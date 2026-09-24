import * as React from "react";
import { Bot, RefreshCw, Sparkles } from "lucide-react";

import type { CanvasScope } from "@/shared/api/canvasTypes";
import { Button } from "@/shared/ui/button";
import { errorMessage } from "./workspaceModel";
import {
  askMainAgentToBuildSite,
  retrySiteAgentStart,
  SiteAgentStartError,
  type SiteAgentRequestReceipt,
} from "./mainAgent";

export function SiteMainAgentPanel({
  businessChannelId,
  siteChannelId,
  siteTitle,
  scope,
  disabled,
  isDirty,
  renderConversation,
  onMembershipChanged,
  onLoadLatest,
}: {
  businessChannelId: string;
  siteChannelId: string;
  siteTitle: string;
  scope: CanvasScope;
  disabled: boolean;
  isDirty: boolean;
  renderConversation?: (channelId: string) => React.ReactNode;
  onMembershipChanged: () => void;
  onLoadLatest: () => void;
}) {
  const [request, setRequest] = React.useState("");
  const [agentName, setAgentName] = React.useState<string | null>(null);
  const [isSending, setIsSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingStart, setPendingStart] =
    React.useState<SiteAgentRequestReceipt | null>(null);
  const sendingRef = React.useRef(false);

  async function sendRequest() {
    if (
      disabled ||
      isDirty ||
      sendingRef.current ||
      (!pendingStart && !request.trim())
    )
      return;
    sendingRef.current = true;
    setIsSending(true);
    setError(null);
    try {
      const agent = pendingStart
        ? await retrySiteAgentStart(pendingStart)
        : await askMainAgentToBuildSite({
            businessChannelId,
            siteChannelId,
            relayUrl: scope.expectedRelayUrl,
            signerPubkey: scope.expectedSignerPubkey,
            request,
          });
      setAgentName(agent.name);
      setPendingStart(null);
      setRequest("");
      onMembershipChanged();
    } catch (cause) {
      if (cause instanceof SiteAgentStartError) {
        setAgentName(cause.receipt.agent.name);
        setPendingStart(cause.receipt);
        onMembershipChanged();
      }
      setError(errorMessage(cause));
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border/50 bg-card">
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Build with your main agent</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Describe what you want for {siteTitle}. Your main agent uses your
            business context and gets access to this site when you send a
            request.
          </p>
          <label
            className="mt-3 block text-xs font-medium"
            htmlFor={`site-agent-request-${siteChannelId}`}
          >
            What should the site do?
          </label>
          <textarea
            className="mt-1.5 min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled || isSending || pendingStart !== null}
            id={`site-agent-request-${siteChannelId}`}
            maxLength={6000}
            onChange={(event) => {
              setRequest(event.target.value);
              setError(null);
            }}
            placeholder="A warm, simple page introducing our studio and services."
            value={request}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {isDirty
                ? "Save your changes before asking the agent."
                : "Your site stays private until you choose to share it."}
            </p>
            <Button
              disabled={
                disabled ||
                isDirty ||
                isSending ||
                (!pendingStart && !request.trim())
              }
              onClick={() => void sendRequest()}
              size="sm"
            >
              <Sparkles />{" "}
              {isSending
                ? "Sending request…"
                : pendingStart
                  ? "Retry agent"
                  : "Ask main agent"}
            </Button>
          </div>
        </div>
      </div>
      {error ? (
        <p
          className="border-t border-destructive/25 bg-destructive/5 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
          {pendingStart
            ? " Retry starts the agent without sending your request again."
            : ""}
        </p>
      ) : null}
      {agentName ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 bg-muted/15 px-4 py-3">
          <p className="text-xs text-muted-foreground" role="status">
            {pendingStart
              ? "Your request is saved and waiting for the agent."
              : `${agentName} has your request. When the work is saved, load it here to review.`}
          </p>
          <Button
            disabled={disabled || isSending}
            onClick={onLoadLatest}
            size="sm"
            variant="outline"
          >
            <RefreshCw /> Load agent changes
          </Button>
        </div>
      ) : null}
      {agentName && renderConversation ? (
        <div
          className="relative flex h-[28rem] min-h-0 flex-col overflow-hidden border-t border-border/50"
          data-testid="site-agent-conversation"
        >
          {renderConversation(siteChannelId)}
        </div>
      ) : null}
    </section>
  );
}
