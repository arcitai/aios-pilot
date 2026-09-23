import {
  createChannel,
  getChannelMembers,
  getChannels,
} from "@/shared/api/tauriChannels";
import type {
  Channel,
  ChannelMember,
  CreateChannelInput,
  SetCanvasInput,
  SetCanvasResult,
} from "@/shared/api/types";
import { getCanvas, getRelayWsUrl, setCanvas } from "@/shared/api/tauri";
import { getIdentity } from "@/shared/api/tauriIdentity";
import type { CanvasResponse } from "@/shared/api/canvasTypes";
import { canonicalRelayUrl } from "@/features/agents/managedAgentRuntimeStatus";

import {
  appCanvasExpectedRevision,
  appCanvasMarker,
  parseAppCanvasEnvelope,
  serializeAppCanvasEnvelope,
} from "./canvasDocument";
import {
  appDocumentStorageKey,
  type AppDocumentScope,
  type AppDocumentStore,
} from "./storage";
import {
  createInitialAppsWorkspace,
  parseAppsWorkspaceDocument,
  type AppDocument,
  type AppId,
  type AppsWorkspaceDocument,
} from "./types";

type CanvasScope = {
  expectedRelayUrl: string;
  expectedSignerPubkey: string;
};

type ScopedCreateChannelInput = CreateChannelInput & CanvasScope;
type ScopedSetCanvasInput = SetCanvasInput & CanvasScope;

type AppCanvasChannelState = {
  channelId: string | null;
  revision: string | null;
  document: AppDocument;
};

type AppCanvasCache = Record<AppId, AppCanvasChannelState>;

export type AppChannelAccess = {
  channel: Channel | null;
  members: ChannelMember[];
};

/** The relay marker is deliberately separate from the business channel Canvas. */
export class CanvasAppDocumentStore implements AppDocumentStore {
  readonly label = "Private Buzz app channels";

  private readonly cache = new Map<string, AppCanvasCache>();

  async load(
    scope: AppDocumentScope,
    initialDocument?: AppsWorkspaceDocument,
  ): Promise<unknown | null> {
    const channels = await this.listChannels();
    this.assertBusinessMembership(channels, scope);
    const defaults =
      initialDocument ?? createInitialAppsWorkspace(scope.channelId);
    const parsedDefaults = parseAppsWorkspaceDocument(
      defaults,
      scope.channelId,
    );
    if (!parsedDefaults.ok) throw new Error(parsedDefaults.reason);
    const state: AppCanvasCache = {
      slides: {
        channelId: null,
        revision: null,
        document: parsedDefaults.document.documents.slides,
      },
      calendar: {
        channelId: null,
        revision: null,
        document: parsedDefaults.document.documents.calendar,
      },
      design: {
        channelId: null,
        revision: null,
        document: parsedDefaults.document.documents.design,
      },
    };

    for (const appId of APP_IDS) {
      const channel = this.findAppChannel(channels, scope, appId);
      if (!channel) continue;
      this.assertPrivateMembership(channel, scope);
      const canvas = await this.readCanvas(channel.id, scope);
      state[appId] = {
        channelId: channel.id,
        revision: canvas.eventId,
        document:
          canvas.content === null
            ? parsedDefaults.document.documents[appId]
            : this.parseDocument(canvas.content, scope, appId),
      };
    }

    this.cacheState(appDocumentStorageKey(scope), state);
    const snapshot: AppsWorkspaceDocument = {
      ...parsedDefaults.document,
      documents: {
        slides: state.slides
          .document as AppsWorkspaceDocument["documents"]["slides"],
        calendar: state.calendar
          .document as AppsWorkspaceDocument["documents"]["calendar"],
        design: state.design
          .document as AppsWorkspaceDocument["documents"]["design"],
      },
    };
    return snapshot;
  }

