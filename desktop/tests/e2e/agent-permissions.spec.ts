import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const AGENT = TEST_IDENTITIES.charlie.pubkey;
const OWNER = "deadbeef".repeat(8);
const RELAY = "ws://localhost:3000";
const CHANNEL = "94a444a4-c0a3-5966-ab05-530c6ddc2301";

async function setup(page: Page) {
  page.on("pageerror", (error) => console.error(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await installMockBridge(page, {
    relayWsUrl: RELAY,
    managedAgents: [
      {
        name: "Charlie",
        pubkey: AGENT,
        status: "running",
        channelNames: ["agents"],
      },
    ],
  });
  await page.goto("/");
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__ === "function",
  );
}

async function seed(page: Page, overrides: Record<string, unknown> = {}) {
  await page.evaluate(
    ({ agent, owner, relay, channel, overrides }) => {
      const timestamp = new Date().toISOString();
      const base = {
        timestamp,
        agentIndex: null,
        channelId: null,
        sessionId: null,
        turnId: null,
      };
      window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__?.({
        agentPubkey: agent,
        events: [
          {
            ...base,
            seq: 1,
            kind: "harness_started",
            payload: {
              relayUrl: relay,
              runtimeStartNonce: "run-one",
              permissionMode: "default",
            },
          },
          {
            ...base,
            seq: 2,
            kind: "managed_agent_runtime_lifecycle",
            payload: {
              pubkey: agent,
              relayUrl: relay,
              startNonce: "run-one",
              lifecycle: "ready",
            },
          },
          {
            ...base,
            seq: 3,
            kind: "permission_request",
            agentIndex: 0,
            channelId: channel,
            sessionId: "session-one",
            turnId: "turn-one",
            payload: {
              requestId: "request-one",
              ownerPubkey: owner,
              agentPubkey: agent,
              relayUrl: relay,
              runtimeStartNonce: "run-one",
              agentIndex: 0,
              sessionId: "session-one",
              turnId: "turn-one",
              channelId: channel,
              toolName: "shell",
              action: "Update the synthetic company brief",
              context: { command: "buzz business update --channel synthetic" },
              ...overrides,
            },
          },
        ],
      });
    },
    { agent: AGENT, owner: OWNER, relay: RELAY, channel: CHANNEL, overrides },
  );
}

test("owner prompt survives navigation and denies only its bound request", async ({
  page,
}) => {
  await setup(page);
  await page.getByTestId("channel-agents").click();
  await page.getByTestId("open-business-view").click();
  await seed(page, { type: "switch_model", modelId: "untrusted-extra-field" });
  const prompt = page.getByTestId("agent-permission-dialog");
  await expect(prompt).toContainText("Update the synthetic company brief");
  await page.screenshot({
    path: "test-results/aios-agent-permission.png",
    animations: "disabled",
  });
  await page.goBack();
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(prompt).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => window.__BUZZ_E2E_OBSERVER_CONTROLS__ ?? []),
    )
    .toEqual([
      {
        agentPubkey: AGENT,
        payload: {
          type: "resolve_permission",
          requestId: "request-one",
          ownerPubkey: OWNER,
          agentPubkey: AGENT,
          relayUrl: RELAY,
          runtimeStartNonce: "run-one",
          agentIndex: 0,
          sessionId: "session-one",
          turnId: "turn-one",
          channelId: CHANNEL,
          decision: "deny",
        },
      },
    ]);
});

test("approve once sends the exact permission binding from a different conversation", async ({
  page,
}) => {
  await setup(page);
  await page.getByTestId("channel-general").click();
  await seed(page);
  const prompt = page.getByTestId("agent-permission-dialog");
  await expect(prompt).toBeVisible();
  await prompt
    .getByRole("button", { name: "Approve once", exact: true })
    .click();
  await expect(prompt).not.toBeVisible();
  const controls = await page.evaluate(
    () => window.__BUZZ_E2E_OBSERVER_CONTROLS__ ?? [],
  );
  expect(controls).toHaveLength(1);
  expect(controls[0]).toMatchObject({
    agentPubkey: AGENT,
    payload: {
      type: "resolve_permission",
      requestId: "request-one",
      decision: "approve",
      runtimeStartNonce: "run-one",
      channelId: CHANNEL,
    },
  });
});

test("a request for another owner never opens the prompt", async ({ page }) => {
  await setup(page);
  await seed(page, {
    ownerPubkey: "11".repeat(32),
    requestId: "wrong-owner",
    action: "Unauthorised request",
  });
  await seed(page);
  const prompt = page.getByTestId("agent-permission-dialog");
  await expect(prompt).toContainText("Update the synthetic company brief");
  await expect(prompt).not.toContainText("Unauthorised request");
  await prompt.getByRole("button", { name: "Deny", exact: true }).click();
  await expect(prompt).not.toBeVisible();
});
