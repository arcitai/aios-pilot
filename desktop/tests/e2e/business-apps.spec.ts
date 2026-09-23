import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

type SaveFixture = {
  blocked: boolean;
  completed: boolean;
  calls: string[];
  release: () => void;
};
type SaveFixtureWindow = Window & { __AIOS_SAVE_FIXTURE__: SaveFixture };

async function holdFirstAppSave(page: Page) {
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
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture: SaveFixture = {
      blocked: false,
      completed: false,
      calls: [],
      release,
    };
    (window as SaveFixtureWindow).__AIOS_SAVE_FIXTURE__ = fixture;
    native.invoke = async (command, args) => {
      if (
        command !== "set_canvas" ||
        !String(args?.content).includes('"kind":"aios.app-document"')
      )
        return original(command, args);
      fixture.calls.push(String(args?.content));
      const first = fixture.calls.length === 1;
      if (first) {
        fixture.blocked = true;
        await held;
      }
      const result = await original(command, args);
      if (first) fixture.completed = true;
      return result;
    };
  });
}

async function openApps(page: Page) {
  await installMockBridge(page);
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  await page.route("http://127.0.0.1:4173/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "Content-Security-Policy": config.app.security.csp,
      },
    });
  });
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("App Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await expect(page.getByTestId("aios-apps-workspace")).toBeVisible();
  await expect(page.getByLabel("Deck title", { exact: true })).toBeVisible();
}

test("slides save to a separate private app document and survive leaving the apps pane", async ({
  page,
}) => {
  await openApps(page);
  await page.getByLabel("Deck title", { exact: true }).fill("Customer story");
  await page
    .getByLabel("Headline", { exact: true })
    .fill("A clearer first conversation");
  await page
    .getByLabel("Supporting text", { exact: true })
    .fill("We use company context to prepare relevant customer questions.");
  const apps = page.getByTestId("aios-apps-workspace");
  await expect(apps.getByRole("status")).toContainText("Saved privately");
  const preview = page.getByRole("region", {
    name: "Slide preview",
    exact: true,
  });
  const stageBox = await preview.boundingBox();
  const copyBox = await preview.locator(".aios-slide-stage-copy").boundingBox();
  expect(stageBox).not.toBeNull();
  expect(copyBox).not.toBeNull();
  if (stageBox && copyBox) {
    expect(copyBox.y + copyBox.height).toBeLessThanOrEqual(
      stageBox.y + stageBox.height,
    );
    expect(
      await preview.evaluate(
        (element) => element.scrollHeight <= element.clientHeight + 1,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: "test-results/aios-apps-slides.png",
    animations: "disabled",
  });
  const writes = await page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? [])
      .filter((entry) => entry.command === "set_canvas")
      .map((entry) => entry.payload),
  );
  const appWrite = writes.findLast((payload) =>
    String(payload?.content).includes('"kind":"aios.app-document"'),
  );
  expect(appWrite).toMatchObject({
    expectedRelayUrl: "ws://localhost:3000",
    expectedSignerPubkey: "deadbeef".repeat(8),
  });
  expect(appWrite?.expectedRevision).toBe("none");
  const envelope = JSON.parse(String(appWrite?.content));
  expect(envelope.appId).toBe("slides");
  expect(envelope.document.title).toBe("Customer story");
  expect(appWrite?.channelId).not.toBe(envelope.businessChannelId);
  await page
    .getByRole("button", { name: "Company context", exact: true })
    .click();
  await expect(page.getByLabel("Company name", { exact: true })).toHaveValue(
    "App Studio",
  );
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await expect(page.getByLabel("Deck title", { exact: true })).toHaveValue(
    "Customer story",
  );
  await expect(page.getByLabel("Headline", { exact: true })).toHaveValue(
    "A clearer first conversation",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export HTML", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("customer-story.html");
});

