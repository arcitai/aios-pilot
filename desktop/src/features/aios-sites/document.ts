import { z } from "zod";
import { SITE_WORKSPACE_MARKER } from "@/shared/lib/appWorkspaceChannel";

export const SITE_DOCUMENT_KIND = "aios.site" as const;
export const SITE_SCHEMA_VERSION = 1 as const;
export const SITE_CHANNEL_MARKER = SITE_WORKSPACE_MARKER;
export const MAX_SITE_DOCUMENT_BYTES = 200_000;
export const MAX_SITE_TITLE_CODE_UNITS = 120;
export const MAX_SITE_HTML_CODE_UNITS = 120_000;
export const MAX_SITE_CSS_CODE_UNITS = 80_000;
export const MAX_SITE_JS_CODE_UNITS = 80_000;
export const MAX_SITE_TITLE_LENGTH = MAX_SITE_TITLE_CODE_UNITS;

const channelIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const siteDocumentSchema = z
  .object({
    schemaVersion: z.literal(SITE_SCHEMA_VERSION),
    kind: z.literal(SITE_DOCUMENT_KIND),
    siteId: channelIdSchema,
    parentBusinessChannelId: channelIdSchema,
    title: z
      .string()
      .min(1)
      .max(MAX_SITE_TITLE_CODE_UNITS)
      .refine((value) => value.trim().length > 0),
    files: z
      .object({
        indexHtml: z.string().max(MAX_SITE_HTML_CODE_UNITS),
        styleCss: z.string().max(MAX_SITE_CSS_CODE_UNITS),
        appJs: z.string().max(MAX_SITE_JS_CODE_UNITS),
      })
      .strict(),
  })
  .strict();

export type SiteDocument = z.infer<typeof siteDocumentSchema>;
export type SiteFiles = SiteDocument["files"];

export function siteChannelDescription(parentBusinessChannelId: string) {
  if (!channelIdSchema.safeParse(parentBusinessChannelId).success) {
    throw new Error("The business workspace channel id is malformed.");
  }
  return `AIOS private site workspace for business channel ${parentBusinessChannelId} ${SITE_CHANNEL_MARKER}`;
}

export function isSiteChannelDescription(
  description: string,
  parentBusinessChannelId: string,
) {
  try {
    return description === siteChannelDescription(parentBusinessChannelId);
  } catch {
    return false;
  }
}

export function newSiteDocument(
  siteId: string,
  parentBusinessChannelId: string,
  title: string,
): SiteDocument {
  return siteDocumentSchema.parse({
    schemaVersion: SITE_SCHEMA_VERSION,
    kind: SITE_DOCUMENT_KIND,
    siteId,
    parentBusinessChannelId,
    title: title.trim(),
    files: { indexHtml: "", styleCss: "", appJs: "" },
  });
}

export function parseSiteDocument(
  content: string,
  expectedParentBusinessChannelId?: string,
): SiteDocument {
  if (new TextEncoder().encode(content).byteLength > MAX_SITE_DOCUMENT_BYTES) {
    throw new Error(
      "This site document is larger than the 200 KB limit. Its canvas was left untouched.",
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    throw new Error(
      "This canvas is not valid Sites JSON. Its content was left untouched.",
    );
  }

  const parsed = siteDocumentSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(
      "This canvas does not match the supported Sites v1 schema. Its content was left untouched.",
    );
  }
  if (
    expectedParentBusinessChannelId !== undefined &&
    parsed.data.parentBusinessChannelId !== expectedParentBusinessChannelId
  ) {
    throw new Error(
      "This site belongs to a different business workspace. Its content was left untouched.",
    );
  }
  return parsed.data;
}

export function serializeSiteDocument(document: SiteDocument) {
  const parsed = siteDocumentSchema.safeParse(document);
  if (!parsed.success) {
    throw new Error("The site document is invalid and cannot be saved.");
  }
  const content = JSON.stringify(parsed.data, null, 2);
  if (new TextEncoder().encode(content).byteLength > MAX_SITE_DOCUMENT_BYTES) {
    throw new Error(
      "This site document is larger than the 200 KB limit. Shorten the code before saving.",
    );
  }
  return content;
}

export function siteChannelName(title: string, nonce: string) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 34)
    .replace(/-$/g, "");
  const suffix = nonce
    .replace(/[^a-z0-9]/gi, "")
    .slice(-4)
    .toLowerCase();
  return `site-${slug || "app"}-${suffix || "new1"}`;
}

export function siteDownloadName(title: string) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-$/g, "");
  return `${slug || "buzz-site"}.html`;
}
