import type { ObserverEvent } from "@/features/agents/ui/agentSessionTypes";
import type { PermissionBinding } from "@/shared/api/tauriAgentPermissions";
import { normalizeRelayUrl } from "@/shared/lib/normalizeRelayUrl";

export const PERMISSION_REQUEST_TTL_MS = 45_000;

export type ActivePermissionRequest = {
  binding: PermissionBinding;
  action: string;
  context: unknown;
  createdAt: number;
  toolName: string;
};

export type AgentPermissionModeSession = {
  sessionId: string;
  mode: string | null;
  requestedMode: string | null;
  status: string;
  mechanism: string | null;
};

export type AgentPermissionModeStatus = {
  requestedMode: string | null;
  status: string;
  mechanism: string | null;
  sessionId: string | null;
  sessions: AgentPermissionModeSession[];
};

export type AgentPermissionSnapshot = {
  /** True only when at least one ACP session currently reports bypass mode. */
  autonomous: boolean;
  /** Actual mode reported by the most recently updated session, if known. */
  permissionMode: string | null;
  /** Per-session actual mode plus the provider's apply/verification status. */
  modeStatus: AgentPermissionModeStatus;
  requests: ActivePermissionRequest[];
};

type DeriveSnapshotInput = {
  activeRelayUrl: string | null | undefined;
  agentPubkey: string;
  agentRelayUrl: string;
  events: readonly ObserverEvent[];
  now?: number;
  ownerPubkey: string | null | undefined;
};

type RuntimeStart = {
  relayUrl: string;
  runtimeStartNonce: string;
  permissionMode: string | null;
  event: ObserverEvent;
};

type RuntimeLifecycle = {
  lifecycle: string;
  relayUrl: string;
  startNonce: string;
};

const EMPTY_SNAPSHOT: AgentPermissionSnapshot = {
  autonomous: false,
  permissionMode: null,
  modeStatus: {
    requestedMode: null,
    status: "unverified",
    mechanism: null,
    sessionId: null,
    sessions: [],
  },
  requests: [],
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedText(value: unknown, fallback: string, maxLength: number) {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  const text = value.trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

function ordered(events: readonly ObserverEvent[]) {
  return [...events].sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      const difference = leftTime - rightTime;
      if (difference !== 0) return difference;
    }
    return left.seq - right.seq;
  });
}

type PermissionRequestPayload = PermissionBinding & Record<string, unknown>;

function isPermissionBinding(
  value: unknown,
): value is PermissionRequestPayload {
  const item = record(value);
  return (
    item !== null &&
    typeof item.requestId === "string" &&
    item.requestId.length > 0 &&
    item.requestId.length <= 80 &&
    typeof item.ownerPubkey === "string" &&
    typeof item.agentPubkey === "string" &&
    typeof item.relayUrl === "string" &&
    typeof item.runtimeStartNonce === "string" &&
    item.runtimeStartNonce.length > 0 &&
    Number.isSafeInteger(item.agentIndex) &&
    (item.agentIndex as number) >= 0 &&
    typeof item.sessionId === "string" &&
    item.sessionId.length > 0 &&
    typeof item.turnId === "string" &&
    item.turnId.length > 0 &&
    (typeof item.channelId === "string" || item.channelId === null)
  );
}

function latestRuntimeStart(
  events: readonly ObserverEvent[],
): RuntimeStart | null {
  for (const event of ordered(events).reverse()) {
    if (event.kind !== "harness_started") continue;
    const payload = record(event.payload);
    if (
      payload &&
      typeof payload.relayUrl === "string" &&
      typeof payload.runtimeStartNonce === "string" &&
      payload.runtimeStartNonce.length > 0
    ) {
      return {
        relayUrl: payload.relayUrl,
        runtimeStartNonce: payload.runtimeStartNonce,
        permissionMode:
          typeof payload.permissionMode === "string"
            ? payload.permissionMode
            : null,
        event,
      };
    }
  }
  return null;
}

function modeConfigOption(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null;
  return record(value.find((option) => record(option)?.category === "mode"));
}

function currentModeFromConfigOptions(value: unknown): string | null {
  const modeOption = modeConfigOption(value);
  const currentValue = record(modeOption)?.currentValue;
  return typeof currentValue === "string" ? currentValue : null;
}

