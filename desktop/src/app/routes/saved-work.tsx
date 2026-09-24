import * as React from "react";
import { Globe2 } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { SavedWorkWorkspace } from "@/features/business/SavedWorkWorkspace";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { CanvasScope } from "@/shared/api/canvasTypes";
import type { AppsExtensionApp } from "@/features/aios-apps/extensions";

const AppsWorkspace = React.lazy(async () => {
  const module = await import("@/features/aios-apps");
  return { default: module.AppsWorkspace };
});

const SitesWorkspace = React.lazy(async () => {
  const module = await import("@/features/aios-sites");
  return { default: module.SitesWorkspace };
});

const ChannelRouteScreen = React.lazy(async () => {
  const module = await import("./ChannelRouteScreen");
  return { default: module.ChannelRouteScreen };
});

export const Route = createFileRoute("/saved-work")({
  validateSearch: (search: Record<string, unknown>) => {
    const context = search.context;
    if (
      context !== undefined &&
      (typeof context !== "string" || !context.trim() || context.length > 128)
    ) {
      throw new Error(
        "This saved-work link has an invalid context. Open Business to find your saved work.",
      );
    }
    return { context };
  },
  component: SavedWorkRoute,
});

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
        presentation="embedded"
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

function SavedWorkRoute() {
  const { context } = Route.useSearch();
  const { activeCommunity } = useCommunities();
  const identity = useIdentityQuery();
  return (
    <SavedWorkWorkspace
      contextId={context}
      key={`${activeCommunity?.relayUrl}:${identity.data?.pubkey}:${context}`}
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
    <BusinessApps
      key={`${scope.expectedRelayUrl}:${scope.expectedSignerPubkey}:${channelId}`}
      channelId={channelId}
      companyName={companyName}
      companySummary={companySummary}
      scope={scope}
      onDirtyChange={onDirtyChange}
    />
  );
}

function BusinessApps({
  channelId,
  companyName,
  companySummary,
  scope,
  onDirtyChange,
}: {
  channelId: string;
  companyName: string;
  companySummary: string;
  scope: CanvasScope;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { expectedRelayUrl, expectedSignerPubkey } = scope;
  const extensions = React.useMemo<readonly AppsExtensionApp[]>(
    () => [
      {
        id: "sites",
        title: "Sites",
        description: "Create and share a useful page for your business.",
        Icon: Globe2,
        render: ({ onDirtyChange: onSiteDirtyChange }) => (
          <React.Suspense
            fallback={
              <p className="p-5 text-sm text-muted-foreground">
                Opening your sites…
              </p>
            }
          >
            <SitesWorkspace
              businessChannelId={channelId}
              companyName={companyName}
              expectedRelayUrl={expectedRelayUrl}
              expectedSignerPubkey={expectedSignerPubkey}
              onDirtyChange={onSiteDirtyChange}
              renderConversation={conversation}
            />
          </React.Suspense>
        ),
      },
    ],
    [channelId, companyName, expectedRelayUrl, expectedSignerPubkey],
  );
  return (
    <React.Suspense
      fallback={
        <p className="p-5 text-sm text-muted-foreground">Opening your apps…</p>
      }
    >
      <AppsWorkspace
        embedded
        channelId={channelId}
        companyName={companyName}
        companySummary={companySummary}
        nativeScope={scope}
        onDirtyChange={onDirtyChange}
        extensionApps={extensions}
        renderConversation={conversation}
      />
    </React.Suspense>
  );
}
