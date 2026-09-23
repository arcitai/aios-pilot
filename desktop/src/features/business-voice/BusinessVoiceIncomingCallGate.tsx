import * as React from "react";
import { toast } from "sonner";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { getAgentObserverSnapshot } from "@/features/agents/observerRelayStore";
import { useCommunities } from "@/features/communities/useCommunities";
import { useHuddle } from "@/features/huddle/HuddleContext";
import { businessVoiceBindingMatches } from "@/features/business-voice/businessVoiceScope";
import { useIdentityQuery } from "@/shared/api/hooks";
import { relayClient } from "@/shared/api/relayClient";
import type { RelayEvent } from "@/shared/api/types";
import {
  getChannelDetails,
  getChannelMembers,
} from "@/shared/api/tauriChannels";
import {
  buildObserverControlEvent,
  decryptObserverEvent,
} from "@/shared/api/tauriObserver";
import { KIND_AGENT_OBSERVER_FRAME } from "@/shared/constants/kinds";
import { Button } from "@/shared/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import type { ManagedAgent } from "@/shared/api/types";
import {
  BUSINESS_CALL_PENDING_LIMIT,
  IncomingBusinessCallInbox,
  createBusinessVoiceCallDecision,
  latestReadyRuntimeNonce,
  normalizeCallRelayUrl,
  parseIncomingBusinessCallRequest,
  type BusinessVoiceCallRequest,
  type IncomingBusinessCall,
} from "./incomingBusinessCall";

const MAX_PARALLEL_CALL_DECRYPTIONS = BUSINESS_CALL_PENDING_LIMIT;
const EVENT_DEDUPE_LIMIT = 256;
const CALL_DECISION_TEXT = {
  accepted: "Timed out while responding to the incoming call.",
  declined: "Timed out while declining the incoming call.",
  failure: "Failed to send the incoming call response.",
};

function singleTagValue(tags: string[][], name: string): string | null {
  const matches = tags.filter((tag) => tag[0] === name);
  return matches.length === 1 && matches[0].length === 2 ? matches[0][1] : null;
}

function isLocallyOwnedReadyAgent(
  agents: readonly ManagedAgent[],
  pubkey: string,
  relayUrl: string,
): ManagedAgent | null {
  const agent = agents.find(
    (candidate) =>
      candidate.pubkey.toLowerCase() === pubkey.toLowerCase() &&
      candidate.backend.type === "local" &&
      candidate.status === "running" &&
      normalizeCallRelayUrl(candidate.relayUrl) === relayUrl,
  );
  if (!agent) return null;

  const runtimeNonce = latestReadyRuntimeNonce(
    getAgentObserverSnapshot(agent.pubkey, true).events,
    agent.pubkey,
    relayUrl,
  );
  return runtimeNonce ? agent : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "The voice call could not be completed.";
}

