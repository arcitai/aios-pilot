import type { Page } from "@playwright/test";

/** Synthetic signed-host result behind the real UI/API; no live grant is made. */
export async function installCompanyKnowledgeCreation(
  page: Page,
  canonical = true,
) {
  return page.evaluate(async (canonical) => {
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
    const contexts = new Map<string, unknown>();
    native.invoke = async (command, args) => {
      if (command === "managed_agent_business_context_protocol") return 1;
      const input = args?.input as Record<string, unknown> | undefined;
      if (
        command === "create_managed_agent" &&
        args?.expectedRelayUrl &&
        input?.spawnAfterCreate
      )
        throw new Error("Scoped native creation requires a stopped agent");
      const result = await invoke(command, args);
      if (command === "create_managed_agent" && input?.businessContext) {
        const data = result as { agent: { pubkey: string } };
        const { selection } = input.businessContext as { selection: unknown };
        const context = {
          desired: selection,
          applied: selection,
          operation: null,
        };
        contexts.set(data.agent.pubkey, context);
        return { ...data, agent: { ...data.agent, business_context: context } };
      }
      if (command === "start_managed_agent") {
        const agent = result as { pubkey: string };
        return {
          ...agent,
          business_context: contexts.get(agent.pubkey) ?? null,
        };
      }
      if (command === "list_managed_agents")
        return (result as { pubkey: string }[]).map((agent) => ({
          ...agent,
          business_context: contexts.get(agent.pubkey) ?? null,
        }));
      if (command !== "get_channels" || !canonical) return result;
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
    };
    return channel.id;
  }, canonical);
}
