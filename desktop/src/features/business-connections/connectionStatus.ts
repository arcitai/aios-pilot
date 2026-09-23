import type { GitHubConnectionStatus } from "@/shared/api/tauriBusinessConnections";

export type BusinessConnectionStatusReport =
  | {
      providerId: "github";
      state: "checking" | "not_connected" | "unknown";
      verified: false;
    }
  | { providerId: "github"; state: "connected"; verified: true; login: string };

export function checkingGitHubStatus(): BusinessConnectionStatusReport {
  return { providerId: "github", state: "checking", verified: false };
}

export function unknownGitHubStatus(): BusinessConnectionStatusReport {
  return { providerId: "github", state: "unknown", verified: false };
}

export function reportGitHubStatus(
  status: GitHubConnectionStatus,
): BusinessConnectionStatusReport {
  if (!status.connected) {
    return { providerId: "github", state: "not_connected", verified: false };
  }
  if (typeof status.login !== "string" || !status.login.trim()) {
    return unknownGitHubStatus();
  }
  return {
    providerId: "github",
    state: "connected",
    verified: true,
    login: status.login,
  };
}

/** A successful connect command returns only after GET /user and keyring write. */
export function reportVerifiedGitHubLogin(login: string) {
  return reportGitHubStatus({ connected: true, login });
}
