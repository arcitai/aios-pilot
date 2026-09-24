import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { installCompanyKnowledgeCreation } from "../helpers/companyKnowledgeCreation";
import { waitForAnimations } from "../helpers/animations";

async function setup(page: Page) {
  await installMockBridge(page, {
    personas: [
      {
        id: "saved-assistant",
        displayName: "Saved assistant",
        systemPrompt: "Help with company work.",
        runtime: "buzz-agent",
      },
    ],
  });
  await page.goto("/");
  await expect(page.getByTestId("open-agents-view")).toBeVisible();
  const contextId = await installCompanyKnowledgeCreation(page);
  await page.getByTestId("open-agents-view").click();
  return contextId;
}

async function writes(page: Page) {
  return page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter((entry) =>
      /^(create_persona|update_persona|create_managed_agent|start_managed_agent)$/.test(
        entry.command,
      ),
    ),
  );
}

test("a saved agent reviews access before creating and starting its private instance", async ({
  page,
}) => {
  const contextId = await setup(page);
  await page.getByTestId("persona-runtime-start-saved-assistant").click();
  const dialog = page.getByTestId("start-saved-agent-dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByLabel("Company knowledge", { exact: true }),
  ).toContainText("Studio knowledge");
  await expect(
    dialog.getByRole("button", { name: "Start agent", exact: true }),
  ).toBeDisabled();
  expect(await writes(page)).toHaveLength(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await writes(page)).toHaveLength(0);
  await page.getByTestId("persona-runtime-start-saved-assistant").click();
  await expect(
    dialog.getByRole("radio", { name: /^When needed/ }),
  ).toBeChecked();
  await dialog.getByRole("checkbox", { name: /^Allow this agent/ }).check();
  await page.setViewportSize({ width: 760, height: 900 });
  await waitForAnimations(page);
  await page.screenshot({
    path: "/tmp/aios-saved-agent-start.png",
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "Start agent", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Agent created", { exact: true })).toBeVisible();
  const calls = await writes(page);
  expect(calls.map((call) => call.command)).toEqual([
    "create_managed_agent",
    "start_managed_agent",
  ]);
  const create = calls[0].payload as {
    expectedRelayUrl: string;
    expectedSignerPubkey: string;
    input: {
      personaId: string;
      spawnAfterCreate: boolean;
      businessContext: { selection: { context_id: string; loading: string } };
    };
  };
  expect(create.input.personaId).toBe("saved-assistant");
  expect(create.input.spawnAfterCreate).toBe(false);
  expect(create.input.businessContext.selection).toMatchObject({
    context_id: contextId,
    loading: "when_needed",
  });
  expect(calls[1].payload).toMatchObject({
    expectedRelayUrl: create.expectedRelayUrl,
    expectedSignerPubkey: create.expectedSignerPubkey,
  });
});

test("profile start uses the same form and recovers a failed start on the saved identity", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Saved assistant agent profile" })
    .click();
  await page.getByRole("button", { name: "Start Agent", exact: true }).click();
  const dialog = page.getByTestId("start-saved-agent-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox", { name: /^Allow this agent/ }).check();
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
      if (command === "start_managed_agent")
        throw new Error("Synthetic start unavailable");
      return invoke(command, args);
    };
  });
  await dialog
    .getByRole("button", { name: "Start agent", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("Agent created, but setup needs attention", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review agent", exact: true }).click();
  await expect(page.getByTestId("edit-agent-dialog")).toBeVisible();
  expect(
    (await writes(page)).filter(
      (call) => call.command === "create_managed_agent",
    ),
  ).toHaveLength(1);
});

test("duplicating a profile saves its definition once and asks for private access before starting", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Saved assistant agent profile" })
    .click();
  await page
    .getByRole("button", { name: "Duplicate agent", exact: true })
    .click();
  const definition = page.getByTestId("persona-dialog");
  await expect(definition).toBeVisible();
  await definition
    .getByRole("tab", { name: "Customize for this agent" })
    .click();
  await definition.locator("#persona-llm-provider").click();
  await page
    .getByRole("menuitemradio", { name: "Buzz shared compute", exact: true })
    .click();
  await definition
    .getByRole("button", { name: "Create agent", exact: true })
    .click();
  const access = page.getByTestId("start-saved-agent-dialog");
  await expect(access).toBeVisible();
  expect((await writes(page)).map((call) => call.command)).toEqual([
    "create_persona",
  ]);
  await access.getByLabel("Company knowledge", { exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "No company knowledge", exact: true })
    .click();
  await access
    .getByRole("button", { name: "Start agent", exact: true })
    .click();
  await expect(access).not.toBeVisible();
  await expect(page.getByText("Agent created", { exact: true })).toBeVisible();
  expect((await writes(page)).map((call) => call.command)).toEqual([
    "create_persona",
    "create_managed_agent",
    "start_managed_agent",
  ]);
});
