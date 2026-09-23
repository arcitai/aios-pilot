import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const AGENT = TEST_IDENTITIES.tyler.pubkey;
const OWNER = "deadbeef".repeat(8);
const RELAY = "ws://localhost:3000";
type CallFixtureWindow = Window & {
  __AIOS_CALL_MIC__: { opened: number; stopped: number };
};

async function setup(page: Page) {
  await page.addInitScript(() => {
    const counts = { opened: 0, stopped: 0 };
    (window as CallFixtureWindow).__AIOS_CALL_MIC__ = counts;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        counts.opened++;
        const audio = new AudioContext({ sampleRate: 48_000 });
        const destination = audio.createMediaStreamDestination();
        for (const track of destination.stream.getTracks()) {
          const stop = track.stop.bind(track);
          track.stop = () => {
            counts.stopped++;
            stop();
            void audio.close();
          };
        }
        return destination.stream;
      },
    });
  });
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: AGENT,
        name: "Fizz",
        personaId: "builtin:fizz",
        status: "running",
        channelNames: ["agents"],
      },
    ],
  });
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("Call Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page
    .getByRole("button", { name: "Begin with my agent", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Ready — continue in the conversation",
      exact: true,
    }),
  ).toBeDisabled();
  const channelId = await page.evaluate(
    () =>
      (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).find(
        (row) =>
          row.command === "set_canvas" &&
          /"kind"\s*:\s*"aios.business-workspace"/.test(
            String(row.payload?.content),
          ),
      )?.payload?.channelId,
  );
  if (typeof channelId !== "string")
    throw new Error("Business fixture channel missing.");
  await page.evaluate(
    ({ agent, relay }) => {
      window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__?.({
        agentPubkey: agent,
        events: [
          {
            timestamp: new Date().toISOString(),
            seq: 1,
            kind: "managed_agent_runtime_lifecycle",
            agentIndex: null,
            channelId: null,
            sessionId: null,
            turnId: null,
            payload: {
              pubkey: agent,
              relayUrl: relay,
              startNonce: "call-runtime-one",
              lifecycle: "ready",
            },
          },
        ],
      });
    },
    { agent: AGENT, relay: RELAY },
  );
  await expect
    .poll(() =>
      page.evaluate(
        (owner) =>
          window.__BUZZ_E2E_HAS_MOCK_OWNER_KIND_SUBSCRIPTION__?.({
            ownerPubkey: owner,
            kind: 24200,
          }) ?? false,
        OWNER,
      ),
    )
    .toBe(true);
  return channelId;
}

async function ring(
  page: Page,
  channelId: string,
  overrides: Record<string, unknown> = {},
) {
  return page.evaluate(
    ({ agent, owner, relay, channelId, overrides }) => {
      const now = Math.floor(Date.now() / 1000);
      const request = {
        type: "call_request",
        version: 1,
        requestId: crypto.randomUUID(),
        ownerPubkey: owner,
        agentPubkey: agent,
        relayUrl: relay,
        runtimeStartNonce: "call-runtime-one",
        channelId,
        createdAt: now,
        expiresAt: now + 45,
        ...overrides,
      };
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "Call Studio",
        kind: 24200,
        pubkey: agent,
        content: JSON.stringify(request),
        createdAt: now,
        extraTags: [
          ["p", owner],
          ["agent", agent],
          ["frame", "control"],
        ],
      });
      return request;
    },
    { agent: AGENT, owner: OWNER, relay: RELAY, channelId, overrides },
  );
}

