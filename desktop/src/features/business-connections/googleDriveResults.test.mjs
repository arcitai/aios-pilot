import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_GOOGLE_DRIVE_RESULTS,
  mergeGoogleDriveResults,
} from "./googleDriveResults.ts";

function file(id, title = `Doc ${id}`) {
  return {
    id,
    title,
    mimeType: "application/vnd.google-apps.document",
    modifiedTime: null,
    url: `https://docs.google.com/document/d/${id}/edit`,
  };
}

test("updates duplicates by file ID and caps accumulated Drive results", () => {
  const initial = Array.from({ length: MAX_GOOGLE_DRIVE_RESULTS }, (_, index) =>
    file(`id-${index}`),
  );
  const merged = mergeGoogleDriveResults(initial, [
    file("id-2", "Updated title"),
    file("new-id"),
  ]);
  assert.equal(merged.length, MAX_GOOGLE_DRIVE_RESULTS);
  assert.equal(
    merged.find((entry) => entry.id === "id-2")?.title,
    "Updated title",
  );
  assert.equal(
    merged.some((entry) => entry.id === "new-id"),
    false,
  );
});
