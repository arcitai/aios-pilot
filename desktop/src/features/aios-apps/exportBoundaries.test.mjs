import assert from "node:assert/strict";
import test from "node:test";
import {
  createCalendarIcs,
  createSandboxedPreviewDocument,
} from "./htmlPreview.ts";

test("preview CSP is installed before markup that precedes the supplied document head", () => {
  const result = createSandboxedPreviewDocument(
    "<style>body{background:u\\72l(https://example.invalid)}</style><html><head></head><body>Example</body></html>",
  );
  assert.ok(
    result.indexOf('http-equiv="Content-Security-Policy"') <
      result.indexOf("<style>"),
  );
  assert.match(result, /script-src 'none'/);
});

test("calendar text cannot introduce fields using lone carriage returns", () => {
  const result = createCalendarIcs([
    {
      id: "meeting\rATTENDEE:bad",
      title: "Review\rATTENDEE:injected@example.invalid",
      description: "A\r\nB\nC\rD",
      startsAt: "2026-09-24T08:00:00.000Z",
      endsAt: "2026-09-24T09:00:00.000Z",
    },
  ]);
  assert.match(result, /SUMMARY:Review\\nATTENDEE:injected@example.invalid/);
  assert.match(result, /DESCRIPTION:A\\nB\\nC\\nD/);
  assert.ok(
    !result
      .split("\r\n")
      .some((line) => line.includes("\r") || line.startsWith("ATTENDEE:")),
  );
});
