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
