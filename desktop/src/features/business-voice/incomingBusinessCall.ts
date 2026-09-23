export const BUSINESS_CALL_TTL_MAX_SECONDS = 60;
export const BUSINESS_CALL_CLOCK_SKEW_SECONDS = 5;
export const BUSINESS_CALL_RATE_WINDOW_SECONDS = 60;
export const BUSINESS_CALL_RATE_LIMIT = 3;
export const BUSINESS_CALL_RATE_LIMIT_ENTRIES = 256;
export const BUSINESS_CALL_PENDING_LIMIT = 8;
export const BUSINESS_CALL_DEDUPE_LIMIT = 256;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/i;

export type BusinessVoiceCallRequest = {
  type: "call_request";
  version: 1;
  requestId: string;
  ownerPubkey: string;
  agentPubkey: string;
  relayUrl: string;
  runtimeStartNonce: string;
  channelId: string;
  createdAt: number;
  expiresAt: number;
};

export type BusinessVoiceCallDecision = Omit<
  BusinessVoiceCallRequest,
  "type"
> & {
  type: "call_decision";
  decision: "accept" | "decline";
};

export type IncomingBusinessCall = BusinessVoiceCallRequest & {
  agentName: string;
  channelName: string;
};

export type CallRequestEnvelope = {
  eventKind: number;
  eventPubkey: string;
  eventCreatedAt: number;
  eventTags: string[][];
  ownerPubkey: string;
  relayUrl: string;
  agentPubkey: string;
  runtimeStartNonce: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  );
}

