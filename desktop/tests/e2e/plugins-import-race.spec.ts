import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { openPluginConnection } from "../helpers/business-navigation";

type ImportFixture = Window & {
  __AIOS_IMPORT_FIXTURE__: { started: boolean; release: () => void };
};

test("a provider result cannot import into a company after its destination changed", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("open-business-view").click();
  await page.getByLabel("What is your business called?").fill("First Studio");
  await page.getByRole("button", { name: "Create company context" }).click();
  await expect(
    page.getByRole("heading", { name: "First Studio", exact: true }),
  ).toBeVisible();
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
    const { channels } = (await original("get_channels", {
      knownHash: null,
    })) as { channels: { id: string; name: string; description: string }[] };
    const first = channels.find((channel) => channel.name === "First Studio");
    if (!first) throw new Error("Missing first context");
    const canvas = (await original("get_canvas", { channelId: first.id })) as {
      content: string;
    };
    const document = JSON.parse(canvas.content);
    document.company.name = "Second Studio";
    const second = (await original("create_channel", {
      name: "Second Studio",
      channelType: "stream",
      visibility: "private",
      description: first.description,
    })) as { id: string };
    await original("set_canvas", {
      channelId: second.id,
      content: JSON.stringify(document),
      expectedRevision: "none",
    });
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fixture = { started: false, release };
    (window as ImportFixture).__AIOS_IMPORT_FIXTURE__ = fixture;
    native.invoke = async (command, args) => {
      if (command === "get_github_connection_status")
        return { connected: true, login: "fixture-team" };
      if (command === "list_github_repositories")
        return [
          {
            id: 12,
            name: "company",
            fullName: "fixture-team/company",
            private: true,
            url: "https://github.com/fixture-team/company",
          },
        ];
      if (command === "import_github_readme") {
        fixture.started = true;
        await pending;
        return {
          title: "Delayed source",
          content: "Must stay out of both companies after switching.",
          kind: "url",
          url: "https://github.com/fixture-team/company",
          truncated: false,
        };
      }
      return original(command, args);
    };
  });
  await openPluginConnection(page, "GitHub");
  const destination = page.getByLabel("Import into business");
  await destination.selectOption({ label: "First Studio" });
  await page.getByRole("button", { name: "Browse repositories" }).click();
  await page
    .getByRole("button", { name: "Import README", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as ImportFixture).__AIOS_IMPORT_FIXTURE__.started,
      ),
    )
    .toBe(true);
  await destination.selectOption({ label: "Second Studio" });
  await expect(
    page.locator("strong").filter({ hasText: "Second Studio" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as ImportFixture).__AIOS_IMPORT_FIXTURE__.release(),
  );
  await expect(
    page.locator('[data-provider="github"]').getByRole("alert"),
  ).toContainText("import destination changed");
  const writes = await page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
      (entry) => entry.command === "set_canvas",
    ),
  );
  expect(writes).toHaveLength(2);
  expect(
    writes.every(
      (entry) => !String(entry.payload?.content).includes("Delayed source"),
    ),
  ).toBe(true);
});
