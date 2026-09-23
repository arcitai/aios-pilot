import * as React from "react";
import { Settings2, Sparkles } from "lucide-react";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { AgentDefaultsDialog } from "@/features/agents/ui/AgentDefaultsDialog";
import { AgentDialog } from "@/features/agents/ui/AgentDialog";
import { pickWelcomeGuideAgentForRelay } from "@/features/onboarding/welcomeGuide";
import type { CanvasScope } from "@/shared/api/canvasTypes";
import { Button } from "@/shared/ui/button";
import { startBusinessConversation } from "./mainAgent";

/** Reuse Buzz's configuration surface without sending users out of their work. */
export function BusinessAgentControls({
  channelId,
  scope,
  started,
  onStarted,
}: {
  channelId: string;
  scope: CanvasScope;
  started: boolean;
  onStarted: () => void;
}) {
  const agents = useManagedAgentsQuery();
  const mainAgent = pickWelcomeGuideAgentForRelay(
    agents.data ?? [],
    scope.expectedRelayUrl,
  );
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [configOpen, setConfigOpen] = React.useState(false);
  const configTrigger = React.useRef<HTMLButtonElement>(null);
  const submitting = React.useRef(false);

  async function begin() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await startBusinessConversation(
        channelId,
        scope.expectedRelayUrl,
        scope.expectedSignerPubkey,
      );
      onStarted();
      await agents.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="business-agent-controls">
      {mainAgent ? (
        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
          <p className="text-sm font-medium">{mainAgent.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {mainAgent.status === "running" || mainAgent.status === "deployed"
              ? "Your main agent is running."
              : "Your main agent is stopped."}
          </p>
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Your main agent has not been set up yet. Check your AI settings, then
          add Fizz from Agents to begin.
        </p>
      )}
      <Button
        className="w-full"
        disabled={
          started ||
          pending ||
          !scope.expectedRelayUrl ||
          !scope.expectedSignerPubkey
        }
        onClick={() => void begin()}
        size="sm"
      >
        <Sparkles />
        {pending
          ? "Inviting your agent…"
          : started
            ? "Ready — continue in the conversation"
            : "Begin with my agent"}
      </Button>
      <Button
        className="w-full"
        disabled={pending || agents.isPending}
        onClick={() => setConfigOpen(true)}
        ref={configTrigger}
        size="sm"
        variant="outline"
      >
        <Settings2 />
        {mainAgent ? "Main agent settings" : "Set up AI"}
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {agents.error ? (
        <p className="text-xs text-destructive" role="alert">
          Could not load your main agent.{" "}
          <button
            className="underline"
            type="button"
            onClick={() => void agents.refetch()}
          >
            Retry
          </button>
        </p>
      ) : null}
      {started ? (
        <p className="text-xs text-muted-foreground" role="status">
          Your request is in the conversation. Your agent needs a working model
          connection to respond.
        </p>
      ) : null}
      {configOpen && mainAgent ? (
        <AgentDialog
          mode="instance-edit"
          agent={mainAgent}
          open
          onOpenChange={setConfigOpen}
          onUpdated={() => void agents.refetch()}
        />
      ) : configOpen ? (
        <AgentDefaultsDialog
          open
          onOpenChange={setConfigOpen}
          returnFocusRef={configTrigger}
        />
      ) : null}
    </div>
  );
}
