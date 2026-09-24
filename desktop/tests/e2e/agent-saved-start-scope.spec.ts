import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { installCompanyKnowledgeCreation } from "../helpers/companyKnowledgeCreation";

type ScopeFixture = Window & {
  __AIOS_AVATAR_GATE__: {
    entered: boolean;
    settled: boolean;
    release: () => void;
    uploads: Record<string, unknown>[];
  };
};

for (const stage of ["before-upload", "upload"] as const) {
  test(`switching workspace during ${stage} never creates or starts an agent`, async ({
    page,
  }) => {
    const communities = [
      {
        id: "ws-a",
        name: "Alpha",
        relayUrl: "ws://localhost:3000",
        addedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "ws-b",
        name: "Bravo",
        relayUrl: "ws://localhost:3001",
        addedAt: "2026-01-02T00:00:00Z",
      },
    ];
    await installMockBridge(
      page,
      {
        personas: [
          {
            id: "saved-avatar",
            displayName: "Avatar assistant",
            systemPrompt: "Help the team.",
            runtime: "buzz-agent",
            avatarUrl: "data:image/png;base64,YQ==",
          },
        ],
      },
      { skipCommunitySeed: true },
    );
    await page.addInitScript((list) => {
      localStorage.setItem("buzz-communities", JSON.stringify(list));
      localStorage.setItem("buzz-active-community-id", list[0].id);
    }, communities);
    await page.goto("/");
    await expect(page.getByTestId("open-agents-view")).toBeVisible();
    await installCompanyKnowledgeCreation(page);
    await page.evaluate((stage) => {
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
      const invoke = native.invoke;
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const fixture = {
        entered: false,
        settled: false,
        release,
        uploads: [] as Record<string, unknown>[],
      };
      (window as ScopeFixture).__AIOS_AVATAR_GATE__ = fixture;
      native.invoke = async (command, args) => {
        if (command === "upload_media_bytes")
          throw new Error(
            "Unscoped avatar upload is forbidden in this fixture",
          );
        if (command === "upload_media_bytes_scoped")
          fixture.uploads.push(args ?? {});
        if (
          (stage === "before-upload" &&
            command === "managed_agent_business_context_protocol") ||
          (stage === "upload" && command === "upload_media_bytes_scoped")
        ) {
          fixture.entered = true;
          await held;
          fixture.settled = true;
          // Simulate an already-dispatched upload completing on its captured
          // host, then exercise the UI fence before the next durable effect.
          return stage === "before-upload"
            ? 1
            : { url: "http://localhost:3000/avatar.png" };
        }
        return invoke(command, args);
      };
    }, stage);
    await page.getByTestId("open-agents-view").click();
    await page.getByTestId("persona-runtime-start-saved-avatar").click();
    const dialog = page.getByTestId("start-saved-agent-dialog");
    await dialog.getByRole("checkbox", { name: /^Allow this agent/ }).check();
    await dialog
      .getByRole("button", { name: "Start agent", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as ScopeFixture).__AIOS_AVATAR_GATE__.entered,
        ),
      )
      .toBe(true);
    // Drive the real workspace provider while the modal is busy, representing
    // a workspace navigation from outside the dialog (for example a deep link).
    await page
      .getByTestId("community-rail-button-ws-b")
      .evaluate((button) => (button as HTMLButtonElement).click());
    await expect(
      page.getByTestId("community-rail-button-ws-b"),
    ).toHaveAttribute("aria-current", "true");
    await page.evaluate(() =>
      (window as ScopeFixture).__AIOS_AVATAR_GATE__.release(),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as ScopeFixture).__AIOS_AVATAR_GATE__.settled,
        ),
      )
      .toBe(true);
    const result = await page.evaluate(() => ({
      uploads: (window as ScopeFixture).__AIOS_AVATAR_GATE__.uploads,
      creates: (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
        (entry) =>
          entry.command === "start_managed_agent" ||
          (entry.command === "create_managed_agent" &&
            (entry.payload as { input?: { personaId?: string } })?.input
              ?.personaId === "saved-avatar"),
      ),
    }));
    expect(result.creates).toEqual([]);
    expect(result.uploads).toHaveLength(stage === "upload" ? 1 : 0);
    if (stage === "upload")
      expect(result.uploads[0]).toMatchObject({
        expectedRelayUrl: communities[0].relayUrl,
        expectedSignerPubkey: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
  });
}
