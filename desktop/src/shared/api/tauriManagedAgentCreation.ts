import {
  fromRawManagedAgent,
  invokeTauri,
  type RawManagedAgent,
} from "./tauri";
import type {
  CreateManagedAgentInput,
  CreateManagedAgentResponse,
} from "./types";
import type { CanvasScope } from "./canvasTypes";
import { requireBusinessContextSupport } from "./tauriAgentBusinessContext";
import { toRawCreateBusinessContext } from "./businessContextWire";
import {
  companyKnowledgeSettled,
  sameCompanyKnowledge,
} from "./businessContextState";
import { startManagedAgent } from "./tauriManagedAgents";

type RawCreateManagedAgentResponse = {
  agent: RawManagedAgent;
  private_key_nsec: string;
  profile_sync_error: string | null;
  spawn_error: string | null;
};

/** Create within the captured scope, then start the saved instance separately. */
export async function createManagedAgent(
  input: CreateManagedAgentInput,
  scope?: CanvasScope,
): Promise<CreateManagedAgentResponse> {
  const requestScope = scope ?? input.requestScope;
  if (input.businessContext && !requestScope) {
    throw new Error(
      "Company knowledge requires a captured workspace and identity.",
    );
  }
  const startAfterCreate = Boolean(requestScope && input.spawnAfterCreate);
  if (input.businessContext) await requireBusinessContextSupport();
  const response = await invokeTauri<RawCreateManagedAgentResponse>(
    "create_managed_agent",
    {
      expectedRelayUrl: requestScope?.expectedRelayUrl,
      expectedSignerPubkey: requestScope?.expectedSignerPubkey,
      input: {
        name: input.name,
        personaId: input.personaId,
        teamId: input.teamId,
        relayUrl: input.relayUrl,
        acpCommand: input.acpCommand,
        agentCommand: input.agentCommand,
        harnessOverride: input.harnessOverride ?? false,
        agentArgs: input.agentArgs,
        mcpCommand: input.mcpCommand,
        turnTimeoutSeconds: input.turnTimeoutSeconds,
        idleTimeoutSeconds: input.idleTimeoutSeconds,
        maxTurnDurationSeconds: input.maxTurnDurationSeconds,
        parallelism: input.parallelism,
        systemPrompt: input.systemPrompt,
        avatarUrl: input.avatarUrl,
        model: input.model,
        provider: input.provider,
        envVars: input.envVars ?? {},
        spawnAfterCreate: requestScope ? false : input.spawnAfterCreate,
        startOnAppLaunch: input.startOnAppLaunch,
        browserEnabled: input.browserEnabled ?? false,
        businessContext: input.businessContext
          ? toRawCreateBusinessContext(input.businessContext)
          : undefined,
        backend: input.backend,
        respondTo: input.respondTo,
        respondToAllowlist: input.respondToAllowlist,
        relayMesh: input.relayMesh,
      },
    },
  );
  const created: CreateManagedAgentResponse = {
    agent: fromRawManagedAgent(response.agent),
    privateKeyNsec: response.private_key_nsec,
    profileSyncError: response.profile_sync_error,
    spawnError: response.spawn_error,
  };
  // Creation is durable now. Every later failure belongs to this identity's
  // settings/retry flow, never to a second create attempt.
  const expected = input.businessContext?.selection;
  const context = created.agent.businessContext;
  if (
    expected &&
    (!companyKnowledgeSettled(context) ||
      !sameCompanyKnowledge(context?.applied, expected))
  ) {
    created.spawnError ??=
      "Company knowledge access is not confirmed. Review this agent’s settings before starting it.";
  }
  if (startAfterCreate && !created.spawnError && !created.profileSyncError) {
    try {
      created.agent = await startManagedAgent(
        created.agent.pubkey,
        requestScope,
      );
    } catch (cause) {
      created.spawnError =
        cause instanceof Error ? cause.message : String(cause);
    }
  }
  return created;
}
