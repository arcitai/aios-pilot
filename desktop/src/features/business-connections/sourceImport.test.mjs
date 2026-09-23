import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeGitHubSource } from "./sourceImport.ts";

test("sanitizes README title and control characters while preserving Markdown", () => {
  assert.deepEqual(
    sanitizeGitHubSource({
      title: "\u0000Acme/widget README\u0007",
      content: "# Intro\u0000\n\tText\u0007\n",
      url: "https://github.com/Acme/widget",
      kind: "url",
    }),
    {
      title: "Acme/widget README",
      content: "# Intro\n\tText\n",
      url: "https://github.com/Acme/widget",
      kind: "url",
    },
  );
});

test("rejects external, credential-bearing, or non-repository links", () => {
  for (const url of [
    "https://raw.githubusercontent.com/acme/widget/main/README.md",
    "https://github.com.evil.example/acme/widget",
    "https://user:password@github.com/acme/widget",
    "https://github.com/acme/widget/tree/main",
  ]) {
    assert.throws(
      () =>
        sanitizeGitHubSource({
          title: "README",
          content: "# text",
          url,
          kind: "url",
        }),
      /invalid repository link/,
    );
  }
});

test("rejects oversized and incomplete README sources", () => {
  assert.throws(
    () =>
      sanitizeGitHubSource({
        title: "README",
        content: "x".repeat(256 * 1024 + 1),
        url: "https://github.com/acme/widget",
        kind: "url",
      }),
    /too large/,
  );
  assert.throws(
    () =>
      sanitizeGitHubSource({ title: "", content: "", url: "", kind: "url" }),
    /incomplete README/,
  );
});
