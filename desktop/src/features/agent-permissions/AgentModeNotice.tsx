import type { ManagedAgent } from "@/shared/api/types";
import type { AgentPermissionSnapshot } from "./permissionRequests";

/** Describe provider-reported state without treating a startup request as proof. */
export function AgentModeNotice({
  agents,
  snapshots,
}: {
  agents: readonly ManagedAgent[];
  snapshots: Record<string, AgentPermissionSnapshot>;
}) {
  const notices = agents.flatMap((agent) => {
    const snapshot = snapshots[agent.pubkey.toLowerCase()];
    if (!snapshot) return [];
    const sessions = snapshot.modeStatus.sessions;
    if (snapshot.modeStatus.requestedMode === null && sessions.length === 0)
      return [];
    const rejected = sessions.some((session) => session.status === "rejected");
    const unsupported = sessions.some(
      (session) => session.status === "unsupported",
    );
    const unknown =
      sessions.length === 0 ||
      sessions.some((session) => session.mode === null);
    const message = snapshot.autonomous
      ? "Can use tools without asking for approval."
      : rejected
        ? "The AI provider rejected the approval setting."
        : unsupported
          ? "The AI provider does not support this approval setting."
          : unknown
            ? "The AI provider has not confirmed its approval setting."
            : null;
    return message ? [{ pubkey: agent.pubkey, name: agent.name, message }] : [];
  });
  if (notices.length === 0) return null;

  return (
    <details
      className="fixed bottom-4 right-4 z-40 max-w-sm rounded-xl border border-amber-500/50 bg-background/95 px-4 py-3 text-sm shadow-lg"
      data-testid="agent-tool-mode-notice"
    >
      <summary className="cursor-pointer font-medium text-amber-700 dark:text-amber-300">
        Check tool access · {notices.length}{" "}
        {notices.length === 1 ? "agent" : "agents"}
      </summary>
      <ul className="mt-3 max-h-48 space-y-3 overflow-auto" aria-live="polite">
        {notices.map((notice) => (
          <li key={notice.pubkey}>
            <p className="font-medium">{notice.name}</p>
            <p className="mt-1 text-muted-foreground">{notice.message}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        Requests sent to Buzz still require your decision. Other tool access
        depends on the AI provider’s settings.
      </p>
    </details>
  );
}
