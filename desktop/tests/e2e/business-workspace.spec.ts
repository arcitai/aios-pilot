import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

test("private company context, source and main-agent recovery stay inside Buzz", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("Example Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await expect(page.getByTestId("business-workspace")).toBeVisible();
  await page
    .getByRole("button", { name: "Company context", exact: true })
    .click();
  await page
    .getByLabel("What you do", { exact: true })
    .fill("We help small teams build useful websites.");
  await page
    .getByLabel("Current priorities", { exact: true })
    .fill("Reduce time spent preparing project briefs.");
  await page.getByRole("button", { name: "Save company context" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  await page.getByLabel("Source title", { exact: true }).fill("Our services");
  await page
    .getByLabel("Source text", { exact: true })
    .fill("We offer website strategy, design and ongoing care.");
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  await expect(page.getByText("Our services", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Company context", exact: true })
    .click();
  await expect(page.getByLabel("What you do", { exact: true })).toHaveValue(
    "We help small teams build useful websites.",
  );
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/aios-company-context.png" });
  await page.getByRole("button", { name: "Main agent", exact: true }).click();
  await page
    .getByRole("button", { name: "Begin with my agent", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Set up your main agent");
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(
    page.getByText("No verified connections yet.", { exact: false }),
  ).toBeVisible();
  await page.setViewportSize({ width: 760, height: 900 });
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/aios-connections-narrow.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("a competing context edit cannot silently overwrite saved business data", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page
    .getByLabel("What is your business called?")
    .fill("Conflict Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page
    .getByRole("button", { name: "Company context", exact: true })
    .click();
  await page
    .getByLabel("What you do", { exact: true })
    .fill("My unsaved draft");
  await page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: <T>(command: string, payload?: unknown) => Promise<T>;
        };
      }
    ).__TAURI_INTERNALS__;
    const response = await bridge.invoke<{
      channels: { id: string; name: string }[];
    }>("get_channels", { knownHash: null });
    const channel = response.channels.find(
      (item) => item.name === "Conflict Studio",
    );
    if (!channel) throw new Error("Fixture channel was not created");
    const head = await bridge.invoke<{ content: string; event_id: string }>(
      "get_canvas",
      { channelId: channel.id },
    );
    const doc = JSON.parse(head.content);
    doc.company.summary = "A newer saved edit";
    await bridge.invoke("set_canvas", {
      channelId: channel.id,
      content: JSON.stringify(doc),
      expectedRevision: head.event_id,
    });
  });
  await page.getByRole("button", { name: "Save company context" }).click();
  await expect(page.getByRole("alert")).toContainText("conflict");
  await expect(page.getByLabel("What you do", { exact: true })).toHaveValue(
    "My unsaved draft",
  );
  await page.getByRole("button", { name: "Reload saved context" }).click();
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(page.getByLabel("What you do", { exact: true })).toHaveValue(
    "A newer saved edit",
  );
});

test("unsaved source changes can be kept and text files are reviewed before importing", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("File Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  await page.getByLabel("Import a text document").setInputFiles({
    name: "meeting.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("We agreed to focus on customer onboarding."),
  });
  await expect(page.getByLabel("Source title", { exact: true })).toHaveValue(
    "meeting.md",
  );
  await page
    .getByRole("button", { name: "Company context", exact: true })
    .click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Source text", { exact: true })).toHaveValue(
    "We agreed to focus on customer onboarding.",
  );
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  await expect(page.getByText("meeting.md", { exact: true })).toBeVisible();
  await page.getByLabel("Find a source").fill("onboarding");
  await expect(page.getByText("meeting.md", { exact: true })).toBeVisible();
  await page.getByLabel("Find a source").fill("no matching source");
  await expect(page.getByText("meeting.md", { exact: true })).not.toBeVisible();
});

test("starting the main agent publishes the request before launching a stopped runtime", async ({
  page,
}) => {
  const agentPubkey = "ab".repeat(32);
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: agentPubkey,
        name: "Fizz",
        personaId: "builtin:fizz",
        status: "stopped",
      },
    ],
  });
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("Agent Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page
    .getByRole("button", { name: "Begin with my agent", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Ready — continue in the conversation",
      exact: true,
    }),
  ).toBeDisabled();
  const log = await page.evaluate(() => window.__BUZZ_E2E_COMMAND_LOG__ ?? []);
  const sendIndex = log.findIndex(
    (entry) =>
      entry.command === "send_channel_message" &&
      String(entry.payload?.content).includes("help me get my business ready"),
  );
  const startIndex = log.findIndex(
    (entry, index) =>
      index > sendIndex && entry.command === "start_managed_agent",
  );
  expect(sendIndex).toBeGreaterThan(-1);
  expect(startIndex).toBeGreaterThan(sendIndex);
  expect(log[startIndex].payload).toMatchObject({
    pubkey: agentPubkey,
    expectedSignerPubkey: "deadbeef".repeat(8),
    replayFloorUnix: expect.any(Number),
  });
});

test("a supported saved version can recover a damaged company canvas", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page
    .getByLabel("What is your business called?")
    .fill("Starting Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page
    .getByRole("button", { name: "Company context", exact: true })
    .click();
  await page
    .getByLabel("Company name", { exact: true })
    .fill("Recovery Studio");
  await page
    .getByLabel("What you do", { exact: true })
    .fill("Our original company context");
  await page.getByRole("button", { name: "Save company context" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: <T>(command: string, payload?: unknown) => Promise<T>;
        };
      }
    ).__TAURI_INTERNALS__;
    const response = await bridge.invoke<{
      channels: { id: string; name: string }[];
    }>("get_channels", { knownHash: null });
    const channel = response.channels.find(
      (item) => item.name === "Starting Studio",
    );
    if (!channel) throw new Error("Missing fixture workspace");
    const head = await bridge.invoke<{ event_id: string }>("get_canvas", {
      channelId: channel.id,
    });
    await bridge.invoke("set_canvas", {
      channelId: channel.id,
      content: "# Accidental ordinary canvas edit",
      expectedRevision: head.event_id,
    });
  });
  await page
    .getByRole("button", { name: "Refresh context", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Saved versions", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Saved company context" });
  await dialog.getByRole("button", { name: /Recovery Studio/ }).click();
  await expect(
    dialog.getByText("Our original company context", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Restore selected version", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("Company name", { exact: true })).toHaveValue(
    "Recovery Studio",
  );
  await expect(page.getByLabel("What you do", { exact: true })).toHaveValue(
    "Our original company context",
  );
});