function currentModeFromSessionConfig(payload: Record<string, unknown>) {
  const configOptions = payload.configOptions;
  const modeOption = Array.isArray(configOptions)
    ? configOptions.find((option) => record(option)?.category === "mode")
    : undefined;
  if (modeOption !== undefined) {
    const currentValue = record(modeOption)?.currentValue;
    return typeof currentValue === "string" ? currentValue : null;
  }
  const legacyMode = record(payload.modes)?.currentModeId;
  return typeof legacyMode === "string" ? legacyMode : null;
}

function eventSessionId(
  event: ObserverEvent,
  params?: Record<string, unknown>,
) {
  const fromParams = params?.sessionId;
  if (typeof fromParams === "string" && fromParams.length > 0) {
    return fromParams;
  }
  return typeof event.sessionId === "string" && event.sessionId.length > 0
    ? event.sessionId
    : null;
}

function derivePermissionModeStatus(
  events: readonly ObserverEvent[],
  start: RuntimeStart,
): {
  autonomous: boolean;
  permissionMode: string | null;
  modeStatus: AgentPermissionModeStatus;
} {
  const startIndex = events.indexOf(start.event);
  const runtimeEvents = startIndex < 0 ? [] : events.slice(startIndex + 1);
  const sessions = new Map<string, AgentPermissionModeSession>();
  let latestSessionId: string | null = null;

  for (const event of runtimeEvents) {
    if (event.kind === "session_config_captured") {
      const payload = record(event.payload);
      const sessionId = eventSessionId(event);
      if (!payload || !sessionId) continue;
      const mode = currentModeFromSessionConfig(payload);
      sessions.set(sessionId, {
        sessionId,
        mode,
        requestedMode: start.permissionMode,
        status: mode === null ? "unverified" : "reported",
        mechanism: modeConfigOption(payload.configOptions)
          ? "config_option"
          : record(payload.modes)
            ? "legacy_mode"
            : null,
      });
      latestSessionId = sessionId;
      continue;
    }

    if (event.kind === "permission_mode_status") {
      const payload = record(event.payload);
      const sessionId = eventSessionId(event);
      if (!payload || !sessionId) continue;
      const current = sessions.get(sessionId) ?? {
        sessionId,
        mode: null,
        requestedMode: start.permissionMode,
        status: "unverified",
        mechanism: null,
      };
      const requestedMode = payload.requestedMode;
      const currentModeId = payload.currentModeId;
      const mechanism = payload.mechanism;
      sessions.set(sessionId, {
        ...current,
        mode: Object.hasOwn(payload, "currentModeId")
          ? typeof currentModeId === "string"
            ? currentModeId
            : null
          : current.mode,
        requestedMode:
          typeof requestedMode === "string"
            ? requestedMode
            : current.requestedMode,
        status:
          typeof payload.status === "string" ? payload.status : current.status,
        mechanism:
          typeof mechanism === "string" ? mechanism : current.mechanism,
      });
      latestSessionId = sessionId;
      continue;
    }

    if (event.kind !== "acp_read") continue;
    const payload = record(event.payload);
    if (payload?.method !== "session/update") continue;
    const params = record(payload.params);
    const update = record(params?.update);
    const sessionId = eventSessionId(event, params ?? undefined);
    if (!update || !sessionId) continue;

    const current = sessions.get(sessionId) ?? {
      sessionId,
      mode: null,
      requestedMode: start.permissionMode,
      status: "unverified",
      mechanism: null,
    };
    if (update.sessionUpdate === "config_option_update") {
      const mode = currentModeFromConfigOptions(update.configOptions);
      sessions.set(sessionId, {
        ...current,
        mode,
        status: mode === null ? "unverified" : "reported",
        mechanism: "config_option",
      });
      latestSessionId = sessionId;
    } else if (update.sessionUpdate === "current_mode_update") {
      const currentModeId = update.currentModeId;
      sessions.set(sessionId, {
        ...current,
        mode: typeof currentModeId === "string" ? currentModeId : null,
        status: typeof currentModeId === "string" ? "reported" : "unverified",
        mechanism: "legacy_mode",
      });
      latestSessionId = sessionId;
    }
  }

  const sessionStatuses = [...sessions.values()];
  const latest = latestSessionId ? sessions.get(latestSessionId) : undefined;
  return {
    autonomous: sessionStatuses.some(
      (session) => session.mode === "bypassPermissions",
    ),
    permissionMode: latest?.mode ?? null,
    modeStatus: {
      requestedMode: latest?.requestedMode ?? start.permissionMode,
      status: latest?.status ?? "unverified",
      mechanism: latest?.mechanism ?? null,
      sessionId: latest?.sessionId ?? null,
      sessions: sessionStatuses,
    },
  };
}

