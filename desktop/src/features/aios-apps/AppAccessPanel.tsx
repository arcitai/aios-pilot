import { useCallback, useEffect, useRef, useState } from "react";

import { canonicalRelayUrl } from "@/features/agents/managedAgentRuntimeStatus";
import { Button } from "@/shared/ui/button";
import {
  addChannelMembers,
  getRelayWsUrl,
  listManagedAgents,
} from "@/shared/api/tauri";
import { getIdentity } from "@/shared/api/tauriIdentity";
import type { ManagedAgent } from "@/shared/api/types";
import { canvasAppDocumentStore, type AppChannelAccess } from "./canvasStore";
import type { AppDocumentScope } from "./storage";
import type { AppId } from "./types";

const FIZZ_PERSONA_ID = "builtin:fizz";

type AppAccessPanelProps = {
  appId: AppId;
  scope: AppDocumentScope | null;
  enabled: boolean;
};

type AccessState = {
  access: AppChannelAccess;
  fizzAgents: ManagedAgent[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "App access could not be loaded.";
}

function displayMember(pubkey: string, name: string | null): string {
  if (name?.trim()) return name.trim();
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-8)}`;
}

async function assertCapturedScope(scope: AppDocumentScope): Promise<void> {
  const [relayUrl, identity] = await Promise.all([
    getRelayWsUrl(),
    getIdentity(),
  ]);
  const expectedRelay = canonicalRelayUrl(scope.expectedRelayUrl);
  const activeRelay = canonicalRelayUrl(relayUrl);
  const relayMatches =
    expectedRelay !== null && activeRelay !== null
      ? expectedRelay === activeRelay
      : scope.expectedRelayUrl === relayUrl;
  if (
    !relayMatches ||
    identity.pubkey.toLowerCase() !==
      scope.expectedSignerPubkey.trim().toLowerCase()
  ) {
    throw new Error(
      "The active relay or identity changed. Reopen app access in the current workspace.",
    );
  }
}

export function AppAccessPanel({ appId, scope, enabled }: AppAccessPanelProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AccessState | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [selectedFizzPubkey, setSelectedFizzPubkey] = useState("");
  const generationRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return null;
    const generation = ++generationRef.current;
    if (!enabled) {
      setState(null);
      setError(
        "Access management is available while shared app storage is active.",
      );
      return null;
    }
    if (!scope) {
      setState(null);
      setError("An active relay and signer are required to manage app access.");
      return null;
    }

    setLoading(true);
    setError("");
    try {
      await assertCapturedScope(scope);
      const [access, managedAgents] = await Promise.all([
        canvasAppDocumentStore.getAppAccess(scope, appId),
        listManagedAgents(),
      ]);
      await assertCapturedScope(scope);
      if (!mountedRef.current || generationRef.current !== generation) {
        return null;
      }

      const currentRelay = canonicalRelayUrl(scope.expectedRelayUrl);
      const fizzAgents = managedAgents.filter(
        (agent) =>
          agent.personaId === FIZZ_PERSONA_ID &&
          currentRelay !== null &&
          canonicalRelayUrl(agent.relayUrl) === currentRelay,
      );
      const next = { access, fizzAgents };
      setState(next);
      setSelectedFizzPubkey((current) =>
        fizzAgents.some((agent) => agent.pubkey === current)
          ? current
          : fizzAgents.length === 1
            ? fizzAgents[0].pubkey
            : "",
      );
      return next;
    } catch (loadError) {
      if (mountedRef.current && generationRef.current === generation) {
        setState(null);
        setError(errorMessage(loadError));
      }
      return null;
    } finally {
      if (mountedRef.current && generationRef.current === generation) {
        setLoading(false);
      }
    }
  }, [appId, enabled, scope]);

  useEffect(() => {
    if (open && enabled) void refresh();
    return () => {
      generationRef.current += 1;
    };
  }, [enabled, open, refresh]);

  async function createPrivateChannel() {
    const capturedScope = scope;
    const capturedAppId = appId;
    if (!capturedScope) return;
    setWorking(true);
    setError("");
    try {
      await canvasAppDocumentStore.ensureAppChannelForAccess(
        capturedScope,
        capturedAppId,
      );
      if (!mountedRef.current) return;
      await refresh();
    } catch (createError) {
      if (mountedRef.current) setError(errorMessage(createError));
    } finally {
      if (mountedRef.current) setWorking(false);
    }
  }

  async function inviteFizz() {
    const capturedScope = scope;
    const capturedAppId = appId;
    const capturedState = state;
    if (!capturedScope || !capturedState?.access.channel) return;
    const fizz = capturedState.fizzAgents.find(
      (agent) => agent.pubkey === selectedFizzPubkey,
    );
    if (!fizz) {
      setError("Choose the Fizz agent from this relay first.");
      return;
    }

    setWorking(true);
    setError("");
    try {
      const channel = await canvasAppDocumentStore.ensureAppChannelForAccess(
        capturedScope,
        capturedAppId,
      );
      if (!mountedRef.current) return;
      const alreadyMember = channel.memberPubkeys.some(
        (pubkey) => pubkey.toLowerCase() === fizz.pubkey.toLowerCase(),
      );
      if (!alreadyMember) {
        const result = await addChannelMembers({
          channelId: channel.id,
          pubkeys: [fizz.pubkey],
          role: "bot",
          expectedRelayUrl: capturedScope.expectedRelayUrl,
          expectedSignerPubkey: capturedScope.expectedSignerPubkey,
        });
        if (!mountedRef.current) return;
        const failure = result.errors.find(
          (entry) => entry.pubkey.toLowerCase() === fizz.pubkey.toLowerCase(),
        );
        if (failure) throw new Error(failure.error);
      }

      if (!mountedRef.current) return;
      const updated = await refresh();
      if (!mountedRef.current) return;
      const nowMember = updated?.access.members.some(
        (member) => member.pubkey.toLowerCase() === fizz.pubkey.toLowerCase(),
      );
      if (!nowMember) {
        throw new Error(
          "The relay has not confirmed Fizz in this app’s access list yet. Refresh to check again.",
        );
      }
    } catch (inviteError) {
      if (mountedRef.current) setError(errorMessage(inviteError));
    } finally {
      if (mountedRef.current) setWorking(false);
    }
  }

  const members = state?.access.members ?? [];
  const channel = state?.access.channel ?? null;
  const selectedFizz = state?.fizzAgents.find(
    (agent) => agent.pubkey === selectedFizzPubkey,
  );
  const fizzAlreadyHasAccess =
    selectedFizz !== undefined &&
    members.some(
      (member) =>
        member.pubkey.toLowerCase() === selectedFizz.pubkey.toLowerCase(),
    );

  return (
    <details
      className="aios-app-access"
      data-testid={`aios-app-access-${appId}`}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>App access</summary>
      <div className="aios-app-access-panel">
        {!enabled ? (
          <p>
            Access management is available while shared app storage is active.
          </p>
        ) : loading && !state ? (
          <p role="status">Loading who has access…</p>
        ) : error && !state ? (
          <p role="alert">{error}</p>
        ) : !channel ? (
          <>
            <p>
              This app does not have a private access channel yet. Creating it
              will not add anyone else.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={working || loading}
              onClick={() => void createPrivateChannel()}
              data-testid={`aios-app-access-create-${appId}`}
            >
              {working ? "Creating…" : "Create private app channel"}
            </Button>
          </>
        ) : (
          <>
            <p className="aios-app-access-count">
              {members.length} {members.length === 1 ? "person" : "people"} can
              access this app.
            </p>
            <ul aria-label="People with app access">
              {members.map((member) => (
                <li key={member.pubkey}>
                  <span>
                    {displayMember(member.pubkey, member.displayName)}
                  </span>
                  <span>{member.isAgent ? "Agent" : member.role}</span>
                </li>
              ))}
            </ul>
            {state?.fizzAgents.length ? (
              <div className="aios-app-access-invite">
                {state.fizzAgents.length > 1 ? (
                  <label>
                    Choose Fizz
                    <select
                      value={selectedFizzPubkey}
                      onChange={(event) =>
                        setSelectedFizzPubkey(event.currentTarget.value)
                      }
                      disabled={working}
                    >
                      <option value="">Select an agent</option>
                      {state.fizzAgents.map((agent) => (
                        <option key={agent.pubkey} value={agent.pubkey}>
                          {agent.name} · {agent.pubkey.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    working ||
                    !selectedFizz ||
                    fizzAlreadyHasAccess ||
                    (state.fizzAgents.length > 1 && !selectedFizzPubkey)
                  }
                  onClick={() => void inviteFizz()}
                  data-testid={`aios-app-access-invite-${appId}`}
                >
                  {fizzAlreadyHasAccess
                    ? "Fizz already has access"
                    : "Let my main agent help"}
                </Button>
              </div>
            ) : (
              <p>No Fizz agent is set up on this relay yet.</p>
            )}
          </>
        )}
        {error && state ? <p role="alert">{error}</p> : null}
        {state && enabled ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={working || loading}
            onClick={() => void refresh()}
          >
            Refresh access list
          </Button>
        ) : null}
      </div>
    </details>
  );
}
