import { invoke } from "@tauri-apps/api/core";
import type { SiteFiles } from "./document";

export const SITES_PUBLISHER_DEFAULT_ORIGIN = "http://127.0.0.1:3352";

export function canEmbedLocalPreview(value: string | null) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port === "3351" &&
      /^\/previews\/[a-f0-9]{32}$/i.test(url.pathname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export type PublisherScopeInput = {
  managerUrl: string;
  expectedRelayUrl: string;
  expectedSignerPubkey: string;
};

export type PublisherConnectionStatus = {
  connected: boolean;
  version: string | null;
};

export type PublishedSiteStatus = {
  siteId: string;
  published: boolean;
  contentHash: string | null;
  publicUrl: string | null;
};

export type PublishSiteResult = {
  siteId: string;
  contentHash: string;
  publicUrl: string;
  alreadyPublished: boolean;
};

export type SitePreviewResult = {
  previewUrl: string;
  expiresInSeconds: number;
};

export function getPublisherStatus(scope: PublisherScopeInput) {
  return invoke<PublisherConnectionStatus>("sites_publisher_status", scope);
}

export function connectPublisher(scope: PublisherScopeInput, token: string) {
  return invoke<PublisherConnectionStatus>("connect_sites_publisher", {
    ...scope,
    token,
  });
}

export function disconnectPublisher(scope: PublisherScopeInput) {
  return invoke<void>("disconnect_sites_publisher", scope);
}

export function createSitePreview(
  scope: PublisherScopeInput,
  siteId: string,
  title: string,
  files: SiteFiles,
) {
  return invoke<SitePreviewResult>("sites_publisher_preview", {
    ...scope,
    siteId,
    title,
    files,
  });
}

export function getPublishedSiteStatus(
  scope: PublisherScopeInput,
  siteId: string,
) {
  return invoke<PublishedSiteStatus>("sites_publisher_site_status", {
    ...scope,
    siteId,
  });
}

export function publishSite(
  scope: PublisherScopeInput,
  siteId: string,
  title: string,
  files: SiteFiles,
) {
  return invoke<PublishSiteResult>("publish_sites_site", {
    ...scope,
    siteId,
    title,
    files,
  });
}

export function revokeSite(scope: PublisherScopeInput, siteId: string) {
  return invoke<boolean>("revoke_sites_site", { ...scope, siteId });
}

export async function siteContentHash(
  siteId: string,
  title: string,
  files: SiteFiles,
) {
  const snapshot = JSON.stringify({ schemaVersion: 1, siteId, title, files });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(snapshot),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
