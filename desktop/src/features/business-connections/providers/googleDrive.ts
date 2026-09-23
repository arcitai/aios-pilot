import {
  connectGoogleDriveConnection,
  getGoogleDriveConnectionStatus,
  importGoogleDriveDocument,
  revokeGoogleDriveConnection,
  searchGoogleDriveFiles,
  type GoogleDriveFile,
} from "@/shared/api/tauriBusinessConnections";
import type {
  BusinessConnectionAdapter,
  ProviderListOptions,
} from "../providerRegistry";
import { BUSINESS_CONNECTION_PROVIDERS } from "../providerRegistry";

const googleDriveDescriptor = BUSINESS_CONNECTION_PROVIDERS.find(
  (provider) => provider.id === "google",
);

if (googleDriveDescriptor?.availability !== "available") {
  throw new Error("Google Drive provider registry entry is unavailable.");
}

export const googleDriveConnectionAdapter: BusinessConnectionAdapter<
  undefined,
  GoogleDriveFile,
  ProviderListOptions
> = {
  descriptor: googleDriveDescriptor,
  async connect(scope) {
    await connectGoogleDriveConnection(scope);
    return { id: "google-drive", label: "Google Drive" };
  },
  async status(scope) {
    const status = await getGoogleDriveConnectionStatus(scope);
    return status.connected
      ? {
          connected: true,
          account: { id: "google-drive", label: "Google Drive" },
        }
      : { connected: false };
  },
  revoke(scope) {
    return revokeGoogleDriveConnection(scope);
  },
  async listResources(scope, options) {
    const result = await searchGoogleDriveFiles(
      scope,
      options?.query ?? "",
      options?.cursor,
    );
    return {
      items: result.files,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    };
  },
  importResource(scope, file) {
    return importGoogleDriveDocument(scope, file.id);
  },
};
