import { createFileRoute } from "@tanstack/react-router";
import { BusinessWorkspace } from "@/features/business/BusinessWorkspace";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";

export const Route = createFileRoute("/business")({ component: BusinessRoute });

function BusinessRoute() {
  const { activeCommunity } = useCommunities();
  const identity = useIdentityQuery();
  return (
    <BusinessWorkspace
      key={`${activeCommunity?.relayUrl}:${identity.data?.pubkey}`}
    />
  );
}
