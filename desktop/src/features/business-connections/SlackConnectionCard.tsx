import * as React from "react";

import type {
  BusinessConnectionScope,
  BusinessConnectionSource,
  SlackChannel,
} from "@/shared/api/tauriBusinessConnections";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  checkingSlackStatus,
  reportSlackStatus,
  reportVerifiedSlackWorkspace,
  unknownSlackStatus,
  type BusinessConnectionStatusReport,
} from "./connectionStatus";
import {
  ProviderCard,
  type RunConnectionAction,
  type SharedConnectionAction,
} from "./ProviderCard";
import { slackConnectionAdapter } from "./providers/slack";
import { sanitizeSlackImport } from "./sourceImport";
import {
  MAX_SLACK_CHANNEL_RESULTS,
  mergeSlackChannelResults,
} from "./slackResults";

type ConnectionView = "checking" | "not_configured" | "connected" | "error";

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function SlackConnectionCard({
  scope,
  busyAction,
  runAction,
  onImportSource,
  onConnectionStatus,
}: {
  scope: BusinessConnectionScope;
  busyAction: SharedConnectionAction | null;
  runAction: RunConnectionAction;
  onImportSource: (source: BusinessConnectionSource) => Promise<void>;
  onConnectionStatus: (status: BusinessConnectionStatusReport) => void;
}) {
  const tokenInputId = React.useId();
  const channelFilterId = React.useId();
  const statusCallback = React.useRef(onConnectionStatus);
  const [connectionView, setConnectionView] =
    React.useState<ConnectionView>("checking");
  const [workspaceName, setWorkspaceName] = React.useState<string | null>(null);
  const [token, setToken] = React.useState("");
  const [showTokenEntry, setShowTokenEntry] = React.useState(false);
  const [channelFilter, setChannelFilter] = React.useState("");
  const [channels, setChannels] = React.useState<
    readonly SlackChannel[] | null
  >(null);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    statusCallback.current = onConnectionStatus;
  }, [onConnectionStatus]);

  const report = React.useCallback((status: BusinessConnectionStatusReport) => {
    try {
      statusCallback.current(status);
    } catch {
      setError(
        "Could not update connection progress in the business workspace.",
      );
    }
  }, []);

  const applyStatus = React.useCallback(
    (status: Awaited<ReturnType<typeof slackConnectionAdapter.status>>) => {
      setConnectionView(status.connected ? "connected" : "not_configured");
      setWorkspaceName(status.connected ? status.account.label : null);
      report(
        reportSlackStatus(
          status.connected
            ? { connected: true, workspaceName: status.account.label }
            : { connected: false, workspaceName: null },
        ),
      );
    },
    [report],
  );

  const readStatus = React.useCallback(async () => {
    const status = await slackConnectionAdapter.status(scope);
    applyStatus(status);
    return status;
  }, [applyStatus, scope]);

  React.useEffect(() => {
    let current = true;
    report(checkingSlackStatus());
    void slackConnectionAdapter
      .status(scope)
      .then((status) => {
        if (current) applyStatus(status);
      })
      .catch((statusError: unknown) => {
        if (!current) return;
        setConnectionView("error");
        setWorkspaceName(null);
        report(unknownSlackStatus());
        setError(
          errorMessage(statusError, "Could not verify the Slack connection."),
        );
      });
    return () => {
      current = false;
    };
  }, [applyStatus, report, scope]);

  function refreshStatus() {
    void runAction("slack:status", async () => {
      setConnectionView("checking");
      setError(null);
      report(checkingSlackStatus());
      try {
        await readStatus();
      } catch (statusError) {
        setConnectionView("error");
        setWorkspaceName(null);
        report(unknownSlackStatus());
        setError(
          errorMessage(statusError, "Could not verify the Slack connection."),
        );
      }
    });
  }

  function handleConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedToken = token;
    if (!submittedToken.trim() || busyAction !== null) return;
    void runAction("slack:connect", async () => {
      setError(null);
      setNotice(null);
      try {
        const workspace = await slackConnectionAdapter.connect(
          scope,
          submittedToken,
        );
        setConnectionView("connected");
        setWorkspaceName(workspace.label);
        setChannels(null);
        setNextCursor(null);
        setHasMore(false);
        setShowTokenEntry(false);
        report(reportVerifiedSlackWorkspace(workspace.label));
        setNotice("Slack is connected for this community and identity.");
      } catch (connectError) {
        setError(errorMessage(connectError, "Could not connect Slack."));
      } finally {
        setToken("");
      }
    });
  }

  function handleBrowse(cursor?: string | null) {
    void runAction("slack:list", async () => {
      setError(null);
      setNotice(null);
      try {
        const result = await slackConnectionAdapter.listResources(scope, {
          cursor,
        });
        setChannels((current) =>
          mergeSlackChannelResults(cursor ? (current ?? []) : [], result.items),
        );
        setNextCursor(result.nextCursor);
        setHasMore(result.hasMore);
      } catch (listError) {
        setError(errorMessage(listError, "Could not load Slack channels."));
      }
    });
  }

  function handleImport(channel: SlackChannel) {
    void runAction("slack:import", async () => {
      setError(null);
      setNotice(null);
      try {
        const imported = sanitizeSlackImport(
          await slackConnectionAdapter.importResource(scope, channel),
          channel.id,
        );
        await onImportSource(imported.source);
        setNotice(
          imported.truncated
            ? `Imported a bounded set of recent messages from #${channel.name}.`
            : `Imported recent messages from #${channel.name}.`,
        );
      } catch (importError) {
        setError(
          errorMessage(importError, "Could not import messages from Slack."),
        );
      }
    });
  }

  function handleRevoke() {
    void runAction("slack:revoke", async () => {
      setError(null);
      setNotice(null);
      try {
        await slackConnectionAdapter.revoke(scope);
        setChannels(null);
        setNextCursor(null);
        setHasMore(false);
        setShowTokenEntry(false);
        const status = await readStatus();
        setNotice(
          status.connected
            ? "Slack still reports a saved connection. Check the keyring and disconnect again."
            : "The Slack bot token was removed from this computer.",
        );
      } catch (revokeError) {
        setConnectionView("error");
        setWorkspaceName(null);
        report(unknownSlackStatus());
        setError(
          errorMessage(
            revokeError,
            "Could not remove or verify the saved Slack token.",
          ),
        );
      }
    });
  }

  const isConnected = connectionView === "connected";
  const shouldShowTokenEntry = !isConnected || showTokenEntry;
  const isBusy = busyAction !== null;
  const visibleChannels = (channels ?? []).filter((channel) =>
    channel.name.toLowerCase().includes(channelFilter.trim().toLowerCase()),
  );
  const atChannelLimit =
    channels !== null &&
    channels.length >= MAX_SLACK_CHANNEL_RESULTS &&
    hasMore;

  return (
    <ProviderCard providerId="slack">
      <p className="text-sm" role="status" aria-live="polite">
        {connectionView === "checking" && "Checking the saved connection…"}
        {connectionView === "connected" && `Connected to ${workspaceName}.`}
        {connectionView === "not_configured" && "Not connected."}
        {connectionView === "error" &&
          "Connection status could not be verified."}
      </p>

      {shouldShowTokenEntry && (
        <form className="space-y-3" onSubmit={handleConnect}>
          <div className="space-y-1.5">
            <label htmlFor={tokenInputId} className="text-sm font-medium">
              Slack bot token · manual setup
            </label>
            <Input
              id={tokenInputId}
              name="slack-bot-token"
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={isBusy || connectionView === "checking"}
              aria-describedby={`${tokenInputId}-help`}
            />
            <p
              id={`${tokenInputId}-help`}
              className="text-xs text-muted-foreground"
            >
              Create a Slack app, allow it to view channels and read their
              messages, then add it only to the channels you want to use. Buzz
              imports messages only after you choose a channel.
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <a
                className="text-primary underline underline-offset-4"
                href="https://api.slack.com/apps"
                target="_blank"
                rel="noreferrer"
              >
                Open Slack app settings
              </a>
              <a
                className="text-primary underline underline-offset-4"
                href="https://docs.slack.dev/authentication/tokens/"
                target="_blank"
                rel="noreferrer"
              >
                Slack token setup help
              </a>
              <a
                className="text-primary underline underline-offset-4"
                href="https://docs.slack.dev/reference/scopes/"
                target="_blank"
                rel="noreferrer"
              >
                Slack permissions help
              </a>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              disabled={
                !token.trim() || isBusy || connectionView === "checking"
              }
            >
              {busyAction === "slack:connect" ? "Verifying…" : "Connect Slack"}
            </Button>
            {isConnected && (
              <Button
                type="button"
                variant="outline"
                disabled={isBusy}
                onClick={() => {
                  setShowTokenEntry(false);
                  setToken("");
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}

      {isConnected && !showTokenEntry && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleBrowse(null)}
            disabled={isBusy}
          >
            {busyAction === "slack:list"
              ? "Loading channels…"
              : "Browse channels"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowTokenEntry(true)}
            disabled={isBusy}
          >
            Replace token
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleRevoke}
            disabled={isBusy}
          >
            {busyAction === "slack:revoke" ? "Removing…" : "Disconnect"}
          </Button>
        </div>
      )}

      {connectionView === "error" && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={refreshStatus}
            disabled={isBusy}
          >
            {busyAction === "slack:status" ? "Checking…" : "Retry status check"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleRevoke}
            disabled={isBusy}
          >
            {busyAction === "slack:revoke" ? "Removing…" : "Remove saved token"}
          </Button>
        </div>
      )}

      {isConnected && !showTokenEntry && (
        <section
          className="space-y-3"
          aria-labelledby={`${channelFilterId}-heading`}
        >
          <h3 id={`${channelFilterId}-heading`} className="text-sm font-medium">
            Choose a channel
          </h3>
          {channels && (
            <>
              <Input
                id={channelFilterId}
                type="search"
                value={channelFilter}
                maxLength={80}
                onChange={(event) => setChannelFilter(event.target.value)}
                disabled={isBusy}
                placeholder="Filter shown channels"
                aria-label="Filter shown Slack channels"
              />
              {visibleChannels.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No shown channels match that name. Browse more channels or
                  change the filter.
                </p>
              ) : (
                <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                  {visibleChannels.map((channel) => (
                    <li
                      key={channel.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
                    >
                      <div className="min-w-0">
                        <a
                          className="truncate text-sm font-medium text-primary underline-offset-4 hover:underline"
                          href={channel.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          #{channel.name}
                        </a>
                        {channel.isPrivate && (
                          <p className="text-xs text-muted-foreground">
                            Private channel
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleImport(channel)}
                        disabled={isBusy}
                      >
                        {busyAction === "slack:import"
                          ? "Importing…"
                          : "Import recent messages"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {hasMore &&
                nextCursor &&
                channels.length < MAX_SLACK_CHANNEL_RESULTS && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleBrowse(nextCursor)}
                    disabled={isBusy}
                  >
                    {busyAction === "slack:list"
                      ? "Loading…"
                      : "Load more channels"}
                  </Button>
                )}
              {atChannelLimit && (
                <p className="text-sm text-muted-foreground" role="status">
                  The channel list is capped. Filter the channels shown or add
                  the Slack app to fewer channels, then refresh.
                </p>
              )}
            </>
          )}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Only channels this bot is part of are shown. Choose a channel to import
        up to 15 recent messages. The token stays on this computer; disconnect
        removes it from Buzz. Revoke it in Slack to make the token unusable.
      </p>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm" role="status" aria-live="polite">
          {notice}
        </p>
      )}
    </ProviderCard>
  );
}