/** App-global incoming ring surface; the app shell decides where to mount it. */
export function BusinessVoiceIncomingCallGate() {
  const { activeCommunity } = useCommunities();
  const identity = useIdentityQuery();
  const { data: managedAgents } = useManagedAgentsQuery();
  const huddle = useHuddle();
  const ownerPubkey = identity.data?.pubkey ?? null;
  const relayUrl = activeCommunity
    ? normalizeCallRelayUrl(activeCommunity.relayUrl)
    : null;

  const scopeRef = React.useRef({
    ownerPubkey,
    relayUrl,
    agents: managedAgents ?? [],
    huddle,
  });
  scopeRef.current = {
    ownerPubkey,
    relayUrl,
    agents: managedAgents ?? [],
    huddle,
  };

  const inboxRef = React.useRef(new IncomingBusinessCallInbox());
  const activeDecryptionsRef = React.useRef(new Set<string>());
  const seenEventsRef = React.useRef(new Map<string, number>());
  const [calls, setCalls] = React.useState<IncomingBusinessCall[]>([]);
  const [resolvingRequestId, setResolvingRequestId] = React.useState<
    string | null
  >(null);
  const [actionError, setActionError] = React.useState<{
    requestId: string;
    message: string;
  } | null>(null);
  const [nowSeconds, setNowSeconds] = React.useState(() =>
    Math.floor(Date.now() / 1_000),
  );

  const refreshCalls = React.useCallback(() => {
    setCalls(inboxRef.current.list());
  }, []);

  const currentAgent = React.useCallback((pubkey: string) => {
    const scope = scopeRef.current;
    if (!scope.ownerPubkey || !scope.relayUrl) return null;
    const agent = isLocallyOwnedReadyAgent(
      scope.agents,
      pubkey,
      scope.relayUrl,
    );
    if (!agent) return null;
    const runtimeNonce = latestReadyRuntimeNonce(
      getAgentObserverSnapshot(agent.pubkey, true).events,
      agent.pubkey,
      scope.relayUrl,
    );
    return runtimeNonce ? { agent, runtimeNonce } : null;
  }, []);

  const isCurrentRequest = React.useCallback(
    (request: BusinessVoiceCallRequest) => {
      const scope = scopeRef.current;
      if (
        !scope.ownerPubkey ||
        scope.ownerPubkey.toLowerCase() !== request.ownerPubkey.toLowerCase() ||
        !scope.relayUrl ||
        scope.relayUrl !== normalizeCallRelayUrl(request.relayUrl) ||
        Math.floor(Date.now() / 1_000) >= request.expiresAt
      ) {
        return false;
      }
      const agent = currentAgent(request.agentPubkey);
      return agent?.runtimeNonce === request.runtimeStartNonce;
    },
    [currentAgent],
  );

  const resolveCallChannel = React.useCallback(
    async (request: BusinessVoiceCallRequest) => {
      if (!isCurrentRequest(request)) return null;
      const [channel, members] = await Promise.all([
        getChannelDetails(request.channelId),
        getChannelMembers(request.channelId),
      ]);
      if (
        !isCurrentRequest(request) ||
        channel.id !== request.channelId ||
        channel.channelType === "dm" ||
        channel.archivedAt !== null ||
        !channel.isMember
      ) {
        return null;
      }
      const memberPubkeys = new Set(
        members.map((member) => member.pubkey.toLowerCase()),
      );
      if (
        !memberPubkeys.has(request.ownerPubkey.toLowerCase()) ||
        !memberPubkeys.has(request.agentPubkey.toLowerCase())
      ) {
        return null;
      }
      return channel;
    },
    [isCurrentRequest],
  );

  const sendDecision = React.useCallback(
    async (
      request: BusinessVoiceCallRequest,
      decision: "accept" | "decline",
    ) => {
      if (!isCurrentRequest(request)) {
        throw new Error(
          "This call is no longer bound to the active workspace.",
        );
      }
      await relayClient.preconnect();
      const event = await buildObserverControlEvent({
        agentPubkey: request.agentPubkey,
        payload: createBusinessVoiceCallDecision(request, decision),
      });
      if (
        !isCurrentRequest(request) ||
        event.pubkey.toLowerCase() !== request.ownerPubkey.toLowerCase()
      ) {
        throw new Error(
          "The active identity or workspace changed before sending.",
        );
      }
      await relayClient.publishEvent(
        event,
        decision === "accept"
          ? CALL_DECISION_TEXT.accepted
          : CALL_DECISION_TEXT.declined,
        CALL_DECISION_TEXT.failure,
      );
    },
    [isCurrentRequest],
  );

  React.useEffect(() => {
    const owner = ownerPubkey?.toLowerCase() ?? null;
    const readyRelay = relayUrl;
    const inbox = inboxRef.current;
    inbox.clear();
    activeDecryptionsRef.current.clear();
    seenEventsRef.current.clear();
    setCalls([]);
    if (
      !owner ||
      !/^[0-9a-f]{64}$/i.test(owner) ||
      !readyRelay ||
      identity.data?.lost ||
      identity.data?.locked
    ) {
      return;
    }

    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    const subscription = relayClient.subscribeInteractive(
      {
        kinds: [KIND_AGENT_OBSERVER_FRAME],
        "#p": [owner],
        "#frame": ["control"],
        limit: 256,
        since: Math.floor(Date.now() / 1_000) - 60,
      },
      (event: RelayEvent) => {
        if (
          disposed ||
          event.kind !== KIND_AGENT_OBSERVER_FRAME ||
          !Array.isArray(event.tags) ||
          event.pubkey.length !== 64 ||
          seenEventsRef.current.has(event.id)
        ) {
          return;
        }
        const taggedOwner = singleTagValue(event.tags, "p");
        const taggedAgent = singleTagValue(event.tags, "agent");
        if (
          taggedOwner?.toLowerCase() !== owner ||
          taggedAgent?.toLowerCase() !== event.pubkey.toLowerCase() ||
          singleTagValue(event.tags, "frame") !== "control" ||
          activeDecryptionsRef.current.size >= MAX_PARALLEL_CALL_DECRYPTIONS
        ) {
          return;
        }

        const agent = currentAgent(event.pubkey);
        if (!agent) return;

        const now = Math.floor(Date.now() / 1_000);
        const eventIds = seenEventsRef.current;
        eventIds.set(event.id, now + 60);
        while (eventIds.size > EVENT_DEDUPE_LIMIT) {
          const oldest = eventIds.keys().next().value;
          if (oldest === undefined) break;
          eventIds.delete(oldest);
        }
        activeDecryptionsRef.current.add(event.id);

        void (async () => {
          let request: BusinessVoiceCallRequest | null = null;
          try {
            const payload = await decryptObserverEvent(event);
            const scope = scopeRef.current;
            const current = currentAgent(event.pubkey);
            if (
              disposed ||
              !scope.ownerPubkey ||
              !scope.relayUrl ||
              !current ||
              current.runtimeNonce !== agent.runtimeNonce
            ) {
              return;
            }
            request = parseIncomingBusinessCallRequest(
              payload,
              {
                eventKind: event.kind,
                eventPubkey: event.pubkey,
                eventCreatedAt: event.created_at,
                eventTags: event.tags,
                ownerPubkey: scope.ownerPubkey,
                relayUrl: scope.relayUrl,
                agentPubkey: current.agent.pubkey,
                runtimeStartNonce: current.runtimeNonce,
              },
              Math.floor(Date.now() / 1_000),
            );
            if (!request) return;

            const reserved = inbox.reserve(
              request,
              Math.floor(Date.now() / 1_000),
            );
            if (reserved !== "reserved") return;
            const channel = await resolveCallChannel(request);
            if (!channel || disposed) {
              inbox.release(request.requestId);
              return;
            }
            const currentTime = Math.floor(Date.now() / 1_000);
            const incoming: IncomingBusinessCall = {
              ...request,
              agentName: current.agent.name,
              channelName: channel.name,
            };
            if (!inbox.commit(incoming, currentTime)) return;
            refreshCalls();
          } catch {
            if (request) inbox.release(request.requestId);
          } finally {
            activeDecryptionsRef.current.delete(event.id);
          }
        })();
      },
    );

    void subscription.then(
      (stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      },
      (error: unknown) => {
        if (!disposed) {
          console.warn(
            "Could not subscribe to incoming business calls:",
            error,
          );
        }
      },
    );

    return () => {
      disposed = true;
      unsubscribe?.();
      inbox.clear();
      activeDecryptionsRef.current.clear();
      seenEventsRef.current.clear();
    };
  }, [
    currentAgent,
    identity.data?.locked,
    identity.data?.lost,
    ownerPubkey,
    refreshCalls,
    relayUrl,
    resolveCallChannel,
  ]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Math.floor(Date.now() / 1_000);
      setNowSeconds(now);
      if (inboxRef.current.expire(now).length > 0) refreshCalls();
      for (const [eventId, expiresAt] of seenEventsRef.current) {
        if (expiresAt <= now) seenEventsRef.current.delete(eventId);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [refreshCalls]);

  const closeRequest = React.useCallback(
    (request: BusinessVoiceCallRequest) => {
      inboxRef.current.remove(request.requestId);
      refreshCalls();
      setActionError(null);
    },
    [refreshCalls],
  );

  const declineCall = React.useCallback(
    async (request: IncomingBusinessCall) => {
      if (resolvingRequestId) return;
      if (!isCurrentRequest(request)) {
        closeRequest(request);
        return;
      }
      setResolvingRequestId(request.requestId);
      setActionError(null);
      try {
        await sendDecision(request, "decline");
        closeRequest(request);
      } catch (error) {
        const message = errorMessage(error);
        setActionError({
          requestId: request.requestId,
          message,
        });
        toast.error(message);
      } finally {
        setResolvingRequestId(null);
      }
    },
    [closeRequest, isCurrentRequest, resolvingRequestId, sendDecision],
  );

  const leaveExactRequestHuddle = React.useCallback(
    async (request: BusinessVoiceCallRequest) => {
      const currentHuddle = scopeRef.current.huddle;
      const binding = currentHuddle.activeHuddleBinding;
      if (
        binding &&
        businessVoiceBindingMatches(
          {
            channelId: request.channelId,
            channelName: "",
            relayUrl: request.relayUrl,
            signerPubkey: request.ownerPubkey,
            mainAgentPubkey: request.agentPubkey,
          },
          binding,
        ) &&
        currentHuddle.activeEphemeralChannelId === binding.ephemeralChannelId
      ) {
        await currentHuddle.leaveHuddle();
      }
    },
    [],
  );

  const waitForConnectedHuddle = React.useCallback(
    async (request: BusinessVoiceCallRequest) => {
      const waitUntil = Math.min(Date.now() + 3_000, request.expiresAt * 1_000);
      while (Date.now() < waitUntil) {
        const currentHuddle = scopeRef.current.huddle;
        const binding = currentHuddle.activeHuddleBinding;
        if (
          currentHuddle.micConnected &&
          binding &&
          businessVoiceBindingMatches(
            {
              channelId: request.channelId,
              channelName: "",
              relayUrl: request.relayUrl,
              signerPubkey: request.ownerPubkey,
              mainAgentPubkey: request.agentPubkey,
            },
            binding,
          ) &&
          currentHuddle.activeEphemeralChannelId === binding.ephemeralChannelId
        ) {
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 100));
      }
      throw new Error(
        Date.now() >= request.expiresAt * 1_000
          ? "The call expired before the private voice session connected."
          : "The private voice session did not connect for this call.",
      );
    },
    [],
  );

  const acceptCall = React.useCallback(
    async (request: IncomingBusinessCall) => {
      if (resolvingRequestId) return;
      setResolvingRequestId(request.requestId);
      setActionError(null);
      let huddleStartAttempted = false;
      try {
        const channel = await resolveCallChannel(request);
        if (!channel) {
          throw new Error("The call is no longer available in this workspace.");
        }
        const currentHuddle = scopeRef.current.huddle;
        if (
          currentHuddle.isStarting ||
          currentHuddle.activeHuddleBinding ||
          currentHuddle.activeEphemeralChannelId !== null ||
          currentHuddle.micConnected
        ) {
          throw new Error(
            "Finish the current voice session before accepting this call.",
          );
        }
        currentHuddle.clearHuddleError();
        huddleStartAttempted = true;
        await currentHuddle.startHuddle(
          request.channelId,
          [request.agentPubkey],
          channel.name,
          {
            relayUrl: request.relayUrl,
            signerPubkey: request.ownerPubkey,
          },
        );
        await waitForConnectedHuddle(request);
        if (
          !isCurrentRequest(request) ||
          !(await resolveCallChannel(request))
        ) {
          throw new Error(
            "The call expired or its workspace membership changed.",
          );
        }
      } catch (error) {
        if (huddleStartAttempted) {
          await leaveExactRequestHuddle(request).catch(() => undefined);
        }
        const message = errorMessage(error);
        toast.error(message);
        let currentMembership = false;
        if (isCurrentRequest(request)) {
          try {
            currentMembership = Boolean(await resolveCallChannel(request));
          } catch {
            currentMembership = false;
          }
        }
        if (currentMembership) {
          try {
            await sendDecision(request, "decline");
            closeRequest(request);
            setActionError({ requestId: request.requestId, message });
          } catch (decisionError) {
            setActionError({
              requestId: request.requestId,
              message: `${message} ${errorMessage(decisionError)}`,
            });
          }
        } else {
          closeRequest(request);
          setActionError({ requestId: request.requestId, message });
        }
        setResolvingRequestId(null);
        return;
      }

      try {
        await sendDecision(request, "accept");
        closeRequest(request);
      } catch (error) {
        await leaveExactRequestHuddle(request).catch(() => undefined);
        closeRequest(request);
        const message = `The private voice session started, but the agent response could not be confirmed. ${errorMessage(error)}`;
        setActionError({
          requestId: request.requestId,
          message,
        });
        toast.error(message);
      } finally {
        setResolvingRequestId(null);
      }
    },
    [
      closeRequest,
      isCurrentRequest,
      leaveExactRequestHuddle,
      resolvingRequestId,
      resolveCallChannel,
      sendDecision,
      waitForConnectedHuddle,
    ],
  );

  const activeCall = calls[0] ?? null;
  const secondsRemaining = activeCall
    ? Math.max(0, activeCall.expiresAt - nowSeconds)
    : 0;
  const visibleError =
    activeCall && actionError?.requestId === activeCall.requestId
      ? actionError.message
      : null;

  return (
    <>
      <AlertDialog open={activeCall !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Incoming voice call</AlertDialogTitle>
            <AlertDialogDescription>
              {activeCall
                ? `${activeCall.agentName} is requesting a private voice huddle in ${activeCall.channelName}. Your microphone is requested only after you choose to accept.`
                : "No incoming call."}
            </AlertDialogDescription>
            {activeCall ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Call expires in {secondsRemaining} seconds.
              </p>
            ) : null}
            {visibleError ? (
              <p className="text-sm text-destructive" role="alert">
                {visibleError}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={resolvingRequestId !== null || secondsRemaining === 0}
              onClick={() => {
                if (activeCall) void declineCall(activeCall);
              }}
            >
              {resolvingRequestId === activeCall?.requestId
                ? "Responding…"
                : "Decline call"}
            </Button>
            <Button
              type="button"
              disabled={resolvingRequestId !== null || secondsRemaining === 0}
              onClick={() => {
                if (activeCall) void acceptCall(activeCall);
              }}
            >
              {resolvingRequestId === activeCall?.requestId
                ? "Connecting…"
                : "Accept and start voice"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {!activeCall && actionError ? (
        <div className="sr-only" role="status">
          {actionError.message}
        </div>
      ) : null}
    </>
  );
}