  async save(
    scope: AppDocumentScope,
    value: AppsWorkspaceDocument,
  ): Promise<{ verified: boolean }> {
    const parsed = parseAppsWorkspaceDocument(value, scope.channelId);
    if (!parsed.ok) throw new Error(parsed.reason);
    const key = appDocumentStorageKey(scope);
    let state = this.cachedState(key);
    if (!state) {
      await this.load(scope, parsed.document);
      state = this.cachedState(key);
    }
    if (!state)
      throw new Error("The private app channel state could not be loaded.");

    let allWritesVerified = true;
    for (const appId of APP_IDS) {
      const nextDocument = parsed.document.documents[appId];
      const previous = state[appId];
      if (documentsEqual(nextDocument, previous.document)) continue;

      const channel = await this.ensureAppChannel(scope, appId);
      const current = await this.readCanvas(channel.id, scope);
      const currentDocument = this.parseOptionalDocument(
        current.content,
        scope,
        appId,
      );
      const currentMatchesPrevious =
        current.content === null
          ? current.eventId === null && previous.revision === null
          : documentsEqual(currentDocument, previous.document);

      if (current.eventId !== previous.revision) {
        if (currentDocument && documentsEqual(currentDocument, nextDocument)) {
          state[appId] = {
            channelId: channel.id,
            revision: current.eventId,
            document: currentDocument,
          };
          continue;
        }
        if (!currentMatchesPrevious) {
          throw new AppCanvasConflictError(appId);
        }
      } else if (!currentMatchesPrevious) {
        throw new AppCanvasConflictError(appId);
      }

      const content = serializeAppCanvasEnvelope(
        scope.channelId,
        appId,
        nextDocument,
      );
      const result = await this.writeCanvas({
        channelId: channel.id,
        content,
        expectedRevision: appCanvasExpectedRevision(current.eventId),
        expectedRelayUrl: scope.expectedRelayUrl,
        expectedSignerPubkey: scope.expectedSignerPubkey,
      });
      if (!result.ok) {
        throw new Error(`The ${appId} Canvas write was rejected by the relay.`);
      }

      if (!result.verified) allWritesVerified = false;
      state[appId] = {
        channelId: channel.id,
        revision: result.eventId,
        document: nextDocument,
      };
    }
    this.cacheState(key, state);
    return { verified: allWritesVerified };
  }

  /** Load the private app channel and its access list in the captured scope. */
  async getAppAccess(
    scope: AppDocumentScope,
    appId: AppId,
  ): Promise<AppChannelAccess> {
    await this.assertActiveScope(scope);
    const channels = await this.listChannels();
    await this.assertActiveScope(scope);
    this.assertBusinessMembership(channels, scope);
    const channel = this.findAppChannel(channels, scope, appId);
    if (!channel) return { channel: null, members: [] };

    const members = await getChannelMembers(channel.id);
    await this.assertActiveScope(scope);
    this.assertPrivateMembership(channel, scope);
    if (
      !members.some(
        (member) =>
          member.pubkey.toLowerCase() ===
          scope.expectedSignerPubkey.trim().toLowerCase(),
      )
    ) {
      throw new Error(
        "Your active identity is not listed in this private app channel.",
      );
    }
    return { channel, members };
  }

  /** Create the private app channel only when the user explicitly requests it. */
  async ensureAppChannelForAccess(
    scope: AppDocumentScope,
    appId: AppId,
  ): Promise<Channel> {
    await this.assertActiveScope(scope);
    const channel = await this.ensureAppChannel(scope, appId);
    await this.assertActiveScope(scope);
    return channel;
  }

  private cachedState(key: string): AppCanvasCache | undefined {
    const state = this.cache.get(key);
    if (state) {
      this.cache.delete(key);
      this.cache.set(key, state);
    }
    return state;
  }

