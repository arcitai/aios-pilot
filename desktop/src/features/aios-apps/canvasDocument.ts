import {
  MAX_APP_CANVAS_DOCUMENT_BYTES,
  parseAppDocument,
  type AppDocument,
  type AppId,
} from "./types";

export const APP_CANVAS_KIND = "aios.app-document" as const;
export const APP_CANVAS_VERSION = 1 as const;

export type AppCanvasEnvelope = {
  kind: typeof APP_CANVAS_KIND;
  schemaVersion: typeof APP_CANVAS_VERSION;
  marker: string;
  businessChannelId: string;
  appId: AppId;
  document: AppDocument;
};

export type AppCanvasParseResult =
  | { ok: true; envelope: AppCanvasEnvelope }
  | { ok: false; reason: string };

export function appCanvasMarker(
  businessChannelId: string,
  appId: AppId,
): string {
  return `aios.app-document:v1:${encodeURIComponent(businessChannelId)}:${appId}`;
}

/** Assert an empty Canvas head instead of sending an unconditional append. */
export function appCanvasExpectedRevision(revision: string | null): string {
  return revision ?? "none";
}

export function serializeAppCanvasEnvelope(
  businessChannelId: string,
  appId: AppId,
  document: AppDocument,
): string {
  const parsedDocument = parseAppDocument(appId, document);
  if (!parsedDocument) {
    throw new Error(`The ${appId} document does not match schema version 1.`);
  }
  const envelope: AppCanvasEnvelope = {
    kind: APP_CANVAS_KIND,
    schemaVersion: APP_CANVAS_VERSION,
    marker: appCanvasMarker(businessChannelId, appId),
    businessChannelId,
    appId,
    document: parsedDocument,
  };
  const serialized = JSON.stringify(envelope);
  if (
    new TextEncoder().encode(serialized).byteLength >
    MAX_APP_CANVAS_DOCUMENT_BYTES
  ) {
    throw new Error("The app document exceeds the 240 KB Canvas limit.");
  }
  return serialized;
}

export function parseAppCanvasEnvelope(
  serialized: string,
  expectedBusinessChannelId: string,
  expectedAppId: AppId,
): AppCanvasParseResult {
  if (
    new TextEncoder().encode(serialized).byteLength >
    MAX_APP_CANVAS_DOCUMENT_BYTES
  ) {
    return { ok: false, reason: "The app Canvas exceeds 240 KB." };
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    return { ok: false, reason: "The app Canvas is not valid JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "The app Canvas marker is missing." };
  }
  const record = value as Record<string, unknown>;
  const expectedMarker = appCanvasMarker(
    expectedBusinessChannelId,
    expectedAppId,
  );
  if (
    record.kind !== APP_CANVAS_KIND ||
    record.schemaVersion !== APP_CANVAS_VERSION ||
    record.marker !== expectedMarker ||
    record.businessChannelId !== expectedBusinessChannelId ||
    record.appId !== expectedAppId
  ) {
    return {
      ok: false,
      reason:
        "The app Canvas marker does not match this business channel and app.",
    };
  }
  const document = parseAppDocument(expectedAppId, record.document);
  if (!document) {
    return {
      ok: false,
      reason: `The ${expectedAppId} Canvas document is malformed or uses an unsupported version.`,
    };
  }
  return {
    ok: true,
    envelope: {
      kind: APP_CANVAS_KIND,
      schemaVersion: APP_CANVAS_VERSION,
      marker: expectedMarker,
      businessChannelId: expectedBusinessChannelId,
      appId: expectedAppId,
      document,
    },
  };
}
