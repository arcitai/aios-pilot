import type {
  BusinessConnectionImport,
  BusinessConnectionScope,
} from "@/shared/api/tauriBusinessConnections";

export type BusinessConnectionProviderId =
  | "github"
  | "google"
  | "notion"
  | "slack";
export type ProviderAvailability = "available" | "planned";

export type BusinessConnectionProviderDescriptor = {
  id: BusinessConnectionProviderId;
  name: string;
  availability: ProviderAvailability;
  description: string;
};

export type ProviderAccount = {
  id: string;
  label: string;
};

export type ProviderConnectionStatus =
  | { connected: false }
  | { connected: true; account: ProviderAccount };

export type ProviderResourcePage<Resource> = {
  items: readonly Resource[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type ProviderListOptions = {
  query?: string;
  cursor?: string | null;
};

/** Small adapter contract shared by real provider modules. */
export interface BusinessConnectionAdapter<
  Credential,
  Resource,
  Options extends ProviderListOptions = ProviderListOptions,
> {
  readonly descriptor: BusinessConnectionProviderDescriptor;
  connect(
    scope: BusinessConnectionScope,
    credential: Credential,
  ): Promise<ProviderAccount>;
  status(scope: BusinessConnectionScope): Promise<ProviderConnectionStatus>;
  revoke(scope: BusinessConnectionScope): Promise<void>;
  listResources(
    scope: BusinessConnectionScope,
    options?: Options,
  ): Promise<ProviderResourcePage<Resource>>;
  importResource(
    scope: BusinessConnectionScope,
    resource: Resource,
  ): Promise<BusinessConnectionImport>;
}

/** Planned providers have no adapter and cannot be used as active connections. */
export const BUSINESS_CONNECTION_PROVIDERS = [
  {
    id: "github",
    name: "GitHub",
    availability: "available",
    description: "Browse read-only repository metadata and import a README.",
  },
  {
    id: "google",
    name: "Google Drive",
    availability: "available",
    description: "Search Docs and import text from a document you select.",
  },
  {
    id: "notion",
    name: "Notion",
    availability: "available",
    description: "Search shared pages and import their text read-only.",
  },
  {
    id: "slack",
    name: "Slack",
    availability: "available",
    description: "Choose a channel and import recent messages read-only.",
  },
] as const satisfies readonly BusinessConnectionProviderDescriptor[];
