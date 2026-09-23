import { invokeTauri } from "@/shared/api/tauri";

export type BusinessConnectionSource = {
  title: string;
  content: string;
  url?: string;
  kind: "url";
};

export type GitHubConnectionStatus =
  | { connected: false; login: null }
  | { connected: true; login: string };

export type GitHubAccount = {
  login: string;
  avatarUrl?: string | null;
};

export type GitHubRepository = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description?: string | null;
  url: string;
};

type ActiveWorkspace = {
  relay_url: string;
  pubkey: string;
};

async function invokeInActiveScope<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const active = await invokeTauri<ActiveWorkspace>("get_active_workspace");
  return invokeTauri<T>(command, {
    ...args,
    expectedRelayUrl: active.relay_url,
    expectedPubkey: active.pubkey,
  });
}

/** Verify the saved token with GitHub before returning a connected status. */
export async function getGitHubConnectionStatus(): Promise<GitHubConnectionStatus> {
  const status = await invokeInActiveScope<{
    connected: boolean;
    login?: string | null;
  }>("get_github_connection_status");
  if (!status.connected) return { connected: false, login: null };
  if (typeof status.login !== "string" || !status.login.trim()) {
    throw new Error("GitHub status did not include a verified account.");
  }
  return { connected: true, login: status.login };
}

/** Verify a user-entered PAT with GitHub, then save it in the OS keyring. */
export function connectGitHubConnection(token: string): Promise<GitHubAccount> {
  return invokeInActiveScope("connect_github_connection", { token });
}

/** Remove the current community and identity's GitHub token from the keyring. */
export function revokeGitHubConnection(): Promise<void> {
  return invokeInActiveScope("revoke_github_connection");
}

/** Return at most 25 repositories the connected account can access. */
export function listGitHubRepositories(): Promise<GitHubRepository[]> {
  return invokeInActiveScope("list_github_repositories");
}

/** Import a README for a repository in the bounded accessible-repository list. */
export function importGitHubReadme(
  repositoryId: number,
): Promise<BusinessConnectionSource> {
  return invokeInActiveScope("import_github_readme", { repositoryId });
}
