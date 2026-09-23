import { MAX_SITE_DOCUMENT_BYTES, type SiteDocument } from "./document";

export function contextKey(context: {
  businessChannelId: string;
  scope: { expectedRelayUrl: string; expectedSignerPubkey: string };
}) {
  return `${context.businessChannelId}\u0000${context.scope.expectedRelayUrl}\u0000${context.scope.expectedSignerPubkey.toLowerCase()}`;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The Sites operation failed.";
}

export function siteTitleFromChannelName(name: string) {
  return name.replace(/^site-/, "").replace(/-[a-z0-9]{4}$/i, "");
}

export function downloadText(
  fileName: string,
  content: string,
  mimeType: string,
) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function serializeForDraft(document: SiteDocument) {
  return JSON.stringify(document, null, 2);
}

export function isDraftDirty(
  document: SiteDocument | null,
  savedCanvasContent: string | null,
) {
  return (
    document !== null &&
    (savedCanvasContent === null ||
      serializeForDraft(document) !== savedCanvasContent)
  );
}

export function documentSize(document: SiteDocument) {
  return new TextEncoder().encode(serializeForDraft(document)).byteLength;
}

export function measureDocument(document: SiteDocument | null) {
  const siteBytes = document ? documentSize(document) : 0;
  return { siteBytes, siteIsTooLarge: siteBytes > MAX_SITE_DOCUMENT_BYTES };
}

export function downloadDraftJson(document: SiteDocument) {
  const slug = document.title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-$/g, "");
  downloadText(
    `${slug || "buzz-site"}.site.json`,
    serializeForDraft(document),
    "application/json;charset=utf-8",
  );
}

export function downloadRawCanvas(content: string) {
  downloadText(
    "untouched-site-canvas.json",
    content,
    "application/json;charset=utf-8",
  );
}

export function downloadConflictCanvas(document: SiteDocument) {
  downloadText(
    "latest-site-canvas.json",
    JSON.stringify(document, null, 2),
    "application/json;charset=utf-8",
  );
}
