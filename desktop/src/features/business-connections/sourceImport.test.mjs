import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeGitHubImport,
  sanitizeGitHubSource,
  sanitizeGoogleDriveImport,
  sanitizeNotionImport,
  sanitizeSlackImport,
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

test("accepts provenance only for the selected Slack channel", () => {
  const workspaceId = "T12345678";
  const source = {
    title: "# operations recent messages",
    content: "# Slack channel: #operations\nMessage text",
    url: "https://slack.com/app_redirect?channel=C12345678&team=T12345678",
    kind: "url",
    truncated: true,
  };
  assert.equal(
    sanitizeSlackImport(source, "C12345678", workspaceId).source.url,
    source.url,
  );
  for (const url of [
    "https://app.slack.com/archives/C12345678",
    "https://slack.com.evil.example/app_redirect?channel=C12345678&team=T12345678",
    "https://slack.com/app_redirect?channel=C87654321&team=T12345678",
    "https://slack.com/app_redirect?channel=C12345678&team=T87654321",
    "https://slack.com/app_redirect?channel=C12345678&team=T12345678&redirect=https://evil.example",
    "https://slack.com/app_redirect?channel=C12345678&channel=C87654321&team=T12345678",
    "https://user:password@slack.com/app_redirect?channel=C12345678&team=T12345678",
    "https://slack.com:444/app_redirect?channel=C12345678&team=T12345678",
  ]) {
    assert.throws(
      () => sanitizeSlackImport({ ...source, url }, "C12345678", workspaceId),
      /invalid channel link/,
    );
  }
  assert.throws(
    () => sanitizeSlackImport(source, "C87654321", workspaceId),
    /invalid channel link/,
  );
  assert.throws(
    () => sanitizeSlackImport(source, "C12345678", "T87654321"),
    /invalid channel link/,
  );
});

test("preserves Slack's native partial-history marker without adding another", () => {
  const marker =
    "[Slack history partially imported by Buzz; older messages, threads, or non-text content were omitted.]";
  const result = sanitizeSlackImport(
    {
      title: "# operations recent messages",
      content: `# Slack channel #operations\n${marker}`,
      url: "https://slack.com/app_redirect?channel=C12345678&team=T12345678",
      kind: "url",
      truncated: true,
    },
    "C12345678",
    "T12345678",
  );
  assert.equal(result.truncated, true);
  assert.equal(result.source.content.split(marker).length - 1, 1);
});

test("accepts Google Drive provenance only for the explicitly selected Doc", () => {
  const selectedId = "doc_id-123";
  const source = {
    title: "Runbook",
    content: "# Runbook\nSelected document text",
    url: `https://docs.google.com/document/d/${selectedId}/edit`,
    kind: "url",
    truncated: false,
  };
  assert.equal(
    sanitizeGoogleDriveImport(source, selectedId).source.url,
    source.url,
  );
  for (const url of [
    `https://docs.google.com.evil.example/document/d/${selectedId}/edit`,
    `https://docs.google.com/document/d/other-id/edit`,
    `https://docs.google.com/document/d/${selectedId}/edit?redirect=https://evil.example`,
    `https://docs.google.com/document/d/${selectedId}/edit/extra`,
    `https://docs.google.com/document/d/${selectedId}/edit/`,
    `https://user:password@docs.google.com/document/d/${selectedId}/edit`,
    `https://docs.google.com:444/document/d/${selectedId}/edit`,
    `http://docs.google.com/document/d/${selectedId}/edit`,
  ]) {
    assert.throws(
      () => sanitizeGoogleDriveImport({ ...source, url }, selectedId),
      /invalid document link/,
    );
  }
  assert.throws(
    () => sanitizeGoogleDriveImport(source, "another-selected-id"),
    /invalid document link/,
  );
});

test("rejects incomplete README sources", () => {
  assert.throws(
    () =>
      sanitizeGitHubSource({ title: "", content: "", url: "", kind: "url" }),
    /incomplete source/,
  );
});
