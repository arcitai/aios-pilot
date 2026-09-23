import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { JSDOM } from "jsdom";

const RELAY_A = "wss://relay-a.example";
const RELAY_B = "wss://relay-b.example";
const SIGNER = "c".repeat(64);
const SITE_ID = "11111111-1111-4111-8111-111111111111";
const BUSINESS_ID = "22222222-2222-4222-8222-222222222222";
const GUIDE_A = "a".repeat(64);
const GUIDE_B = "b".repeat(64);

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
let handlers;
let calls;
let askMainAgentToBuildSite;
let SiteAgentStartError;

function rawAgent(pubkey, relayUrl, status = "stopped") {
  return {
    pubkey,
    name: "Fizz",
    persona_id: "builtin:fizz",
    relay_url: relayUrl,
    acp_command: "buzz-acp",
    agent_command: "buzz-agent",
    agent_args: [],
    mcp_command: "buzz-dev-mcp",
    turn_timeout_seconds: 120,
    idle_timeout_seconds: null,
    max_turn_duration_seconds: null,
    parallelism: 1,
    system_prompt: null,
    model: null,
    provider: null,
    persona_out_of_date: false,
    persona_orphaned: false,
    needs_restart: false,
    restart_diff: [],
    env_vars: {},
    status,
    pid: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    last_started_at: null,
    last_stopped_at: null,
    last_exit_code: null,
    last_error: null,
    last_error_code: null,
    log_path: "",
    start_on_app_launch: false,
    auto_restart_on_config_change: true,
    backend: { type: "local" },
    backend_agent_id: null,
  };
}

function resetNative(overrides = {}) {
  calls = [];
  handlers = new Map([
    [
      "list_managed_agents",
      () => [rawAgent(GUIDE_A, RELAY_A), rawAgent(GUIDE_B, RELAY_B)],
    ],
    ["add_channel_members", () => ({ added: [GUIDE_A], errors: [] })],
    [
      "send_channel_message",
      () => ({ event_id: "e".repeat(64), created_at: 1234 }),
    ],
    ["start_managed_agent", () => rawAgent(GUIDE_A, RELAY_A, "running")],
    ...Object.entries(overrides),
  ]);
}

before(async () => {
  globalThis.window = dom.window;
  dom.window.__TAURI_INTERNALS__ = {
    invoke(command, args) {
      calls.push({ command, args });
      const handler = handlers.get(command);
      if (!handler)
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      return Promise.resolve().then(() => handler(args));
    },
    transformCallback: () => 1,
  };
  globalThis.__TAURI_INTERNALS__ = dom.window.__TAURI_INTERNALS__;
  ({ askMainAgentToBuildSite, SiteAgentStartError } = await import(
    "./mainAgent.ts"
  ));
});

after(() => dom.window.close());

test("adds only the relay-matched main agent and sends the exact Sites contract before starting it", async () => {
  resetNative();
  const memberConfirmed = [];
  await askMainAgentToBuildSite({
    businessChannelId: BUSINESS_ID,
    siteChannelId: SITE_ID,
    relayUrl: RELAY_A,
    signerPubkey: SIGNER,
    request: "A landing page for our new service.",
    onMembershipConfirmed: () => memberConfirmed.push(true),
  });

  assert.deepEqual(
    calls.map(({ command }) => command),
    [
      "list_managed_agents",
      "add_channel_members",
      "send_channel_message",
      "start_managed_agent",
    ],
  );
  assert.deepEqual(calls[1].args, {
    channelId: SITE_ID,
    pubkeys: [GUIDE_A],
    role: "bot",
    expectedRelayUrl: RELAY_A,
    expectedSignerPubkey: SIGNER,
  });
  assert.equal(calls[2].args.channelId, SITE_ID);
  assert.deepEqual(calls[2].args.mentionPubkeys, [GUIDE_A]);
  assert.equal(calls[2].args.expectedRelayUrl, RELAY_A);
  assert.equal(calls[2].args.expectedSignerPubkey, SIGNER);
  assert.match(calls[2].args.content, new RegExp(BUSINESS_ID));
  assert.match(calls[2].args.content, new RegExp(SITE_ID));
  assert.match(calls[2].args.content, /buzz sites show --business-channel/);
  assert.match(calls[2].args.content, /buzz sites update --business-channel/);
  assert.match(calls[2].args.content, /"schemaVersion": 1/);
  assert.match(calls[2].args.content, /120000/);
  assert.match(calls[2].args.content, /200000 UTF-8 bytes/);
  assert.deepEqual(calls[3].args, {
    pubkey: GUIDE_A,
    expectedRelayUrl: RELAY_A,
    expectedSignerPubkey: SIGNER,
    replayFloorUnix: 1234,
  });
  assert.deepEqual(memberConfirmed, [true]);
});

test("does not start before an accepted message and reuses an accepted request after startup failure", async () => {
  let sendAttempts = 0;
  let startAttempts = 0;
  resetNative({
    send_channel_message: () => {
      sendAttempts += 1;
      if (sendAttempts === 1) throw new Error("message was not accepted");
      return { event_id: "f".repeat(64), created_at: 5678 };
    },
    start_managed_agent: () => {
      startAttempts += 1;
      if (startAttempts === 1) throw new Error("runtime unavailable");
      return rawAgent(GUIDE_A, RELAY_A, "running");
    },
  });

  const input = {
    businessChannelId: BUSINESS_ID,
    siteChannelId: SITE_ID,
    relayUrl: RELAY_A,
    signerPubkey: SIGNER,
    request: "A booking page for our new service.",
    onMembershipConfirmed() {},
  };
  await assert.rejects(
    askMainAgentToBuildSite(input),
    /message was not accepted/,
  );
  assert.equal(
    calls.some(({ command }) => command === "start_managed_agent"),
    false,
  );

  await assert.rejects(
    askMainAgentToBuildSite(input),
    (error) => error instanceof SiteAgentStartError,
  );
  assert.equal(sendAttempts, 2);

  await askMainAgentToBuildSite(input);
  assert.equal(sendAttempts, 2);
  assert.equal(startAttempts, 2);
  assert.deepEqual(
    calls
      .filter(({ command }) => command === "start_managed_agent")
      .map(({ args }) => args.replayFloorUnix),
    [5678, 5678],
  );
});
