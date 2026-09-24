import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useCommunities } from "@/features/communities/useCommunities";
import { findBusinessWorkspaces } from "@/features/business/workspace";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { CanvasScope } from "@/shared/api/canvasTypes";
import type {
  BusinessContextSelection,
  CreateAgentBusinessContext,
} from "@/shared/api/businessContextTypes";
import { BUSINESS_CONTEXT_RESOURCE } from "@/shared/lib/appWorkspaceChannel";

/** Private setup travels beside the definition; it is never exported with it. */
export type AgentKnowledgeSetup = {
  requestScope: CanvasScope;
  businessContext?: CreateAgentBusinessContext;
};

type Draft = {
  scopeKey: string;
  contextId: string | null | undefined;
  loading: BusinessContextSelection["loading"];
  acknowledged: boolean;
};

/** Pin a choice to the workspace and signer visible before asynchronous setup. */
export function useCompanyKnowledgeDraft(available: boolean) {
  const { activeCommunity } = useCommunities();
  const identity = useIdentityQuery();
  const scope: CanvasScope = {
    expectedRelayUrl: activeCommunity?.relayUrl ?? "",
    expectedSignerPubkey: identity.data?.pubkey ?? "",
  };
  const scopeKey = JSON.stringify(scope);
  const [saved, setSaved] = React.useState<Draft | null>(null);
  const draft: Draft =
    saved?.scopeKey === scopeKey
      ? saved
      : {
          scopeKey,
          contextId: undefined,
          loading: "when_needed",
          acknowledged: false,
        };
  const directory = useQuery({
    queryKey: ["agent-company-knowledge", scopeKey],
    queryFn: findBusinessWorkspaces,
    enabled:
      available &&
      Boolean(scope.expectedRelayUrl && scope.expectedSignerPubkey),
    refetchOnMount: "always",
    staleTime: 0,
    retry: 1,
  });
  // Legacy knowledge remains an explicit choice because it may include earlier
  // conversations. Only the host's canonical resource can be proposed by default.
  const proposed = directory.data?.find(
    (channel) => channel.resourceType === BUSINESS_CONTEXT_RESOURCE,
  );
  const contextId =
    draft.contextId === undefined ? (proposed?.id ?? null) : draft.contextId;
  const selected = directory.data?.find((channel) => channel.id === contextId);
  const ready =
    Boolean(scope.expectedRelayUrl && scope.expectedSignerPubkey) &&
    (!available ||
      draft.contextId === null ||
      (directory.isSuccess &&
        !directory.isFetching &&
        (!contextId || (Boolean(selected) && draft.acknowledged))));

  function capture(): AgentKnowledgeSetup {
    if (!ready)
      throw new Error("Review company knowledge before creating this agent.");
    return {
      requestScope: { ...scope },
      businessContext:
        available && selected
          ? {
              selection: {
                contextId: selected.id,
                relayUrl: scope.expectedRelayUrl,
                loading: draft.loading,
              },
              acknowledgeChannelHistory: draft.acknowledged,
            }
          : undefined,
    };
  }

  return {
    directory,
    contextId,
    selected,
    ready,
    capture,
    loading: draft.loading,
    acknowledged: draft.acknowledged,
    select: (id: string | null) =>
      setSaved({ ...draft, contextId: id, acknowledged: false }),
    setLoading: (loading: Draft["loading"]) =>
      setSaved({ ...draft, contextId, loading }),
    acknowledge: (acknowledged: boolean) =>
      setSaved({ ...draft, contextId, acknowledged }),
  };
}
