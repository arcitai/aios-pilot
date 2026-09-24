import * as React from "react";

import type {
  BusinessConnectionScope,
  BusinessConnectionSource,
} from "@/shared/api/tauriBusinessConnections";
import { GitHubConnectionCard } from "./GitHubConnectionCard";
import { GoogleDriveConnectionCard } from "./GoogleDriveConnectionCard";
import { NotionConnectionCard } from "./NotionConnectionCard";
import { SlackConnectionCard } from "./SlackConnectionCard";
import type { BusinessConnectionStatusReport } from "./connectionStatus";
import {
  ProviderCard,
  type RunConnectionAction,
  type SharedConnectionAction,
} from "./ProviderCard";
import {
  BUSINESS_CONNECTION_PROVIDERS,
  type BusinessConnectionProviderDescriptor,
  type BusinessConnectionProviderId,
} from "./providerRegistry";

export type BusinessConnectionsPanelProps = BusinessConnectionScope & {
  onImportSource: (source: BusinessConnectionSource) => Promise<void>;
  onConnectionStatus?: (status: BusinessConnectionStatusReport) => void;
  providerId?: BusinessConnectionProviderId;
  showHeading?: boolean;
};

/** Local, read-only providers for importing source material. */
export function BusinessConnectionsPanel({
  expectedRelayUrl,
  expectedSignerPubkey,
  onImportSource,
  onConnectionStatus,
  providerId,
  showHeading = true,
}: BusinessConnectionsPanelProps) {
  const scope = React.useMemo(
    () => ({ expectedRelayUrl, expectedSignerPubkey }),
    [expectedRelayUrl, expectedSignerPubkey],
  );
  const callbackRef = React.useRef(onConnectionStatus);
  const busyRef = React.useRef(false);
  const [busyAction, setBusyAction] =
    React.useState<SharedConnectionAction | null>(null);

  React.useEffect(() => {
    callbackRef.current = onConnectionStatus;
  }, [onConnectionStatus]);

  const reportStatus = React.useCallback(
    (status: BusinessConnectionStatusReport) => {
      try {
        callbackRef.current?.(status);
      } catch {
        // Provider cards keep their own status errors visible in their surfaces.
      }
    },
    [],
  );

  const runAction = React.useCallback<RunConnectionAction>(
    async (action, operation) => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusyAction(action);
      try {
        await operation();
        return true;
      } finally {
        busyRef.current = false;
        setBusyAction(null);
      }
    },
    [],
  );

  const providerDescriptors: readonly BusinessConnectionProviderDescriptor[] =
    BUSINESS_CONNECTION_PROVIDERS;
  const plannedProviders = providerDescriptors.filter(
    (provider) => provider.availability === "planned",
  );

  return (
    <section className="min-w-0 space-y-5" aria-label="Connection setup">
      <div>
        {showHeading ? (
          <>
            <h2
              id="business-connections-title"
              className="text-lg font-semibold"
            >
              Business connections
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect read-only sources for this community and identity.
            </p>
          </>
        ) : null}
        {busyAction && (
          <p className="sr-only" role="status" aria-live="polite">
            {`Working on ${busyAction.replace(":", " ")}.`}
          </p>
        )}
      </div>

      <div className="grid gap-4">
        {(!providerId || providerId === "github") && (
          <GitHubConnectionCard
            scope={scope}
            busyAction={busyAction}
            runAction={runAction}
            onImportSource={onImportSource}
            onConnectionStatus={reportStatus}
          />
        )}
        {(!providerId || providerId === "google") && (
          <GoogleDriveConnectionCard
            scope={scope}
            busyAction={busyAction}
            runAction={runAction}
            onImportSource={onImportSource}
            onConnectionStatus={reportStatus}
          />
        )}
        {(!providerId || providerId === "notion") && (
          <NotionConnectionCard
            scope={scope}
            busyAction={busyAction}
            runAction={runAction}
            onImportSource={onImportSource}
            onConnectionStatus={reportStatus}
          />
        )}
        {(!providerId || providerId === "slack") && (
          <SlackConnectionCard
            scope={scope}
            busyAction={busyAction}
            runAction={runAction}
            onImportSource={onImportSource}
            onConnectionStatus={reportStatus}
          />
        )}
        {plannedProviders
          .filter((provider) => !providerId || provider.id === providerId)
          .map((provider) => (
            <ProviderCard key={provider.id} providerId={provider.id}>
              <p className="text-sm text-muted-foreground">
                Not connected yet.
              </p>
            </ProviderCard>
          ))}
      </div>
    </section>
  );
}
