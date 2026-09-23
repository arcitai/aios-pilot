import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_NOTION_PAGE_RESULTS,
  mergeNotionPageResults,
} from "./notionResults.ts";

function page(id, title = `Page ${id}`) {
  return {
    id,
    title,
    url: `https://app.notion.com/p/${title}-${id}`,
    lastEditedTime: null,
  };
}

test("Notion pagination deduplicates IDs and refreshes the duplicate item", () => {
  const results = mergeNotionPageResults(
    [page("one"), page("two")],
    [page("two", "Updated two"), page("three")],
  );
  assert.deepEqual(
    results.map((item) => item.id),
    ["one", "two", "three"],
  );
  assert.equal(results[1].title, "Updated two");
});

test("Notion pagination never accumulates more than 100 pages", () => {
  const results = mergeNotionPageResults(
    Array.from({ length: MAX_NOTION_PAGE_RESULTS }, (_, index) =>
      page(`existing-${index}`),
    ),
    [page("incoming-1"), page("incoming-2")],
  );
  assert.equal(results.length, MAX_NOTION_PAGE_RESULTS);
  assert.ok(!results.some((item) => item.id.startsWith("incoming-")));
});
