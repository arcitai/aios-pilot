import * as React from "react";
import { Bot, RefreshCw, Sparkles } from "lucide-react";

import type { CanvasScope } from "@/shared/api/canvasTypes";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import {
  AppAgentStartError,
  askMainAgentToBuildApp,
  retryAppAgentStart,
  type AppAgentRequestReceipt,
} from "./appMainAgent";
import type { AppId } from "./types";

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request could not be sent.";
}

export function AppMainAgentPanel({
  appId,
  appTitle,
  businessChannelId,
  scope,
  disabled,
  sharedStorageActive,
  isDirty,
  renderConversation,
  onLoadLatest,
}: {
  appId: AppId;
  appTitle: string;
  businessChannelId: string;
  scope: CanvasScope | null;
  disabled: boolean;
  sharedStorageActive: boolean;
  isDirty: boolean;
  renderConversation?: (channelId: string) => React.ReactNode;
  onLoadLatest: () => void;
}) {
  const [request, setRequest] = React.useState("");
  const [agentName, setAgentName] = React.useState<string | null>(null);
  const [appChannelId, setAppChannelId] = React.useState<string | null>(null);
  const [pendingStart, setPendingStart] =
    React.useState<AppAgentRequestReceipt | null>(null);
  const [isSending, setIsSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const sendingRef = React.useRef(false);
  const panelId = `apps-main-agent-request-${appId}`;

  async function sendRequest() {
    if (
      disabled ||
      !sharedStorageActive ||
      isDirty ||
      !scope ||
      sendingRef.current ||
      (!pendingStart && !request.trim())
    ) {
      return;
    }

    sendingRef.current = true;
    setIsSending(true);
    setError(null);
    try {
      const result = pendingStart
        ? {
            agent: await retryAppAgentStart(pendingStart),
            appChannelId: pendingStart.appChannelId,
          }
        : await askMainAgentToBuildApp({
            businessChannelId,
            appId,
            relayUrl: scope.expectedRelayUrl,
            signerPubkey: scope.expectedSignerPubkey,
            request,
          }).then(({ agent, appChannel }) => ({
            agent,
            appChannelId: appChannel.id,
          }));
      setAgentName(result.agent.name);
      setAppChannelId(result.appChannelId);
      setPendingStart(null);
      setRequest("");
    } catch (cause) {
      if (cause instanceof AppAgentStartError) {
        setAgentName(cause.receipt.agent.name);
        setAppChannelId(cause.receipt.appChannelId);
        setPendingStart(cause.receipt);
      }
      setError(errorMessage(cause));
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }

  const unavailable = disabled || !sharedStorageActive || !scope;
  const sendDisabled =
    unavailable || isDirty || isSending || (!pendingStart && !request.trim());

  return (
    <section
      className="overflow-hidden rounded-xl border border-border/50 bg-card"
      data-testid={`apps-main-agent-${appId}`}
    >
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Build with your main agent</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Describe what you want for {appTitle}. Your main agent can use your
            business context and this app’s private channel.
          </p>
          <label className="mt-3 block text-xs font-medium" htmlFor={panelId}>
            What should it create?
          </label>
          <Textarea
            className="mt-1.5 min-h-20 resize-y text-sm"
            disabled={unavailable || isSending || pendingStart !== null}
            id={panelId}
            maxLength={6000}
            onChange={(event) => {
              setRequest(event.currentTarget.value);
              setError(null);
            }}
            placeholder={`A useful ${appTitle.toLowerCase()} for our business.`}
            value={request}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {!sharedStorageActive
                ? "Reconnect shared app storage to work with your agent."
                : disabled
                  ? "Resolve the app storage issue above before asking."
                  : !scope
                    ? "Connect a relay and identity to ask your agent."
                    : isDirty
                      ? "Save your edits before asking the agent."
                      : "Only your main agent is added to this app channel."}
            </p>
            <Button
              disabled={sendDisabled}
              onClick={() => void sendRequest()}
              size="sm"
              type="button"
            >
              <Sparkles aria-hidden="true" />
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
      {agentName && appChannelId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 bg-muted/15 px-4 py-3">
          <p className="text-xs text-muted-foreground" role="status">
            {pendingStart
              ? "Your request is saved and waiting for the agent."
              : `${agentName} has your request. Load its changes here when they are ready.`}
          </p>
          <Button
            disabled={
              unavailable || isDirty || isSending || pendingStart !== null
            }
            onClick={() => {
              if (!isDirty) onLoadLatest();
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            <RefreshCw aria-hidden="true" /> Load agent changes
          </Button>
        </div>
      ) : null}
      {agentName && appChannelId && renderConversation ? (
        <div
          className="relative flex h-[24rem] min-h-0 flex-col overflow-hidden border-t border-border/50"
          data-testid={`apps-main-agent-conversation-${appId}`}
        >
          {renderConversation(appChannelId)}
        </div>
      ) : null}
    </section>
  );
}
