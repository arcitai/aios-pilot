import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

const TEAMMATE = "a1".repeat(32);
const BOT = "b2".repeat(32);
const searchProfiles = [
  {
    pubkey: TEAMMATE,
    displayName: "Casey Studio",
    nip05Handle: "casey@studio.test",
  },
  { pubkey: BOT, displayName: "Casey Assistant", isAgent: true },
];

async function openAccess(page: Page) {
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("Access Studio");
  await page.getByRole("button", { name: "Create company context" }).click();
  await page.getByRole("button", { name: "Access", exact: true }).click();
  return page.getByRole("dialog", { name: "Business access" });
}

async function selectTeammate(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Business access" });
  await dialog.getByLabel("Add a teammate").fill("Casey");
  await dialog
    .getByRole("button", { name: "Casey Studio casey@studio.test" })
    .click();
  return dialog;
}

test("Business access grants and removes only the explicitly selected teammate and context", async ({
  page,
}) => {
  await installMockBridge(page, { searchProfiles });
  const dialog = await openAccess(page);
  await expect(dialog.getByRole("list")).toContainText("(you)");
  await dialog.getByLabel("Add a teammate").fill("Casey");
  await expect(
    dialog.getByRole("button", { name: "Casey Studio casey@studio.test" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /Casey Assistant/ }),
  ).toHaveCount(0);
  await selectTeammate(page);
  await expect(
    dialog.getByRole("region", { name: "Confirm access change" }),
  ).toContainText("earlier conversations");
  expect(await accessWrites(page)).toHaveLength(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await accessWrites(page)).toHaveLength(0);
  await selectTeammate(page);
  await dialog
    .getByRole("button", { name: "Grant access", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText("Access granted.");
  await expect(
    dialog.getByRole("list", {
      name: "People and agents with business access",
    }),
  ).toContainText("Casey Studio");
  await dialog
    .getByRole("button", { name: "Remove Casey Studio's business access" })
    .click();
  await dialog
    .getByRole("button", { name: "Remove access", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText("Access removed.");
  await expect(
    dialog.getByRole("list", {
      name: "People and agents with business access",
    }),
  ).not.toContainText("Casey Studio");
  const writes = await accessWrites(page);
  expect(writes).toHaveLength(2);
  expect(writes[0].payload).toMatchObject({
    pubkeys: [TEAMMATE],
    role: "member",
  });
  expect(writes[1].payload).toMatchObject({
    channelId: writes[0].payload?.channelId,
    pubkey: TEAMMATE,
    expectedRelayUrl: writes[0].payload?.expectedRelayUrl,
    expectedSignerPubkey: writes[0].payload?.expectedSignerPubkey,
  });
  expect(String(writes[0].payload?.expectedRelayUrl)).toMatch(/^ws/);
  expect(String(writes[0].payload?.expectedSignerPubkey)).toMatch(
    /^[a-f0-9]{64}$/,
  );
  await page.setViewportSize({ width: 760, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await dialog.press("Escape");
  await expect(
    page.getByRole("button", { name: "Access", exact: true }),
  ).toBeFocused();
});

test("a denied grant preserves the selection and retries without a false success", async ({
  page,
}) => {
  await installMockBridge(page, {
    searchProfiles,
    addChannelMembersErrors: ["Only an admin can grant access.", null],
  });
  const dialog = await openAccess(page);
  await selectTeammate(page);
  await dialog
    .getByRole("button", { name: "Grant access", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Only an admin");
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await expect(
    dialog.getByRole("region", { name: "Confirm access change" }),
  ).toContainText("Casey Studio");
  await dialog
    .getByRole("button", { name: "Grant access", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toHaveText("Access granted.");
});

test("ordinary context members see access but no grant or revoke controls", async ({
  page,
}) => {
  await installMockBridge(page, { searchProfiles });
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
    native.invoke = async (command, args) => {
      const result = await original(command, args);
      if (command !== "get_channel_members") return result;
      return {
        ...(result as object),
        members: (result as { members: { role: string }[] }).members.map(
          (member) => ({ ...member, role: "member" }),
        ),
      };
    };
  });
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("Read Studio");
  await page.getByRole("button", { name: "Create company context" }).click();
  await page.getByRole("button", { name: "Access", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Business access" });
  await expect(dialog).toContainText(
    "A context owner or admin can change access.",
  );
  await expect(dialog.getByLabel("Add a teammate")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Remove/ })).toHaveCount(0);
  expect(await accessWrites(page)).toHaveLength(0);
});

test("accepted access with failed readback requires refresh before another write", async ({
  page,
}) => {
  await installMockBridge(page, { searchProfiles });
  const dialog = await openAccess(page);
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
    let failedReadsRemaining = 0;
    native.invoke = async (command, args) => {
      if (command === "get_channel_members" && failedReadsRemaining > 0) {
        failedReadsRemaining -= 1;
        throw new Error("Readback unavailable");
      }
      const result = await original(command, args);
      if (command === "add_channel_members") failedReadsRemaining = 2;
      return result;
    };
  });
  await selectTeammate(page);
  await dialog
    .getByRole("button", { name: "Grant access", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "host accepted the change",
  );
  await expect(dialog.getByRole("status")).toHaveCount(0);
  expect(await accessWrites(page)).toHaveLength(1);
  await dialog
    .getByRole("button", { name: "Refresh access", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(
    dialog.getByRole("list", {
      name: "People and agents with business access",
    }),
  ).toContainText("Casey Studio");
  expect(await accessWrites(page)).toHaveLength(1);
});

async function accessWrites(page: Page) {
  return page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter((entry) =>
      /^(add_channel_members|remove_channel_member)$/.test(entry.command),
    ),
  );
}
