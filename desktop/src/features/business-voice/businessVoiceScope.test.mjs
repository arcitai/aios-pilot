import assert from "node:assert/strict";
import test from "node:test";

import {
  businessVoiceBindingMatches,
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
