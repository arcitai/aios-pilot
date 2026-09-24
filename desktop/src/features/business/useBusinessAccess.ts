import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addChannelMembers, getChannelMembers } from "@/shared/api/tauri";
import { removeChannelMember } from "@/shared/api/tauriChannelMemberships";
import { searchUsers } from "@/shared/api/tauriProfiles";
import type { CanvasScope } from "@/shared/api/canvasTypes";

/** Context membership stays scoped to its own private group, never a work channel. */
export function useBusinessAccess(contextId: string, scope: CanvasScope) {
  const client = useQueryClient();
  const [query, setQuery] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [verificationPending, setVerificationPending] = React.useState(false);
  const mounted = React.useRef(false);
  const writing = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const scopeKey = [scope.expectedRelayUrl, scope.expectedSignerPubkey];
  const members = useQuery({
    queryKey: ["business-access", ...scopeKey, contextId],
    queryFn: () => getChannelMembers(contextId, scope),
    refetchOnMount: "always",
    refetchInterval: pending ? false : 10_000,
    retry: 1,
  });
  const self = members.data?.find(
    (member) =>
      member.pubkey.toLowerCase() === scope.expectedSignerPubkey.toLowerCase(),
  );
  const canManage =
    !members.isError && (self?.role === "owner" || self?.role === "admin");
  const people = useQuery({
    queryKey: ["business-access-people", ...scopeKey, search],
    queryFn: () => searchUsers(search, 12, null, scope),
    enabled: canManage && search.length >= 2,
    retry: 1,
    staleTime: 0,
  });
  const existing = new Set(members.data?.map((member) => member.pubkey));
  const candidates =
    query.trim() === search && !people.isError
      ? (people.data?.users ?? []).filter(
          (person) =>
            !person.isAgent &&
            !person.ownerPubkey &&
            !existing.has(person.pubkey),
        )
      : [];

  async function changeAccess(pubkey: string, action: "grant" | "remove") {
    if (
      writing.current ||
      !canManage ||
      members.isFetching ||
      verificationPending
    )
      return false;
    writing.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    let accepted = false;
    try {
      if (action === "grant") {
        const result = await addChannelMembers({
          ...scope,
          channelId: contextId,
          pubkeys: [pubkey],
          role: "member",
        });
        if (result.errors.length || !result.added.includes(pubkey)) {
          throw new Error(
            result.errors[0]?.error ?? "Access was not granted. Try again.",
          );
        }
      } else {
        await removeChannelMember(contextId, pubkey, scope);
      }
      accepted = true;
      await client.invalidateQueries({ queryKey: ["channels"] });
      const refreshed = await members.refetch();
      if (refreshed.error) throw refreshed.error;
      const present = refreshed.data?.some(
        (member) => member.pubkey === pubkey,
      );
      if (present !== (action === "grant")) {
        throw new Error("The updated access could not be confirmed.");
      }
      if (mounted.current) {
        setNotice(action === "grant" ? "Access granted." : "Access removed.");
        setQuery("");
      }
      return true;
    } catch (cause) {
      if (mounted.current) {
        setVerificationPending(accepted);
        const detail = cause instanceof Error ? cause.message : String(cause);
        setError(
          accepted
            ? `The host accepted the change, but verification failed. Refresh access before retrying. ${detail}`
            : detail,
        );
      }
      return false;
    } finally {
      writing.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function refresh() {
    const result = await members.refetch();
    if (result.error || !mounted.current) return false;
    setError(null);
    setNotice(null);
    setVerificationPending(false);
    return true;
  }

  return {
    members,
    canManage,
    candidates,
    people,
    query,
    setQuery,
    search,
    pending,
    error,
    notice,
    refresh,
    verificationPending,
    changeAccess,
  };
}