/** Canonicalize relay schemes while rejecting cleartext remote relays. */
export function normalizeCallRelayUrl(relayUrl: string): string | null {
  try {
    const parsed = new URL(relayUrl.trim());
    if (!parsed.hostname || parsed.username || parsed.password || parsed.hash) {
      return null;
    }

    const host = parsed.hostname.toLowerCase();
    const isLoopback =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host === "[::1]";
    const protocol =
      parsed.protocol === "https:"
        ? "wss:"
        : parsed.protocol === "http:"
          ? "ws:"
          : parsed.protocol;
    if (
      (protocol !== "wss:" && !(protocol === "ws:" && isLoopback)) ||
      (protocol === "ws:" && !isLoopback)
    ) {
      return null;
    }

    const path =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return `${protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return null;
  }
}

function singleTagValue(tags: string[][], name: string): string | null {
  const matches = tags.filter((tag) => tag[0] === name);
  return matches.length === 1 && matches[0].length === 2 ? matches[0][1] : null;
}

/**
 * Validate a decrypted agent call request against its signed Nostr envelope,
 * current owner/relay, and the runtime that is currently ready for this agent.
 * Call only after native `decrypt_observer_event` has verified ID/signature.
 */
export function parseIncomingBusinessCallRequest(
  value: unknown,
  envelope: CallRequestEnvelope,
  nowSeconds: number,
): BusinessVoiceCallRequest | null {
  const payload = record(value);
  if (
    payload?.type !== "call_request" ||
    payload.version !== 1 ||
    envelope.eventKind !== 24200 ||
    !PUBKEY_PATTERN.test(envelope.ownerPubkey) ||
    !PUBKEY_PATTERN.test(envelope.agentPubkey) ||
    !PUBKEY_PATTERN.test(envelope.eventPubkey)
  ) {
    return null;
  }

  const ownerPubkey = payload.ownerPubkey;
  const agentPubkey = payload.agentPubkey;
  const relayUrl = payload.relayUrl;
  const requestId = payload.requestId;
  const runtimeStartNonce = payload.runtimeStartNonce;
  const channelId = payload.channelId;
  const createdAt = payload.createdAt;
  const expiresAt = payload.expiresAt;
  const relay =
    typeof relayUrl === "string" ? normalizeCallRelayUrl(relayUrl) : null;
  const expectedRelay = normalizeCallRelayUrl(envelope.relayUrl);

  if (
    typeof ownerPubkey !== "string" ||
    ownerPubkey.toLowerCase() !== envelope.ownerPubkey.toLowerCase() ||
    typeof agentPubkey !== "string" ||
    agentPubkey.toLowerCase() !== envelope.agentPubkey.toLowerCase() ||
    agentPubkey.toLowerCase() !== envelope.eventPubkey.toLowerCase() ||
    singleTagValue(envelope.eventTags, "p")?.toLowerCase() !==
      envelope.ownerPubkey.toLowerCase() ||
    singleTagValue(envelope.eventTags, "agent")?.toLowerCase() !==
      envelope.agentPubkey.toLowerCase() ||
    singleTagValue(envelope.eventTags, "frame") !== "control" ||
    !relay ||
    relay !== expectedRelay ||
    !validText(requestId, 80) ||
    !UUID_PATTERN.test(requestId) ||
    !validText(runtimeStartNonce, 256) ||
    runtimeStartNonce !== envelope.runtimeStartNonce ||
    typeof channelId !== "string" ||
    !UUID_PATTERN.test(channelId) ||
    !Number.isSafeInteger(createdAt) ||
    !Number.isSafeInteger(expiresAt) ||
    !Number.isSafeInteger(envelope.eventCreatedAt) ||
    !Number.isSafeInteger(nowSeconds)
  ) {
    return null;
  }

  const ttlSeconds = (expiresAt as number) - (createdAt as number);
  if (
    ttlSeconds <= 0 ||
    ttlSeconds > BUSINESS_CALL_TTL_MAX_SECONDS ||
    (createdAt as number) > nowSeconds + BUSINESS_CALL_CLOCK_SKEW_SECONDS ||
    Math.abs((envelope.eventCreatedAt as number) - (createdAt as number)) >
      BUSINESS_CALL_CLOCK_SKEW_SECONDS ||
    nowSeconds >= (expiresAt as number)
  ) {
    return null;
  }

  return {
    type: "call_request",
    version: 1,
    requestId,
    ownerPubkey,
    agentPubkey,
    relayUrl: relay,
    runtimeStartNonce,
    channelId,
    createdAt: createdAt as number,
    expiresAt: expiresAt as number,
  };
}

/** Build the owner response from protocol fields only. */
export function createBusinessVoiceCallDecision(
  request: BusinessVoiceCallRequest,
  decision: "accept" | "decline",
): BusinessVoiceCallDecision {
  return {
    type: "call_decision",
    version: request.version,
    requestId: request.requestId,
    decision,
    ownerPubkey: request.ownerPubkey,
    agentPubkey: request.agentPubkey,
    relayUrl: request.relayUrl,
    runtimeStartNonce: request.runtimeStartNonce,
    channelId: request.channelId,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
  };
}

/** Verify an owner decision carries the exact binding and remains unexpired. */
export function isMatchingBusinessVoiceCallDecision(
  value: unknown,
  request: BusinessVoiceCallRequest,
  envelope: Pick<
    CallRequestEnvelope,
    "eventKind" | "eventPubkey" | "eventCreatedAt" | "eventTags"
  >,
  nowSeconds: number,
): value is BusinessVoiceCallDecision {
  const payload = record(value);
  if (
    payload?.type !== "call_decision" ||
    payload.version !== 1 ||
    (payload.decision !== "accept" && payload.decision !== "decline") ||
    envelope.eventKind !== 24200 ||
    envelope.eventPubkey.toLowerCase() !== request.ownerPubkey.toLowerCase() ||
    singleTagValue(envelope.eventTags, "p")?.toLowerCase() !==
      request.agentPubkey.toLowerCase() ||
    singleTagValue(envelope.eventTags, "agent")?.toLowerCase() !==
      request.agentPubkey.toLowerCase() ||
    singleTagValue(envelope.eventTags, "frame") !== "control" ||
    !Number.isSafeInteger(envelope.eventCreatedAt)
  ) {
    return false;
  }

  return (
    payload.requestId === request.requestId &&
    typeof payload.ownerPubkey === "string" &&
    payload.ownerPubkey.toLowerCase() === request.ownerPubkey.toLowerCase() &&
    typeof payload.agentPubkey === "string" &&
    payload.agentPubkey.toLowerCase() === request.agentPubkey.toLowerCase() &&
    typeof payload.relayUrl === "string" &&
    normalizeCallRelayUrl(payload.relayUrl) ===
      normalizeCallRelayUrl(request.relayUrl) &&
    payload.runtimeStartNonce === request.runtimeStartNonce &&
    payload.channelId === request.channelId &&
    payload.createdAt === request.createdAt &&
    payload.expiresAt === request.expiresAt &&
    Number.isSafeInteger(nowSeconds) &&
    (envelope.eventCreatedAt as number) >=
      request.createdAt - BUSINESS_CALL_CLOCK_SKEW_SECONDS &&
    (envelope.eventCreatedAt as number) <=
      Math.min(
        request.expiresAt + BUSINESS_CALL_CLOCK_SKEW_SECONDS,
        nowSeconds + BUSINESS_CALL_CLOCK_SKEW_SECONDS,
      ) &&
    nowSeconds < request.expiresAt
  );
}

export function latestReadyRuntimeNonce(
  events: readonly {
    kind: string;
    timestamp: string;
    seq: number;
    payload: unknown;
  }[],
  agentPubkey: string,
  relayUrl: string,
): string | null {
  const expectedAgent = agentPubkey.toLowerCase();
  const expectedRelay = normalizeCallRelayUrl(relayUrl);
  const lifecycleEvents = events
    .filter((event) => event.kind === "managed_agent_runtime_lifecycle")
    .sort((left, right) => {
      const leftTime = Date.parse(left.timestamp);
      const rightTime = Date.parse(right.timestamp);
      return Number.isFinite(leftTime) && Number.isFinite(rightTime)
        ? leftTime - rightTime || left.seq - right.seq
        : left.seq - right.seq;
    });

  for (const event of lifecycleEvents.reverse()) {
    const payload = record(event.payload);
    if (
      payload &&
      typeof payload.pubkey === "string" &&
      payload.pubkey.toLowerCase() === expectedAgent &&
      typeof payload.relayUrl === "string" &&
      normalizeCallRelayUrl(payload.relayUrl) === expectedRelay
    ) {
      return payload.lifecycle === "ready" && validText(payload.startNonce, 256)
        ? payload.startNonce
        : null;
    }
  }
  return null;
}

export type CallAdmission = "reserved" | "duplicate" | "rate-limited" | "full";

/** Bounded in-memory dedupe, per-agent rate limit, and pending call queue. */
export class IncomingBusinessCallInbox {
  private readonly pending = new Map<string, IncomingBusinessCall>();
  private readonly inFlight = new Map<string, BusinessVoiceCallRequest>();
  private readonly seen = new Map<string, number>();
  private readonly requestTimes = new Map<string, number[]>();

  reserve(
    request: BusinessVoiceCallRequest,
    nowSeconds: number,
  ): CallAdmission {
    this.expire(nowSeconds);
    if (this.seen.has(request.requestId)) return "duplicate";

    this.seen.set(request.requestId, request.expiresAt);
    while (this.seen.size > BUSINESS_CALL_DEDUPE_LIMIT) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }

    const agentKey = request.agentPubkey.toLowerCase();
    if (
      !this.requestTimes.has(agentKey) &&
      this.requestTimes.size >= BUSINESS_CALL_RATE_LIMIT_ENTRIES
    ) {
      return "rate-limited";
    }
    const recent = (this.requestTimes.get(agentKey) ?? []).filter(
      (time) => time > nowSeconds - BUSINESS_CALL_RATE_WINDOW_SECONDS,
    );
    this.requestTimes.set(agentKey, recent);
    if (recent.length >= BUSINESS_CALL_RATE_LIMIT) return "rate-limited";
    recent.push(nowSeconds);

    if (this.pending.size + this.inFlight.size >= BUSINESS_CALL_PENDING_LIMIT) {
      return "full";
    }
    this.inFlight.set(request.requestId, request);
    return "reserved";
  }

  commit(request: IncomingBusinessCall, nowSeconds: number): boolean {
    if (!this.inFlight.delete(request.requestId)) return false;
    if (request.expiresAt <= nowSeconds) return false;
    this.pending.set(request.requestId, request);
    return true;
  }

  clear(): void {
    this.pending.clear();
    this.inFlight.clear();
    this.seen.clear();
    this.requestTimes.clear();
  }

  release(requestId: string): void {
    this.inFlight.delete(requestId);
  }

  remove(requestId: string): void {
    this.pending.delete(requestId);
    this.inFlight.delete(requestId);
  }

  expire(nowSeconds: number): IncomingBusinessCall[] {
    const expired: IncomingBusinessCall[] = [];
    for (const [requestId, request] of this.pending) {
      if (request.expiresAt <= nowSeconds) {
        expired.push(request);
        this.pending.delete(requestId);
      }
    }
    for (const [requestId, request] of this.inFlight) {
      if (request.expiresAt <= nowSeconds) this.inFlight.delete(requestId);
    }
    for (const [requestId, expiresAt] of this.seen) {
      if (expiresAt <= nowSeconds) this.seen.delete(requestId);
    }
    for (const [agent, times] of this.requestTimes) {
      const recent = times.filter(
        (time) => time > nowSeconds - BUSINESS_CALL_RATE_WINDOW_SECONDS,
      );
      if (recent.length === 0) this.requestTimes.delete(agent);
      else this.requestTimes.set(agent, recent);
    }
    return expired;
  }

  list(): IncomingBusinessCall[] {
    return [...this.pending.values()].sort(
      (left, right) => left.createdAt - right.createdAt,
    );
  }
}
