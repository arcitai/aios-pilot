import { AgentPermissionGate } from "@/features/agent-permissions/AgentPermissionGate";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";

/** Owner decisions remain available independently of the current conversation. */
export function AppAgentPermissions() {
  const { activeCommunity } = useCommunities();
  const identity = useIdentityQuery();
  const agents = useManagedAgentsQuery();
  const relay = activeCommunity?.relayUrl ?? null;
  return (
    <AgentPermissionGate
      key={`${relay}:${identity.data?.pubkey ?? ""}`}
      activeRelayUrl={relay}
      agents={agents.data ?? []}
    />
  );
}
