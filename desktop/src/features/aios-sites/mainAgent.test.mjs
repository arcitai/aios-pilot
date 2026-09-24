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
let retrySiteAgentStart;
let siteHasAgent;

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
  siteHasAgent = false;
  handlers = new Map([
    [
      "list_managed_agents",
      () => [rawAgent(GUIDE_A, RELAY_A), rawAgent(GUIDE_B, RELAY_B)],
    ],
    [
      "get_channel_members",
      ({ channelId }) => ({
        members:
          channelId === BUSINESS_ID || siteHasAgent
            ? [
                {
                  pubkey: GUIDE_A,
                  role: "bot",
                  joined_at: "2026-01-01T00:00:00.000Z",
                  display_name: "Fizz",
                },
              ]
            : [],
      }),
    ],
    [
      "add_channel_members",
      () => {
        siteHasAgent = true;
        return { added: [GUIDE_A], errors: [] };
      },
    ],
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
  ({ askMainAgentToBuildSite, SiteAgentStartError, retrySiteAgentStart } =
    await import("./mainAgent.ts"));
});

after(() => dom.window.close());

const input = {
  businessChannelId: BUSINESS_ID,
  siteChannelId: SITE_ID,
  relayUrl: RELAY_A,
  signerPubkey: SIGNER,
  request: "A landing page for our new service.",
};

test("verifies business and site access, then sends the exact contract before startup", async () => {
  resetNative();
  await askMainAgentToBuildSite(input);
  assert.deepEqual(
    calls.map(({ command }) => command),
    [
      "list_managed_agents",
      "get_channel_members",
      "get_channel_members",
      "add_channel_members",
      "get_channel_members",
      "send_channel_message",
      "start_managed_agent",
    ],
  );
  const invite = calls.find(({ command }) => command === "add_channel_members");
  assert.deepEqual(invite.args, {
    channelId: SITE_ID,
    pubkeys: [GUIDE_A],
    role: "bot",
    expectedRelayUrl: RELAY_A,
    expectedSignerPubkey: SIGNER,
  });
  for (const { args } of calls.filter(
    ({ command }) => command === "get_channel_members",
  )) {
    assert.equal(args.expectedRelayUrl, RELAY_A);
    assert.equal(args.expectedSignerPubkey, SIGNER);
  }
  const sent = calls.find(
    ({ command }) => command === "send_channel_message",
  ).args;
  assert.equal(sent.channelId, SITE_ID);
  assert.deepEqual(sent.mentionPubkeys, [GUIDE_A]);
  assert.equal(sent.expectedRelayUrl, RELAY_A);
  assert.equal(sent.expectedSignerPubkey, SIGNER);
  for (const part of [
    BUSINESS_ID,
    SITE_ID,
    "buzz sites show --business-channel",
    "buzz sites update --business-channel",
    '"schemaVersion": 1',
    "200000 UTF-8 bytes",
    "no database",
  ])
    assert.ok(sent.content.includes(part));
  assert.equal(calls.at(-1).args.replayFloorUnix, 1234);
});

test("a failed send never starts the agent", async () => {
  resetNative({
    send_channel_message: () => {
      throw new Error("message was not accepted");
    },
  });
  await assert.rejects(
    askMainAgentToBuildSite(input),
    /message was not accepted/,
  );
  assert.equal(
    calls.some(({ command }) => command === "start_managed_agent"),
    false,
  );
});

test("retrying an accepted request starts it without a second message, while a new identical request is allowed", async () => {
  let attempts = 0;
  resetNative({
    start_managed_agent: () => {
      if (++attempts === 1) throw new Error("runtime unavailable");
      return rawAgent(GUIDE_A, RELAY_A, "running");
    },
  });
  let receipt;
  await assert.rejects(askMainAgentToBuildSite(input), (error) => {
    assert.ok(error instanceof SiteAgentStartError);
    receipt = error.receipt;
    return true;
  });
  await retrySiteAgentStart(receipt);
  assert.equal(
    calls.filter(({ command }) => command === "send_channel_message").length,
    1,
  );
  assert.equal(attempts, 2);
  await askMainAgentToBuildSite(input);
  assert.equal(
    calls.filter(({ command }) => command === "send_channel_message").length,
    2,
  );
  assert.equal(
    calls.filter(({ command }) => command === "add_channel_members").length,
    1,
  );
});

test("missing business access does not grant access or send a request", async () => {
  resetNative({ get_channel_members: () => ({ members: [] }) });
  await assert.rejects(
    askMainAgentToBuildSite(input),
    /does not have access to this business/,
  );
  assert.equal(
    calls.some(({ command }) =>
      [
        "add_channel_members",
        "send_channel_message",
        "start_managed_agent",
      ].includes(command),
    ),
    false,
  );
});

test("an already-like error is not proof of membership", async () => {
  resetNative({
    add_channel_members: () => ({
      added: [],
      errors: [{ pubkey: GUIDE_A, error: "already processing: denied" }],
    }),
  });
  await assert.rejects(
    askMainAgentToBuildSite(input),
    /already processing: denied/,
  );
  assert.equal(
    calls.some(({ command }) => command === "send_channel_message"),
    false,
  );
});

test("retry refuses revoked access instead of re-inviting the agent", async () => {
  resetNative({
    start_managed_agent: () => {
      throw new Error("offline");
    },
  });
  let receipt;
  await assert.rejects(askMainAgentToBuildSite(input), (error) => {
    receipt = error.receipt;
    return true;
  });
  siteHasAgent = false;
  await assert.rejects(
    retrySiteAgentStart(receipt),
    /access to this site could not be confirmed/,
  );
  assert.equal(
    calls.filter(({ command }) => command === "add_channel_members").length,
    1,
  );
  assert.equal(
    calls.filter(({ command }) => command === "send_channel_message").length,
    1,
  );
});
