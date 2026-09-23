import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUSINESS_CALL_PENDING_LIMIT,
  IncomingBusinessCallInbox,
  createBusinessVoiceCallDecision,
  isMatchingBusinessVoiceCallDecision,
  latestReadyRuntimeNonce,
  normalizeCallRelayUrl,
  parseIncomingBusinessCallRequest,
} from "./incomingBusinessCall.ts";

const OWNER = "a".repeat(64);
const AGENT = "b".repeat(64);
const RELAY = "wss://relay.example.test";
const CHANNEL_ID = "11111111-2222-4333-8444-555555555555";
const REQUEST_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function requestPayload(overrides = {}) {
  return {
    type: "call_request",
    version: 1,
    requestId: REQUEST_ID,
    ownerPubkey: OWNER,
    agentPubkey: AGENT,
    relayUrl: RELAY,
    runtimeStartNonce: "runtime-nonce-current",
    channelId: CHANNEL_ID,
    createdAt: 100,
    expiresAt: 140,
    ...overrides,
  };
}

function requestEnvelope(overrides = {}) {
  return {
    eventKind: 24200,
    eventPubkey: AGENT,
    eventCreatedAt: 100,
    eventTags: [
      ["p", OWNER],
      ["agent", AGENT],
      ["frame", "control"],
    ],
    ownerPubkey: OWNER,
    relayUrl: RELAY,
    agentPubkey: AGENT,
    runtimeStartNonce: "runtime-nonce-current",
    ...overrides,
  };
}

function parsedRequest(overrides = {}) {
  const request = parseIncomingBusinessCallRequest(
    requestPayload(overrides),
    requestEnvelope(),
    110,
  );
  assert.ok(request);
  return request;
}

test("canonicalizes secure relay URLs and allows cleartext only on loopback", () => {
  assert.equal(normalizeCallRelayUrl("https://Relay.Example.test/"), RELAY);
  assert.equal(
    normalizeCallRelayUrl("ws://localhost:3000/"),
    "ws://localhost:3000",
  );
  assert.equal(normalizeCallRelayUrl("ws://relay.example.test"), null);
  assert.equal(
    normalizeCallRelayUrl("wss://user:pass@relay.example.test"),
    null,
  );
});

test("accepts a request only when payload and signed envelope share the binding", () => {
  const request = parseIncomingBusinessCallRequest(
    requestPayload({ relayUrl: "https://relay.example.test/" }),
    requestEnvelope(),
    110,
  );
  assert.equal(request?.relayUrl, RELAY);

  assert.equal(
    parseIncomingBusinessCallRequest(
      requestPayload({ agentPubkey: OWNER }),
      requestEnvelope(),
      110,
    ),
    null,
  );
  assert.equal(
    parseIncomingBusinessCallRequest(
      requestPayload(),
      requestEnvelope({
        eventTags: [
          ["p", AGENT],
          ["agent", AGENT],
          ["frame", "control"],
        ],
      }),
      110,
    ),
    null,
  );
  assert.equal(
    parseIncomingBusinessCallRequest(
      requestPayload(),
      requestEnvelope({
        eventTags: [
          ["p", OWNER],
          ["p", OWNER],
          ["agent", AGENT],
          ["frame", "control"],
        ],
      }),
      110,
    ),
    null,
  );
});

test("rejects malformed, overlong, expired, or clock-skewed requests", () => {
  for (const payload of [
    requestPayload({ expiresAt: 161 }),
    requestPayload({ expiresAt: 100 }),
    requestPayload({ createdAt: 106, expiresAt: 120 }),
    requestPayload({ createdAt: 1, expiresAt: 50 }),
    requestPayload({ channelId: "not-a-uuid" }),
  ]) {
    assert.equal(
      parseIncomingBusinessCallRequest(payload, requestEnvelope(), 110),
      null,
    );
  }
  assert.equal(
    parseIncomingBusinessCallRequest(
      requestPayload(),
      requestEnvelope({ eventCreatedAt: 106 }),
      110,
    ),
    null,
  );
});

