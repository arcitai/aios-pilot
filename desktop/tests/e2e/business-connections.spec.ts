import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

test("Notion import retains attribution, rejects duplicates and never saves the credential in context", async ({
  page,
}) => {
  await installMockBridge(page);
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
    let connected = false;
    const pageId = "c5047ab8-292e-4cb6-a33a-14111ae7c49b";
    const url = `https://www.notion.so/${pageId.replaceAll("-", "")}`;
    native.invoke = async (command, args) => {
      if (command === "get_github_connection_status")
        return { connected: false, login: null };
      if (
        ![
          "get_notion_connection_status",
          "connect_notion_connection",
          "revoke_notion_connection",
          "search_notion_pages",
          "import_notion_page",
        ].includes(command)
      )
        return original(command, args);
      if (
        args?.expectedRelayUrl !== "ws://localhost:3000" ||
        args.expectedSignerPubkey !== "deadbeef".repeat(8)
      )
        throw new Error("Lost the captured connection scope.");
      if (command === "get_notion_connection_status")
        return { connected, name: connected ? "Studio knowledge" : null };
      if (command === "connect_notion_connection") {
        if (args.token !== "fixture-notion-read-token")
          throw new Error("Notion rejected this token.");
        connected = true;
        return { id: pageId, name: "Studio knowledge" };
      }
      if (command === "revoke_notion_connection") {
        connected = false;
        return null;
      }
      if (!connected) throw new Error("Not connected");
      if (command === "search_notion_pages")
        return {
          pages: [
            {
              id: pageId,
              title: "Customer onboarding",
              url,
              lastEditedTime: null,
            },
          ],
          hasMore: false,
          nextCursor: null,
        };
      if (args.pageId !== pageId) throw new Error("Unexpected page selection");
      return {
        title: "Customer onboarding",
        content:
          "We welcome each customer with a discovery call.\n\n[Notion page partially imported by Buzz; some blocks were omitted or limits were reached.]",
        url,
        kind: "url",
        truncated: true,
      };
    };
  });
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("Notion Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  const notion = page.locator('[data-provider="notion"]');
  await expect(
    notion.getByText("Not connected.", { exact: true }),
  ).toBeVisible();
  await notion
    .getByLabel("Notion internal integration token")
    .fill("fixture-notion-read-token");
  await notion
    .getByRole("button", { name: "Connect Notion", exact: true })
    .click();
  await expect(
    notion.getByText("Connected as Studio knowledge.", { exact: true }),
  ).toBeVisible();
  await notion
    .getByRole("button", { name: "Browse pages", exact: true })
    .click();
  await notion
    .getByRole("button", { name: "Import page", exact: true })
    .click();
  await expect(
    notion.getByRole("status").filter({ hasText: "Imported a partial page" }),
  ).toBeVisible();
  await notion
    .getByRole("button", { name: "Import page", exact: true })
    .click();
  await expect(notion.getByRole("alert")).toContainText(
    "already in your workspace",
  );
  await page.screenshot({
    path: "test-results/aios-notion-connection.png",
    animations: "disabled",
  });
  await notion.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    notion.getByText("Not connected.", { exact: true }),
  ).toBeVisible();
  await expect(
    notion.getByLabel("Notion internal integration token"),
  ).toHaveValue("");
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  const source = page
    .locator("details")
    .filter({ hasText: "Customer onboarding" });
  await source.locator("summary").click();
  await expect(source).toContainText(
    "We welcome each customer with a discovery call.",
  );
  await expect(source).toContainText("partially imported");
  await expect(source).toContainText(
    "https://www.notion.so/c5047ab8292e4cb6a33a14111ae7c49b",
  );
  await expect(page.locator("details")).toHaveCount(1);
  const saved = await page.evaluate(async () => {
    const native = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const result = (await native.invoke("get_channels", {
      knownHash: null,
    })) as { channels: { id: string; name: string }[] };
    const channel = result.channels.find(
      (item) => item.name === "Notion Studio",
    );
    if (!channel) throw new Error("Missing business room");
    return native.invoke("get_canvas", { channelId: channel.id });
  });
  expect(JSON.stringify(saved)).not.toContain("fixture-notion-read-token");
});
