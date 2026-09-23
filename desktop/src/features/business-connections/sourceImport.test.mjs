import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeGitHubImport,
  sanitizeGitHubSource,
  sanitizeNotionImport,
} from "./sourceImport.ts";

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

test("caps imports at 40,000 UTF-16 units and marks truncation", () => {
  const imported = sanitizeGitHubImport({
    title: "README",
    content: "🧭".repeat(20_005),
    url: "https://github.com/acme/widget",
    kind: "url",
  });
  assert.equal(imported.truncated, true);
  assert.ok(imported.source.content.length <= 40_000);
  assert.match(imported.source.content, /truncated by Buzz/);
  assert.ok(!imported.source.content.includes("\uFFFD"));
});

test("preserves a native partial-import flag even when text fits", () => {
  const imported = sanitizeGitHubImport({
    title: "README",
    content: "# Partial\n[README truncated by native provider]",
    url: "https://github.com/acme/widget",
    kind: "url",
    truncated: true,
  });
  assert.equal(imported.truncated, true);
  assert.equal(imported.source.content.includes("native provider"), true);
  assert.match(imported.source.content, /provider omitted content/);
});

test("accepts fixed Notion provenance URLs but never a URL with extra fetch targets", () => {
  const imported = sanitizeNotionImport(
    {
      title: "Runbook",
      content: "# Runbook\nText",
      url: "https://app.notion.com/p/Runbook-11111111111141118111111111111111",
      kind: "url",
      truncated: false,
    },
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(
    imported.source.url,
    "https://app.notion.com/p/Runbook-11111111111141118111111111111111",
  );
  const legacyUrl =
    "https://www.notion.so/workspace/Runbook-11111111111141118111111111111111";
  assert.equal(
    sanitizeNotionImport(
      {
        title: "Runbook",
        content: "text",
        url: legacyUrl,
        kind: "url",
      },
      "11111111-1111-4111-8111-111111111111",
    ).source.url,
    legacyUrl,
  );
  for (const url of [
    "https://notion.so.evil.example/11111111111141118111111111111111",
    "https://app.notion.com/p/Runbook-11111111111141118111111111111111?redirect=https://evil.example",
    "https://www.notion.so/one/two/three/four/five/six/seven/eight/nine/11111111111141118111111111111111",
    "https://user:password@www.notion.so/11111111111141118111111111111111",
    "https://app.notion.com/Runbook-11111111111141118111111111111111",
  ]) {
    assert.throws(
      () =>
        sanitizeNotionImport(
          {
            title: "Runbook",
            content: "text",
            url,
            kind: "url",
          },
          "11111111-1111-4111-8111-111111111111",
        ),
      /invalid page link/,
    );
  }
  assert.throws(
    () =>
      sanitizeNotionImport(
        {
          title: "Runbook",
          content: "text",
          url: "https://app.notion.com/p/Runbook-11111111111141118111111111111111",
          kind: "url",
        },
        "not-a-page-id",
      ),
    /invalid page link/,
  );
  assert.throws(
    () =>
      sanitizeNotionImport(
        {
          title: "Runbook",
          content: "text",
          url: "https://app.notion.com/p/Runbook-22222222222242228222222222222222",
          kind: "url",
        },
        "11111111-1111-4111-8111-111111111111",
      ),
    /invalid page link/,
  );
});

test("rejects incomplete README sources", () => {
  assert.throws(
    () =>
      sanitizeGitHubSource({ title: "", content: "", url: "", kind: "url" }),
    /incomplete source/,
  );
});