test("requires a decision to echo every field and come from the owner", () => {
  const request = parsedRequest();
  const decision = createBusinessVoiceCallDecision(request, "accept");
  const envelope = {
    eventKind: 24200,
    eventPubkey: OWNER,
    eventCreatedAt: 120,
    eventTags: [
      ["p", AGENT],
      ["agent", AGENT],
      ["frame", "control"],
    ],
  };
  assert.equal(
    isMatchingBusinessVoiceCallDecision(decision, request, envelope, 120),
    true,
  );
  assert.equal(
    isMatchingBusinessVoiceCallDecision(
      { ...decision, runtimeStartNonce: "old-runtime" },
      request,
      envelope,
      120,
    ),
    false,
  );
  assert.equal(
    isMatchingBusinessVoiceCallDecision(
      decision,
      { ...request, ownerPubkey: AGENT },
      envelope,
      120,
    ),
    false,
  );
  assert.equal(
    isMatchingBusinessVoiceCallDecision(
      decision,
      request,
      { ...envelope, eventPubkey: AGENT },
      120,
    ),
    false,
  );
  assert.equal(
    isMatchingBusinessVoiceCallDecision(decision, request, envelope, 140),
    false,
  );
});

test("call decisions exclude UI-only fields on enriched incoming requests", () => {
  const request = parsedRequest();
  const decision = createBusinessVoiceCallDecision(
    {
      ...request,
      agentName: "UI-only agent label",
      channelName: "UI-only workspace label",
      accidentalExtra: { shouldNotSerialize: true },
    },
    "decline",
  );

  assert.deepEqual(decision, {
    type: "call_decision",
    version: request.version,
    requestId: request.requestId,
    decision: "decline",
    ownerPubkey: request.ownerPubkey,
    agentPubkey: request.agentPubkey,
    relayUrl: request.relayUrl,
    runtimeStartNonce: request.runtimeStartNonce,
    channelId: request.channelId,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
  });
  assert.equal("agentName" in decision, false);
  assert.equal("channelName" in decision, false);
  assert.equal("accidentalExtra" in decision, false);
});

test("uses the newest matching runtime lifecycle and fails closed after stop", () => {
  const events = [
    {
      kind: "managed_agent_runtime_lifecycle",
      timestamp: "2025-01-01T00:00:00.000Z",
      seq: 1,
      payload: {
        pubkey: AGENT,
        relayUrl: RELAY,
        lifecycle: "ready",
        startNonce: "old-runtime",
      },
    },
    {
      kind: "managed_agent_runtime_lifecycle",
      timestamp: "2025-01-01T00:00:01.000Z",
      seq: 2,
      payload: {
        pubkey: AGENT,
        relayUrl: RELAY,
        lifecycle: "ready",
        startNonce: "runtime-nonce-current",
      },
    },
  ];
  assert.equal(
    latestReadyRuntimeNonce(events, AGENT, RELAY),
    "runtime-nonce-current",
  );
  assert.equal(
    latestReadyRuntimeNonce(
      [
        ...events,
        {
          ...events[1],
          seq: 3,
          timestamp: "2025-01-01T00:00:02.000Z",
          payload: { ...events[1].payload, lifecycle: "stopped" },
        },
      ],
      AGENT,
      RELAY,
    ),
    null,
  );
});

test("bounds pending calls, deduplicates IDs, rate-limits agents, and honors injected time", () => {
  const inbox = new IncomingBusinessCallInbox();
  const first = parsedRequest();
  assert.equal(inbox.reserve(first, 110), "reserved");
  assert.equal(inbox.reserve(first, 110), "duplicate");
  assert.equal(
    inbox.commit({ ...first, agentName: "Agent", channelName: "Studio" }, 140),
    false,
  );

  const pending = new IncomingBusinessCallInbox();
  for (let index = 0; index < BUSINESS_CALL_PENDING_LIMIT; index += 1) {
    const req = {
      ...first,
      requestId: `aaaaaaaa-bbbb-4ccc-8ddd-${String(index).padStart(12, "0")}`,
      agentPubkey: String(index + 1).padStart(64, "0"),
    };
    assert.equal(pending.reserve(req, 110), "reserved");
    assert.equal(
      pending.commit(
        { ...req, agentName: "Agent", channelName: "Studio" },
        110,
      ),
      true,
    );
  }
  const overflow = {
    ...first,
    requestId: "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    agentPubkey: "f".repeat(64),
  };
  assert.equal(pending.reserve(overflow, 110), "full");

  const limited = new IncomingBusinessCallInbox();
  for (let index = 0; index < 3; index += 1) {
    const req = {
      ...first,
      requestId: `bbbbbbbb-bbbb-4ccc-8ddd-${String(index).padStart(12, "0")}`,
    };
    assert.equal(limited.reserve(req, 110), "reserved");
  }
  assert.equal(
    limited.reserve(
      { ...first, requestId: "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
      110,
    ),
    "rate-limited",
  );
});
