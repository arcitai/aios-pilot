import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { JSDOM } from "jsdom";

import { appCanvasMarker } from "./canvasDocument.ts";

const RELAY_A = "wss://relay-a.example";
const RELAY_B = "wss://relay-b.example";
const SIGNER = "c".repeat(64);
const BUSINESS_ID = "22222222-2222-4222-8222-222222222222";
const APP_CHANNEL_ID = "33333333-3333-4333-8333-333333333333";
const GUIDE_A = "a".repeat(64);
const GUIDE_B = "b".repeat(64);

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
let handlers;
let calls;
let appChannelCreated;
let appHasAgent;
let businessMembers;
let appVisibility;
let askMainAgentToBuildApp;
let AppAgentStartError;
let retryAppAgentStart;
let buildAppRequest;

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

function rawChannel({
  id,
  name,
  description,
  visibility = "private",
  memberPubkeys = [SIGNER],
}) {
  return {
    id,
    name,
    channel_type: "stream",
    visibility,
    description,
    topic: null,
    purpose: null,
    member_count: memberPubkeys.length,
    member_pubkeys: memberPubkeys,
    last_message_at: null,
    archived_at: null,
    participants: [],
    participant_pubkeys: [],
    is_member: true,
    ttl_seconds: null,
    ttl_deadline: null,
  };
}

function appChannelRaw(overrides = {}) {
  return rawChannel({
    id: APP_CHANNEL_ID,
    name: "aios-slides-22222222",
    description: appCanvasMarker(BUSINESS_ID, "slides"),
    visibility: appVisibility,
    memberPubkeys: appHasAgent ? [SIGNER, GUIDE_A] : [SIGNER],
    ...overrides,
  });
}

function member(pubkey, role) {
  return {
    pubkey,
    role,
    is_agent: role === "bot",
    joined_at: "2026-01-01T00:00:00.000Z",
    display_name: role === "bot" ? "Fizz" : "Human",
  };
}

