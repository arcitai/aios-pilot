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
} from "./providerRegistry";

export type BusinessConnectionsPanelProps = BusinessConnectionScope & {
  onImportSource: (source: BusinessConnectionSource) => Promise<void>;
  onConnectionStatus?: (status: BusinessConnectionStatusReport) => void;
};

/** Local, read-only providers for importing source material. */
export function BusinessConnectionsPanel({
  expectedRelayUrl,
  expectedSignerPubkey,
  onImportSource,
  onConnectionStatus,
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
    <section
      className="min-w-0 space-y-5"
      aria-labelledby="business-connections-title"
    >
      <div>
        <h2 id="business-connections-title" className="text-lg font-semibold">
          Business connections
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect read-only sources for this community and identity.
        </p>
        {busyAction && (
          <p className="sr-only" role="status" aria-live="polite">
            {`Working on ${busyAction.replace(":", " ")}.`}
          </p>
        )}
      </div>

      <div className="grid gap-4">
        <GitHubConnectionCard
          scope={scope}
          busyAction={busyAction}
          runAction={runAction}
          onImportSource={onImportSource}
          onConnectionStatus={reportStatus}
        />
        <GoogleDriveConnectionCard
          scope={scope}
          busyAction={busyAction}
          runAction={runAction}
          onImportSource={onImportSource}
          onConnectionStatus={reportStatus}
        />
        <NotionConnectionCard
          scope={scope}
          busyAction={busyAction}
          runAction={runAction}
          onImportSource={onImportSource}
          onConnectionStatus={reportStatus}
        />
        <SlackConnectionCard
          scope={scope}
          busyAction={busyAction}
          runAction={runAction}
          onImportSource={onImportSource}
          onConnectionStatus={reportStatus}
        />
        {plannedProviders.map((provider) => (
          <ProviderCard key={provider.id} providerId={provider.id}>
            <p className="text-sm text-muted-foreground">Not connected yet.</p>
          </ProviderCard>
        ))}
      </div>
    </section>
  );
}