test("an unfinished Calendar event is guarded across business navigation and retained between apps", async ({
  page,
}) => {
  await openApps(page);
  await page.getByTestId("aios-app-nav-calendar").click();
  await page.getByLabel("Event name", { exact: true }).fill("Discovery call");
  await page.getByTestId("aios-app-nav-slides").click();
  await page.getByTestId("aios-app-nav-calendar").click();
  await expect(page.getByLabel("Event name", { exact: true })).toHaveValue(
    "Discovery call",
  );
  await page.getByRole("button", { name: "Main agent", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Leave your unsaved changes?",
  );
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.getByRole("button", { name: "Add event", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Discovery call", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("aios-apps-workspace")
      .getByRole("status")
      .filter({ hasText: "Saved" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).some(
          (entry) =>
            entry.command === "set_canvas" &&
            String(entry.payload?.content).includes('"appId":"calendar"') &&
            String(entry.payload?.content).includes("Discovery call"),
        ),
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/aios-apps-calendar.png",
    animations: "disabled",
  });
  await page
    .getByLabel("Event name", { exact: true })
    .fill("Discard this draft");
  await page.getByRole("button", { name: "Main agent", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await page.getByTestId("aios-app-nav-calendar").click();
  await expect(page.getByLabel("Event name", { exact: true })).toHaveValue("");
  await expect(
    page.getByRole("heading", { name: "Discovery call", exact: true }),
  ).toBeVisible();
});

test("design previews render under the production parent CSP without executing scripts or loading remote assets", async ({
  page,
}) => {
  const external: string[] = [];
  const denied: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes("blocked-fixture.invalid"))
      denied.push(request.failure()?.errorText ?? "unknown");
  });
  await page.route("https://blocked-fixture.invalid/**", (route) => {
    external.push(route.request().url());
    return route.abort();
  });
  await openApps(page);
  await page.getByTestId("aios-app-nav-design").click();
  await page
    .getByLabel("Design HTML source")
    .fill(
      '<style>body{background:u\\72l(https://blocked-fixture.invalid/before-head)}</style><html><head></head><body><h1>Welcome to our studio</h1><script>window.parent.document.title="UNSAFE"</script><img src="https://blocked-fixture.invalid/image.png"><form action="https://blocked-fixture.invalid/submit"><input></form></body></html>',
    );
  const preview = page.frameLocator('iframe[title="Sandboxed design preview"]');
  await expect(
    preview.getByRole("heading", { name: "Welcome to our studio" }),
  ).toBeVisible();
  await expect(preview.locator("script,form,img[src]")).toHaveCount(0);
  expect(await page.title()).not.toBe("UNSAFE");
  expect(external).toEqual([]);
  // Chromium reports this attempt before CSP rejects it. It must never
  // reach interception/network, and the browser must identify CSP denial.
  expect(denied).toEqual(["csp"]);
  await expect(
    page.getByTestId("aios-apps-workspace").getByRole("status"),
  ).toContainText("Saved");
  await page.setViewportSize({ width: 900, height: 760 });
  await page.screenshot({
    path: "test-results/aios-apps-design.png",
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("an older save cannot report the newer pending draft as saved", async ({
  page,
}) => {
  await openApps(page);
  await page.clock.install();
  await holdFirstAppSave(page);
  await page.getByLabel("Deck title", { exact: true }).fill("First version");
  await page.clock.runFor(600);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as SaveFixtureWindow).__AIOS_SAVE_FIXTURE__.blocked,
      ),
    )
    .toBe(true);
  await page.getByLabel("Deck title", { exact: true }).fill("Second version");
  await page.evaluate(() =>
    (window as SaveFixtureWindow).__AIOS_SAVE_FIXTURE__.release(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as SaveFixtureWindow).__AIOS_SAVE_FIXTURE__.completed,
      ),
    )
    .toBe(true);
  await expect(
    page.getByTestId("aios-apps-workspace").getByRole("status"),
  ).toHaveText("Unsaved changes");
  await page.clock.runFor(600);
  await expect(
    page.getByTestId("aios-apps-workspace").getByRole("status"),
  ).toHaveText("Saved privately");
  const writes = await page.evaluate(
    () => (window as SaveFixtureWindow).__AIOS_SAVE_FIXTURE__.calls,
  );
  expect(writes).toHaveLength(2);
  expect(JSON.parse(writes[1]).document.title).toBe("Second version");
});

test("discarding the workspace cancels a queued save that has not reached storage", async ({
  page,
}) => {
  await openApps(page);
  await page.clock.install();
  await holdFirstAppSave(page);
  await page
    .getByLabel("Deck title", { exact: true })
    .fill("Already submitted");
  await page.clock.runFor(600);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as SaveFixtureWindow).__AIOS_SAVE_FIXTURE__.blocked,
      ),
    )
    .toBe(true);
  await page
    .getByLabel("Deck title", { exact: true })
    .fill("Discard queued version");
  await page.clock.runFor(600);
  await page
    .getByRole("button", { name: "Company context", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page.evaluate(() =>
    (window as SaveFixtureWindow).__AIOS_SAVE_FIXTURE__.release(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as SaveFixtureWindow).__AIOS_SAVE_FIXTURE__.completed,
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await expect(page.getByLabel("Deck title", { exact: true })).toHaveValue(
    "Already submitted",
  );
  expect(
    await page.evaluate(
      () => (window as SaveFixtureWindow).__AIOS_SAVE_FIXTURE__.calls,
    ),
  ).toHaveLength(1);
});
