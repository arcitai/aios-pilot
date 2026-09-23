import type { NotionPageSummary } from "@/shared/api/tauriBusinessConnections";

export const MAX_NOTION_PAGE_RESULTS = 100;

/** Append one result page, update duplicate records, and keep a hard UI bound. */
export function mergeNotionPageResults(
  existing: readonly NotionPageSummary[],
  incoming: readonly NotionPageSummary[],
): NotionPageSummary[] {
  const pagesById = new Map<string, NotionPageSummary>();
  for (const page of [...existing, ...incoming]) {
    pagesById.set(page.id, page);
  }
  return [...pagesById.values()].slice(0, MAX_NOTION_PAGE_RESULTS);
}
