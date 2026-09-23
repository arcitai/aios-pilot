import {
  deserializeAppsWorkspaceDocument,
  serializeAppsWorkspaceDocument,
} from "./types";
import type { AppsWorkspaceDocument } from "./types";

export type AppDocumentScope = {
  communityId?: string;
  expectedRelayUrl: string;
  expectedSignerPubkey: string;
  channelId: string;
};

export type AppDocumentSaveResult = {
  /** False means the relay accepted the write but could not verify its head. */
  verified: boolean;
};

/**
 * Persistence seam for app documents. Implementations should load and replace
 * one complete versioned snapshot so an edit never leaves a partial app set.
 */
export interface AppDocumentStore {
  /** User-facing description of where writes go, such as "This device only". */
  readonly label: string;
  load(
    scope: AppDocumentScope,
    defaults?: AppsWorkspaceDocument,
  ): Promise<unknown | null>;
  save(
    scope: AppDocumentScope,
    document: AppsWorkspaceDocument,
  ): Promise<AppDocumentSaveResult>;
}

export function appDocumentStorageKey(scope: AppDocumentScope): string {
  return [
    "buzz:aios-apps:v1",
    scope.communityId ?? "",
    scope.expectedRelayUrl.trim(),
    scope.expectedSignerPubkey.trim().toLowerCase(),
    scope.channelId,
  ]
    .map((part, index) => (index === 0 ? part : encodeURIComponent(part)))
    .join(":");
}

/**
 * Temporary local adapter. App documents remain private to this desktop
 * storage profile and are separated by community, identity, and channel.
 */
export class LocalAppDocumentStore implements AppDocumentStore {
  readonly label = "This device only";
  private readonly storage?: Storage;

  constructor(storage?: Storage) {
    this.storage = storage;
  }

  async load(scope: AppDocumentScope): Promise<unknown | null> {
    const raw = this.getStorage().getItem(appDocumentStorageKey(scope));
    if (raw === null) return null;
    const parsed = deserializeAppsWorkspaceDocument(raw, scope.channelId);
    if (!parsed.ok) {
      throw new Error(`Couldn't read the saved apps: ${parsed.reason}`);
    }
    return parsed.document;
  }

  async save(
    scope: AppDocumentScope,
    document: AppsWorkspaceDocument,
  ): Promise<AppDocumentSaveResult> {
    if (document.channelId !== scope.channelId) {
      throw new Error(
        "The app document channel does not match its storage scope.",
      );
    }
    const serialized = serializeAppsWorkspaceDocument(document);
    this.getStorage().setItem(appDocumentStorageKey(scope), serialized);
    return { verified: true };
  }

  private getStorage(): Storage {
    if (this.storage) return this.storage;
    if (typeof window === "undefined") {
      throw new Error(
        "Local app storage is unavailable outside the desktop app.",
      );
    }
    return window.localStorage;
  }
}

export const localAppDocumentStore = new LocalAppDocumentStore();
