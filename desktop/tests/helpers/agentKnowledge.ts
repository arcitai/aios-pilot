import { expect, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "./bridge";
import type {
  RawAgentBusinessContext,
  RawBusinessContextSelection,
} from "../../src/shared/api/businessContextWire";
import type { RawManagedAgent } from "../../src/shared/api/tauri";

type Fixture = {
  context: RawAgentBusinessContext | null;
  selection: RawBusinessContextSelection;
  behavior: "ok" | "deny" | "pending" | "unconfirmed";
  protocol: number;
  calls: { command: string; input: Record<string, unknown> }[];
};

declare global {
  interface Window {
    __AIOS_EDIT_KNOWLEDGE__: Fixture;
  }
}

/** Controlled native boundary; this is not a real relay grant/model test. */
export async function openAgentKnowledge(
  page: Page,
  state: "none" | "full" | "pending" | "removing" = "none",
  linked = false,
) {
  const pubkey = TEST_IDENTITIES.tyler.pubkey;
  await installMockBridge(page, {
    personas: linked
      ? [
          {
            id: "knowledge-template",
            displayName: "Knowledge template",
            systemPrompt: "Help with company knowledge.",
          },
        ]
      : undefined,
    managedAgents: [
      {
        pubkey,
        name: "Knowledge assistant",
        status: "stopped",
        channelNames: ["agents"],
        personaId: linked ? "knowledge-template" : undefined,
      },
    ],
  });
  await page.goto("/");
  await expect(page.getByTestId("open-agents-view")).toBeVisible();
  await page.evaluate(
    async ({ pubkey, state }) => {
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
      const channel = (await invoke("create_channel", {
        name: "Studio knowledge",
        channelType: "stream",
        visibility: "private",
        description:
          "AIOS business workspace · private company context and main-agent conversation. [aios.business-workspace:v1]",
      })) as { id: string };
      const agents = (await invoke("list_managed_agents")) as RawManagedAgent[];
      const agent = agents.find((entry) => entry.pubkey === pubkey);
      if (!agent) throw new Error("Fixture agent is missing");
      const selection: RawBusinessContextSelection = {
        context_id: channel.id,
        relay_url: agent.relay_url,
        loading: "full",
      };
      const pending = state === "pending" || state === "removing";
      const fixture: Fixture = {
        selection,
        behavior: "ok",
        protocol: 1,
        calls: [],
        context:
          state === "none"
            ? null
            : {
                desired: state === "removing" ? null : selection,
                applied: state === "full" ? selection : null,
                operation: pending
                  ? {
                      id: "saved-operation",
                      phase: "failed",
                      candidate: selection,
                      cancel_requested: state === "removing",
                      last_error: "Synthetic host verification interrupted",
                    }
                  : null,
              },
      };
      window.__AIOS_EDIT_KNOWLEDGE__ = fixture;
      native.invoke = async (command, args) => {
        if (command === "managed_agent_business_context_protocol")
          return fixture.protocol;
        if (
          command === "set_managed_agent_business_context" ||
          command === "retry_managed_agent_business_context"
        ) {
          const input = args?.input as Record<string, unknown>;
          fixture.calls.push({ command, input });
          if (fixture.behavior === "deny")
            throw new Error("Synthetic context authority denied");
          if (fixture.behavior === "ok") {
            const next =
              command === "retry_managed_agent_business_context"
                ? (fixture.context?.desired ?? null)
                : (input.selection as RawBusinessContextSelection | null);
            fixture.context = { desired: next, applied: next, operation: null };
          }
          if (fixture.behavior === "unconfirmed") fixture.context = null;
          return { ...agent, business_context: fixture.context };
        }
        const result = await invoke(command, args);
        if (command === "list_managed_agents")
          return (result as RawManagedAgent[]).map((entry) =>
            entry.pubkey === pubkey
              ? { ...entry, business_context: fixture.context }
              : entry,
          );
        if (command === "get_channels") {
          const data = result as { channels: { id: string }[] | null };
          return {
            ...data,
            channels:
              data.channels?.map((entry) =>
                entry.id === channel.id
                  ? { ...entry, resource_type: "aios.business-context:v1" }
                  : entry,
              ) ?? null,
          };
        }
        return result;
      };
      await window.__BUZZ_E2E_EMIT_TAURI_EVENT__?.("agents-data-changed", null);
    },
    { pubkey, state },
  );
  await page.getByTestId("open-agents-view").click();
  await page
    .getByRole("button", {
      name: linked
        ? "Knowledge template agent profile"
        : "Knowledge assistant agent profile",
    })
    .click();
  if (linked) {
    await page
      .getByRole("button", { name: "Agent settings", exact: true })
      .click();
  } else {
    await page.getByTestId("user-profile-edit-agent").click();
  }
  await expect(page.getByTestId("edit-agent-dialog")).toBeVisible();
  if (state !== "none")
    await expect(
      page.getByText(
        state === "full" ? "Full company context" : "Setup needs attention",
        { exact: true },
      ),
    ).toBeVisible();
  await page.locator("#edit-agent-name").fill("Unsaved name draft");
  await page.getByRole("button", { name: "Manage company knowledge" }).click();
  const dialog = page.getByTestId("agent-company-knowledge-dialog");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByText("Checking company knowledge…", { exact: true }),
  ).not.toBeVisible();
  return dialog;
}
