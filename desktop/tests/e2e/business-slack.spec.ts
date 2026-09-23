import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

test("Slack imports only the selected channel and retains its verified source after disconnect", async ({
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
    const teamId = "T0123456789";
    const channelId = "C0123456789";
    const url = `https://slack.com/app_redirect?channel=${channelId}&team=${teamId}`;
    native.invoke = async (command, args) => {
      if (command === "get_github_connection_status")
        return { connected: false, login: null };
      if (command === "get_notion_connection_status")
        return { connected: false, name: null };
      if (
        ![
          "get_slack_connection_status",
          "connect_slack_connection",
          "revoke_slack_connection",
          "list_slack_channels",
          "import_slack_channel_history",
        ].includes(command)
      )
        return original(command, args);
      if (
        args?.expectedRelayUrl !== "ws://localhost:3000" ||
        args.expectedSignerPubkey !== "deadbeef".repeat(8)
      ) {
        throw new Error("Lost the captured Slack connection scope.");
      }
      if (command === "get_slack_connection_status")
        return {
          connected,
          workspaceName: connected ? "Studio team" : null,
          workspaceId: connected ? teamId : null,
        };
      if (command === "connect_slack_connection") {
        if (args.token !== "fixture-slack-read-token")
          throw new Error("Slack rejected this token.");
        connected = true;
        return { teamId, name: "Studio team" };
      }
      if (command === "revoke_slack_connection") {
        connected = false;
        return null;
      }
      if (!connected) throw new Error("Not connected");
      if (command === "list_slack_channels")
        return {
          channels: [
            { id: channelId, name: "customer-success", isPrivate: true, url },
            {
              id: "C9999999999",
              name: "unselected-channel",
              isPrivate: true,
              url: `https://slack.com/app_redirect?channel=C9999999999&team=${teamId}`,
            },
          ],
          hasMore: false,
          nextCursor: null,
        };
      if (args.channelId !== channelId)
        throw new Error("A different channel was selected.");
      return {
        title: "#customer-success — recent messages",
        kind: "url",
        url,
        truncated: true,
        content:
          "Customers value a clear first-week plan.\n\n[Slack: partial snapshot of recent channel messages.]",
      };
    };
  });
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("Slack Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  const slack = page.locator('[data-provider="slack"]');
  await expect(
    slack.getByText("Not connected.", { exact: true }),
  ).toBeVisible();
  await slack
    .getByLabel("Slack bot token · manual setup")
    .fill("fixture-slack-read-token");
  await slack
    .getByRole("button", { name: "Connect Slack", exact: true })
    .click();
  await expect(
    slack.getByText("Connected to Studio team.", { exact: true }),
  ).toBeVisible();
  await slack
    .getByRole("button", { name: "Browse channels", exact: true })
    .click();
  const channel = slack
    .getByRole("listitem")
    .filter({ hasText: "#customer-success" });
  await expect(channel.getByRole("link")).toHaveAttribute(
    "href",
    "https://slack.com/app_redirect?channel=C0123456789&team=T0123456789",
  );
  await channel.getByRole("button", { name: "Import recent messages" }).click();
  await expect(
    slack.getByRole("status").filter({ hasText: "Imported a bounded set" }),
  ).toBeVisible();
  await channel.getByRole("button", { name: "Import recent messages" }).click();
  await expect(slack.getByRole("alert")).toContainText(
    "already in your workspace",
  );
  await slack.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    slack.getByText("Not connected.", { exact: true }),
  ).toBeVisible();
  await expect(slack.getByLabel("Slack bot token · manual setup")).toHaveValue(
    "",
  );
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  const source = page
    .locator("details")
    .filter({ hasText: "#customer-success" });
  await source.locator("summary").click();
  await expect(source).toContainText(
    "Customers value a clear first-week plan.",
  );
  await expect(source).toContainText("partial snapshot");
  await expect(source).toContainText(
    "https://slack.com/app_redirect?channel=C0123456789&team=T0123456789",
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
    })) as {
      channels: { id: string; name: string }[];
    };
    const workspace = result.channels.find(
      (item) => item.name === "Slack Studio",
    );
    if (!workspace) throw new Error("Missing business room");
    return native.invoke("get_canvas", { channelId: workspace.id });
  });
  expect(JSON.stringify(saved)).not.toContain("fixture-slack-read-token");
  expect(JSON.stringify(saved)).not.toContain("unselected-channel");
});
