import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const DESKTOP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const VITE_PORT = 1422;
const PREVIEW_URL = `http://127.0.0.1:${VITE_PORT}/aios-apps-preview.html`;
const FIZZ_PUBKEY = "b".repeat(64);

type AppsTestState = {
  invocations: Array<{
    command: string;
    args?: Record<string, unknown>;
  }>;
  mounts: number;
  delayInvite: boolean;
  inviteStarted: boolean;
  releaseInvite?: () => void;
};

declare global {
  interface Window {
    __AIOS_APPS_TEST_STATE__: AppsTestState;
  }
}

let viteProcess: ChildProcess | undefined;
let viteError = "";

test.beforeAll(async () => {
  viteProcess = spawn(
    process.execPath,
    [
      path.join(DESKTOP_ROOT, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(VITE_PORT),
    ],
    {
      cwd: DESKTOP_ROOT,
      env: { ...process.env, VITE_PORT: String(VITE_PORT) },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  viteProcess.stderr?.on("data", (chunk: Buffer) => {
    viteError += chunk.toString();
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (viteProcess.exitCode !== null) {
      throw new Error(`The Apps UI test server exited early:\n${viteError}`);
    }
    try {
      const response = await fetch(PREVIEW_URL);
      if (response.ok) return;
    } catch {
      // Wait briefly while Vite starts.
    }
    await delay(100);
  }
  throw new Error(`The Apps UI test server did not start:\n${viteError}`);
});

test.afterAll(async () => {
  if (!viteProcess || viteProcess.exitCode !== null) return;
  viteProcess.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => viteProcess?.once("exit", () => resolve())),
    delay(2_000),
  ]);
});

test("keeps extension drafts and isolates delayed app invites after switching apps", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(PREVIEW_URL);
  await page
    .getByTestId("aios-apps-embedded-save-status")
    .getByText("Saved privately")
    .waitFor();
  await page.getByTestId("aios-app-nav-sites").click();
  const draft = page.getByRole("textbox", { name: "Site draft" });
  await draft.fill("Spring launch draft");
  await expect(page.getByTestId("host-dirty-state")).toHaveText("dirty");
  await expect
    .poll(() => page.evaluate(() => window.__AIOS_APPS_TEST_STATE__.mounts))
    .toBe(1);
  await page.getByTestId("aios-app-nav-calendar").click();
  await page.getByTestId("aios-app-nav-sites").click();
  await expect(draft).toHaveValue("Spring launch draft");
  await expect
    .poll(() => page.evaluate(() => window.__AIOS_APPS_TEST_STATE__.mounts))
    .toBe(1);

  await page.getByTestId("aios-app-nav-slides").click();
  const slidesAccess = page.getByTestId("aios-app-access-slides");
  await slidesAccess.locator("summary").click();
  await page.getByTestId("aios-app-access-create-slides").click();
  await expect(
    slidesAccess.getByText("1 person can access this app."),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__AIOS_APPS_TEST_STATE__.invocations.filter(
            (entry) => entry.command === "add_channel_members",
          ).length,
      ),
    )
    .toBe(0);
  await slidesAccess
    .getByRole("button", { name: "Let my main agent help" })
    .click();
  await expect(
    slidesAccess.getByRole("button", { name: "Fizz already has access" }),
  ).toBeVisible();
  await expect(
    slidesAccess.getByText("2 people can access this app."),
  ).toBeVisible();

  await page.getByTestId("aios-app-nav-calendar").click();
  const calendarAccess = page.getByTestId("aios-app-access-calendar");
  await calendarAccess.locator("summary").click();
  await page.getByTestId("aios-app-access-create-calendar").click();
  await expect(
    calendarAccess.getByText("2 people can access this app."),
  ).toBeVisible();
  await expect(
    calendarAccess.getByText("Reviewer", { exact: true }),
  ).toBeVisible();

  await page.evaluate(() => {
    window.__AIOS_APPS_TEST_STATE__.delayInvite = true;
  });
  await calendarAccess
    .getByRole("button", { name: "Let my main agent help" })
    .click();
  await page.waitForFunction(
    () => window.__AIOS_APPS_TEST_STATE__.inviteStarted,
  );
  await page.getByTestId("aios-app-nav-slides").click();
  const activeSlidesAccess = page.getByTestId("aios-app-access-slides");
  await activeSlidesAccess.locator("summary").click();
  await expect(
    activeSlidesAccess.getByText("2 people can access this app."),
  ).toBeVisible();
  await expect(
    activeSlidesAccess.getByText("Fizz", { exact: true }),
  ).toBeVisible();
  await expect(
    activeSlidesAccess.getByText("Reviewer", { exact: true }),
  ).toHaveCount(0);

  await page.evaluate(() => window.__AIOS_APPS_TEST_STATE__.releaseInvite?.());
  await expect(
    activeSlidesAccess.getByText("2 people can access this app."),
  ).toBeVisible();
  await expect(
    activeSlidesAccess.getByText("Reviewer", { exact: true }),
  ).toHaveCount(0);
  const delayedInvite = await page.evaluate(() =>
    window.__AIOS_APPS_TEST_STATE__.invocations.find(
      (entry) =>
        entry.command === "add_channel_members" &&
        entry.args?.role === "bot" &&
        entry.args.expectedRelayUrl === "wss://relay.example.test",
    ),
  );
  expect(delayedInvite?.args?.pubkeys).toEqual([FIZZ_PUBKEY]);
  expect(delayedInvite?.args?.expectedSignerPubkey).toBe("a".repeat(64));

  await page.setViewportSize({ width: 390, height: 844 });
  const panelRect = await activeSlidesAccess
    .locator(".aios-app-access-panel")
    .evaluate((panel) => panel.getBoundingClientRect().toJSON());
  expect(panelRect.left).toBeGreaterThanOrEqual(0);
  expect(panelRect.right).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(pageErrors).toEqual([]);
});