function latestRuntimeLifecycle(
  events: readonly ObserverEvent[],
  agentPubkey: string,
): RuntimeLifecycle | null {
  const expectedAgent = agentPubkey.toLowerCase();
  for (const event of ordered(events).reverse()) {
    if (event.kind !== "managed_agent_runtime_lifecycle") continue;
    const payload = record(event.payload);
    if (
      payload &&
      typeof payload.pubkey === "string" &&
      payload.pubkey.toLowerCase() === expectedAgent &&
      typeof payload.relayUrl === "string" &&
      typeof payload.startNonce === "string" &&
      typeof payload.lifecycle === "string"
    ) {
      return {
        lifecycle: payload.lifecycle,
        relayUrl: payload.relayUrl,
        startNonce: payload.startNonce,
      };
    }
  }
  return null;
}

/**
 * Derive requests that belong to this owner, agent, community relay, and the
 * latest ready runtime. Old process events and requests from another community
 * stay hidden; the native broker remains the authority for final approval.
 */
export function deriveAgentPermissionSnapshot({
  activeRelayUrl,
  agentPubkey,
  agentRelayUrl,
  events,
  now = Date.now(),
  ownerPubkey,
}: DeriveSnapshotInput): AgentPermissionSnapshot {
  if (
    !activeRelayUrl ||
    !ownerPubkey ||
    normalizeRelayUrl(activeRelayUrl) !== normalizeRelayUrl(agentRelayUrl)
  ) {
    return EMPTY_SNAPSHOT;
  }

  const sorted = ordered(events);
  const start = latestRuntimeStart(sorted);
  const lifecycle = latestRuntimeLifecycle(sorted, agentPubkey);
  if (
    !start ||
    !lifecycle ||
    lifecycle.lifecycle !== "ready" ||
    lifecycle.startNonce !== start.runtimeStartNonce ||
    normalizeRelayUrl(start.relayUrl) !== normalizeRelayUrl(activeRelayUrl) ||
    normalizeRelayUrl(lifecycle.relayUrl) !== normalizeRelayUrl(activeRelayUrl)
  ) {
    return EMPTY_SNAPSHOT;
  }

  const modeStatus = derivePermissionModeStatus(sorted, start);
  const results = new Set<string>();
  for (const event of sorted) {
    if (event.kind !== "permission_result") continue;
    const payload = record(event.payload);
    if (typeof payload?.requestId === "string") results.add(payload.requestId);
  }

  const requests: ActivePermissionRequest[] = [];
  for (const event of sorted) {
    if (event.kind !== "permission_request") continue;
    const payload = record(event.payload);
    if (!payload || !isPermissionBinding(payload)) continue;
    const binding = payload;
    const eventTime = Date.parse(event.timestamp);
    if (!Number.isFinite(eventTime) || eventTime > now + 5_000) continue;
    if (
      results.has(binding.requestId) ||
      now >= eventTime + PERMISSION_REQUEST_TTL_MS ||
      binding.ownerPubkey.toLowerCase() !== ownerPubkey.toLowerCase() ||
      binding.agentPubkey.toLowerCase() !== agentPubkey.toLowerCase() ||
      binding.relayUrl !== start.relayUrl ||
      normalizeRelayUrl(binding.relayUrl) !==
        normalizeRelayUrl(activeRelayUrl) ||
      binding.runtimeStartNonce !== start.runtimeStartNonce ||
      event.agentIndex !== binding.agentIndex ||
      event.sessionId !== binding.sessionId ||
      event.turnId !== binding.turnId ||
      (event.channelId ?? null) !== binding.channelId
    ) {
      continue;
    }

    const context = payload.context;
    let boundedContext = context;
    try {
      if (JSON.stringify(context).length > 4_096) {
        boundedContext = "Request details omitted because they were too large.";
      }
    } catch {
      boundedContext = "Request details could not be displayed.";
    }
    requests.push({
      binding,
      action: boundedText(
        payload.action,
        "The agent requested tool access.",
        256,
      ),
      context: boundedContext,
      createdAt: eventTime,
      toolName: boundedText(payload.toolName, "Agent tool", 128),
    });
  }

  return { ...modeStatus, requests };
}
