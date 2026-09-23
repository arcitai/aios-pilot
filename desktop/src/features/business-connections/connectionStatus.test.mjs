import assert from "node:assert/strict";
import test from "node:test";

import {
  checkingNotionStatus,
  checkingGitHubStatus,
  reportNotionStatus,
  reportGitHubStatus,
  reportVerifiedGitHubLogin,
  reportVerifiedNotionName,
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
