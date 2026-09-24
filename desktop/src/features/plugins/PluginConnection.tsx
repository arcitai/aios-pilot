import * as React from "react";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  BusinessConnectionsPanel,
  type BusinessConnectionProviderId,
} from "@/features/business-connections";
import { useBusinessWorkspace } from "@/features/business/useBusinessWorkspace";
import type { BusinessConnectionSource } from "@/shared/api/tauriBusinessConnections";
import { Button } from "@/shared/ui/button";

/** Keep credential setup independent from the selected knowledge import destination. */
export function PluginConnection({
  providerId,
}: {
  providerId: BusinessConnectionProviderId;
}) {
  const workspace = useBusinessWorkspace();
  const navigation = useAppNavigation();
  const document = workspace.context.data?.document;
  const destination = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    destination.current = workspace.channel?.id ?? null;
    return () => {
      destination.current = null;
    };
  }, [workspace.channel?.id]);
  const error =
    workspace.error ??
    workspace.channels.error?.message ??
    workspace.context.error?.message;
  async function importSource(source: BusinessConnectionSource) {
    if (!document || !workspace.channel)
      throw new Error(
        "Create or load company context in Business before importing a source.",
      );
    if (!destination.current || destination.current !== workspace.channel.id) {
      throw new Error(
        "The import destination changed. Retry for the selected business.",
      );
    }
    if (
      source.url &&
      document.sources.some((saved) => saved.url === source.url)
    )
      throw new Error(
        "This source is already saved in Business. Review it there before importing it again.",
      );
    await workspace.save({
      ...document,
      sources: [
        ...document.sources,
        {
          ...source,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        },
      ],
    });
  }
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        These connections run on this computer. Credentials stay in its
        keychain; only the source material you choose is saved to Business.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="space-y-2">
          {document ? (
            <p>
              Import into{" "}
              <strong className="font-medium">{document.company.name}</strong>.
              People and agents invited to that context can read imported
              material.
            </p>
          ) : (
            <p>
              Create company context in Business when you are ready to import a
              source.
            </p>
          )}
          {(workspace.channels.data?.length ?? 0) > 1 ? (
            <select
              aria-label="Import into business"
              value={workspace.channel?.id}
              disabled={workspace.busy}
              className="rounded-md border bg-background p-2 text-sm"
              onChange={(event) => workspace.setSelectedId(event.target.value)}
            >
              {workspace.channels.data?.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void navigation.goBusiness()}
        >
          Open Business
        </Button>
      </div>
      {error ? (
        <div className="space-y-2 text-sm" role="alert">
          <p className="text-destructive">{error}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void workspace.channels.refetch();
              if (workspace.channel) void workspace.reload();
            }}
          >
            Reload saved context
          </Button>
        </div>
      ) : null}
      {workspace.notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {workspace.notice}
        </p>
      ) : null}
      <BusinessConnectionsPanel
        {...workspace.canvasScope}
        providerId={providerId}
        showHeading={false}
        onImportSource={importSource}
      />
    </div>
  );
}
