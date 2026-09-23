import * as React from "react";

import type {
  BusinessConnectionScope,
  BusinessConnectionSource,
  NotionPageSummary,
} from "@/shared/api/tauriBusinessConnections";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  checkingNotionStatus,
  reportNotionStatus,
  reportVerifiedNotionName,
  unknownNotionStatus,
  type BusinessConnectionStatusReport,
} from "./connectionStatus";
import {
  ProviderCard,
  type RunConnectionAction,
  type SharedConnectionAction,
} from "./ProviderCard";
import { notionConnectionAdapter } from "./providers/notion";
import { sanitizeNotionImport } from "./sourceImport";

type ConnectionView = "checking" | "not_configured" | "connected" | "error";

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function NotionConnectionCard({
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
  const searchInputId = React.useId();
  const statusCallback = React.useRef(onConnectionStatus);
  const [connectionView, setConnectionView] =
    React.useState<ConnectionView>("checking");
  const [integrationName, setIntegrationName] = React.useState<string | null>(
    null,
  );
  const [token, setToken] = React.useState("");
  const [showTokenEntry, setShowTokenEntry] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [pages, setPages] = React.useState<readonly NotionPageSummary[] | null>(
    null,
  );
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
    (status: Awaited<ReturnType<typeof notionConnectionAdapter.status>>) => {
      setConnectionView(status.connected ? "connected" : "not_configured");
      setIntegrationName(status.connected ? status.account.label : null);
      report(
        reportNotionStatus(
          status.connected
            ? { connected: true, name: status.account.label }
            : { connected: false, name: null },
        ),
      );
    },
    [report],
  );

  const readStatus = React.useCallback(async () => {
    const status = await notionConnectionAdapter.status(scope);
    applyStatus(status);
    return status;
  }, [applyStatus, scope]);

  React.useEffect(() => {
    let current = true;
    report(checkingNotionStatus());
    void notionConnectionAdapter
      .status(scope)
      .then((status) => {
        if (current) applyStatus(status);
      })
      .catch((statusError: unknown) => {
        if (!current) return;
        setConnectionView("error");
        setIntegrationName(null);
        report(unknownNotionStatus());
        setError(
          errorMessage(statusError, "Could not verify the Notion connection."),
        );
      });
    return () => {
      current = false;
    };
  }, [applyStatus, report, scope]);

  function refreshStatus() {
    void runAction("notion:status", async () => {
      setConnectionView("checking");
      setError(null);
      report(checkingNotionStatus());
      try {
        await readStatus();
      } catch (statusError) {
        setConnectionView("error");
        setIntegrationName(null);
        report(unknownNotionStatus());
        setError(
          errorMessage(statusError, "Could not verify the Notion connection."),
        );
      }
    });
  }

  function handleConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedToken = token;
    if (!submittedToken.trim() || busyAction !== null) return;
    void runAction("notion:connect", async () => {
      setError(null);
      setNotice(null);
      try {
        const account = await notionConnectionAdapter.connect(
          scope,
          submittedToken,
        );
        setConnectionView("connected");
        setIntegrationName(account.label);
        setPages(null);
        setShowTokenEntry(false);
        report(reportVerifiedNotionName(account.label));
        setNotice("Notion is connected for this community and identity.");
      } catch (connectError) {
        setError(errorMessage(connectError, "Could not connect Notion."));
      } finally {
        setToken("");
      }
    });
  }

  function handleSearch(cursor?: string | null) {
    const searchQuery = query;
    void runAction("notion:list", async () => {
      setError(null);
      setNotice(null);
      try {
        const result = await notionConnectionAdapter.listResources(scope, {
          query: searchQuery,
          cursor,
        });
        setPages((current) =>
          cursor ? [...(current ?? []), ...result.items] : result.items,
        );
        setNextCursor(result.nextCursor);
        setHasMore(result.hasMore);
      } catch (searchError) {
        setError(errorMessage(searchError, "Could not search Notion pages."));
      }
    });
  }

  function handleImport(page: NotionPageSummary) {
    void runAction("notion:import", async () => {
      setError(null);
      setNotice(null);
      try {
        const imported = sanitizeNotionImport(
          await notionConnectionAdapter.importResource(scope, page),
          page.id,
        );
        await onImportSource(imported.source);
        setNotice(
          imported.truncated
            ? `Imported a partial page from “${page.title}”; Buzz marked omitted or truncated content.`
            : `Imported “${page.title}”.`,
        );
      } catch (importError) {
        setError(
          errorMessage(importError, "Could not import this Notion page."),
        );
      }
    });
  }

  function handleRevoke() {
    void runAction("notion:revoke", async () => {
      setError(null);
      setNotice(null);
      try {
        await notionConnectionAdapter.revoke(scope);
        setPages(null);
        setNextCursor(null);
        setHasMore(false);
        setShowTokenEntry(false);
        const status = await readStatus();
        setNotice(
          status.connected
            ? "Notion still reports a saved connection. Check the keyring and disconnect again."
            : "The Notion integration token was removed from this device.",
        );
      } catch (revokeError) {
        setConnectionView("error");
        setIntegrationName(null);
        report(unknownNotionStatus());
        setError(
          errorMessage(
            revokeError,
            "Could not remove or verify the saved token.",
          ),
        );
      }
    });
  }

  const isConnected = connectionView === "connected";
  const shouldShowTokenEntry = !isConnected || showTokenEntry;
  const isBusy = busyAction !== null;

  return (
    <ProviderCard providerId="notion">
      <p className="text-sm" role="status" aria-live="polite">
        {connectionView === "checking" && "Checking the saved connection…"}
        {connectionView === "connected" && `Connected as ${integrationName}.`}
        {connectionView === "not_configured" && "Not connected."}
        {connectionView === "error" &&
          "Connection status could not be verified."}
      </p>

      {shouldShowTokenEntry && (
        <form className="space-y-3" onSubmit={handleConnect}>
          <div className="space-y-1.5">
            <label htmlFor={tokenInputId} className="text-sm font-medium">
              Notion internal integration token
            </label>
            <Input
              id={tokenInputId}
              name="notion-integration-token"
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
              Create an internal integration in your Notion workspace, grant
              Read content only, and share the pages you want to import with
              that connection. No OAuth app is needed for this token flow.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              disabled={
                !token.trim() || isBusy || connectionView === "checking"
              }
            >
              {busyAction === "notion:connect"
                ? "Verifying…"
                : "Connect Notion"}
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
            onClick={() => handleSearch(null)}
            disabled={isBusy}
          >
            {busyAction === "notion:list" ? "Searching…" : "Browse pages"}
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
            {busyAction === "notion:revoke" ? "Removing…" : "Disconnect"}
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
            {busyAction === "notion:status"
              ? "Checking…"
              : "Retry status check"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleRevoke}
            disabled={isBusy}
          >
            {busyAction === "notion:revoke"
              ? "Removing…"
              : "Remove saved token"}
          </Button>
        </div>
      )}

      {isConnected && !showTokenEntry && (
        <section
          className="space-y-3"
          aria-labelledby={`${searchInputId}-heading`}
        >
          <h3 id={`${searchInputId}-heading`} className="text-sm font-medium">
            Search shared Notion pages
          </h3>
          <div className="flex flex-wrap gap-2">
            <Input
              id={searchInputId}
              type="search"
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              disabled={isBusy}
              placeholder="Page title"
              aria-label="Search Notion page titles"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => handleSearch(null)}
              disabled={isBusy}
            >
              Search
            </Button>
          </div>
          {pages && (
            <div className="space-y-2">
              {pages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No shared pages matched this search.
                </p>
              ) : (
                <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                  {pages.map((page) => (
                    <li
                      key={page.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
                    >
                      <div className="min-w-0">
                        <a
                          className="truncate text-sm font-medium text-primary underline-offset-4 hover:underline"
                          href={page.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {page.title}
                        </a>
                        {page.lastEditedTime && (
                          <p className="text-xs text-muted-foreground">
                            Edited {page.lastEditedTime}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleImport(page)}
                        disabled={isBusy}
                      >
                        {busyAction === "notion:import"
                          ? "Importing…"
                          : "Import page"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {hasMore && nextCursor && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleSearch(nextCursor)}
                  disabled={isBusy}
                >
                  {busyAction === "notion:list"
                    ? "Loading…"
                    : "Load more pages"}
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        The token stays on this device in the OS keyring. Requests go only to
        Notion’s fixed API origin; imported links are provenance labels and are
        never fetched.
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
