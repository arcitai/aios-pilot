import assert from "node:assert/strict";
import test from "node:test";

const { createBusinessConnectionsApi } = await import(
  "./tauriBusinessConnections.ts"
);

test("all provider commands keep the rendered A scope when native workspace is B", async () => {
  const renderedScopeA = {
    expectedRelayUrl: "wss://community-a.example",
    expectedSignerPubkey: "a".repeat(64),
  };
  const activeNativeWorkspaceB = {
    relay_url: "wss://community-b.example",
    pubkey: "b".repeat(64),
  };
  const calls = [];
  let activeWorkspaceReads = 0;

  const api = createBusinessConnectionsApi(async (command, args) => {
    if (command === "get_active_workspace") {
      activeWorkspaceReads += 1;
      return activeNativeWorkspaceB;
    }
    calls.push({ command, args });
    if (command === "get_github_connection_status") {
      return { connected: false, login: null };
    }
    if (command === "connect_github_connection") {
      return { login: "octocat" };
    }
    if (command === "list_github_repositories") return [];
    if (command === "import_github_readme") {
      return {
        title: "acme/widget README",
        content: "# Widget",
        url: "https://github.com/acme/widget",
        kind: "url",
        truncated: false,
      };
    }
    if (command === "get_notion_connection_status") {
      return { connected: false, name: null };
    }
    if (command === "connect_notion_connection") {
      return {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Buzz integration",
      };
    }
    if (command === "search_notion_pages") {
      return { pages: [], hasMore: false, nextCursor: null };
    }
    if (command === "import_notion_page") {
      return {
        title: "Runbook",
        content: "# Runbook",
        url: "https://www.notion.so/11111111111141118111111111111111",
        kind: "url",
        truncated: false,
      };
    }
    return undefined;
  });

  await api.getGitHubConnectionStatus(renderedScopeA);
  await api.connectGitHubConnection(renderedScopeA, "fixture-token-only");
  await api.listGitHubRepositories(renderedScopeA);
  await api.importGitHubReadme(renderedScopeA, 42);
  await api.revokeGitHubConnection(renderedScopeA);
  await api.getNotionConnectionStatus(renderedScopeA);
  await api.connectNotionConnection(
    renderedScopeA,
    "fixture-notion-token-only",
  );
  await api.searchNotionPages(renderedScopeA, "runbook", "opaque-cursor");
  await api.importNotionPage(
    renderedScopeA,
    "11111111-1111-4111-8111-111111111111",
  );
  await api.revokeNotionConnection(renderedScopeA);

  assert.equal(activeWorkspaceReads, 0);
  assert.deepEqual(
    calls.map(({ command, args }) => ({
      command,
      expectedRelayUrl: args.expectedRelayUrl,
      expectedSignerPubkey: args.expectedSignerPubkey,
    })),
    [
      "get_github_connection_status",
      "connect_github_connection",
      "list_github_repositories",
      "import_github_readme",
      "revoke_github_connection",
      "get_notion_connection_status",
      "connect_notion_connection",
      "search_notion_pages",
      "import_notion_page",
      "revoke_notion_connection",
    ].map((command) => ({
      command,
      expectedRelayUrl: renderedScopeA.expectedRelayUrl,
      expectedSignerPubkey: renderedScopeA.expectedSignerPubkey,
    })),
  );
  assert.equal(calls[1].args.token, "fixture-token-only");
  assert.equal(calls[6].args.token, "fixture-notion-token-only");
  assert.equal(calls[7].args.query, "runbook");
  assert.equal(calls[7].args.cursor, "opaque-cursor");
  assert.notEqual(
    renderedScopeA.expectedRelayUrl,
    activeNativeWorkspaceB.relay_url,
  );
});
