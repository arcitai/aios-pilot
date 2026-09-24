import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { startSitesPublisherFixture } from "../helpers/sites-publisher";

async function openSites(page: Page, mainAgent = false, advanced = true) {
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
  await expect(page.getByTestId("open-business-view")).toBeVisible();
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
    native.invoke = (command, args) => {
      if (
        [
          "sites_publisher_status",
          "connect_sites_publisher",
          "disconnect_sites_publisher",
          "sites_publisher_preview",
          "sites_publisher_site_status",
          "publish_sites_site",
          "revoke_sites_site",
        ].includes(command)
      ) {
        const fixture = (
          window as unknown as {
            __AIOS_PUBLISHER_FIXTURE__?: (
              command: string,
              args: Record<string, unknown>,
            ) => Promise<unknown>;
          }
        ).__AIOS_PUBLISHER_FIXTURE__;
        if (fixture) return fixture(command, args ?? {});
        if (command === "sites_publisher_status")
          return Promise.resolve({ connected: false, version: null });
        return Promise.reject(
          new Error("No publisher fixture was configured."),
        );
      }
      return original(command, args);
    };
  });
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("Site Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  if (mainAgent) {
    await page
      .getByRole("button", { name: "Begin with my agent", exact: true })
      .click();
    await expect(page.getByTestId("business-agent-controls")).toContainText(
      "Ready — continue in the conversation",
    );
  }
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await page.getByTestId("aios-app-nav-sites").click();
  await expect(page.getByTestId("aios-sites-workspace")).toBeVisible();
  await page
    .getByRole("button", { name: "Create a site", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Name this site", { exact: true })
    .fill("Customer welcome");
  await page.getByRole("button", { name: "Create site", exact: true }).click();
  await expect(page.getByLabel("Site name", { exact: true })).toHaveValue(
    "Customer welcome",
  );
  if (advanced) await page.getByText("Edit code", { exact: true }).click();
}

test("Sites shares the Apps rail and preserves a private saved page across business navigation", async ({
  page,
}) => {
  await openSites(page);
  const html =
    "<main><h1>Welcome to our studio</h1><p>Let's create something useful.</p></main>";
  await page.getByLabel("HTML source", { exact: true }).fill(html);
  await page
    .getByTestId("aios-sites-workspace")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page
      .getByTestId("aios-sites-workspace")
      .getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Saved to the private Buzz canvas." }),
  ).toBeVisible();
  const log = await page.evaluate(() => window.__BUZZ_E2E_COMMAND_LOG__ ?? []);
  const saved = log.findLast(
    (entry) =>
      entry.command === "set_canvas" &&
      /"kind"\s*:\s*"aios.site"/.test(String(entry.payload?.content)),
  );
  expect(saved?.payload).toMatchObject({
    expectedRelayUrl: "ws://localhost:3000",
    expectedSignerPubkey: "deadbeef".repeat(8),
  });
  const document = JSON.parse(String(saved?.payload?.content));
  expect(document.files.indexHtml).toBe(html);
  expect(document.siteId).toBe(saved?.payload?.channelId);
  expect(document.siteId).not.toBe(document.parentBusinessChannelId);
  const created = log.find(
    (entry) =>
      entry.command === "create_channel" &&
      String(entry.payload?.description).includes("[aios.site-channel:v1]"),
  );
  expect(created?.payload?.visibility).toBe("private");
  await page
    .getByRole("button", { name: "Company context", exact: true })
    .click();
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await page.getByTestId("aios-app-nav-sites").click();
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(
    html,
  );
  await page.setViewportSize({ width: 1100, height: 900 });
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/aios-sites-integrated.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("a real self-hosted publisher previews, publishes and revokes a site from the integrated workspace", async ({
  page,
  context,
}) => {
  test.skip(
    !process.env.AIOS_TEST_SITES_BIN,
    "Set AIOS_TEST_SITES_BIN to the built publisher; ports 3351/3352 must be free.",
  );
  test.setTimeout(60_000);
  const binary = process.env.AIOS_TEST_SITES_BIN;
  if (!binary) throw new Error("Publisher binary is required for this test.");
  // Chromium prompts before a sandboxed page can reach a loopback service.
  // Grant only in this disposable test context; keep the production CSP intact.
  await context.grantPermissions(["local-network-access"]);
  const publisher = await startSitesPublisherFixture(binary);
  try {
    await page.exposeFunction("__AIOS_PUBLISHER_FIXTURE__", publisher.invoke);
    await openSites(page);
    await page
      .getByLabel("HTML source", { exact: true })
      .fill(
        '<main><h1>Welcome, customer</h1><button id="action">Prepare my brief</button><p id="result">Ready</p></main>',
      );
    await page.getByRole("tab", { name: "JS", exact: true }).click();
    await page
      .getByLabel("JS source", { exact: true })
      .fill(
        'document.querySelector("#action").addEventListener("click",()=>{document.querySelector("#result").textContent="Brief prepared"});',
      );
    await page
      .getByTestId("aios-sites-workspace")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      page
        .getByTestId("aios-sites-workspace")
        .getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Saved to the private Buzz canvas." }),
    ).toBeVisible();
    await page
      .getByLabel("Publisher operator token", { exact: true })
      .fill(publisher.token);
    await page
      .getByRole("button", { name: "Connect publisher", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Run preview", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Run preview", exact: true })
      .click();
    const preview = page.frameLocator('iframe[title="Sandboxed site preview"]');
    await preview
      .getByRole("button", { name: "Prepare my brief" })
      .click({ timeout: 10_000 });
    await expect(
      preview.getByText("Brief prepared", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('iframe[title="Sandboxed site preview"]'),
    ).toHaveAttribute("sandbox", "allow-scripts");
    await page
      .getByRole("button", { name: "Publish site", exact: true })
      .click();
    const link = page.getByRole("link", {
      name: "Open published site",
      exact: true,
    });
    await expect(link).toBeVisible();
    const url = await link.getAttribute("href");
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:3351\/sites\/[a-zA-Z0-9_-]+$/);
    if (!url) throw new Error("The publisher did not return a public URL.");
    const publishedPage = await context.newPage();
    await publishedPage.goto(url);
    await publishedPage
      .getByRole("button", { name: "Prepare my brief" })
      .click();
    await expect(
      publishedPage.getByText("Brief prepared", { exact: true }),
    ).toBeVisible();
    await publishedPage.close();
    await page
      .getByRole("button", { name: "Revoke public site", exact: true })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Revoke site", exact: true })
      .click();
    await expect(link).not.toBeVisible();
    expect((await page.request.get(url)).status()).toBe(404);
    await page.getByRole("tab", { name: "HTML", exact: true }).click();
    await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(
      /Welcome, customer/,
    );
  } finally {
    await publisher.stop();
  }
});

test("an unsaved Sites draft survives app switching and is guarded when leaving the workspace", async ({
  page,
}) => {
  await openSites(page);
  const draft = "<h1>A page still being written</h1>";
  await page.getByLabel("HTML source", { exact: true }).fill(draft);
  await page.getByTestId("aios-app-nav-calendar").click();
  await page.getByTestId("aios-app-nav-sites").click();
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(
    draft,
  );
  await page.getByRole("button", { name: "Main agent", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "Leave your unsaved changes?",
  );
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(
    draft,
  );
  await page.getByRole("button", { name: "Main agent", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Apps", exact: true }).click();
  await page.getByTestId("aios-app-nav-sites").click();
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue("");
});

test("guided Sites work verifies access, retries startup once and loads the agent result without losing a draft", async ({
  page,
}) => {
  await openSites(page, true, false);
  await expect(
    page.getByLabel("HTML source", { exact: true }),
  ).not.toBeVisible();
  await page.evaluate(async () => {
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
    const agents = (await original("list_managed_agents")) as {
      pubkey: string;
      persona_id: string;
    }[];
    const agent = agents.find(
      (candidate) => candidate.persona_id === "builtin:fizz",
    );
    if (!agent) throw new Error("Main agent fixture missing");
    await original("stop_managed_agent", { pubkey: agent.pubkey });
    let failed = false;
    native.invoke = (command, args) => {
      if (command === "start_managed_agent" && !failed) {
        failed = true;
        return Promise.reject(new Error("Synthetic unavailable runtime"));
      }
      return original(command, args);
    };
  });
  const request = page.getByLabel("What should the site do?", { exact: true });
  await request.fill("Introduce our design studio and its services.");
  await page
    .getByRole("button", { name: "Ask main agent", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Synthetic unavailable runtime" }),
  ).toContainText("without sending your request again");
  await page.getByRole("button", { name: "Retry agent", exact: true }).click();
  await expect(request).toHaveValue("");
  await expect(page.getByTestId("site-agent-conversation")).toBeVisible();
  const sentCount = () =>
    page.evaluate(
      () =>
        (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
          (row) =>
            row.command === "send_channel_message" &&
            String(row.payload?.content).includes("help me build this site."),
        ).length,
    );
  expect(await sentCount()).toBe(1);
  await request.fill("Introduce our design studio and its services.");
  await page
    .getByRole("button", { name: "Ask main agent", exact: true })
    .click();
  await expect(request).toHaveValue("");
  expect(await sentCount()).toBe(2);

  await page.evaluate(async () => {
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
    const request = (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).findLast(
      (row) =>
        row.command === "send_channel_message" &&
        String(row.payload?.content).includes("help me build this site."),
    );
    if (!request) throw new Error("No saved site request");
    const channelId = request.payload?.channelId;
    const canvas = (await native.invoke("get_canvas", { channelId })) as {
      content: string;
      event_id: string;
    };
    const doc = JSON.parse(canvas.content);
    doc.files.indexHtml = "<h1>A new page from your agent</h1>";
    await native.invoke("set_canvas", {
      channelId,
      content: JSON.stringify(doc),
      expectedRevision: canvas.event_id,
    });
  });
  await page.getByText("Edit code", { exact: true }).click();
  await page
    .getByLabel("HTML source", { exact: true })
    .fill("<h1>My unfinished edit</h1>");
  await request.fill("Improve the headline.");
  await expect(
    page.getByRole("button", { name: "Ask main agent", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Save your changes before asking the agent.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load agent changes", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(
    "<h1>My unfinished edit</h1>",
  );
  await page
    .getByRole("button", { name: "Load agent changes", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /Discard/ })
    .click();
  await expect(page.getByLabel("HTML source", { exact: true })).toHaveValue(
    "<h1>A new page from your agent</h1>",
  );
  await expect(page.getByTestId("site-agent-conversation")).toBeVisible();
  await page.getByText("Edit code", { exact: true }).click();
  await page.screenshot({
    path: "test-results/aios-sites-guided.png",
    animations: "disabled",
  });
});
