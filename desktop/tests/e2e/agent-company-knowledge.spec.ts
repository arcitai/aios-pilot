import { installCompanyKnowledgeCreation } from "../helpers/companyKnowledgeCreation";
import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

async function openCreate(page: Page, canonical: boolean) {
  await installMockBridge(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Toggle Sidebar", exact: true }),
  ).toBeVisible();
  if (!(await page.getByTestId("open-agents-view").isVisible())) {
    await page
      .getByRole("button", { name: "Toggle Sidebar", exact: true })
      .click();
  }
  await expect(page.getByTestId("open-agents-view")).toBeVisible();
  const contextId = await installCompanyKnowledgeCreation(page, canonical);
  await page.getByTestId("open-agents-view").click();
  const mobileSidebar = page.locator(
    '[data-sidebar="sidebar"][data-mobile="true"][data-state="open"]',
  );
  if (await mobileSidebar.isVisible()) await mobileSidebar.press("Escape");
  await page.getByTestId("new-agent-card").click();
  await page.locator("#persona-display-name").fill("Knowledge assistant");
  await page.getByRole("tab", { name: "Customize for this agent" }).click();
  await page.locator("#persona-llm-provider").click();
  await page
    .getByRole("menuitemradio", { name: "Buzz shared compute", exact: true })
    .click();
  await expect(
    page.getByText("Checking company knowledge…", { exact: true }),
  ).not.toBeVisible();
  return contextId;
}

for (const loading of ["when_needed", "full"] as const) {
  test(`agent setup sends ${loading} knowledge only to its scoped private instance`, async ({
    page,
  }) => {
    const contextId = await openCreate(page, true);
    const selector = page.getByLabel("Company knowledge", { exact: true });
    await expect(selector).toContainText("Studio knowledge");
    await expect(
      page.getByRole("radio", { name: /^When needed/ }),
    ).toBeChecked();
    const submit = page.getByRole("button", { name: "Add agent", exact: true });
    await expect(submit).toBeDisabled();
    if (loading === "full")
      await page.getByRole("radio", { name: /^Full company context/ }).check();
    await page
      .getByRole("checkbox", { name: /^Allow this agent to read and update/ })
      .check();
    await expect(submit).toBeEnabled();
    if (loading === "full")
      await page.setViewportSize({ width: 1000, height: 1000 });
    if (loading === "full") await waitForAnimations(page);
    if (loading === "full")
      await page.screenshot({
        path: "/tmp/aios-agent-company-knowledge.png",
        animations: "disabled",
      });
    await submit.click();
    await expect(
      page.getByText("Agent created", { exact: true }),
    ).toBeVisible();
    const calls = await page.evaluate(
      () => window.__BUZZ_E2E_COMMAND_LOG__ ?? [],
    );
    const creation = calls.filter(
      (entry) => entry.command === "create_managed_agent",
    );
    expect(creation).toHaveLength(1);
    const args = creation[0].payload as {
      expectedRelayUrl: string;
      expectedSignerPubkey: string;
      input: Record<string, unknown>;
    };
    expect(args.expectedRelayUrl).toMatch(/^wss?:\/\//);
    expect(args.expectedSignerPubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(args.input.businessContext).toEqual({
      selection: {
        context_id: contextId,
        relay_url: args.expectedRelayUrl,
        loading,
      },
      acknowledge_channel_history: true,
    });
    const definition = calls.find(
      (entry) => entry.command === "create_persona",
    );
    expect(definition).toBeDefined();
    expect(JSON.stringify(definition?.payload)).not.toContain(
      "businessContext",
    );
    expect(JSON.stringify(definition?.payload)).not.toContain(contextId);
  });
}

test("legacy context is an explicit choice and no knowledge grants nothing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await openCreate(page, false);
  const selector = page.getByLabel("Company knowledge", { exact: true });
  await expect(selector).toContainText("No company knowledge");
  await selector.click();
  await page
    .getByRole("menuitemradio", {
      name: "Studio knowledge (saved context)",
      exact: true,
    })
    .click();
  const submit = page.getByRole("button", { name: "Add agent", exact: true });
  await expect(submit).toBeDisabled();
  await waitForAnimations(page);
  await selector.press("Enter");
  await page
    .getByRole("menuitemradio", { name: "No company knowledge", exact: true })
    .click();
  await expect(submit).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await waitForAnimations(page);
  await page.screenshot({
    path: "/tmp/aios-agent-company-knowledge-narrow.png",
    animations: "disabled",
  });
  await submit.click();
  await expect(page.getByText("Agent created", { exact: true })).toBeVisible();
  const input = await page.evaluate(
    () =>
      (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).find(
        (entry) => entry.command === "create_managed_agent",
      )?.payload,
  );
  expect(
    (input as { input: Record<string, unknown> }).input.businessContext,
  ).toBeUndefined();
});

test("an old companion refuses company setup before saving a definition or identity", async ({
  page,
}) => {
  await openCreate(page, true);
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
    native.invoke = async (command, args) =>
      command === "managed_agent_business_context_protocol"
        ? 0
        : invoke(command, args);
  });
  await page
    .getByRole("checkbox", { name: /^Allow this agent to read and update/ })
    .check();
  await page.getByRole("button", { name: "Add agent", exact: true }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "does not support company knowledge" }),
  ).toBeVisible();
  await expect(page.locator("#persona-display-name")).toHaveValue(
    "Knowledge assistant",
  );
  const writes = await page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter((entry) =>
      /^(create_persona|create_managed_agent)$/.test(entry.command),
    ),
  );
  expect(writes).toHaveLength(0);
});

test("a denied instance preserves its draft and reuses the saved definition on retry", async ({
  page,
}) => {
  await openCreate(page, true);
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
    let deny = true;
    native.invoke = async (command, args) => {
      if (command === "create_managed_agent" && deny) {
        deny = false;
        throw new Error("Synthetic context authority denied before creation");
      }
      return invoke(command, args);
    };
  });
  await page
    .getByRole("checkbox", { name: /^Allow this agent to read and update/ })
    .check();
  const submit = page.getByRole("button", { name: "Add agent", exact: true });
  await submit.click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Synthetic context authority denied" }),
  ).toBeVisible();
  await expect(page.locator("#persona-display-name")).toHaveValue(
    "Knowledge assistant",
  );
  await expect(
    page.getByRole("checkbox", {
      name: /^Allow this agent to read and update/,
    }),
  ).toBeChecked();
  await submit.click();
  await expect(page.getByText("Agent created", { exact: true })).toBeVisible();
  const calls = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_LOG__ ?? [],
  );
  expect(
    calls.filter((entry) => entry.command === "create_persona"),
  ).toHaveLength(1);
  expect(
    calls.filter((entry) => entry.command === "create_managed_agent"),
  ).toHaveLength(1);
});
