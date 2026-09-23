import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { parseBusinessDocument } from "./document.ts";

// Read the very same files as buzz-business's production-validator tests.
// A copied parser or copied fixture corpus would hide cross-language drift.
const fixtures = new URL(
  "../../../../crates/buzz-business/tests/fixtures/",
  import.meta.url,
);
const files = readdirSync(fixtures).filter((name) => name.endsWith(".json"));
assert.ok(files.length > 0, "shared schema fixtures must exist");

for (const filename of files.sort()) {
  test(`shared business schema: ${filename}`, () => {
    const input = readFileSync(new URL(filename, fixtures), "utf8");
    if (filename.startsWith("valid-")) {
      assert.deepEqual(parseBusinessDocument(input), JSON.parse(input));
    } else {
      assert.ok(
        filename.startsWith("invalid-"),
        "fixture declares its outcome",
      );
      assert.throws(() => parseBusinessDocument(input));
    }
  });
}
