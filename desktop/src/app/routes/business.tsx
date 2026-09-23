import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BusinessWorkspace } from "@/features/business/BusinessWorkspace";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";

const ChannelRouteScreen = React.lazy(async () => {
  const module = await import("./ChannelRouteScreen");
  return { default: module.ChannelRouteScreen };
});

export const Route = createFileRoute("/business")({ component: BusinessRoute });

function conversation(channelId: string) {
  return (
    <React.Suspense
      fallback={
        <p className="p-5 text-sm text-muted-foreground">
          Opening conversation…
        </p>
      }
    >
      <ChannelRouteScreen
        autoSendDraftKey={null}
        channelId={channelId}
        searchHighlight={null}
        selectedPostId={null}
        targetMessageId={null}
        targetReplyId={null}
        targetThreadRootId={null}
      />
    </React.Suspense>
  );
}

function BusinessRoute() {
  const { activeCommunity } = useCommunities();
  const identity = useIdentityQuery();
  return (
    <BusinessWorkspace
      key={`${activeCommunity?.relayUrl}:${identity.data?.pubkey}`}
      renderConversation={conversation}
    />
  );
}
