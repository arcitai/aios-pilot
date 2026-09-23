import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  BUSINESS_CONNECTION_PROVIDERS,
  type BusinessConnectionProviderId,
} from "./providerRegistry";

export type SharedConnectionAction =
  | "github:connect"
  | "github:revoke"
  | "github:list"
  | "github:import"
  | "github:status"
  | "notion:connect"
  | "notion:revoke"
  | "notion:list"
  | "notion:import"
  | "notion:status";

export type RunConnectionAction = (
  action: SharedConnectionAction,
  operation: () => Promise<void>,
) => Promise<boolean>;

export function ProviderCard({
  providerId,
  children,
}: {
  providerId: BusinessConnectionProviderId;
  children: ReactNode;
}) {
  const provider = BUSINESS_CONNECTION_PROVIDERS.find(
    (item) => item.id === providerId,
  );
  if (!provider) throw new Error(`Missing ${providerId} provider descriptor.`);

  return (
    <Card data-provider={provider.id}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">{provider.name}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {provider.description}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-border/70 px-2 py-1 text-xs text-muted-foreground">
          {provider.availability === "available" ? "Available" : "Planned"}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
