import {
  connectGitHubConnection,
  getGitHubConnectionStatus,
  importGitHubReadme,
  listGitHubRepositories,
  revokeGitHubConnection,
  type GitHubRepository,
} from "@/shared/api/tauriBusinessConnections";
import type { BusinessConnectionAdapter } from "../providerRegistry";
import { BUSINESS_CONNECTION_PROVIDERS } from "../providerRegistry";

const githubDescriptor = BUSINESS_CONNECTION_PROVIDERS.find(
  (provider) => provider.id === "github",
);

if (githubDescriptor?.availability !== "available") {
  throw new Error("GitHub provider registry entry is unavailable.");
}

export const githubConnectionAdapter: BusinessConnectionAdapter<
  string,
  GitHubRepository
> = {
  descriptor: githubDescriptor,
  async connect(scope, token) {
    const account = await connectGitHubConnection(scope, token);
    return { id: account.login, label: `@${account.login}` };
  },
  async status(scope) {
    const status = await getGitHubConnectionStatus(scope);
    return status.connected
      ? {
          connected: true,
          account: { id: status.login, label: `@${status.login}` },
        }
      : { connected: false };
  },
  revoke(scope) {
    return revokeGitHubConnection(scope);
  },
  async listResources(scope) {
    return {
      items: await listGitHubRepositories(scope),
      hasMore: false,
      nextCursor: null,
    };
  },
  async importResource(scope, repository) {
    return importGitHubReadme(scope, repository.id);
  },
};
