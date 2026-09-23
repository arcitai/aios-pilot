import assert from "node:assert/strict";
import test from "node:test";

const { createBusinessConnectionsApi } = await import(
  "./tauriBusinessConnections.ts"
);

test("all GitHub commands keep the rendered A scope when native workspace is B", async () => {
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
      };
    }
    return undefined;
  });

  await api.getGitHubConnectionStatus(renderedScopeA);
  await api.connectGitHubConnection(renderedScopeA, "fixture-token-only");
  await api.listGitHubRepositories(renderedScopeA);
  await api.importGitHubReadme(renderedScopeA, 42);
  await api.revokeGitHubConnection(renderedScopeA);

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
    ].map((command) => ({
      command,
      expectedRelayUrl: renderedScopeA.expectedRelayUrl,
      expectedSignerPubkey: renderedScopeA.expectedSignerPubkey,
    })),
  );
  assert.equal(calls[1].args.token, "fixture-token-only");
  assert.notEqual(
    renderedScopeA.expectedRelayUrl,
    activeNativeWorkspaceB.relay_url,
  );
});
