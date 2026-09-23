import {
  connectSlackConnection,
  getSlackConnectionStatus,
  importSlackHistory,
  listSlackChannels,
  revokeSlackConnection,
  type SlackChannel,
} from "@/shared/api/tauriBusinessConnections";
import type {
  BusinessConnectionAdapter,
  ProviderListOptions,
} from "../providerRegistry";
import { BUSINESS_CONNECTION_PROVIDERS } from "../providerRegistry";

const slackDescriptor = BUSINESS_CONNECTION_PROVIDERS.find(
  (provider) => provider.id === "slack",
);

if (slackDescriptor?.availability !== "available") {
  throw new Error("Slack provider registry entry is unavailable.");
}

export const slackConnectionAdapter: BusinessConnectionAdapter<
  string,
  SlackChannel,
  ProviderListOptions
> = {
  descriptor: slackDescriptor,
  async connect(scope, token) {
    const workspace = await connectSlackConnection(scope, token);
    return { id: workspace.teamId, label: workspace.name };
  },
  async status(scope) {
    const status = await getSlackConnectionStatus(scope);
    return status.connected
      ? {
          connected: true,
          account: { id: status.workspaceId, label: status.workspaceName },
        }
      : { connected: false };
  },
  revoke(scope) {
    return revokeSlackConnection(scope);
  },
  async listResources(scope, options) {
    const result = await listSlackChannels(scope, options?.cursor);
    return {
      items: result.channels,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    };
  },
  importResource(scope, channel) {
    return importSlackHistory(scope, channel.id);
  },
};
