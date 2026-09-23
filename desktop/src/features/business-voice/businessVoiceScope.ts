import type { HuddleActiveBinding } from "@/features/huddle/HuddleContext.types";

export interface BusinessVoiceScope {
  channelId: string;
  channelName: string;
  relayUrl: string;
  signerPubkey: string;
  mainAgentPubkey: string;
}

function normalizeRelayUrl(relayUrl: string): string | null {
  try {
    const parsed = new URL(relayUrl.trim());
    const host = parsed.hostname.toLowerCase();
    const isLoopback =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host === "[::1]";
    if (
      (parsed.protocol !== "wss:" &&
        !(parsed.protocol === "ws:" && isLoopback)) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.pathname === "/"
      ? `${parsed.origin}${parsed.search}`
      : parsed.href;
  } catch {
    return null;
  }
}

export function validateBusinessVoiceScope(
  scope: BusinessVoiceScope,
): string | null {
  if (!scope.channelId.trim() || !scope.channelName.trim()) {
    return "Choose a business workspace before starting voice.";
  }
  if (!normalizeRelayUrl(scope.relayUrl)) {
    return "This workspace does not have a valid voice relay.";
  }
  if (!/^[0-9a-f]{64}$/i.test(scope.signerPubkey)) {
    return "The workspace identity is unavailable. Reconnect this workspace and try again.";
  }
  if (!/^[0-9a-f]{64}$/i.test(scope.mainAgentPubkey)) {
    return "The main agent identity is unavailable. Set up a main agent before starting voice.";
  }
  if (
    scope.signerPubkey.toLowerCase() === scope.mainAgentPubkey.toLowerCase()
  ) {
    return "The workspace owner identity cannot be used as its main agent.";
  }
  return null;
}

export function businessVoiceBindingMatches(
  scope: BusinessVoiceScope,
  binding: HuddleActiveBinding | null,
): boolean {
  const expectedRelay = normalizeRelayUrl(scope.relayUrl);
  const activeRelay = binding ? normalizeRelayUrl(binding.relayUrl) : null;
  return Boolean(
    binding &&
      expectedRelay &&
      activeRelay === expectedRelay &&
      binding.parentChannelId === scope.channelId &&
      binding.signerPubkey.toLowerCase() === scope.signerPubkey.toLowerCase() &&
      binding.agentPubkeys.some(
        (pubkey) =>
          pubkey.toLowerCase() === scope.mainAgentPubkey.toLowerCase(),
      ),
  );
}
