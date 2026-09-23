import {
  connectNotionConnection,
  getNotionConnectionStatus,
  importNotionPage,
  revokeNotionConnection,
  searchNotionPages,
  type NotionPageSummary,
} from "@/shared/api/tauriBusinessConnections";
import type {
  BusinessConnectionAdapter,
  ProviderListOptions,
} from "../providerRegistry";
import { BUSINESS_CONNECTION_PROVIDERS } from "../providerRegistry";

const notionDescriptor = BUSINESS_CONNECTION_PROVIDERS.find(
  (provider) => provider.id === "notion",
);

if (notionDescriptor?.availability !== "available") {
  throw new Error("Notion provider registry entry is unavailable.");
}

export const notionConnectionAdapter: BusinessConnectionAdapter<
  string,
  NotionPageSummary,
  ProviderListOptions
> = {
  descriptor: notionDescriptor,
  async connect(scope, token) {
    const account = await connectNotionConnection(scope, token);
    return { id: account.id, label: account.name };
  },
  async status(scope) {
    const status = await getNotionConnectionStatus(scope);
    return status.connected
      ? {
          connected: true,
          account: { id: status.name, label: status.name },
        }
      : { connected: false };
  },
  revoke(scope) {
    return revokeNotionConnection(scope);
  },
  async listResources(scope, options) {
    const result = await searchNotionPages(
      scope,
      options?.query ?? "",
      options?.cursor,
    );
    return {
      items: result.pages,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    };
  },
  importResource(scope, page) {
    return importNotionPage(scope, page.id);
  },
};
