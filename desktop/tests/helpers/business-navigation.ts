import { expect, type Page } from "@playwright/test";

export async function openBusinessOverview(page: Page) {
  await page.getByTestId("open-business-view").click();
  await expect(page.getByTestId("business-workspace")).toBeVisible();
  const back = page.getByRole("button", {
    name: "Back to business",
    exact: true,
  });
  if (await back.isVisible()) await back.click();
}

export async function openSavedWork(page: Page) {
  await openBusinessOverview(page);
  await page.getByText("Earlier pilot work", { exact: true }).click();
  await page
    .getByRole("button", { name: "Open saved work", exact: true })
    .click();
  await expect(page.getByTestId("saved-work-workspace")).toBeVisible();
}

export async function openPluginConnection(page: Page, provider: string) {
  await page.getByTestId("open-plugins-view").click();
  await page.getByRole("button", { name: new RegExp(`^${provider} `) }).click();
}