  private cacheState(key: string, state: AppCanvasCache): void {
    this.cache.delete(key);
    this.cache.set(key, state);
    while (this.cache.size > MAX_APP_SCOPE_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }

  private async listChannels(): Promise<Channel[]> {
    const result = await getChannels(null);
    if (result.channels === null) {
      throw new Error("The relay did not return a fresh channel list.");
    }
    return result.channels;
  }

  private async assertActiveScope(scope: AppDocumentScope): Promise<void> {
    const [relayUrl, identity] = await Promise.all([
      getRelayWsUrl(),
      getIdentity(),
    ]);
    const expectedRelay = canonicalRelayUrl(scope.expectedRelayUrl);
    const activeRelay = canonicalRelayUrl(relayUrl);
    const relayMatches =
      expectedRelay !== null && activeRelay !== null
        ? expectedRelay === activeRelay
        : scope.expectedRelayUrl === relayUrl;
    if (
      !relayMatches ||
      identity.pubkey.toLowerCase() !==
        scope.expectedSignerPubkey.trim().toLowerCase()
    ) {
      throw new Error(
        "The active relay or identity changed. Reopen app access in the current workspace.",
      );
    }
  }

  private assertBusinessMembership(
    channels: Channel[],
    scope: AppDocumentScope,
  ): Channel {
    const businessChannel = channels.find(
      (channel) => channel.id === scope.channelId,
    );
    if (!businessChannel?.isMember) {
      throw new Error(
        "You need access to this business channel before its apps can use shared storage.",
      );
    }
    return businessChannel;
  }

  private findAppChannel(
    channels: Channel[],
    scope: AppDocumentScope,
    appId: AppId,
  ): Channel | null {
    const marker = appCanvasMarker(scope.channelId, appId);
    const candidates = channels.filter(
      (channel) => channel.description === marker,
    );
    if (candidates.length > 1) {
      throw new Error(
        `More than one private channel has the ${appId} app marker. Ask an admin to resolve the duplicate before editing.`,
      );
    }
    const candidate = candidates[0];
    if (!candidate) return null;
    this.assertPrivateMembership(candidate, scope);
    return candidate;
  }

  private async ensureAppChannel(
    scope: AppDocumentScope,
    appId: AppId,
  ): Promise<Channel> {
    const channels = await this.listChannels();
    this.assertBusinessMembership(channels, scope);
    const existing = this.findAppChannel(channels, scope, appId);
    if (existing) return existing;

    const marker = appCanvasMarker(scope.channelId, appId);
    const input: ScopedCreateChannelInput = {
      name: `aios-${appId}-${scope.channelId.slice(0, 8)}`,
      channelType: "stream",
      visibility: "private",
      description: marker,
      expectedRelayUrl: scope.expectedRelayUrl,
      expectedSignerPubkey: scope.expectedSignerPubkey,
    };
    const scopedCreateChannel = createChannel as unknown as (
      input: ScopedCreateChannelInput,
    ) => Promise<Channel>;
    let created: Channel;
    try {
      created = await scopedCreateChannel(input);
    } catch (error) {
      // A transport failure can arrive after the relay created the channel.
      // Re-read its exact marker before deciding that setup failed.
      const latest = await this.listChannels().catch(() => []);
      const recovered = this.findAppChannel(latest, scope, appId);
      if (recovered) return recovered;
      throw error;
    }
    if (created.description !== marker) {
      throw new Error(
        "The relay returned an app channel with the wrong marker.",
      );
    }
    this.assertPrivateMembership(created, scope);
    return created;
  }

  private assertPrivateMembership(
    channel: Channel,
    scope: AppDocumentScope,
  ): void {
    const memberPubkeys = new Set(
      channel.memberPubkeys.map((pubkey) => pubkey.toLowerCase()),
    );
    if (
      channel.channelType !== "stream" ||
      channel.visibility !== "private" ||
      !channel.isMember ||
      !memberPubkeys.has(scope.expectedSignerPubkey.trim().toLowerCase())
    ) {
      throw new Error(
        "This app document must be in a private channel that includes your active identity.",
      );
    }
  }

  private async readCanvas(
    channelId: string,
    scope: AppDocumentScope,
  ): Promise<CanvasResponse> {
    const scopedGetCanvas = getCanvas as unknown as (
      channelId: string,
      scope: CanvasScope,
    ) => Promise<CanvasResponse>;
    return scopedGetCanvas(channelId, {
      expectedRelayUrl: scope.expectedRelayUrl,
      expectedSignerPubkey: scope.expectedSignerPubkey,
    });
  }

  private async writeCanvas(
    input: ScopedSetCanvasInput,
  ): Promise<SetCanvasResult> {
    const scopedSetCanvas = setCanvas as unknown as (
      input: ScopedSetCanvasInput,
    ) => Promise<SetCanvasResult>;
    return scopedSetCanvas(input);
  }

  private parseOptionalDocument(
    content: string | null,
    scope: AppDocumentScope,
    appId: AppId,
  ): AppDocument | null {
    if (content === null) return null;
    return this.parseDocument(content, scope, appId);
  }

  private parseDocument(
    content: string,
    scope: AppDocumentScope,
    appId: AppId,
  ): AppDocument {
    const parsed = parseAppCanvasEnvelope(content, scope.channelId, appId);
    if (!parsed.ok) throw new Error(`Couldn't read ${appId}: ${parsed.reason}`);
    return parsed.envelope.document;
  }
}

export class AppCanvasConflictError extends Error {
  readonly code = "APP_CANVAS_CONFLICT";

  constructor(appId: AppId) {
    super(
      `Someone else changed ${appId} in its private app channel. Your local edits are still here; reload the latest document before saving again.`,
    );
    this.name = "AppCanvasConflictError";
  }
}

function documentsEqual(left: AppDocument | null, right: AppDocument): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

const APP_IDS: readonly AppId[] = ["slides", "calendar", "design"];
export const MAX_APP_SCOPE_CACHE_ENTRIES = 100;

export const canvasAppDocumentStore = new CanvasAppDocumentStore();
