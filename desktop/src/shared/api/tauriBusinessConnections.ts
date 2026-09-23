import { invokeTauri } from "@/shared/api/tauri";

export type BusinessConnectionSource = {
  title: string;
  content: string;
  url?: string;
  kind: "url";
};

export type BusinessConnectionImport = BusinessConnectionSource & {
  truncated: boolean;
};

/** Scope captured from the parent workspace render that owns this request. */
export type BusinessConnectionScope = {
  expectedRelayUrl: string;
  expectedSignerPubkey: string;
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

export type NotionConnectionStatus =
  | { connected: false; name: null }
  | { connected: true; name: string };

export type NotionAccount = { id: string; name: string };

export type NotionPageSummary = {
  id: string;
  title: string;
  url: string;
  lastEditedTime: string | null;
};

export type NotionPageSearchResult = {
  pages: NotionPageSummary[];
  hasMore: boolean;
  nextCursor: string | null;
};

type BusinessConnectionInvoker = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

/** Build the provider API around an invoker so scope binding is directly testable. */
export function createBusinessConnectionsApi(
  invoke: BusinessConnectionInvoker,
) {
  function invokeInScope<T>(
    scope: BusinessConnectionScope,
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    return invoke<T>(command, {
      ...args,
      expectedRelayUrl: scope.expectedRelayUrl,
      expectedSignerPubkey: scope.expectedSignerPubkey,
    });
  }

  return {
    async getGitHubConnectionStatus(
      scope: BusinessConnectionScope,
    ): Promise<GitHubConnectionStatus> {
      const status = await invokeInScope<{
        connected: boolean;
        login?: string | null;
      }>(scope, "get_github_connection_status");
      if (!status.connected) return { connected: false, login: null };
      if (typeof status.login !== "string" || !status.login.trim()) {
        throw new Error("GitHub status did not include a verified account.");
      }
      return { connected: true, login: status.login };
    },

    /** Verify a user-entered PAT, then save it in the OS keyring. */
    connectGitHubConnection(
      scope: BusinessConnectionScope,
      token: string,
    ): Promise<GitHubAccount> {
      return invokeInScope(scope, "connect_github_connection", { token });
    },

    /** Remove only the credential for the caller's captured workspace scope. */
    revokeGitHubConnection(scope: BusinessConnectionScope): Promise<void> {
      return invokeInScope(scope, "revoke_github_connection");
    },

    /** Return at most 25 repositories the connected account can access. */
    listGitHubRepositories(
      scope: BusinessConnectionScope,
    ): Promise<GitHubRepository[]> {
      return invokeInScope(scope, "list_github_repositories");
    },

    /** Import a README for a repository in the bounded accessible list. */
    importGitHubReadme(
      scope: BusinessConnectionScope,
      repositoryId: number,
    ): Promise<BusinessConnectionImport> {
      return invokeInScope(scope, "import_github_readme", { repositoryId });
    },

    async getNotionConnectionStatus(
      scope: BusinessConnectionScope,
    ): Promise<NotionConnectionStatus> {
      const status = await invokeInScope<{
        connected: boolean;
        name?: string | null;
      }>(scope, "get_notion_connection_status");
      if (!status.connected) return { connected: false, name: null };
      if (typeof status.name !== "string" || !status.name.trim()) {
        throw new Error(
          "Notion status did not include a verified integration.",
        );
      }
      return { connected: true, name: status.name };
    },

    connectNotionConnection(
      scope: BusinessConnectionScope,
      token: string,
    ): Promise<NotionAccount> {
      return invokeInScope(scope, "connect_notion_connection", { token });
    },

    revokeNotionConnection(scope: BusinessConnectionScope): Promise<void> {
      return invokeInScope(scope, "revoke_notion_connection");
    },

    searchNotionPages(
      scope: BusinessConnectionScope,
      query: string,
      cursor?: string | null,
    ): Promise<NotionPageSearchResult> {
      return invokeInScope(scope, "search_notion_pages", { query, cursor });
    },

    importNotionPage(
      scope: BusinessConnectionScope,
      pageId: string,
    ): Promise<BusinessConnectionImport> {
      return invokeInScope(scope, "import_notion_page", { pageId });
    },
  };
}

const businessConnectionsApi = createBusinessConnectionsApi(invokeTauri);

export const getGitHubConnectionStatus =
  businessConnectionsApi.getGitHubConnectionStatus;
export const connectGitHubConnection =
  businessConnectionsApi.connectGitHubConnection;
export const revokeGitHubConnection =
  businessConnectionsApi.revokeGitHubConnection;
export const listGitHubRepositories =
  businessConnectionsApi.listGitHubRepositories;
export const importGitHubReadme = businessConnectionsApi.importGitHubReadme;
export const getNotionConnectionStatus =
  businessConnectionsApi.getNotionConnectionStatus;
export const connectNotionConnection =
  businessConnectionsApi.connectNotionConnection;
export const revokeNotionConnection =
  businessConnectionsApi.revokeNotionConnection;
export const searchNotionPages = businessConnectionsApi.searchNotionPages;
export const importNotionPage = businessConnectionsApi.importNotionPage;
