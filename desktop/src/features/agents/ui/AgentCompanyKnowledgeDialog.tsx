import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { managedAgentsQueryKey } from "@/features/agents/hooks";
import type { ManagedAgent } from "@/shared/api/types";
import {
  retryManagedAgentBusinessContext,
  setManagedAgentBusinessContext,
} from "@/shared/api/tauriAgentBusinessContext";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { ChooserDialogContent } from "@/shared/ui/chooser-dialog-content";
import { CompanyKnowledgeField } from "./CompanyKnowledgeField";
import { useCompanyKnowledgeDraft } from "./useCompanyKnowledgeDraft";
import { canonicalRelayUrl } from "../managedAgentRuntimeStatus";
import {
  companyKnowledgeSettled,
  sameCompanyKnowledge,
} from "../lib/companyKnowledge";

export function AgentCompanyKnowledgeDialog({
  agent,
  onClose,
}: {
  agent: ManagedAgent;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // Freeze the starting draft; background agent polling must not erase edits.
  const [initial] = React.useState(agent.businessContext?.desired ?? null);
  const available = agent.backend.type === "local";
  const draft = useCompanyKnowledgeDraft(available, initial);
  const [openedScope] = React.useState(draft.scopeKey);
  const liveScope = React.useRef(draft.scopeKey);
  liveScope.current = draft.scopeKey;
  const scopeChanged = React.useRef(false);
  if (openedScope !== draft.scopeKey) scopeChanged.current = true;
  const [busy, setBusy] = React.useState(false);
  const locked = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const context = agent.businessContext;
  const operation = context?.operation;
  const boundRelay =
    operation?.candidate.relayUrl ??
    context?.applied?.relayUrl ??
    agent.relayUrl;
  const scopeMatches =
    !scopeChanged.current &&
    canonicalRelayUrl(boundRelay) !== null &&
    canonicalRelayUrl(boundRelay) ===
      canonicalRelayUrl(draft.scope.expectedRelayUrl) &&
    Boolean(draft.scope.expectedSignerPubkey);
  const changed =
    !companyKnowledgeSettled(context) ||
    !sameCompanyKnowledge(
      draft.contextId
        ? {
            contextId: draft.contextId,
            relayUrl: draft.scope.expectedRelayUrl,
            loading: draft.loading,
          }
        : null,
      initial,
    );

  async function save(action: "apply" | "retry" | "remove") {
    if (locked.current || !scopeMatches) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    const scope = { ...draft.scope };
    const scopeKey = draft.scopeKey;
    try {
      const setup = action === "apply" ? draft.capture() : null;
      const expected =
        action === "retry"
          ? (context?.desired ?? null)
          : (setup?.businessContext?.selection ?? null);
      const result =
        action === "retry" && operation
          ? await retryManagedAgentBusinessContext(
              agent.pubkey,
              operation.id,
              scope,
            )
          : await setManagedAgentBusinessContext(
              agent.pubkey,
              setup?.businessContext?.selection ?? null,
              setup?.businessContext?.acknowledgeChannelHistory ?? false,
              scope,
            );
      if (scopeChanged.current || liveScope.current !== scopeKey) return;
      if (result.pubkey !== agent.pubkey)
        throw new Error(
          "The host returned a different agent. Close and reopen these settings to check the saved state.",
        );
      queryClient.setQueryData<ManagedAgent[]>(
        managedAgentsQueryKey,
        (entries) =>
          entries?.map((entry) =>
            entry.pubkey === result.pubkey ? result : entry,
          ),
      );
      if (result.businessContext?.operation) {
        setError(
          result.businessContext.operation.lastError ??
            "Setup is still pending. Review it here before starting the agent.",
        );
      } else if (
        companyKnowledgeSettled(result.businessContext) &&
        sameCompanyKnowledge(expected, result.businessContext?.applied)
      ) {
        onClose();
      } else {
        setError(
          "The host has not confirmed this change. Close and reopen these settings to check the saved state.",
        );
      }
    } catch (cause) {
      if (!scopeChanged.current && liveScope.current === scopeKey)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      // Even an interrupted response may have persisted a recovery operation.
      void queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey });
      locked.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <ChooserDialogContent
        title="Company knowledge"
        headerSubtitle={agent.name}
        className="max-w-lg border-0"
        footerClassName="border-t-0"
        data-testid="agent-company-knowledge-dialog"
        footer={
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Close
            </Button>
            {operation ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !scopeMatches}
                  onClick={() =>
                    void save(operation.cancelRequested ? "retry" : "remove")
                  }
                >
                  {operation.cancelRequested
                    ? "Retry removal"
                    : "Remove access"}
                </Button>
                {!operation.cancelRequested ? (
                  <Button
                    type="button"
                    disabled={busy || !scopeMatches}
                    onClick={() => void save("retry")}
                  >
                    {busy ? "Checking…" : "Retry setup"}
                  </Button>
                ) : null}
              </>
            ) : (
              <Button
                type="button"
                disabled={busy || !scopeMatches || !draft.ready || !changed}
                onClick={() => void save("apply")}
              >
                {busy ? "Saving…" : "Save knowledge access"}
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          {!scopeMatches ? (
            <p role="alert" className="text-sm text-destructive">
              Switch back to this agent’s workspace, then reopen these settings.
            </p>
          ) : null}
          {operation ? (
            <div className="space-y-2 text-sm">
              <p>
                Company knowledge setup needs attention. This agent cannot start
                until access is confirmed or removed.
              </p>
              <p className="text-muted-foreground">
                Try again to finish setup, or remove this agent’s access.
              </p>
            </div>
          ) : (
            <CompanyKnowledgeField
              draft={draft}
              available={available}
              disabled={busy || !scopeMatches}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Saving here stops this agent and leaves your other settings
            unchanged. Start it again when you are ready. Removing access cannot
            erase information already read.
          </p>
          {error || operation?.lastError ? (
            <p role="alert" className="break-words text-sm text-destructive">
              {error ?? operation?.lastError}
            </p>
          ) : null}
        </div>
      </ChooserDialogContent>
    </Dialog>
  );
}
