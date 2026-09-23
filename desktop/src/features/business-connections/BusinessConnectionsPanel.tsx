import * as React from "react";

import type {
  BusinessConnectionScope,
  BusinessConnectionSource,
  GitHubRepository,
} from "@/shared/api/tauriBusinessConnections";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import {
  checkingGitHubStatus,
  reportGitHubStatus,
  reportVerifiedGitHubLogin,
  unknownGitHubStatus,
  type BusinessConnectionStatusReport,
} from "./connectionStatus";
import { githubConnectionAdapter } from "./providers/github";
import { BUSINESS_CONNECTION_PROVIDERS } from "./providerRegistry";
import { sanitizeGitHubSource } from "./sourceImport";

type ConnectionView = "checking" | "not_configured" | "connected" | "error";

export type BusinessConnectionsPanelProps = BusinessConnectionScope & {
  onImportSource: (source: BusinessConnectionSource) => Promise<void>;
  onConnectionStatus?: (status: BusinessConnectionStatusReport) => void;
};

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

/** Local, read-only provider connections for importing source material. */
export function BusinessConnectionsPanel({
  expectedRelayUrl,
  expectedSignerPubkey,
  onImportSource,
  onConnectionStatus,
}: BusinessConnectionsPanelProps) {
  const tokenInputId = React.useId();
  const connectionScope = React.useMemo(
    () => ({ expectedRelayUrl, expectedSignerPubkey }),
    [expectedRelayUrl, expectedSignerPubkey],
  );
  const statusCallbackRef = React.useRef(onConnectionStatus);
  const [connectionView, setConnectionView] =
    React.useState<ConnectionView>("checking");
  const [accountLabel, setAccountLabel] = React.useState<string | null>(null);
  const [token, setToken] = React.useState("");
  const [showTokenEntry, setShowTokenEntry] = React.useState(false);
  const [repositories, setRepositories] = React.useState<
    readonly GitHubRepository[] | null
  >(null);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [isLoadingRepositories, setIsLoadingRepositories] =
    React.useState(false);
  const [importingRepositoryId, setImportingRepositoryId] = React.useState<
    number | null
  >(null);
  const [isRevoking, setIsRevoking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    statusCallbackRef.current = onConnectionStatus;
  }, [onConnectionStatus]);

  const reportConnectionStatus = React.useCallback(
    (status: BusinessConnectionStatusReport) => {
      try {
        statusCallbackRef.current?.(status);
      } catch {
        setError(
          "Could not update connection progress in the business workspace.",
        );
      }
    },
    [],
  );

  const refreshStatus = React.useCallback(async () => {
    const requestScope = connectionScope;
    setConnectionView("checking");
    setError(null);
    reportConnectionStatus(checkingGitHubStatus());
    try {
      const status = await githubConnectionAdapter.status(requestScope);
      setConnectionView(status.connected ? "connected" : "not_configured");
      setAccountLabel(status.connected ? status.account.label : null);
      reportConnectionStatus(
        reportGitHubStatus(
          status.connected
            ? { connected: true, login: status.account.id }
            : { connected: false, login: null },
        ),
      );
    } catch (statusError) {
      setConnectionView("error");
      setAccountLabel(null);
      reportConnectionStatus(unknownGitHubStatus());
      setError(
        errorMessage(statusError, "Could not verify the GitHub connection."),
      );
    }
  }, [connectionScope, reportConnectionStatus]);

  React.useEffect(() => {
    let current = true;
    const requestScope = connectionScope;
    reportConnectionStatus(checkingGitHubStatus());
    void githubConnectionAdapter
      .status(requestScope)
      .then((status) => {
        if (!current) return;
        setConnectionView(status.connected ? "connected" : "not_configured");
        setAccountLabel(status.connected ? status.account.label : null);
        reportConnectionStatus(
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
        reportConnectionStatus(unknownGitHubStatus());
        setError(
          errorMessage(statusError, "Could not verify the GitHub connection."),
        );
      });
    return () => {
      current = false;
    };
  }, [connectionScope, reportConnectionStatus]);

  async function handleConnect(event: React.FormEvent<HTMLFormElement>) {
    const requestScope = connectionScope;
    event.preventDefault();
    if (!token.trim() || isConnecting) return;
    setIsConnecting(true);
    setError(null);
    setNotice(null);
    try {
      const account = await githubConnectionAdapter.connect(
        requestScope,
        token,
      );
      setAccountLabel(account.label);
      setConnectionView("connected");
      setRepositories(null);
      setShowTokenEntry(false);
      reportConnectionStatus(reportVerifiedGitHubLogin(account.id));
      setNotice("GitHub is connected for this community and identity.");
    } catch (connectError) {
      setError(errorMessage(connectError, "Could not connect GitHub."));
    } finally {
      setToken("");
      setIsConnecting(false);
    }
  }

  async function handleLoadRepositories() {
    const requestScope = connectionScope;
    if (isLoadingRepositories) return;
    setIsLoadingRepositories(true);
    setError(null);
    setNotice(null);
    try {
      setRepositories(
        await githubConnectionAdapter.listResources(requestScope),
      );
    } catch (listError) {
      setError(errorMessage(listError, "Could not load GitHub repositories."));
    } finally {
      setIsLoadingRepositories(false);
    }
  }

  async function handleImport(repository: GitHubRepository) {
    const requestScope = connectionScope;
    if (importingRepositoryId !== null) return;
    setImportingRepositoryId(repository.id);
    setError(null);
    setNotice(null);
    try {
      const source = sanitizeGitHubSource(
        await githubConnectionAdapter.importResource(requestScope, repository),
      );
      await onImportSource(source);
      setNotice(`Imported the README from ${repository.fullName}.`);
    } catch (importError) {
      setError(errorMessage(importError, "Could not import this README."));
    } finally {
      setImportingRepositoryId(null);
    }
  }

  async function handleRevoke() {
    const requestScope = connectionScope;
    if (isRevoking) return;
    setIsRevoking(true);
    setError(null);
    setNotice(null);
    try {
      await githubConnectionAdapter.revoke(requestScope);
      setConnectionView("not_configured");
      setAccountLabel(null);
      setRepositories(null);
      setShowTokenEntry(false);
      reportConnectionStatus(
        reportGitHubStatus({ connected: false, login: null }),
      );
      setNotice("The GitHub token was removed from this device.");
    } catch (revokeError) {
      setError(errorMessage(revokeError, "Could not remove the saved token."));
    } finally {
      setIsRevoking(false);
    }
  }

  const isConnected = connectionView === "connected";
  const shouldShowTokenEntry = !isConnected || showTokenEntry;

  return (
    <section
      className="min-w-0 space-y-5"
      aria-labelledby="business-connections-title"
    >
      <div>
        <h2 id="business-connections-title" className="text-lg font-semibold">
          Business connections
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect read-only sources for this community and identity.
        </p>
      </div>

      <div className="grid gap-4">
        {BUSINESS_CONNECTION_PROVIDERS.map((provider) => (
          <Card key={provider.id} data-provider={provider.id}>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">{provider.name}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {provider.description}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-border/70 px-2 py-1 text-xs text-muted-foreground">
                {provider.availability === "available"
                  ? "Available"
                  : "Planned"}
              </span>
            </CardHeader>

            {provider.id === "github" && (
              <CardContent className="space-y-4">
                <p className="text-sm" role="status" aria-live="polite">
                  {connectionView === "checking" &&
                    "Checking the saved connection…"}
                  {connectionView === "connected" &&
                    `Connected as ${accountLabel}.`}
                  {connectionView === "not_configured" && "Not connected."}
                  {connectionView === "error" &&
                    "Connection status could not be verified."}
                </p>

                {shouldShowTokenEntry && (
                  <form className="space-y-3" onSubmit={handleConnect}>
                    <div className="space-y-1.5">
                      <label
                        htmlFor={tokenInputId}
                        className="text-sm font-medium"
                      >
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
                        disabled={isConnecting || connectionView === "checking"}
                        aria-describedby={`${tokenInputId}-help`}
                      />
                      <p
                        id={`${tokenInputId}-help`}
                        className="text-xs text-muted-foreground"
                      >
                        Use selected repositories with Metadata: read and
                        Contents: read. Buzz does not request write access.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="submit"
                        disabled={
                          !token.trim() ||
                          isConnecting ||
                          connectionView === "checking"
                        }
                      >
                        {isConnecting ? "Verifying…" : "Connect GitHub"}
                      </Button>
                      {isConnected && (
                        <Button
                          type="button"
                          variant="outline"
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
                      onClick={() => void handleLoadRepositories()}
                      disabled={isLoadingRepositories}
                    >
                      {isLoadingRepositories
                        ? "Loading repositories…"
                        : "Browse repositories"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowTokenEntry(true)}
                    >
                      Replace token
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleRevoke()}
                      disabled={isRevoking}
                    >
                      {isRevoking ? "Removing…" : "Disconnect"}
                    </Button>
                  </div>
                )}

                {connectionView === "error" && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void refreshStatus()}
                    >
                      Retry status check
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleRevoke()}
                      disabled={isRevoking}
                    >
                      {isRevoking ? "Removing…" : "Remove saved token"}
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
                              onClick={() => void handleImport(repository)}
                              disabled={importingRepositoryId !== null}
                            >
                              {importingRepositoryId === repository.id
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
                  The token stays on this device in the OS keyring. It is sent
                  only to GitHub’s fixed API origin for read operations.
                </p>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {error && (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          className="rounded-lg border border-border/70 px-3 py-2 text-sm"
          role="status"
          aria-live="polite"
        >
          {notice}
        </p>
      )}
    </section>
  );
}
