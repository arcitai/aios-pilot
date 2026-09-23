import type {
  GitHubConnectionStatus,
  GoogleDriveConnectionStatus,
  NotionConnectionStatus,
  SlackConnectionStatus,
} from "@/shared/api/tauriBusinessConnections";

type UnverifiedStatusReport = {
  state: "checking" | "not_connected" | "unknown";
  verified: false;
};

export type BusinessConnectionStatusReport =
  | (UnverifiedStatusReport & { providerId: "google" })
  | {
      providerId: "google";
      state: "connected";
      verified: true;
      label: "Google Drive";
    }
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
    }
  | (UnverifiedStatusReport & { providerId: "slack" })
  | {
      providerId: "slack";
      state: "connected";
      verified: true;
      workspaceName: string;
    };

export function checkingGoogleDriveStatus(): BusinessConnectionStatusReport {
  return { providerId: "google", state: "checking", verified: false };
}

export function unknownGoogleDriveStatus(): BusinessConnectionStatusReport {
  return { providerId: "google", state: "unknown", verified: false };
}

export function reportGoogleDriveStatus(
  status: GoogleDriveConnectionStatus,
): BusinessConnectionStatusReport {
  return status.connected
    ? {
        providerId: "google",
        state: "connected",
        verified: true,
        label: "Google Drive",
      }
    : { providerId: "google", state: "not_connected", verified: false };
}

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

export function checkingSlackStatus(): BusinessConnectionStatusReport {
  return { providerId: "slack", state: "checking", verified: false };
}

export function unknownSlackStatus(): BusinessConnectionStatusReport {
  return { providerId: "slack", state: "unknown", verified: false };
}

export function reportSlackStatus(
  status: SlackConnectionStatus,
): BusinessConnectionStatusReport {
  if (!status.connected) {
    return { providerId: "slack", state: "not_connected", verified: false };
  }
  if (
    typeof status.workspaceId !== "string" ||
    !/^T[A-Z0-9]{7,31}$/.test(status.workspaceId) ||
    typeof status.workspaceName !== "string" ||
    !status.workspaceName.trim()
  ) {
    return unknownSlackStatus();
  }
  return {
    providerId: "slack",
    state: "connected",
    verified: true,
    workspaceName: status.workspaceName,
  };
}

export function reportVerifiedSlackWorkspace(
  workspaceId: string,
  workspaceName: string,
) {
  return reportSlackStatus({ connected: true, workspaceId, workspaceName });
}
