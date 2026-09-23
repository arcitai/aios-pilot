import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BusinessWorkspace } from "@/features/business/BusinessWorkspace";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { CanvasScope } from "@/shared/api/canvasTypes";

const AppsWorkspace = React.lazy(async () => {
  const module = await import("@/features/aios-apps");
  return { default: module.AppsWorkspace };
});

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
      renderApps={apps}
    />
  );
}

function apps(
  channelId: string,
  companyName: string,
  companySummary: string,
  scope: CanvasScope,
  onDirtyChange: (dirty: boolean) => void,
) {
  return (
    <React.Suspense
      fallback={
        <p className="p-5 text-sm text-muted-foreground">Opening your apps…</p>
      }
    >
      <AppsWorkspace
        key={`${scope.expectedRelayUrl}:${scope.expectedSignerPubkey}:${channelId}`}
        channelId={channelId}
        companyName={companyName}
        companySummary={companySummary}
        nativeScope={scope}
        onDirtyChange={onDirtyChange}
      />
    </React.Suspense>
  );
}
