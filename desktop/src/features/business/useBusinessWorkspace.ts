import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import { getCanvas, setCanvas } from "@/shared/api/tauri";
import {
  findBusinessWorkspaces,
  initializeBusinessWorkspace,
  loadBusinessWorkspace,
} from "./workspace";
import { serializeBusinessDocument, type BusinessDocument } from "./document";

export function useBusinessWorkspace(contextId?: string) {
  const { activeCommunity } = useCommunities();
  const identity = useIdentityQuery();
  const client = useQueryClient();
  const scope = [activeCommunity?.relayUrl, identity.data?.pubkey];
  const canvasScope = {
    expectedRelayUrl: activeCommunity?.relayUrl ?? "",
    expectedSignerPubkey: identity.data?.pubkey ?? "",
  };
  const [selectedId, setSelectedId] = React.useState<string | null>(
    contextId ?? null,
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const channels = useQuery({
    queryKey: ["business-workspaces", ...scope],
    queryFn: findBusinessWorkspaces,
    enabled: Boolean(scope[0] && scope[1]),
  });
  // An explicit resource link must never fall back to a different company's data.
  const channel = selectedId
    ? channels.data?.find((item) => item.id === selectedId)
    : channels.data?.[0];
  const unavailable = Boolean(selectedId && channels.isSuccess && !channel);
  const contextKey = ["business-context", ...scope, channel?.id];
  const context = useQuery({
    queryKey: contextKey,
    queryFn: () => loadBusinessWorkspace(channel?.id ?? "", canvasScope),
    enabled: Boolean(channel && scope[0] && scope[1]),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  // Watch the revision separately. Updating the editor's base in the background
  // would let an old draft overwrite an agent's newer context without conflict.
  const remoteHead = useQuery({
    queryKey: [
      "business-context-head",
      ...scope,
      channel?.id,
      context.data?.revision,
    ],
    queryFn: async () =>
      (await getCanvas(channel?.id ?? "", canvasScope)).eventId ?? "none",
    enabled: Boolean(channel && context.data?.document && scope[0] && scope[1]),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    gcTime: 30_000,
    retry: 1,
  });

  async function initialize(name: string) {
    if (unavailable) {
      setError("This business context is no longer available to your account.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await initializeBusinessWorkspace(
        name,
        canvasScope,
        channel?.id,
      );
      setSelectedId(created.id);
      await client.invalidateQueries({
        queryKey: ["business-workspaces", ...scope],
      });
      await client.invalidateQueries({ queryKey: ["channels"] });
      await client.invalidateQueries({
        queryKey: ["business-context", ...scope],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      // A channel may already be durable even when seeding failed. Discover it
      // before offering retry so the same private workspace can be recovered.
      await channels.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function save(document: BusinessDocument) {
    if (!channel || !context.data)
      throw new Error("Load the workspace before saving.");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await setCanvas({
        ...canvasScope,
        channelId: channel.id,
        content: serializeBusinessDocument(document),
        expectedRevision: context.data.revision,
      });
      await context.refetch();
      if (!result.verified)
        setNotice(
          "Saved to the relay. Verification is unavailable; reload before making another change.",
        );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      throw cause;
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    const result = await context.refetch();
    if (result.error) return false;
    setError(null);
    setNotice(null);
    return true;
  }

  return {
    channel,
    channels,
    context,
    busy,
    error: unavailable
      ? "This business context is no longer available to your account."
      : error,
    unavailable,
    notice,
    initialize,
    save,
    reload,
    setSelectedId,
    relayUrl: activeCommunity?.relayUrl,
    pubkey: identity.data?.pubkey,
    canvasScope,
    hasRemoteUpdate:
      remoteHead.data !== undefined &&
      remoteHead.data !== context.data?.revision,
  };
}
