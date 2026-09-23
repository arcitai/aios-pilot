import * as React from "react";

import { useObserverEvents } from "@/features/agents/ui/useObserverEvents";
import type { ManagedAgent } from "@/shared/api/types";
import { useIdentityQuery } from "@/shared/api/hooks";
import { normalizeRelayUrl } from "@/shared/lib/normalizeRelayUrl";
import { Button } from "@/shared/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { sendAgentPermissionDecision } from "@/shared/api/tauriAgentPermissions";
import { AgentModeNotice } from "./AgentModeNotice";
import {
  deriveAgentPermissionSnapshot,
  PERMISSION_REQUEST_TTL_MS,
  type ActivePermissionRequest,
  type AgentPermissionSnapshot,
} from "./permissionRequests";

type AgentPermissionGateProps = {
  agents: readonly ManagedAgent[];
  activeRelayUrl: string | null;
};

type WatcherProps = {
  activeRelayUrl: string | null;
  agent: ManagedAgent;
  now: number;
  onSnapshot: (agentPubkey: string, snapshot: AgentPermissionSnapshot) => void;
  ownerPubkey: string | null;
};

function AgentPermissionWatcher({
  activeRelayUrl,
  agent,
  now,
  onSnapshot,
  ownerPubkey,
}: WatcherProps) {
  const events = useObserverEvents(ownerPubkey != null, agent.pubkey);
  const snapshot = React.useMemo(
    () =>
      deriveAgentPermissionSnapshot({
        activeRelayUrl,
        agentPubkey: agent.pubkey,
        agentRelayUrl: agent.relayUrl,
        events: events.events,
        now,
        ownerPubkey,
      }),
    [
      activeRelayUrl,
      agent.pubkey,
      agent.relayUrl,
      events.events,
      now,
      ownerPubkey,
    ],
  );

  React.useEffect(() => {
    onSnapshot(agent.pubkey, snapshot);
  }, [agent.pubkey, onSnapshot, snapshot]);

  return null;
}

function contextText(context: unknown) {
  if (context == null) return "No additional request details.";
  if (typeof context === "string") return context;
  try {
    return JSON.stringify(context, null, 2) ?? "No additional request details.";
  } catch {
    return "Request details could not be displayed.";
  }
}

/** App-wide owner prompt for live, one-shot ACP tool permission requests. */
export function AgentPermissionGate({
  agents,
  activeRelayUrl,
}: AgentPermissionGateProps) {
  const identityQuery = useIdentityQuery();
  const ownerPubkey = identityQuery.data?.pubkey ?? null;
  const [now, setNow] = React.useState(Date.now);
  const [snapshots, setSnapshots] = React.useState<
    Record<string, AgentPermissionSnapshot>
  >({});
  const [hiddenRequestIds, setHiddenRequestIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [sendingId, setSendingId] = React.useState<string | null>(null);
  const [errorState, setError] = React.useState<{
    requestId: string;
    message: string;
  } | null>(null);
  const sendingRef = React.useRef<string | null>(null);

  const activeAgents = React.useMemo(() => {
    if (!activeRelayUrl) return [];
    const relayUrl = normalizeRelayUrl(activeRelayUrl);
    return agents.filter(
      (agent) =>
        (agent.status === "running" || agent.status === "deployed") &&
        normalizeRelayUrl(agent.relayUrl) === relayUrl,
    );
  }, [activeRelayUrl, agents]);

  const onSnapshot = React.useCallback(
    (agentPubkey: string, snapshot: AgentPermissionSnapshot) => {
      setSnapshots((current) => ({
        ...current,
        [agentPubkey.toLowerCase()]: snapshot,
      }));
    },
    [],
  );

  const activeKeys = React.useMemo(
    () => new Set(activeAgents.map((agent) => agent.pubkey.toLowerCase())),
    [activeAgents],
  );
  const activeRequests = React.useMemo(
    () =>
      Object.entries(snapshots)
        .filter(([agentPubkey]) => activeKeys.has(agentPubkey))
        .flatMap(([, snapshot]) => snapshot.requests)
        .filter((request) => !hiddenRequestIds.has(request.binding.requestId))
        .sort((left, right) => left.createdAt - right.createdAt),
    [activeKeys, hiddenRequestIds, snapshots],
  );
  const request: ActivePermissionRequest | null = activeRequests[0] ?? null;
  const error =
    errorState && errorState.requestId === request?.binding.requestId
      ? errorState.message
      : null;
  const requestAgent = request
    ? (activeAgents.find(
        (agent) =>
          agent.pubkey.toLowerCase() ===
          request.binding.agentPubkey.toLowerCase(),
      ) ?? null)
    : null;

  React.useEffect(() => {
    if (activeRequests.length === 0) return;
    const nextExpiry = Math.min(
      ...activeRequests.map(
        (candidate) => candidate.createdAt + PERMISSION_REQUEST_TTL_MS,
      ),
    );
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(25, Math.min(1_000, nextExpiry - Date.now())),
    );
    return () => window.clearTimeout(timer);
  }, [activeRequests]);

  const decide = React.useCallback(
    async (decision: "approve" | "deny") => {
      if (!request || !ownerPubkey || !activeRelayUrl) return;
      if (sendingRef.current === request.binding.requestId) return;
      sendingRef.current = request.binding.requestId;
      setSendingId(request.binding.requestId);
      setError(null);
      try {
        await sendAgentPermissionDecision(request.binding, decision, {
          activeRelayUrl,
          ownerPubkey,
        });
        setHiddenRequestIds(
          (current) =>
            new Set([...current, request.binding.requestId].slice(-64)),
        );
      } catch (nextError) {
        setError({
          requestId: request.binding.requestId,
          message:
            nextError instanceof Error
              ? nextError.message
              : "Failed to send the permission decision.",
        });
      } finally {
        sendingRef.current = null;
        setSendingId(null);
      }
    },
    [activeRelayUrl, ownerPubkey, request],
  );

  const isSending = request != null && sendingId === request.binding.requestId;

  return (
    <>
      {activeAgents.map((agent) => (
        <AgentPermissionWatcher
          key={agent.pubkey}
          activeRelayUrl={activeRelayUrl}
          agent={agent}
          now={now}
          onSnapshot={onSnapshot}
          ownerPubkey={ownerPubkey}
        />
      ))}

      <AgentModeNotice agents={activeAgents} snapshots={snapshots} />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && request && !isSending) void decide("deny");
        }}
        open={request != null}
      >
        <AlertDialogContent data-testid="agent-permission-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this tool call once?</AlertDialogTitle>
            <AlertDialogDescription>
              {requestAgent?.name ?? "Your agent"} wants to use{" "}
              <span className="font-medium text-foreground">
                {request?.toolName ?? "an agent tool"}
              </span>
              . Approval applies to this request only. Requests expire after 45
              seconds and are denied automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {request ? (
            <div className="space-y-3">
              <p className="break-words text-sm text-foreground">
                {request.action}
              </p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-muted/25 p-3 font-mono text-xs text-muted-foreground">
                {contextText(request.context)}
              </pre>
            </div>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <AlertDialogFooter>
            <Button
              autoFocus
              disabled={isSending}
              onClick={() => void decide("deny")}
              variant="outline"
            >
              Deny
            </Button>
            <Button
              disabled={isSending || ownerPubkey == null}
              onClick={() => void decide("approve")}
            >
              {isSending ? "Sending…" : "Approve once"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
