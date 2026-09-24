import { expect, test } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

test("a failed start recovers on the created agent instead of repeating its creation", async ({
  page,
}) => {
  const origin = "94a444a4-c0a3-5966-ab05-530c6ddc2301";
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: TEST_IDENTITIES.tyler.pubkey,
        name: "Existing assistant",
        status: "running",
        channelNames: ["agents"],
      },
    ],
  });
  await page.goto("/");
  await expect(page.getByTestId("channel-agents")).toBeVisible();
  await page.evaluate(
    ({ origin, author }) => {
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
      native.invoke = async (command, args) => {
        if (command !== "create_managed_agent") return invoke(command, args);
        const result = await invoke(command, {
          ...args,
          input: {
            ...(args?.input as Record<string, unknown>),
            spawnAfterCreate: false,
          },
        });
        return {
          ...(result as Record<string, unknown>),
          spawn_error: "Synthetic setup failure",
        };
      };
      window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__?.({
        agentPubkey: author,
        live: true,
        events: [
          {
            seq: 1,
            timestamp: new Date().toISOString(),
            kind: "acp_message",
            agentIndex: 0,
            channelId: origin,
            sessionId: "creation-recovery",
            turnId: "request-create",
            payload: {
              type: "agent_management_request",
              action: "create",
              requestId: "recover-one-created-agent",
              request: {
                channelId: origin,
                displayName: "Company researcher",
                systemPrompt: "Research the selected company knowledge.",
              },
            },
          },
        ],
      });
    },
    { origin, author: TEST_IDENTITIES.tyler.pubkey },
  );

  const form = page
    .getByRole("dialog")
    .filter({ has: page.getByLabel("Agent name", { exact: true }) });
  await expect(form).toBeVisible();
  await form.getByRole("tab", { name: "Customize for this agent" }).click();
  await form.locator("#persona-llm-provider").click();
  await page
    .getByRole("menuitemradio", { name: "Buzz shared compute", exact: true })
    .click();
  await form.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(
    page.getByText("Agent created, but setup needs attention", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Company researcher: Synthetic setup failure", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review agent", exact: true }).click();
  const savedAgent = page.getByTestId("edit-agent-dialog");
  await expect(savedAgent).toBeVisible();
  const commands = await page.evaluate(
    () => window.__BUZZ_E2E_COMMAND_LOG__ ?? [],
  );
  expect(
    commands.filter((entry) => entry.command === "create_managed_agent"),
  ).toHaveLength(1);
  expect(
    commands.filter((entry) => entry.command === "create_persona"),
  ).toHaveLength(1);
  await savedAgent.getByRole("button", { name: "Cancel", exact: true }).click();
});
