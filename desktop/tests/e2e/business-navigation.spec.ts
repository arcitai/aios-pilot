import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { openSavedWork } from "../helpers/business-navigation";
import { waitForAnimations } from "../helpers/animations";

test("Business is knowledge, Plugins is a sibling, and leaving an edit preserves the draft", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page
    .getByLabel("What is your business called?")
    .fill("Navigation Studio");
  await page.getByRole("button", { name: "Create company context" }).click();
  const business = page.getByTestId("business-workspace");
  await expect(
    business.getByRole("heading", { name: "Navigation Studio", exact: true }),
  ).toBeVisible();
  await expect(
    business.getByRole("button", { name: "Main agent", exact: true }),
  ).toHaveCount(0);
  await expect(
    business.getByRole("button", { name: "Apps", exact: true }),
  ).toHaveCount(0);
  await expect(
    business.getByRole("button", { name: /huddle|members/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Navigation Studio", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Company context", exact: true })
    .click();
  await page
    .getByLabel("What you do", { exact: true })
    .fill("A draft that must survive navigation.");
  await page.getByTestId("open-plugins-view").click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page).toHaveURL(/\/business$/);
  await expect(page.getByLabel("What you do", { exact: true })).toHaveValue(
    "A draft that must survive navigation.",
  );
  await page.getByRole("button", { name: "Save company context" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await page.getByTestId("open-plugins-view").click();
  await expect(page.getByTestId("plugins-workspace")).toBeVisible();
  await page.getByTestId("open-business-view").click();
  await expect(
    business.getByText("A draft that must survive navigation.", {
      exact: true,
    }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/aios-business-overview-v2.png" });
});

test("Plugins works before company setup, search and skill inspection perform no agent writes", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("open-plugins-view").click();
  const plugins = page.getByTestId("plugins-workspace");
  await page.getByLabel("Search plugins").fill("notion");
  await expect(plugins.getByRole("button", { name: /^Notion / })).toBeVisible();
  await expect(plugins.getByRole("button", { name: /^GitHub / })).toHaveCount(
    0,
  );
  await page.getByLabel("Search plugins").fill("nothing-found");
  await expect(plugins.getByRole("status")).toContainText(
    "No connections match",
  );
  await page.getByLabel("Search plugins").fill("");
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Slide writer Available in agent setup",
      exact: true,
    })
    .click();
  await expect(
    plugins.getByRole("heading", { name: "Slide writer" }),
  ).toBeVisible();
  await expect(plugins).toContainText("Do not invent figures");
  const writes = await page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter((entry) =>
      /^(create_managed_agent|update_managed_agent|create_channel|set_canvas)$/.test(
        entry.command,
      ),
    ),
  );
  expect(writes).toHaveLength(0);
  await page
    .getByRole("button", { name: "Back to plugins", exact: true })
    .click();
  await page.setViewportSize({ width: 760, height: 900 });
  await waitForAnimations(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/aios-plugins-skills-v2.png" });
});

test("an unavailable saved-work link cannot open a different company's data", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("Private Studio");
  await page.getByRole("button", { name: "Create company context" }).click();
  await openSavedWork(page);
  // Exercise the real router without reloading the in-memory native fixture.
  await page.evaluate(() => {
    window.location.hash = "/saved-work?context=unavailable-context";
  });
  const saved = page.getByTestId("saved-work-workspace");
  await expect(saved.getByRole("alert")).toContainText("no longer available");
  await expect(page.getByTestId("aios-apps-workspace")).toHaveCount(0);
  await expect(saved).not.toContainText("Private Studio");
  await saved.getByRole("button", { name: "Business", exact: true }).click();
  await expect(page.getByTestId("business-workspace")).toContainText(
    "Private Studio",
  );
});
