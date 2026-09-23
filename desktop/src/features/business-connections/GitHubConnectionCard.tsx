import * as React from "react";

import type {
  BusinessConnectionScope,
  BusinessConnectionSource,
  GitHubRepository,
} from "@/shared/api/tauriBusinessConnections";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  checkingGitHubStatus,
  reportGitHubStatus,
  reportVerifiedGitHubLogin,
  unknownGitHubStatus,
  type BusinessConnectionStatusReport,
} from "./connectionStatus";
import {
  ProviderCard,
  type RunConnectionAction,
  type SharedConnectionAction,
} from "./ProviderCard";
import { githubConnectionAdapter } from "./providers/github";
import { sanitizeGitHubImport } from "./sourceImport";

type ConnectionView = "checking" | "not_configured" | "connected" | "error";

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function GitHubConnectionCard({
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
  const statusCallback = React.useRef(onConnectionStatus);
  const [connectionView, setConnectionView] =
    React.useState<ConnectionView>("checking");
  const [accountLabel, setAccountLabel] = React.useState<string | null>(null);
  const [token, setToken] = React.useState("");
  const [showTokenEntry, setShowTokenEntry] = React.useState(false);
  const [repositories, setRepositories] = React.useState<
    readonly GitHubRepository[] | null
  >(null);
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

  const readStatus = React.useCallback(async () => {
    const status = await githubConnectionAdapter.status(scope);
    setConnectionView(status.connected ? "connected" : "not_configured");
    setAccountLabel(status.connected ? status.account.label : null);
    report(
      reportGitHubStatus(
        status.connected
          ? { connected: true, login: status.account.id }
          : { connected: false, login: null },
      ),
    );
    return status;
  }, [report, scope]);

  React.useEffect(() => {
    let current = true;
    report(checkingGitHubStatus());
    void githubConnectionAdapter
      .status(scope)
      .then((status) => {
        if (!current) return;
        setConnectionView(status.connected ? "connected" : "not_configured");
        setAccountLabel(status.connected ? status.account.label : null);
        report(
          reportGitHubStatus(
            status.connected
              ? { connected: true, login: status.account.id }
              : { connected: false, login: null },
          ),
        );
      })
      .catch((statusError: unknown) => {
        if (!current) return;
        setConnectionView("error");
        setAccountLabel(null);
        report(unknownGitHubStatus());
        setError(
          errorMessage(statusError, "Could not verify the GitHub connection."),
        );
      });
    return () => {
      current = false;
    };
  }, [report, scope]);

  function refreshStatus() {
    void runAction("github:status", async () => {
      setConnectionView("checking");
      setError(null);
      report(checkingGitHubStatus());
      try {
        await readStatus();
      } catch (statusError) {
        setConnectionView("error");
        setAccountLabel(null);
        report(unknownGitHubStatus());
        setError(
          errorMessage(statusError, "Could not verify the GitHub connection."),
        );
      }
    });
  }

  function handleConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedToken = token;
    if (!submittedToken.trim() || busyAction !== null) return;
    void runAction("github:connect", async () => {
      setError(null);
      setNotice(null);
      try {
        const account = await githubConnectionAdapter.connect(
          scope,
          submittedToken,
        );
        setAccountLabel(account.label);
        setConnectionView("connected");
        setRepositories(null);
        setShowTokenEntry(false);
        report(reportVerifiedGitHubLogin(account.id));
        setNotice("GitHub is connected for this community and identity.");
      } catch (connectError) {
        setError(errorMessage(connectError, "Could not connect GitHub."));
      } finally {
        setToken("");
      }
    });
  }

  function handleLoadRepositories() {
    void runAction("github:list", async () => {
      setError(null);
      setNotice(null);
      try {
        const page = await githubConnectionAdapter.listResources(scope);
        setRepositories(page.items);
      } catch (listError) {
        setError(
          errorMessage(listError, "Could not load GitHub repositories."),
        );
      }
    });
  }

  function handleImport(repository: GitHubRepository) {
    void runAction("github:import", async () => {
      setError(null);
      setNotice(null);
      try {
        const imported = sanitizeGitHubImport(
          await githubConnectionAdapter.importResource(scope, repository),
        );
        await onImportSource(imported.source);
        setNotice(
          imported.truncated
            ? `Imported a partial README from ${repository.fullName}; Buzz marked the truncated content.`
            : `Imported the README from ${repository.fullName}.`,
        );
      } catch (importError) {
        setError(errorMessage(importError, "Could not import this README."));
      }
    });
  }

  function handleRevoke() {
    void runAction("github:revoke", async () => {
      setError(null);
      setNotice(null);
      try {
        await githubConnectionAdapter.revoke(scope);
        setRepositories(null);
        setShowTokenEntry(false);
        const status = await readStatus();
        setNotice(
          status.connected
            ? "GitHub still reports a saved connection. Check the keyring and disconnect again."
            : "The GitHub token was removed from this device.",
        );
      } catch (revokeError) {
        setConnectionView("error");
        setAccountLabel(null);
        report(unknownGitHubStatus());
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
    <ProviderCard providerId="github">
      <p className="text-sm" role="status" aria-live="polite">
        {connectionView === "checking" && "Checking the saved connection…"}
        {connectionView === "connected" && `Connected as ${accountLabel}.`}
        {connectionView === "not_configured" && "Not connected."}
        {connectionView === "error" &&
          "Connection status could not be verified."}
      </p>

      {shouldShowTokenEntry && (
        <form className="space-y-3" onSubmit={handleConnect}>
          <div className="space-y-1.5">
            <label htmlFor={tokenInputId} className="text-sm font-medium">
              Fine-grained personal access token
            </label>
            <Input
              id={tokenInputId}
              name="github-pat"
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
              Use selected repositories with Metadata: read and Contents: read.
              Buzz does not request write access.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              disabled={
                !token.trim() || isBusy || connectionView === "checking"
              }
            >
              {busyAction === "github:connect"
                ? "Verifying…"
                : "Connect GitHub"}
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
            onClick={handleLoadRepositories}
            disabled={isBusy}
          >
            {busyAction === "github:list"
              ? "Loading repositories…"
              : "Browse repositories"}
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
            {busyAction === "github:revoke" ? "Removing…" : "Disconnect"}
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
            {busyAction === "github:status"
              ? "Checking…"
              : "Retry status check"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleRevoke}
            disabled={isBusy}
          >
            {busyAction === "github:revoke"
              ? "Removing…"
              : "Remove saved token"}
          </Button>
        </div>
      )}

      {repositories && (
        <section
          className="space-y-2"
          aria-labelledby={`${tokenInputId}-repositories-heading`}
        >
          <h3
            id={`${tokenInputId}-repositories-heading`}
            className="text-sm font-medium"
          >
            Repositories (up to 25, most recently updated)
          </h3>
          {repositories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No accessible repositories were found.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
              {repositories.map((repository) => (
                <li
                  key={repository.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
                >
                  <div className="min-w-0">
                    <a
                      className="truncate text-sm font-medium text-primary underline-offset-4 hover:underline"
                      href={repository.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {repository.fullName}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      {repository.private
                        ? "Private repository"
                        : "Public repository"}
                      {repository.description
                        ? ` · ${repository.description}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleImport(repository)}
                    disabled={isBusy}
                  >
                    {busyAction === "github:import"
                      ? "Importing…"
                      : "Import README"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        The token stays on this device in the OS keyring. It is sent only to
        GitHub’s fixed API origin for read operations.
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
