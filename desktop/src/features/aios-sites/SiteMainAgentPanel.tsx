import * as React from "react";
import { Bot, Sparkles } from "lucide-react";

import type { CanvasScope } from "@/shared/api/canvasTypes";
import { Button } from "@/shared/ui/button";
import { errorMessage } from "./workspaceModel";
import { askMainAgentToBuildSite, SiteAgentStartError } from "./mainAgent";

export function SiteMainAgentPanel({
  businessChannelId,
  siteChannelId,
  siteTitle,
  scope,
  disabled,
  renderConversation,
  onMembershipChanged,
}: {
  businessChannelId: string;
  siteChannelId: string;
  siteTitle: string;
  scope: CanvasScope;
  disabled: boolean;
  renderConversation?: (channelId: string) => React.ReactNode;
  onMembershipChanged: () => void;
}) {
  const [request, setRequest] = React.useState("");
  const [agentName, setAgentName] = React.useState<string | null>(null);
  const [isSending, setIsSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [acceptedRequest, setAcceptedRequest] = React.useState<string | null>(
    null,
  );
  const [startRetryRequest, setStartRetryRequest] = React.useState<
    string | null
  >(null);
  const currentRequestAccepted = request.trim() === acceptedRequest;
  const needsStartRetry =
    currentRequestAccepted && startRetryRequest === acceptedRequest;

  async function sendRequest() {
    const trimmedRequest = request.trim();
    if (!trimmedRequest || disabled || isSending) return;
    const capturedScope = { ...scope };
    const capturedBusinessChannelId = businessChannelId;
    const capturedSiteChannelId = siteChannelId;
    setIsSending(true);
    setError(null);
    try {
      const agent = await askMainAgentToBuildSite({
        businessChannelId: capturedBusinessChannelId,
        siteChannelId: capturedSiteChannelId,
        relayUrl: capturedScope.expectedRelayUrl,
        signerPubkey: capturedScope.expectedSignerPubkey,
        request: trimmedRequest,
        onMembershipConfirmed: onMembershipChanged,
      });
      setAgentName(agent.name);
      setAcceptedRequest(trimmedRequest);
      setStartRetryRequest(null);
    } catch (cause) {
      if (cause instanceof SiteAgentStartError) {
        setAgentName(cause.agentName);
        setAcceptedRequest(trimmedRequest);
        setStartRetryRequest(trimmedRequest);
      }
      setError(errorMessage(cause));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border/50 bg-card">
      <div className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bot className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">
              Build with your main agent
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Ask for one useful first version of {siteTitle}. This adds the
              configured main agent for this relay to this private site channel
              and sends your request there.
            </p>
            <label
              className="mt-3 block text-xs font-medium"
              htmlFor={`site-agent-request-${siteChannelId}`}
            >
              What should the site do?
            </label>
            <textarea
              className="mt-1.5 min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || isSending}
              id={`site-agent-request-${siteChannelId}`}
              onChange={(event) => {
                setRequest(event.target.value);
                setError(null);
              }}
              placeholder="For example: a clear landing page for our new service, with a simple way to request a consultation."
              value={request}
            />
            <p className="mt-1.5 text-2xs leading-relaxed text-muted-foreground">
              The agent reads the parent business canvas, follows the strict
              Sites document contract, and saves one revision. Publishing stays
              separate.
            </p>
          </div>
        </div>
        <Button
          className="shrink-0"
          disabled={
            disabled ||
            isSending ||
            !request.trim() ||
            (currentRequestAccepted && !needsStartRetry)
          }
          onClick={() => void sendRequest()}
          size="sm"
          variant="outline"
        >
          <Sparkles />
          {isSending
            ? "Sending request…"
            : currentRequestAccepted && needsStartRetry
              ? "Retry agent"
              : currentRequestAccepted
                ? "Request sent"
                : "Ask main agent"}
        </Button>
      </div>
      {error ? (
        <p
          className="border-t border-destructive/25 bg-destructive/5 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          {currentRequestAccepted && needsStartRetry
            ? `${error} Retry to start the agent; the accepted request will not be sent twice.`
            : error}
        </p>
      ) : currentRequestAccepted ? (
        <p
          className="border-t border-border/40 bg-muted/15 px-4 py-2 text-xs text-muted-foreground"
          role="status"
        >
          Request sent to {agentName ?? "your main agent"} in this private site
          channel. Review the saved canvas before previewing it.
        </p>
      ) : null}
      {acceptedRequest !== null && renderConversation ? (
        <div
          className="border-t border-border/50"
          data-testid="site-agent-conversation"
        >
          {renderConversation(siteChannelId)}
        </div>
      ) : null}
    </section>
  );
}
