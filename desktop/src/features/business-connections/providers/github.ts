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
  async connect(token) {
    const account = await connectGitHubConnection(token);
    return { id: account.login, label: `@${account.login}` };
  },
  async status() {
    const status = await getGitHubConnectionStatus();
    return status.connected
      ? {
          connected: true,
          account: { id: status.login, label: `@${status.login}` },
        }
      : { connected: false };
  },
  revoke: revokeGitHubConnection,
  listResources: listGitHubRepositories,
  async importResource(repository) {
    return importGitHubReadme(repository.id);
  },
};
