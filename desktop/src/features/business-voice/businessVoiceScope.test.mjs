import assert from "node:assert/strict";
import test from "node:test";

import {
  businessVoiceBindingMatches,
  leaveMatchingBusinessVoiceHuddle,
  validateBusinessVoiceScope,
} from "./businessVoiceScope.ts";

const SCOPE = {
  channelId: "business-channel-a",
  channelName: "Studio",
  relayUrl: "wss://relay.example.test/",
  signerPubkey: "a".repeat(64),
  mainAgentPubkey: "b".repeat(64),
};

test("validates secure relays and the local development relay", () => {
  assert.equal(validateBusinessVoiceScope(SCOPE), null);
  assert.equal(
    validateBusinessVoiceScope({ ...SCOPE, relayUrl: "ws://localhost:3000" }),
    null,
  );
  assert.match(
    validateBusinessVoiceScope({ ...SCOPE, relayUrl: "https://relay.example" }),
    /valid voice relay/i,
  );
  assert.match(
    validateBusinessVoiceScope({ ...SCOPE, relayUrl: "ws://relay.example" }),
    /valid voice relay/i,
  );
});

test("binding requires the same channel, relay, owner, and main agent", () => {
  const binding = {
    parentChannelId: SCOPE.channelId,
    ephemeralChannelId: "ephemeral-a",
    relayUrl: "wss://relay.example.test",
    signerPubkey: SCOPE.signerPubkey.toUpperCase(),
    agentPubkeys: [SCOPE.mainAgentPubkey.toUpperCase()],
  };

  assert.equal(businessVoiceBindingMatches(SCOPE, binding), true);
  assert.equal(
    businessVoiceBindingMatches(SCOPE, {
      ...binding,
      relayUrl: "wss://other.example.test",
    }),
    false,
  );
  assert.equal(
    businessVoiceBindingMatches(SCOPE, {
      ...binding,
      agentPubkeys: ["c".repeat(64)],
    }),
    false,
  );
});

test("failed exact-scope cleanup retains the native error for retry UI", async () => {
  const failure = "Rust leave_huddle failed: session is still active";
  const huddle = {
    activeEphemeralChannelId: "ephemeral-a",
    activeHuddleBinding: {
      parentChannelId: SCOPE.channelId,
      ephemeralChannelId: "ephemeral-a",
      relayUrl: SCOPE.relayUrl,
      signerPubkey: SCOPE.signerPubkey,
      agentPubkeys: [SCOPE.mainAgentPubkey],
    },
    async leaveHuddle() {
      return false;
    },
    getLastLeaveHuddleError() {
      return failure;
    },
  };

  assert.equal(await leaveMatchingBusinessVoiceHuddle(SCOPE, huddle), failure);
});

test("failed cleanup preserves rejected errors and never leaves another huddle", async () => {
  const huddle = {
    activeEphemeralChannelId: "ephemeral-a",
    activeHuddleBinding: {
      parentChannelId: SCOPE.channelId,
      ephemeralChannelId: "ephemeral-a",
      relayUrl: SCOPE.relayUrl,
      signerPubkey: SCOPE.signerPubkey,
      agentPubkeys: [SCOPE.mainAgentPubkey],
    },
    async leaveHuddle() {
      throw new Error("native command rejected");
    },
  };
  assert.equal(
    await leaveMatchingBusinessVoiceHuddle(SCOPE, huddle),
    "native command rejected",
  );

  let leaveCount = 0;
  assert.equal(
    await leaveMatchingBusinessVoiceHuddle(SCOPE, {
      ...huddle,
      activeHuddleBinding: {
        ...huddle.activeHuddleBinding,
        parentChannelId: "different-channel",
      },
      async leaveHuddle() {
        leaveCount += 1;
        return true;
      },
    }),
    null,
  );
  assert.equal(leaveCount, 0);
});
