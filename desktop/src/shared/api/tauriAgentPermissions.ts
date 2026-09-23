import { sendAgentObserverControl } from "@/shared/api/observerRelay";
import { normalizeRelayUrl } from "@/shared/lib/normalizeRelayUrl";

export type PermissionBinding = {
  requestId: string;
  ownerPubkey: string;
  agentPubkey: string;
  relayUrl: string;
  runtimeStartNonce: string;
  agentIndex: number;
  sessionId: string;
  turnId: string;
  channelId: string | null;
};

export type AgentPermissionDecision = "approve" | "deny";

/** Send a one-shot decision through the existing owner-encrypted control path. */
export async function sendAgentPermissionDecision(
  binding: PermissionBinding,
  decision: AgentPermissionDecision,
  scope: {
    activeRelayUrl: string | null | undefined;
    ownerPubkey: string | null | undefined;
  },
) {
  if (!scope.ownerPubkey || !scope.activeRelayUrl) {
    throw new Error("The active owner or community is unavailable.");
  }
  if (binding.ownerPubkey.toLowerCase() !== scope.ownerPubkey.toLowerCase()) {
    throw new Error("This request belongs to another owner identity.");
  }
  if (
    normalizeRelayUrl(binding.relayUrl) !==
    normalizeRelayUrl(scope.activeRelayUrl)
  ) {
    throw new Error("This request belongs to another community.");
  }
  if (
    !binding.requestId ||
    !binding.runtimeStartNonce ||
    !binding.sessionId ||
    !binding.turnId ||
    !Number.isSafeInteger(binding.agentIndex) ||
    binding.agentIndex < 0
  ) {
    throw new Error("The permission request binding is incomplete.");
  }

  await sendAgentObserverControl(binding.agentPubkey, {
    type: "resolve_permission",
    // The observer payload also contains display-only fields. Copy only the
    // binding, so untrusted extra keys can never replace the control verb.
    requestId: binding.requestId,
    ownerPubkey: binding.ownerPubkey,
    agentPubkey: binding.agentPubkey,
    relayUrl: binding.relayUrl,
    runtimeStartNonce: binding.runtimeStartNonce,
    agentIndex: binding.agentIndex,
    sessionId: binding.sessionId,
    turnId: binding.turnId,
    channelId: binding.channelId,
    decision,
  });
}
