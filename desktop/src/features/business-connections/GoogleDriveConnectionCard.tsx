import * as React from "react";

import {
  getGoogleDriveOAuthClientId,
  setGoogleDriveOAuthClientId,
  type BusinessConnectionScope,
  type BusinessConnectionSource,
  type GoogleDriveFile,
} from "@/shared/api/tauriBusinessConnections";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  checkingGoogleDriveStatus,
  reportGoogleDriveStatus,
  unknownGoogleDriveStatus,
  type BusinessConnectionStatusReport,
} from "./connectionStatus";
import {
  ProviderCard,
  type RunConnectionAction,
  type SharedConnectionAction,
} from "./ProviderCard";
import { googleDriveConnectionAdapter } from "./providers/googleDrive";
import {
  MAX_GOOGLE_DRIVE_RESULTS,
  mergeGoogleDriveResults,
} from "./googleDriveResults";
import { sanitizeGoogleDriveImport } from "./sourceImport";

type ConnectionView = "checking" | "not_configured" | "connected" | "error";
type ConfigView = "checking" | "missing" | "ready" | "error";

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function GoogleDriveConnectionCard({
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
  const clientIdInputId = React.useId();
  const searchInputId = React.useId();
  const statusCallback = React.useRef(onConnectionStatus);
  const scopeKey = `${scope.expectedRelayUrl}\u0000${scope.expectedSignerPubkey}`;
  const scopeKeyRef = React.useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const [connectionView, setConnectionView] =
    React.useState<ConnectionView>("checking");
  const [configView, setConfigView] = React.useState<ConfigView>("checking");
  const [clientId, setClientId] = React.useState("");
  const [savedClientId, setSavedClientId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [files, setFiles] = React.useState<readonly GoogleDriveFile[] | null>(
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
    (connected: boolean) => {
      setConnectionView(connected ? "connected" : "not_configured");
      report(reportGoogleDriveStatus({ connected }));
    },
    [report],
  );

  const readStatus = React.useCallback(async () => {
    const status = await googleDriveConnectionAdapter.status(scope);
    if (scopeKeyRef.current === scopeKey) applyStatus(status.connected);
    return status;
  }, [applyStatus, scope, scopeKey]);

  React.useEffect(() => {
    let current = true;
    report(checkingGoogleDriveStatus());
    setConnectionView("checking");
    setConfigView("checking");
    setFiles(null);
    setNextCursor(null);
    setHasMore(false);
    setError(null);
    setNotice(null);

    void getGoogleDriveOAuthClientId()
      .then((storedClientId) => {
        if (!current) return;
        setClientId(storedClientId ?? "");
        setSavedClientId(storedClientId);
        setConfigView(storedClientId ? "ready" : "missing");
      })
      .catch((configError: unknown) => {
        if (!current) return;
        setConfigView("error");
        setError(
          errorMessage(
            configError,
            "Could not read the local Google Drive setup.",
          ),
        );
      });

    void googleDriveConnectionAdapter
      .status(scope)
      .then((status) => {
        if (current) applyStatus(status.connected);
      })
      .catch((statusError: unknown) => {
        if (!current) return;
        setConnectionView("error");
        report(unknownGoogleDriveStatus());
        setError(
          errorMessage(
            statusError,
            "Could not verify the Google Drive connection.",
          ),
        );
      });
    return () => {
      current = false;
    };
  }, [applyStatus, report, scope]);

  function isCurrent(requestScopeKey: string): boolean {
    return scopeKeyRef.current === requestScopeKey;
  }

  function handleSaveClientId(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedClientId = clientId.trim();
    if (!submittedClientId || busyAction !== null) return;
    void runAction("google:configure", async () => {
      setError(null);
      setNotice(null);
      try {
        const storedClientId =
          await setGoogleDriveOAuthClientId(submittedClientId);
        setClientId(storedClientId);
        setSavedClientId(storedClientId);
        setConfigView("ready");
        setNotice(
          "The Google Desktop OAuth client ID is saved on this computer.",
        );
      } catch (configError) {
        setConfigView(savedClientId ? "ready" : "missing");
        setError(
          errorMessage(
            configError,
            "Could not save the Google Desktop OAuth client ID.",
          ),
        );
      }
    });
  }

  function handleConnect() {
    if (
      !savedClientId ||
      clientId.trim() !== savedClientId ||
      busyAction !== null
    ) {
      return;
    }
    const requestedScopeKey = scopeKey;
    void runAction("google:connect", async () => {
      setError(null);
      setNotice(null);
      try {
        await googleDriveConnectionAdapter.connect(scope, undefined);
        if (!isCurrent(requestedScopeKey)) return;
        setFiles(null);
        setNextCursor(null);
        setHasMore(false);
        applyStatus(true);
        setNotice("Google Drive is connected for this community and identity.");
      } catch (connectError) {
        if (!isCurrent(requestedScopeKey)) return;
        setError(errorMessage(connectError, "Could not connect Google Drive."));
      }
    });
  }

  function handleSearch(cursor?: string | null) {
    const searchTerm = query.trim();
    if (!searchTerm) {
      setFiles(null);
      setNextCursor(null);
      setHasMore(false);
      setError("Enter a document title to search Google Drive.");
      return;
    }
    const requestedScopeKey = scopeKey;
    void runAction("google:list", async () => {
      setError(null);
      setNotice(null);
      if (!cursor) {
        setFiles(null);
        setNextCursor(null);
        setHasMore(false);
      }
      try {
        const page = await googleDriveConnectionAdapter.listResources(scope, {
          query: searchTerm,
          cursor,
        });
        if (!isCurrent(requestedScopeKey)) return;
        setFiles((current) =>
          mergeGoogleDriveResults(cursor ? (current ?? []) : [], page.items),
        );
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
      } catch (searchError) {
        if (!isCurrent(requestedScopeKey)) return;
        setError(errorMessage(searchError, "Could not search Google Drive."));
      }
    });
  }

  function handleImport(file: GoogleDriveFile) {
    const requestedScopeKey = scopeKey;
    void runAction("google:import", async () => {
      setError(null);
      setNotice(null);
      try {
        const imported = sanitizeGoogleDriveImport(
          await googleDriveConnectionAdapter.importResource(scope, file),
          file.id,
        );
        if (!isCurrent(requestedScopeKey)) return;
        await onImportSource(imported.source);
        if (!isCurrent(requestedScopeKey)) return;
        setNotice(
          imported.truncated
            ? `Imported a bounded amount of text from “${file.title}”.`
            : `Imported “${file.title}” from Google Drive.`,
        );
      } catch (importError) {
        if (!isCurrent(requestedScopeKey)) return;
        setError(
          errorMessage(importError, "Could not import this Google Doc."),
        );
      }
    });
  }

  function handleRevoke() {
    const requestedScopeKey = scopeKey;
    void runAction("google:revoke", async () => {
      setError(null);
      setNotice(null);
      try {
        await googleDriveConnectionAdapter.revoke(scope);
        if (!isCurrent(requestedScopeKey)) return;
        setFiles(null);
        setNextCursor(null);
        setHasMore(false);
        const status = await readStatus();
        if (!isCurrent(requestedScopeKey)) return;
        setNotice(
          status.connected
            ? "Google Drive still reports a saved local connection. Check the keyring and disconnect again."
            : "The Google tokens were removed from this computer. Google's account grant remains separate.",
        );
      } catch (revokeError) {
        if (!isCurrent(requestedScopeKey)) return;
        setConnectionView("error");
        report(unknownGoogleDriveStatus());
        setError(
          errorMessage(
            revokeError,
            "Could not remove or verify the saved Google tokens.",
          ),
        );
      }
    });
  }

  function refreshStatus() {
    const requestedScopeKey = scopeKey;
    void runAction("google:status", async () => {
      setConnectionView("checking");
      setError(null);
      report(checkingGoogleDriveStatus());
      try {
        await readStatus();
      } catch (statusError) {
        if (!isCurrent(requestedScopeKey)) return;
        setConnectionView("error");
        report(unknownGoogleDriveStatus());
        setError(
          errorMessage(
            statusError,
            "Could not verify the Google Drive connection.",
          ),
        );
      }
    });
  }

  const isBusy = busyAction !== null;
  const isConnected = connectionView === "connected";
  const hasSavedClientId =
    configView === "ready" &&
    savedClientId !== null &&
    clientId.trim() === savedClientId;
  const atResultLimit =
    files !== null && files.length >= MAX_GOOGLE_DRIVE_RESULTS && hasMore;

  return (
    <ProviderCard providerId="google">
      <p className="text-sm" role="status" aria-live="polite">
        {connectionView === "checking" && "Checking the saved connection…"}
        {connectionView === "connected" && "Connected to Google Drive."}
        {connectionView === "not_configured" && "Not connected."}
        {connectionView === "error" &&
          "Connection status could not be verified."}
      </p>

      <section
        className="space-y-3"
        aria-labelledby={`${clientIdInputId}-heading`}
      >
        <h3 id={`${clientIdInputId}-heading`} className="text-sm font-medium">
          {configView === "missing" ? "Setup required" : "Google OAuth setup"}
        </h3>
        <form className="space-y-3" onSubmit={handleSaveClientId}>
          <div className="space-y-1.5">
            <label htmlFor={clientIdInputId} className="text-sm font-medium">
              Google Desktop OAuth client ID
            </label>
            <Input
              id={clientIdInputId}
              name="google-desktop-oauth-client-id"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={512}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={isBusy || configView === "checking"}
              aria-describedby={`${clientIdInputId}-help`}
            />
            <p
              id={`${clientIdInputId}-help`}
              className="text-xs text-muted-foreground"
            >
              Add a Desktop app OAuth client in Google Cloud and paste its
              client ID here. This is public setup configuration; do not enter a
              client secret. Buzz stores the ID in this computer’s app
              configuration.
            </p>
            <a
              className="text-xs text-primary underline underline-offset-4"
              href="https://developers.google.com/identity/protocols/oauth2/native-app"
              target="_blank"
              rel="noreferrer"
            >
              Google Desktop OAuth setup guide
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant="outline"
              disabled={
                !clientId.trim() ||
                isBusy ||
                configView === "checking" ||
                clientId.trim() === savedClientId
              }
            >
              {busyAction === "google:configure" ? "Saving…" : "Save client ID"}
            </Button>
            {clientId.trim() !== savedClientId && savedClientId && (
              <Button
                type="button"
                variant="ghost"
                disabled={isBusy}
                onClick={() => setClientId(savedClientId)}
              >
                Cancel changes
              </Button>
            )}
          </div>
        </form>
        <p className="text-xs text-muted-foreground">
          Google will grant <code>drive.readonly</code>, which can view and
          download all files in the Google Drive account. Buzz searches Docs and
          reads text only after you select a result and click Import. Buzz does
          not use Google Picker or request <code>drive.file</code>. Changing the
          client ID affects future sign-ins; a saved connection keeps the client
          ID it needs for token refresh.
        </p>
      </section>

      {isConnected && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleConnect}
            disabled={!hasSavedClientId || isBusy}
          >
            {busyAction === "google:connect" ? "Connecting…" : "Reconnect"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleRevoke}
            disabled={isBusy}
          >
            {busyAction === "google:revoke" ? "Removing…" : "Disconnect"}
          </Button>
        </div>
      )}

      {!isConnected && connectionView !== "checking" && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={handleConnect}
            disabled={!hasSavedClientId || isBusy}
          >
            {busyAction === "google:connect"
              ? "Waiting for Google…"
              : "Connect Google Drive"}
          </Button>
          {connectionView === "error" && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={refreshStatus}
                disabled={isBusy}
              >
                {busyAction === "google:status"
                  ? "Checking…"
                  : "Retry status check"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleRevoke}
                disabled={isBusy}
              >
                Remove saved tokens
              </Button>
            </>
          )}
        </div>
      )}

      {isConnected && (
        <section
          className="space-y-3"
          aria-labelledby={`${searchInputId}-heading`}
        >
          <h3 id={`${searchInputId}-heading`} className="text-sm font-medium">
            Search Google Docs by title
          </h3>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              handleSearch(null);
            }}
          >
            <Input
              id={searchInputId}
              type="search"
              value={query}
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
              disabled={isBusy}
              placeholder="Document title"
              aria-label="Search Google Docs by title"
            />
            <Button type="submit" variant="outline" disabled={isBusy}>
              {busyAction === "google:list" ? "Searching…" : "Search Docs"}
            </Button>
          </form>
          {files && (
            <div className="space-y-2">
              {files.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No Google Docs matched this title search.
                </p>
              ) : (
                <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
                  {files.map((file) => (
                    <li
                      key={file.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
                    >
                      <div className="min-w-0">
                        <a
                          className="truncate text-sm font-medium text-primary underline-offset-4 hover:underline"
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {file.title}
                        </a>
                        {file.modifiedTime && (
                          <p className="text-xs text-muted-foreground">
                            Edited {file.modifiedTime}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleImport(file)}
                        disabled={isBusy}
                      >
                        {busyAction === "google:import"
                          ? "Importing…"
                          : "Import Doc"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {hasMore &&
                nextCursor &&
                files.length < MAX_GOOGLE_DRIVE_RESULTS && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleSearch(nextCursor)}
                    disabled={isBusy}
                  >
                    {busyAction === "google:list"
                      ? "Loading…"
                      : "Load more Docs"}
                  </Button>
                )}
              {atResultLimit && (
                <p className="text-sm text-muted-foreground" role="status">
                  The result list is capped at 100 Docs. Narrow the title search
                  to see different files.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Buzz stores access and refresh tokens in the OS keyring for this
        community and identity. Disconnect removes those local tokens; it does
        not revoke Google’s account grant. You can review that grant in{" "}
        <a
          className="text-primary underline underline-offset-4"
          href="https://myaccount.google.com/permissions"
          target="_blank"
          rel="noreferrer"
        >
          Google Account permissions
        </a>
        .
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
