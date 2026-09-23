import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

async function openDrive(page: Page, configured = false) {
  await installMockBridge(page);
  await page.goto("/");
  await expect(page.getByTestId("open-business-view")).toBeVisible();
  await page.evaluate((isConfigured) => {
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
    let clientId: string | null = isConfigured
      ? "1234567890-fixture.apps.googleusercontent.com"
      : null;
    let connected = false;
    let attempts = 0;
    native.invoke = async (command, args) => {
      if (command === "get_google_drive_oauth_client_id") return clientId;
      if (command === "set_google_drive_oauth_client_id") {
        clientId = String(args?.clientId);
        return clientId;
      }
      if (
        ![
          "get_google_drive_connection_status",
          "connect_google_drive_connection",
          "revoke_google_drive_connection",
          "search_google_drive_files",
          "import_google_drive_document",
        ].includes(command)
      )
        return original(command, args);
      if (
        args?.expectedRelayUrl !== "ws://localhost:3000" ||
        args.expectedSignerPubkey !== "deadbeef".repeat(8)
      ) {
        throw new Error("Lost the captured Google Drive connection scope.");
      }
      if (command === "get_google_drive_connection_status")
        return { connected };
      if (command === "connect_google_drive_connection") {
        if (!clientId) throw new Error("Google sign-in is not configured.");
        attempts += 1;
        if (isConfigured && attempts === 1)
          throw new Error("Google authorization was canceled or denied.");
        connected = true;
        return { connected };
      }
      if (command === "revoke_google_drive_connection") {
        connected = false;
        return;
      }
      if (!connected) throw new Error("Google Drive is disconnected.");
      if (command === "search_google_drive_files") {
        if (args.query !== "Customer") throw new Error("Unexpected search.");
        return {
          files: [
            {
              id: "fixture_customer_guide",
              title: "Customer guide",
              mimeType: "application/vnd.google-apps.document",
              modifiedTime: "2026-09-23T10:00:00Z",
              url: "https://docs.google.com/document/d/fixture_customer_guide/edit",
            },
            {
              id: "fixture_unselected",
              title: "Unselected customer file",
              mimeType: "application/vnd.google-apps.document",
              modifiedTime: null,
              url: "https://docs.google.com/document/d/fixture_unselected/edit",
            },
          ],
          hasMore: false,
          nextCursor: null,
        };
      }
      if (args.fileId !== "fixture_customer_guide")
        throw new Error("An unselected Doc was imported.");
      return {
        title: "Customer guide",
        kind: "url",
        truncated: false,
        url: "https://docs.google.com/document/d/fixture_customer_guide/edit",
        content: "We prepare a shared onboarding plan for every new customer.",
      };
    };
  }, configured);
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("Drive Studio");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  return page.locator('[data-provider="google"]');
}

test("Google sign-in imports only a selected Doc and retains its source after disconnect", async ({
  page,
}) => {
  const drive = await openDrive(page);
  await expect(
    drive.getByRole("button", { name: "Connect Google Drive", exact: true }),
  ).toBeDisabled();
  await drive
    .getByLabel("Google Desktop OAuth client ID", { exact: true })
    .fill("1234567890-fixture.apps.googleusercontent.com");
  await drive
    .getByRole("button", { name: "Save client ID", exact: true })
    .click();
  await expect(
    drive.getByLabel("Google Desktop OAuth client ID", { exact: true }),
  ).not.toBeVisible();
  await expect(drive).toContainText("read access to all files");
  await drive
    .getByRole("button", { name: "Connect Google Drive", exact: true })
    .click();
  await expect(
    drive.getByText("Connected to Google Drive.", { exact: true }),
  ).toBeVisible();
  await drive
    .getByRole("searchbox", {
      name: "Search Google Docs by title",
      exact: true,
    })
    .fill("Customer");
  await drive.getByRole("button", { name: "Search Docs", exact: true }).click();
  const doc = drive.getByRole("listitem").filter({ hasText: "Customer guide" });
  await expect(doc.getByRole("link")).toHaveAttribute(
    "href",
    "https://docs.google.com/document/d/fixture_customer_guide/edit",
  );
  await doc.getByRole("button", { name: "Import Doc", exact: true }).click();
  await expect(
    drive.getByRole("status").filter({ hasText: "Imported “Customer guide”" }),
  ).toBeVisible();
  await doc.getByRole("button", { name: "Import Doc", exact: true }).click();
  await expect(drive.getByRole("alert")).toContainText(
    "already in your workspace",
  );
  await drive.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    drive.getByText("Not connected.", { exact: true }),
  ).toBeVisible();
  await expect(drive.getByRole("listitem")).toHaveCount(0);
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  const source = page.locator("details").filter({ hasText: "Customer guide" });
  await source.locator("summary").click();
  await expect(source).toContainText("We prepare a shared onboarding plan");
  await expect(source).toContainText(
    "https://docs.google.com/document/d/fixture_customer_guide/edit",
  );
  await expect(page.locator("details")).toHaveCount(1);
  const writes = await page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? [])
      .filter((entry) => entry.command === "set_canvas")
      .map((entry) => entry.payload),
  );
  expect(JSON.stringify(writes)).not.toContain("fixture_unselected");
  expect(JSON.stringify(writes)).not.toContain("apps.googleusercontent.com");
});

test("a canceled Google sign-in remains disconnected and can be retried", async ({
  page,
}) => {
  const drive = await openDrive(page, true);
  const connect = drive.getByRole("button", {
    name: "Connect Google Drive",
    exact: true,
  });
  await connect.click();
  await expect(drive.getByRole("alert")).toContainText("canceled or denied");
  await expect(
    drive.getByText("Not connected.", { exact: true }),
  ).toBeVisible();
  await expect(
    drive.getByRole("button", { name: "Search Docs", exact: true }),
  ).not.toBeVisible();
  await connect.click();
  await expect(
    drive.getByText("Connected to Google Drive.", { exact: true }),
  ).toBeVisible();
  await expect(drive.getByRole("alert")).not.toBeVisible();
});
