import assert from "node:assert/strict";
import test from "node:test";

import {
  checkingNotionStatus,
  checkingGitHubStatus,
  checkingSlackStatus,
  reportNotionStatus,
  reportGitHubStatus,
  reportVerifiedGitHubLogin,
  reportVerifiedNotionName,
  reportSlackStatus,
  reportVerifiedSlackWorkspace,
  unknownSlackStatus,
  unknownNotionStatus,
} from "./connectionStatus.ts";

test("only a successful GitHub account check reports verified connected", () => {
  assert.deepEqual(reportGitHubStatus({ connected: true, login: "octocat" }), {
    providerId: "github",
    state: "connected",
    verified: true,
    login: "octocat",
  });
  assert.deepEqual(reportVerifiedGitHubLogin("octocat"), {
    providerId: "github",
    state: "connected",
    verified: true,
    login: "octocat",
  });
});

test("only a verified Notion integration reports connected", () => {
  assert.deepEqual(
    reportNotionStatus({ connected: true, name: "Workspace integration" }),
    {
      providerId: "notion",
      state: "connected",
      verified: true,
      name: "Workspace integration",
    },
  );
  assert.deepEqual(reportVerifiedNotionName("Workspace integration"), {
    providerId: "notion",
    state: "connected",
    verified: true,
    name: "Workspace integration",
  });
  assert.deepEqual(checkingNotionStatus(), {
    providerId: "notion",
    state: "checking",
    verified: false,
  });
  assert.deepEqual(unknownNotionStatus(), {
    providerId: "notion",
    state: "unknown",
    verified: false,
  });
  assert.deepEqual(reportNotionStatus({ connected: false, name: null }), {
    providerId: "notion",
    state: "not_connected",
    verified: false,
  });
});

test("missing, malformed, or pending connection checks cannot report connected", () => {
  assert.deepEqual(checkingGitHubStatus(), {
    providerId: "github",
    state: "checking",
    verified: false,
  });
  assert.deepEqual(reportGitHubStatus({ connected: false }), {
    providerId: "github",
    state: "not_connected",
    verified: false,
  });
  assert.deepEqual(reportGitHubStatus({ connected: true, login: null }), {
    providerId: "github",
    state: "unknown",
    verified: false,
  });
  assert.deepEqual(reportVerifiedGitHubLogin("  "), {
    providerId: "github",
    state: "unknown",
    verified: false,
  });
});

test("Slack is connected only after a bot token verifies its workspace", () => {
  assert.deepEqual(
    reportSlackStatus({
      connected: true,
      workspaceId: "T12345678",
      workspaceName: "Example workspace",
    }),
    {
      providerId: "slack",
      state: "connected",
      verified: true,
      workspaceName: "Example workspace",
    },
  );
  assert.deepEqual(
    reportVerifiedSlackWorkspace("T12345678", "Example workspace"),
    {
      providerId: "slack",
      state: "connected",
      verified: true,
      workspaceName: "Example workspace",
    },
  );
  assert.deepEqual(checkingSlackStatus(), {
    providerId: "slack",
    state: "checking",
    verified: false,
  });
  assert.deepEqual(unknownSlackStatus(), {
    providerId: "slack",
    state: "unknown",
    verified: false,
  });
  assert.deepEqual(
    reportSlackStatus({
      connected: true,
      workspaceId: "T12345678",
      workspaceName: " ",
    }),
    unknownSlackStatus(),
  );
  assert.deepEqual(
    reportSlackStatus({
      connected: true,
      workspaceId: "invalid",
      workspaceName: "Example workspace",
    }),
    unknownSlackStatus(),
  );
});
