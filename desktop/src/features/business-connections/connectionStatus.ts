import type {
  GitHubConnectionStatus,
  NotionConnectionStatus,
} from "@/shared/api/tauriBusinessConnections";

type UnverifiedStatusReport = {
  state: "checking" | "not_connected" | "unknown";
  verified: false;
};

export type BusinessConnectionStatusReport =
  | (UnverifiedStatusReport & { providerId: "github" })
  | {
      providerId: "github";
      state: "connected";
      verified: true;
      login: string;
    }
  | (UnverifiedStatusReport & { providerId: "notion" })
  | {
      providerId: "notion";
      state: "connected";
      verified: true;
      name: string;
    };

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

export function checkingNotionStatus(): BusinessConnectionStatusReport {
  return { providerId: "notion", state: "checking", verified: false };
}

export function unknownNotionStatus(): BusinessConnectionStatusReport {
  return { providerId: "notion", state: "unknown", verified: false };
}

export function reportNotionStatus(
  status: NotionConnectionStatus,
): BusinessConnectionStatusReport {
  if (!status.connected) {
    return { providerId: "notion", state: "not_connected", verified: false };
  }
  if (typeof status.name !== "string" || !status.name.trim()) {
    return unknownNotionStatus();
  }
  return {
    providerId: "notion",
    state: "connected",
    verified: true,
    name: status.name,
  };
}

export function reportVerifiedNotionName(name: string) {
  return reportNotionStatus({ connected: true, name });
}
