import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

before(() => {
  Object.assign(globalThis, {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    window: dom.window,
  });
});

afterEach(async () => {
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});

after(() => dom.window.close());

const SCOPE = {
  channelId: "business-channel-a",
  channelName: "Studio",
  relayUrl: "wss://relay.example.test/",
  signerPubkey: "a".repeat(64),
  mainAgentPubkey: "b".repeat(64),
};

function huddlePort(overrides = {}) {
  return {
    isStarting: false,
    huddleError: null,
    clearHuddleError() {},
    micConnected: false,
    activeEphemeralChannelId: null,
    activeHuddleBinding: null,
    startHuddle: async () => {},
    leaveHuddle: async () => true,
    ...overrides,
  };
}

async function renderAction(props = {}) {
  const React = await import("react");
  const { render } = await import("@testing-library/react");
  const { BusinessVoiceAction } = await import("./BusinessVoiceAction.tsx");
  return render(
    React.createElement(BusinessVoiceAction, {
      ...SCOPE,
      huddle: huddlePort(),
      ...props,
    }),
  );
}

test("microphone flow starts only after the explicit click with captured scope", async () => {
  const { act, fireEvent, screen } = await import("@testing-library/react");
  const calls = [];
  let clearedErrors = 0;
  const port = huddlePort({
    clearHuddleError() {
      clearedErrors += 1;
    },
    async startHuddle(...args) {
      calls.push(args);
    },
  });

  await renderAction({ huddle: port });
  assert.equal(calls.length, 0, "rendering must not begin capture or a huddle");
  assert.match(
    document.body.textContent,
    /microphone is requested only after/i,
  );
  assert.match(
    document.body.textContent,
    /Danish transcription isn’t available/i,
  );

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Start voice" }));
    await new Promise((resolve) => setImmediate(resolve));
  });

  assert.equal(clearedErrors, 1);
  assert.deepEqual(calls, [
    [
      SCOPE.channelId,
      [SCOPE.mainAgentPubkey],
      SCOPE.channelName,
      { relayUrl: SCOPE.relayUrl, signerPubkey: SCOPE.signerPubkey },
    ],
  ]);
});

test("a changed workspace cannot start or end a huddle bound elsewhere", async () => {
  const { screen } = await import("@testing-library/react");
  let startCount = 0;
  let leaveCount = 0;
  const port = huddlePort({
    activeEphemeralChannelId: "ephemeral-old",
    activeHuddleBinding: {
      parentChannelId: SCOPE.channelId,
      ephemeralChannelId: "ephemeral-old",
      relayUrl: SCOPE.relayUrl,
      signerPubkey: SCOPE.signerPubkey,
      agentPubkeys: [SCOPE.mainAgentPubkey],
    },
    async startHuddle() {
      startCount += 1;
    },
    async leaveHuddle() {
      leaveCount += 1;
      return true;
    },
  });

  await renderAction({
    channelId: "business-channel-b",
    channelName: "Other studio",
    huddle: port,
  });

  assert.match(document.body.textContent, /another voice huddle is open/i);
  assert.equal(
    screen.getByRole("button", { name: "Start voice" }).disabled,
    true,
  );
  assert.equal(
    screen.queryByRole("button", { name: "End voice session" }),
    null,
  );
  assert.equal(startCount, 0);
  assert.equal(leaveCount, 0);
});

test("only the matching active binding is reported as connected and endable", async () => {
  const { act, fireEvent, screen } = await import("@testing-library/react");
  let leaveCount = 0;
  const port = huddlePort({
    micConnected: true,
    activeEphemeralChannelId: "ephemeral-a",
    activeHuddleBinding: {
      parentChannelId: SCOPE.channelId,
      ephemeralChannelId: "ephemeral-a",
      relayUrl: "wss://relay.example.test",
      signerPubkey: SCOPE.signerPubkey.toUpperCase(),
      agentPubkeys: [SCOPE.mainAgentPubkey.toUpperCase()],
    },
    async leaveHuddle() {
      leaveCount += 1;
      return true;
    },
  });

  await renderAction({ huddle: port });
  assert.match(
    document.body.textContent,
    /your microphone is connected to the private huddle/i,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "End voice session" }));
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.equal(leaveCount, 1);
});

test("a failed leave remains visible and can be retried", async () => {
  const { act, fireEvent, screen } = await import("@testing-library/react");
  let leaveCount = 0;
  const port = huddlePort({
    micConnected: true,
    activeEphemeralChannelId: "ephemeral-a",
    activeHuddleBinding: {
      parentChannelId: SCOPE.channelId,
      ephemeralChannelId: "ephemeral-a",
      relayUrl: "wss://relay.example.test",
      signerPubkey: SCOPE.signerPubkey,
      agentPubkeys: [SCOPE.mainAgentPubkey],
    },
    async leaveHuddle() {
      leaveCount += 1;
      port.activeEphemeralChannelId = null;
      port.activeHuddleBinding = null;
      return leaveCount > 1;
    },
  });

  await renderAction({ huddle: port });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "End voice session" }));
    await new Promise((resolve) => setImmediate(resolve));
  });

  assert.equal(leaveCount, 1);
  assert.match(document.body.textContent, /could not be confirmed as ended/i);
  assert.ok(screen.getByRole("button", { name: "Retry ending voice session" }));

  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Retry ending voice session" }),
    );
    await new Promise((resolve) => setImmediate(resolve));
  });

  assert.equal(leaveCount, 2);
  assert.ok(screen.getByRole("button", { name: "Start voice" }));
});

test("invalid workspace identity fails closed and exposes the setup issue", async () => {
  const { screen } = await import("@testing-library/react");
  await renderAction({ signerPubkey: "not-a-pubkey" });

  assert.equal(
    screen.getByRole("button", { name: "Start voice" }).disabled,
    true,
  );
  assert.match(
    screen.getByRole("alert").textContent,
    /identity is unavailable/i,
  );
});
