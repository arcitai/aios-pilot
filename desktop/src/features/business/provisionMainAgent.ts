import {
  buildInstanceInputForDefinition,
  resolveStartRuntimeForDefinition,
} from "@/features/agents/lib/instanceInputForDefinition";
import {
  pickWelcomeGuideAgentForRelay,
  WELCOME_GUIDE_PERSONA_ID,
} from "@/features/onboarding/welcomeGuide";
import { createManagedAgent, listManagedAgents } from "@/shared/api/tauri";
import { discoverAcpRuntimes } from "@/shared/api/tauriAcpDiscovery";
import { getGlobalAgentConfig } from "@/shared/api/tauriGlobalAgentConfig";
import { listPersonas, setPersonaActive } from "@/shared/api/tauriPersonas";
import type { CanvasScope } from "@/shared/api/canvasTypes";
import type { AcpRuntime, ManagedAgent } from "@/shared/api/types";

const pending = new Map<string, Promise<ManagedAgent>>();

/** Create only the main agent on explicit Begin; existing configuration wins. */
export function ensureBusinessMainAgent(
  scope: CanvasScope,
): Promise<ManagedAgent> {
  const key = JSON.stringify([
    scope.expectedRelayUrl,
    scope.expectedSignerPubkey,
  ]);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = provision(scope).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

async function provision(scope: CanvasScope): Promise<ManagedAgent> {
  const existing = pickWelcomeGuideAgentForRelay(
    await listManagedAgents(),
    scope.expectedRelayUrl,
  );
  if (existing) return existing;
  const [personas, catalog, config] = await Promise.all([
    listPersonas(),
    discoverAcpRuntimes(),
    getGlobalAgentConfig(),
  ]);
  const persona = personas.find((item) => item.id === WELCOME_GUIDE_PERSONA_ID);
  if (!persona)
    throw new Error(
      "Your main agent template is unavailable. Reopen the app and try again.",
    );
  const available = catalog.filter(
    (item): item is AcpRuntime => item.availability === "available",
  );
  const { runtime } = resolveStartRuntimeForDefinition(
    persona,
    available,
    config.preferred_runtime,
  );
  const input = await buildInstanceInputForDefinition(persona, runtime);
  if (!persona.isActive) await setPersonaActive(persona.id, true);
  // Native code binds owner keys, relay, retention and profile publication to
  // this captured scope. Starting remains a separate scoped command.
  const result = await createManagedAgent(
    {
      ...input,
      name: "Fizz",
      relayUrl: scope.expectedRelayUrl,
      spawnAfterCreate: false,
      startOnAppLaunch: false,
      respondTo: "owner-only",
    },
    scope,
  );
  if (result.profileSyncError) {
    throw new Error(
      `Your main agent was created, but connecting it needs another try: ${result.profileSyncError}`,
    );
  }
  return result.agent;
}
