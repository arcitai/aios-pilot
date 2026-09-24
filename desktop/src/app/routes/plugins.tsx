import { createFileRoute } from "@tanstack/react-router";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import { PluginsWorkspace } from "@/features/plugins/PluginsWorkspace";
import { PluginConnection } from "@/features/plugins/PluginConnection";

export const Route = createFileRoute("/plugins")({ component: PluginsRoute });

function PluginsRoute() {
  const { activeCommunity } = useCommunities();
  const identity = useIdentityQuery();
  return (
    <PluginsWorkspace
      key={`${activeCommunity?.relayUrl}:${identity.data?.pubkey}`}
      renderConnection={(providerId) => (
        <PluginConnection key={providerId} providerId={providerId} />
      )}
    />
  );
}
