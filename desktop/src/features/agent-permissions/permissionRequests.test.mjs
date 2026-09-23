import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveAgentPermissionSnapshot,
  PERMISSION_REQUEST_TTL_MS,
} from "./permissionRequests.ts";

const OWNER = "11".repeat(32);
const AGENT = "22".repeat(32);
const RELAY = "wss://community.example/";
const RUNTIME = "runtime-current";
const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function event(seq, kind, payload, timestamp = NOW) {
  return {
    seq,
    timestamp: new Date(timestamp).toISOString(),
    kind,
    agentIndex: kind === "permission_request" ? 2 : null,
    channelId: kind === "permission_request" ? "channel-a" : null,
    sessionId: kind === "permission_request" ? "session-a" : null,
    turnId: kind === "permission_request" ? "turn-a" : null,
    payload,
  };
}

function requestPayload(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    ownerPubkey: OWNER,
    agentPubkey: AGENT,
    relayUrl: "wss://community.example",
    runtimeStartNonce: RUNTIME,
    agentIndex: 2,
    sessionId: "session-a",
    turnId: "turn-a",
    channelId: "channel-a",
    toolName: "shell",
    action: "Run one command",
    context: { command: "printf safe" },
    ...overrides,
  };
}

function baseEvents({ permissionMode = "default" } = {}) {
  return [
    event(1, "harness_started", {
      relayUrl: "wss://community.example",
      runtimeStartNonce: RUNTIME,
      permissionMode,
    }),
    event(2, "managed_agent_runtime_lifecycle", {
      pubkey: AGENT,
      relayUrl: "wss://community.example",
      startNonce: RUNTIME,
      lifecycle: "ready",
    }),
    event(3, "permission_request", requestPayload(), NOW - 1_000),
  ];
}

function derive(events, options = {}) {
  return deriveAgentPermissionSnapshot({
    activeRelayUrl: RELAY,
    agentPubkey: AGENT,
    agentRelayUrl: RELAY,
    events,
    now: NOW,
    ownerPubkey: OWNER,
    ...options,
  });
}

test("shows a request bound to the current owner, relay, and ready runtime", () => {
  const snapshot = derive(baseEvents());

  assert.equal(snapshot.requests.length, 1);
  assert.equal(snapshot.requests[0].binding.requestId, REQUEST_ID);
  assert.equal(snapshot.requests[0].toolName, "shell");
  assert.equal(snapshot.autonomous, false);
});

test("rejects wrong owner, runtime, event context, and inactive community", () => {
  const wrongOwner = baseEvents();
  wrongOwner[2].payload = requestPayload({ ownerPubkey: "33".repeat(32) });
  assert.equal(derive(wrongOwner).requests.length, 0);

  const wrongRuntime = baseEvents();
  wrongRuntime[2].payload = requestPayload({ runtimeStartNonce: "old-run" });
  assert.equal(derive(wrongRuntime).requests.length, 0);

  const wrongContext = baseEvents();
  wrongContext[2].turnId = "another-turn";
  assert.equal(derive(wrongContext).requests.length, 0);

  assert.equal(
    derive(baseEvents(), { activeRelayUrl: "wss://another.example" }).requests
      .length,
    0,
  );
});

test("stale, completed, and non-ready-runtime requests stay hidden", () => {
  const expired = baseEvents();
  expired[2].timestamp = new Date(
    NOW - PERMISSION_REQUEST_TTL_MS - 1,
  ).toISOString();
  assert.equal(derive(expired).requests.length, 0);

  const completed = baseEvents();
  completed.push(
    event(4, "permission_result", { requestId: REQUEST_ID, status: "denied" }),
  );
  assert.equal(derive(completed).requests.length, 0);

  const notReady = baseEvents();
  notReady[1].payload.lifecycle = "failed";
  assert.equal(derive(notReady).requests.length, 0);
});

test("surfaces explicitly configured bypass mode", () => {
  const snapshot = derive(baseEvents({ permissionMode: "bypassPermissions" }));
  assert.equal(snapshot.autonomous, true);
});
