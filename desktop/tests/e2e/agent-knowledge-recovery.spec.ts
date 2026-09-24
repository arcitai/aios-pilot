import { expect, test } from "@playwright/test";
import { openAgentKnowledge } from "../helpers/agentKnowledge";
import { waitForAnimations } from "../helpers/animations";

test("a persona-linked agent exposes its private knowledge through Agent settings", async ({
  page,
}) => {
  const dialog = await openAgentKnowledge(page, "full", true);
  await expect(
    dialog.getByRole("radio", { name: /^Full company context/ }),
  ).toBeChecked();
  await dialog.press("Escape");
  await expect(page.locator("#edit-agent-name")).toHaveValue(
    "Unsaved name draft",
  );
  expect(
    await page.evaluate(() => window.__AIOS_EDIT_KNOWLEDGE__.calls),
  ).toEqual([]);
});

test("an existing agent does not inherit a new context and closing preserves ordinary edits", async ({
  page,
}) => {
  const dialog = await openAgentKnowledge(page);
  await expect(
    dialog.getByLabel("Company knowledge", { exact: true }),
  ).toContainText("No company knowledge");
  await expect(
    dialog.getByRole("button", { name: "Save knowledge access" }),
  ).toBeDisabled();
  await dialog.press("Escape");
  await expect(page.locator("#edit-agent-name")).toHaveValue(
    "Unsaved name draft",
  );
  expect(
    await page.evaluate(() => window.__AIOS_EDIT_KNOWLEDGE__.calls),
  ).toEqual([]);
});

test("an old companion cannot silently accept an existing agent's knowledge settings", async ({
  page,
}) => {
  const dialog = await openAgentKnowledge(page, "full");
  await page.evaluate(() => {
    window.__AIOS_EDIT_KNOWLEDGE__.protocol = 0;
  });
  await dialog.getByRole("radio", { name: /^When needed/ }).check();
  await dialog
    .getByRole("checkbox", { name: /^Allow this agent to read and update/ })
    .check();
  await dialog.getByRole("button", { name: "Save knowledge access" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "does not support company knowledge",
  );
  expect(
    await page.evaluate(() => window.__AIOS_EDIT_KNOWLEDGE__.calls),
  ).toEqual([]);
});

test("editing loading and removing access save the private instance separately", async ({
  page,
}) => {
  const dialog = await openAgentKnowledge(page, "full");
  await expect(
    dialog.getByRole("radio", { name: /^Full company context/ }),
  ).toBeChecked();
  await dialog.getByRole("radio", { name: /^When needed/ }).check();
  const save = dialog.getByRole("button", { name: "Save knowledge access" });
  await expect(save).toBeDisabled();
  await dialog
    .getByRole("checkbox", { name: /^Allow this agent to read and update/ })
    .check();
  await save.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("#edit-agent-name")).toHaveValue(
    "Unsaved name draft",
  );
  await expect(page.getByText("When needed", { exact: true })).toBeVisible();
  const { calls, selection } = await page.evaluate(
    () => window.__AIOS_EDIT_KNOWLEDGE__,
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].command).toBe("set_managed_agent_business_context");
  expect(calls[0].input).toMatchObject({
    selection: { ...selection, loading: "when_needed" },
    acknowledge_channel_history: true,
    expected_relay_url: selection.relay_url,
  });
  expect(calls[0].input.expected_signer_pubkey).toMatch(/^[0-9a-f]{64}$/);
  await page.getByRole("button", { name: "Manage company knowledge" }).click();
  await dialog.getByLabel("Company knowledge", { exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "No company knowledge", exact: true })
    .click();
  await waitForAnimations(page);
  await save.click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("No company knowledge", { exact: true }),
  ).toBeVisible();
  const last = await page.evaluate(() =>
    window.__AIOS_EDIT_KNOWLEDGE__.calls.at(-1),
  );
  expect(last?.input.selection).toBeNull();
  expect(last?.input.acknowledge_channel_history).toBe(false);
  const ordinaryWrites = await page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter((entry) =>
      /^(update_managed_agent|create_managed_agent|create_persona|update_persona)$/.test(
        entry.command,
      ),
    ),
  );
  expect(ordinaryWrites).toHaveLength(0);
});

test("ambiguous grant recovery retries one operation and can remove unapplied access", async ({
  page,
}) => {
  const dialog = await openAgentKnowledge(page, "pending");
  await page.evaluate(() => {
    window.__AIOS_EDIT_KNOWLEDGE__.behavior = "pending";
  });
  await dialog
    .getByRole("button", { name: "Retry setup", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Synthetic host verification interrupted",
  );
  const first = await page.evaluate(
    () => window.__AIOS_EDIT_KNOWLEDGE__.calls[0],
  );
  expect(first.command).toBe("retry_managed_agent_business_context");
  expect(first.input.operation_id).toBe("saved-operation");
  await page.setViewportSize({ width: 760, height: 900 });
  await waitForAnimations(page);
  await page.screenshot({
    path: "/tmp/aios-agent-knowledge-recovery.png",
    animations: "disabled",
  });
  await page.evaluate(() => {
    window.__AIOS_EDIT_KNOWLEDGE__.behavior = "ok";
  });
  await dialog
    .getByRole("button", { name: "Remove access", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("No company knowledge", { exact: true }),
  ).toBeVisible();
  const calls = await page.evaluate(() => window.__AIOS_EDIT_KNOWLEDGE__.calls);
  expect(calls).toHaveLength(2);
  expect(calls[1].command).toBe("set_managed_agent_business_context");
  expect(calls[1].input.selection).toBeNull();
});

test("an interrupted removal retries its saved operation without regranting", async ({
  page,
}) => {
  const dialog = await openAgentKnowledge(page, "removing");
  await expect(
    dialog.getByRole("button", { name: "Retry setup", exact: true }),
  ).not.toBeVisible();
  await dialog
    .getByRole("button", { name: "Retry removal", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const calls = await page.evaluate(() => window.__AIOS_EDIT_KNOWLEDGE__.calls);
  expect(calls).toHaveLength(1);
  expect(calls[0].command).toBe("retry_managed_agent_business_context");
  expect(calls[0].input.operation_id).toBe("saved-operation");
});

for (const failure of ["deny", "unconfirmed"] as const) {
  test(`${failure} knowledge change stays visible without claiming applied access`, async ({
    page,
  }) => {
    const dialog = await openAgentKnowledge(page, "full");
    await page.evaluate((behavior) => {
      window.__AIOS_EDIT_KNOWLEDGE__.behavior = behavior;
    }, failure);
    await dialog.getByRole("radio", { name: /^When needed/ }).check();
    await dialog
      .getByRole("checkbox", { name: /^Allow this agent to read and update/ })
      .check();
    await dialog.getByRole("button", { name: "Save knowledge access" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      failure === "deny"
        ? "Synthetic context authority denied"
        : "The host has not confirmed",
    );
    await expect(
      dialog.getByRole("radio", { name: /^When needed/ }),
    ).toBeChecked();
    await dialog.press("Escape");
    await expect(page.locator("#edit-agent-name")).toHaveValue(
      "Unsaved name draft",
    );
  });
}