function resetNative(overrides = {}) {
  calls = [];
  appChannelCreated = false;
  appHasAgent = false;
  businessMembers = [member(SIGNER, "owner"), member(GUIDE_A, "bot")];
  appVisibility = "private";
  handlers = new Map([
    ["get_relay_ws_url", () => RELAY_A],
    ["get_identity", () => ({ pubkey: SIGNER, display_name: "Human" })],
    [
      "list_managed_agents",
      () => [rawAgent(GUIDE_A, RELAY_A), rawAgent(GUIDE_B, RELAY_B)],
    ],
    [
      "get_channels",
      () => ({
        hash: "apps-test",
        channels: [
          rawChannel({
            id: BUSINESS_ID,
            name: "business",
            description: "",
            memberPubkeys: [SIGNER, GUIDE_A],
          }),
          ...(appChannelCreated ? [appChannelRaw()] : []),
        ],
        last_messages: {},
      }),
    ],
    [
      "create_channel",
      (args) => {
        appChannelCreated = true;
        return appChannelRaw({
          name: args.name,
          description: args.description,
        });
      },
    ],
    [
      "get_channel_members",
      ({ channelId }) => ({
        members:
          channelId === BUSINESS_ID
            ? businessMembers
            : appHasAgent
              ? [member(SIGNER, "owner"), member(GUIDE_A, "bot")]
              : [member(SIGNER, "owner")],
        next_cursor: null,
      }),
    ],
    [
      "add_channel_members",
      () => {
        appHasAgent = true;
        return { added: [GUIDE_A], errors: [] };
      },
    ],
    [
      "send_channel_message",
      () => ({
        event_id: "e".repeat(64),
        parent_event_id: null,
        root_event_id: null,
        depth: 0,
        created_at: 1234,
      }),
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
      if (!handler) {
        return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
      return Promise.resolve().then(() => handler(args ?? {}));
    },
    transformCallback: () => 1,
  };
  globalThis.__TAURI_INTERNALS__ = dom.window.__TAURI_INTERNALS__;
  ({
    askMainAgentToBuildApp,
    AppAgentStartError,
    retryAppAgentStart,
    buildAppRequest,
  } = await import("./appMainAgent.ts"));
});

after(() => dom.window.close());

const input = {
  businessChannelId: BUSINESS_ID,
  appId: "slides",
  relayUrl: RELAY_A,
  signerPubkey: SIGNER,
  request: "A short introduction to our new service.",
};

test("creates the private app as the human, invites only the matching agent, verifies access, then sends the revision-safe request", async () => {
  resetNative();
  const result = await askMainAgentToBuildApp(input);

  assert.equal(result.appChannel.id, APP_CHANNEL_ID);
  const create = calls.find(({ command }) => command === "create_channel");
  const invite = calls.find(({ command }) => command === "add_channel_members");
  const send = calls.find(({ command }) => command === "send_channel_message");
  const start = calls.find(({ command }) => command === "start_managed_agent");
  assert.ok(create);
  assert.ok(invite);
  assert.ok(send);
  assert.ok(start);
  assert.ok(calls.indexOf(create) < calls.indexOf(invite));
  assert.ok(calls.indexOf(invite) < calls.indexOf(send));
  assert.ok(calls.indexOf(send) < calls.indexOf(start));

  assert.deepEqual(create.args, {
    name: "aios-slides-22222222",
    channelType: "stream",
    visibility: "private",
    description: appCanvasMarker(BUSINESS_ID, "slides"),
    expectedRelayUrl: RELAY_A,
    expectedSignerPubkey: SIGNER,
  });
  assert.deepEqual(invite.args, {
    channelId: APP_CHANNEL_ID,
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
  assert.equal(send.args.channelId, APP_CHANNEL_ID);
  assert.deepEqual(send.args.mentionPubkeys, [GUIDE_A]);
  assert.equal(send.args.expectedRelayUrl, RELAY_A);
  assert.equal(send.args.expectedSignerPubkey, SIGNER);
  for (const instruction of [
    `buzz apps show --channel ${BUSINESS_ID} --app slides`,
    `buzz apps update --channel ${BUSINESS_ID} --app slides --expected-revision <revision-from-show-or-none> --document -`,
    "Use `none` only when show reports no revision",
    "Send the document JSON on stdin",
    "run show again",
    '"schemaVersion":1',
    "Do not publish or share anything outside this private app",
  ]) {
    assert.ok(send.args.content.includes(instruction), instruction);
  }
  assert.equal(start.args.pubkey, GUIDE_A);
  assert.equal(start.args.expectedRelayUrl, RELAY_A);
  assert.equal(start.args.expectedSignerPubkey, SIGNER);
  assert.equal(start.args.replayFloorUnix, 1234);
});

test("uses an existing human-owned app channel without recreating it", async () => {
  resetNative();
  appChannelCreated = true;

  await askMainAgentToBuildApp(input);

  assert.equal(
    calls.some(({ command }) => command === "create_channel"),
    false,
  );
  const invite = calls.find(({ command }) => command === "add_channel_members");
  assert.deepEqual(invite.args.pubkeys, [GUIDE_A]);
  assert.equal(appHasAgent, true);
});

test("does not create an app or send when business membership is missing", async () => {
  resetNative();
  businessMembers = [member(SIGNER, "owner")];

  await assert.rejects(
    askMainAgentToBuildApp(input),
    /main agent does not have access to this business/,
  );
  assert.equal(
    calls.some(({ command }) =>
      [
        "get_channels",
        "create_channel",
        "add_channel_members",
        "send_channel_message",
        "start_managed_agent",
      ].includes(command),
    ),
    false,
  );
});

test("rejects a marked app channel that is not private before inviting the agent", async () => {
  resetNative();
  appChannelCreated = true;
  appVisibility = "open";

  await assert.rejects(
    askMainAgentToBuildApp(input),
    /private channel that includes your active identity/,
  );
  assert.equal(
    calls.some(({ command }) =>
      ["add_channel_members", "send_channel_message"].includes(command),
    ),
    false,
  );
});

test("does not invite the agent when the human's private app membership is missing", async () => {
  resetNative({
    get_channel_members: ({ channelId }) => ({
      members:
        channelId === BUSINESS_ID ? businessMembers : [member(GUIDE_A, "bot")],
      next_cursor: null,
    }),
    create_channel: (args) => {
      appChannelCreated = true;
      return appChannelRaw({
        name: args.name,
        description: args.description,
        memberPubkeys: [GUIDE_A],
      });
    },
  });

  await assert.rejects(
    askMainAgentToBuildApp(input),
    /private channel that includes your active identity/,
  );
  assert.equal(
    calls.some(({ command }) =>
      ["add_channel_members", "send_channel_message"].includes(command),
    ),
    false,
  );
});

test("a failed invite is not proof of membership and never sends the request", async () => {
  resetNative({
    add_channel_members: () => ({
      added: [],
      errors: [{ pubkey: GUIDE_A, error: "invite denied" }],
    }),
  });

  await assert.rejects(askMainAgentToBuildApp(input), /invite denied/);
  assert.equal(
    calls.some(({ command }) =>
      ["send_channel_message", "start_managed_agent"].includes(command),
    ),
    false,
  );
});

test("startup retry reuses the sent receipt, while a later identical request is allowed", async () => {
  let attempts = 0;
  resetNative({
    start_managed_agent: () => {
      if (++attempts === 1) throw new Error("runtime unavailable");
      return rawAgent(GUIDE_A, RELAY_A, "running");
    },
  });
  let receipt;
  await assert.rejects(askMainAgentToBuildApp(input), (error) => {
    assert.ok(error instanceof AppAgentStartError);
    receipt = error.receipt;
    return true;
  });

  await retryAppAgentStart(receipt);
  assert.equal(
    calls.filter(({ command }) => command === "send_channel_message").length,
    1,
  );
  assert.equal(attempts, 2);

  await askMainAgentToBuildApp(input);
  assert.equal(
    calls.filter(({ command }) => command === "send_channel_message").length,
    2,
  );
  assert.equal(
    calls.filter(({ command }) => command === "add_channel_members").length,
    1,
  );
});

test("retry fails closed after app access is revoked without re-inviting or re-sending", async () => {
  resetNative({
    start_managed_agent: () => {
      throw new Error("runtime unavailable");
    },
  });
  let receipt;
  await assert.rejects(askMainAgentToBuildApp(input), (error) => {
    receipt = error.receipt;
    return true;
  });
  appHasAgent = false;

  await assert.rejects(
    retryAppAgentStart(receipt),
    /main agent's access to this app could not be confirmed/,
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

test("request instructions include the exact document shape for every built-in app", () => {
  const shapeByApp = {
    slides:
      '{"kind":"slides","schemaVersion":1,"id":"...","updatedAt":"...Z","title":"...","slides":[{"id":"...","title":"...","body":"..."}]}',
    calendar:
      '{"kind":"calendar","schemaVersion":1,"id":"...","updatedAt":"...Z","googleCalendarStatus":"not_connected","events":[{"id":"...","title":"...","description":"...","startsAt":"...Z","endsAt":"...Z"}]}',
    design:
      '{"kind":"design","schemaVersion":1,"id":"...","updatedAt":"...Z","title":"...","html":"..."}',
  };
  for (const [appId, shape] of Object.entries(shapeByApp)) {
    const prompt = buildAppRequest({
      ...input,
      agentName: "Fizz",
      appChannelId: APP_CHANNEL_ID,
      appId,
    });
    assert.ok(prompt.includes(shape));
    assert.ok(prompt.includes(`--app ${appId}`));
    assert.ok(
      prompt.includes("--expected-revision <revision-from-show-or-none>"),
    );
    assert.ok(prompt.includes("Use exactly these fields, with no extras"));
  }
});

test("invalid requests fail before any relay call", async () => {
  resetNative();
  await assert.rejects(
    askMainAgentToBuildApp({ ...input, request: "  " }),
    /Describe what you want/,
  );
  assert.equal(calls.length, 0);
});