test("incoming call remains available outside chat and declining never requests the microphone", async ({
  page,
}) => {
  const channelId = await setup(page);
  await page
    .getByRole("button", { name: "Company context", exact: true })
    .click();
  const request = await ring(page, channelId);
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(
    "Fizz is requesting a private voice huddle in Call Studio",
  );
  expect(
    await page.evaluate(
      () => (window as CallFixtureWindow).__AIOS_CALL_MIC__.opened,
    ),
  ).toBe(0);
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/aios-incoming-call.png" });
  await dialog
    .getByRole("button", { name: "Decline call", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const decisions = await page.evaluate(
    () => window.__BUZZ_E2E_OBSERVER_CONTROLS__ ?? [],
  );
  expect(decisions).toContainEqual({
    agentPubkey: AGENT,
    payload: { ...request, type: "call_decision", decision: "decline" },
  });
  expect(
    await page.evaluate(
      () => (window as CallFixtureWindow).__AIOS_CALL_MIC__.opened,
    ),
  ).toBe(0);
});

test("acceptance starts only the requested scoped huddle before confirming the call", async ({
  page,
}) => {
  const channelId = await setup(page);
  const request = await ring(page, channelId);
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Accept and start voice", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  const log = await page.evaluate(() => window.__BUZZ_E2E_COMMAND_LOG__ ?? []);
  const startIndex = log.findIndex((row) => row.command === "start_huddle");
  const decisionIndex = log.findIndex(
    (row) =>
      row.command === "build_observer_control_event" &&
      (row.payload?.payload as { type?: string })?.type === "call_decision",
  );
  expect(log[startIndex]?.payload).toMatchObject({
    parentChannelId: channelId,
    memberPubkeys: [AGENT],
    expectedRelayUrl: RELAY,
    expectedSignerPubkey: OWNER,
  });
  expect(decisionIndex).toBeGreaterThan(startIndex);
  const decisions = await page.evaluate(
    () => window.__BUZZ_E2E_OBSERVER_CONTROLS__ ?? [],
  );
  expect(decisions).toContainEqual({
    agentPubkey: AGENT,
    payload: { ...request, type: "call_decision", decision: "accept" },
  });
  expect(
    await page.evaluate(
      () => (window as CallFixtureWindow).__AIOS_CALL_MIC__.opened,
    ),
  ).toBe(1);
});

test("a stale runtime cannot ring and an unanswered valid call expires without microphone access", async ({
  page,
}) => {
  const channelId = await setup(page);
  await page.clock.install();
  await ring(page, channelId, { runtimeStartNonce: "old-runtime" });
  await page.clock.runFor(300);
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  const now = await page.evaluate(() => Math.floor(Date.now() / 1000));
  await ring(page, channelId, { expiresAt: now + 3 });
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.clock.runFor(4000);
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => (window as CallFixtureWindow).__AIOS_CALL_MIC__.opened,
    ),
  ).toBe(0);
});

test("a failed call confirmation stops the microphone and exposes retry when native cleanup fails", async ({
  page,
}) => {
  const channelId = await setup(page);
  await page.evaluate(() => {
    const native = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const original = native.invoke;
    let leaveAttempts = 0;
    native.invoke = async (command, args) => {
      if (
        command === "build_observer_control_event" &&
        (args?.payload as { type?: string })?.type === "call_decision"
      ) {
        throw new Error("The call response could not reach the agent.");
      }
      if (command === "leave_huddle" && ++leaveAttempts === 1) {
        throw new Error("The voice server is temporarily unavailable.");
      }
      return original(command, args);
    };
  });
  await ring(page, channelId);
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Accept and start voice", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as CallFixtureWindow).__AIOS_CALL_MIC__.stopped,
      ),
    )
    .toBe(1);
  const retry = page.getByRole("button", {
    name: "Retry ending voice session",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await expect(
    page.getByText("The voice server is temporarily unavailable.", {
      exact: true,
    }),
  ).toBeVisible();
  await retry.click();
  await expect(retry).not.toBeVisible();
  await expect(
    page.getByText("The voice server is temporarily unavailable.", {
      exact: true,
    }),
  ).not.toBeVisible();
  const decisions = await page.evaluate(
    () => window.__BUZZ_E2E_OBSERVER_CONTROLS__ ?? [],
  );
  expect(decisions).toHaveLength(0);
});
