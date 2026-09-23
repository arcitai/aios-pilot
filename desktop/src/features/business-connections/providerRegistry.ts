import type {
  BusinessConnectionScope,
  BusinessConnectionSource,
} from "@/shared/api/tauriBusinessConnections";

export type BusinessConnectionProviderId = "github" | "google" | "notion";
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

/** Small adapter contract shared by real provider modules. */
export interface BusinessConnectionAdapter<Credential, Resource> {
  readonly descriptor: BusinessConnectionProviderDescriptor;
  connect(
    scope: BusinessConnectionScope,
    credential: Credential,
  ): Promise<ProviderAccount>;
  status(scope: BusinessConnectionScope): Promise<ProviderConnectionStatus>;
  revoke(scope: BusinessConnectionScope): Promise<void>;
  listResources(scope: BusinessConnectionScope): Promise<readonly Resource[]>;
  importResource(
    scope: BusinessConnectionScope,
    resource: Resource,
  ): Promise<BusinessConnectionSource>;
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
    name: "Google",
    availability: "planned",
    description: "Not connected yet.",
  },
  {
    id: "notion",
    name: "Notion",
    availability: "planned",
    description: "Not connected yet.",
  },
] as const satisfies readonly BusinessConnectionProviderDescriptor[];
