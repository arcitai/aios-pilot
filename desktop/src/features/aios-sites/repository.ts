import {
  addChannelMembers,
  createChannel,
  getCanvas,
  getCanvasHistory,
  getChannels,
  setCanvas,
} from "@/shared/api/tauri";
import type { CanvasScope } from "@/shared/api/canvasTypes";
import type { CanvasRevision } from "@/shared/api/types";
import type { Channel } from "@/shared/api/types";
import {
  newSiteDocument,
  parseSiteDocument,
  serializeSiteDocument,
  siteChannelName,
  siteChannelDescription,
  type SiteDocument,
} from "./document";

export const MAX_SITE_CHANNELS = 100;
const SITE_HISTORY_PAGE_SIZE = 20;

export class MalformedSiteCanvasError extends Error {
  readonly rawContent: string;

  constructor(message: string, rawContent: string) {
    super(message);
    this.name = "MalformedSiteCanvasError";
    this.rawContent = rawContent;
  }
}

export function isSiteChannel(
  channel: Channel,
  parentBusinessChannelId: string,
) {
  return (
    channel.isMember &&
    channel.visibility === "private" &&
    channel.channelType === "stream" &&
    channel.description === siteChannelDescription(parentBusinessChannelId) &&
    !channel.archivedAt
  );
}

export async function listSiteChannels(parentBusinessChannelId: string) {
  const result = await getChannels(null);
  if (result.channels === null) {
    throw new Error("Buzz did not return the channel list. Try again.");
  }
  const sites = result.channels.filter((channel) =>
    isSiteChannel(channel, parentBusinessChannelId),
  );
  if (sites.length > MAX_SITE_CHANNELS) {
    throw new Error(
      `This workspace has more than ${MAX_SITE_CHANNELS} Sites channels. The full list was not opened.`,
    );
  }
  return sites;
}

export async function loadSiteCanvas(
  channel: Channel,
  parentBusinessChannelId: string,
  scope: CanvasScope,
) {
  if (!isSiteChannel(channel, parentBusinessChannelId)) {
    throw new Error("This private Sites channel is no longer available.");
  }
  const canvas = await getCanvas(channel.id, scope);
  let document: SiteDocument | null = null;
  if (canvas.content !== null) {
    try {
      document = parseSiteDocument(canvas.content, parentBusinessChannelId);
    } catch (cause) {
      throw new MalformedSiteCanvasError(
        cause instanceof Error ? cause.message : "This canvas is malformed.",
        canvas.content,
      );
    }
  }
  if (document && document.siteId !== channel.id) {
    throw new Error(
      "The canvas site id does not match its private channel. Its content was left untouched.",
    );
  }
  return {
    document,
    revision: canvas.eventId ?? "none",
    updatedAt: canvas.updatedAt,
  };
}

export async function createSiteChannel(
  title: string,
  parentBusinessChannelId: string,
  scope: CanvasScope,
) {
  if (!title.trim()) {
    throw new Error("Enter a name for this site.");
  }
  const existing = await listSiteChannels(parentBusinessChannelId);
  if (existing.length >= MAX_SITE_CHANNELS) {
    throw new Error(
      `A business workspace can have at most ${MAX_SITE_CHANNELS} Sites.`,
    );
  }
  return createChannel({
    ...scope,
    name: siteChannelName(title, crypto.randomUUID()),
    channelType: "stream",
    visibility: "private",
    description: siteChannelDescription(parentBusinessChannelId),
  });
}

export function makeNewSiteDocument(
  channelId: string,
  parentBusinessChannelId: string,
  title: string,
) {
  return newSiteDocument(channelId, parentBusinessChannelId, title);
}

export async function saveSiteCanvas(
  channelId: string,
  document: SiteDocument,
  expectedRevision: string,
  scope: CanvasScope,
) {
  const content = serializeSiteDocument(document);
  return setCanvas({
    channelId,
    content,
    expectedRevision,
    ...scope,
  });
}

export async function getSiteHistory(
  channelId: string,
  parentBusinessChannelId: string,
  scope: CanvasScope,
) {
  const response = await getCanvasHistory(channelId, {
    limit: SITE_HISTORY_PAGE_SIZE,
    scope,
  });
  return response.revisions.map((revision: CanvasRevision) => {
    const document = parseSiteDocument(
      revision.content,
      parentBusinessChannelId,
    );
    if (document.siteId !== channelId) {
      throw new Error(
        "A history entry belongs to a different site. Its content was left untouched.",
      );
    }
    return { revision, document };
  });
}

export async function addSiteMember(
  channelId: string,
  pubkey: string,
  scope: CanvasScope,
) {
  const normalizedPubkey = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedPubkey)) {
    throw new Error("Enter one 64-character public key in hex format.");
  }
  return addChannelMembers({
    channelId,
    pubkeys: [normalizedPubkey],
    role: "member",
    ...scope,
  });
}

export function siteChannelTitle(channel: Channel) {
  return channel.name.replace(/^site-/, "").replace(/-[a-z0-9]{4}$/i, "");
}
