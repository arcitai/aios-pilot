import assert from "node:assert/strict";
import test from "node:test";

import {
  checkingGitHubStatus,
  reportGitHubStatus,
  reportVerifiedGitHubLogin,
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
