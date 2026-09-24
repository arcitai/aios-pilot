import { expect, test } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

test("main agent settings open inside the business conversation", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: TEST_IDENTITIES.tyler.pubkey,
        name: "Fizz",
        personaId: "builtin:fizz",
        status: "stopped",
        channelNames: ["agents"],
      },
    ],
  });
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page
    .getByLabel("What is your business called?")
    .fill("Onboarding Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await expect(
    page.getByText(
      "Your business context and conversation with your main agent.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/\[aios\.business-workspace:v1\]/),
  ).not.toBeVisible();
  const controls = page.getByTestId("business-agent-controls");
  await expect(controls).toContainText("Your main agent is stopped.");
  await controls.getByRole("button", { name: "Main agent settings" }).click();
  const dialog = page.getByTestId("edit-agent-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#edit-agent-llm-provider")).toBeVisible();
  await expect(page).toHaveURL(/\/business$/);
  await page.screenshot({
    path: "test-results/aios-main-agent-settings.png",
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("business-workspace")).toContainText(
    "Onboarding Studio",
  );
});

test("missing-agent recovery exposes AI settings without discarding the workspace", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("Setup Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page.getByRole("button", { name: "Set up AI", exact: true }).click();
  const dialog = page.getByTestId("agent-ai-defaults-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("These settings apply to all agents");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId("business-workspace")).toContainText(
    "Setup Studio",
  );
});

test("begin creates one scoped main agent before membership, kickoff and start", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page
    .getByLabel("What is your business called?")
    .fill("First conversation");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page
    .getByRole("button", { name: "Begin with my agent", exact: true })
    .click();
  const controls = page.getByTestId("business-agent-controls");
  await expect(controls).toContainText("Ready — continue in the conversation");
  const log = await page.evaluate(() => window.__BUZZ_E2E_COMMAND_LOG__ ?? []);
  const creations = log.filter((row) => row.command === "create_managed_agent");
  expect(creations).toHaveLength(1);
  expect(creations[0].payload).toMatchObject({
    expectedRelayUrl: "ws://localhost:3000",
    expectedSignerPubkey: "deadbeef".repeat(8),
    input: {
      name: "Fizz",
      personaId: "builtin:fizz",
      relayUrl: "ws://localhost:3000",
      spawnAfterCreate: false,
      startOnAppLaunch: false,
      respondTo: "owner-only",
    },
  });
  const createIndex = log.findIndex(
    (row) => row.command === "create_managed_agent",
  );
  const addIndex = log.findIndex(
    (row, index) =>
      index > createIndex && row.command === "add_channel_members",
  );
  const sendIndex = log.findIndex(
    (row, index) => index > addIndex && row.command === "send_channel_message",
  );
  const startIndex = log.findIndex(
    (row, index) => index > sendIndex && row.command === "start_managed_agent",
  );
  expect(addIndex).toBeGreaterThan(createIndex);
  expect(sendIndex).toBeGreaterThan(addIndex);
  expect(startIndex).toBeGreaterThan(sendIndex);
  await page
    .getByRole("button", { name: "Company context", exact: true })
    .click();
  await page.getByRole("button", { name: "Main agent", exact: true }).click();
  await expect(
    controls.getByRole("button", { name: "Main agent settings" }),
  ).toBeVisible();
});

test("retry after profile sync failure reuses the created main agent", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("Retry Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
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
    const invoke = native.invoke;
    native.invoke = async (command, args) => {
      const result = await invoke(command, args);
      return command === "create_managed_agent"
        ? {
            ...(result as Record<string, unknown>),
            profile_sync_error: "Synthetic relay interruption",
          }
        : result;
    };
  });
  const begin = page.getByRole("button", {
    name: "Begin with my agent",
    exact: true,
  });
  await begin.click();
  await expect(
    page.getByTestId("business-agent-controls").getByRole("alert"),
  ).toContainText("was created");
  await begin.click();
  await expect(page.getByTestId("business-agent-controls")).toContainText(
    "Ready — continue in the conversation",
  );
  const count = await page.evaluate(
    () =>
      (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
        (row) => row.command === "create_managed_agent",
      ).length,
  );
  expect(count).toBe(1);
});
