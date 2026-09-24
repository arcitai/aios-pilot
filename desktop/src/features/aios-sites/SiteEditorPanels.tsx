import type { Channel } from "@/shared/api/types";
import type { SiteDocument, SiteFiles } from "./document";
import { SiteAccessPanel } from "./SiteAccessPanel";
import { SiteCodeEditor } from "./SiteCodeEditor";
import { SitePreview } from "./SitePreview";
import { SiteVersionHistory } from "./SiteVersionHistory";
import type { WorkspaceContext } from "./workspaceTypes";

export function SiteEditorPanels({
  channel,
  context,
  businessChannelId,
  document,
  revision,
  disabled,
  previewUrl,
  previewError,
  previewLoading,
  previewConfigured,
  previewIsCurrent,
  previewExpiresAt,
  onUpdateFile,
  onRunPreview,
  onMembershipChanged,
  onSelectHistory,
}: {
  channel: Channel;
  context: WorkspaceContext;
  businessChannelId: string;
  document: SiteDocument;
  revision: string;
  disabled: boolean;
  previewUrl: string | null;
  previewError: string | null;
  previewLoading: boolean;
  previewConfigured: boolean;
  previewIsCurrent: boolean;
  previewExpiresAt: number | null;
  onUpdateFile: (file: keyof SiteFiles, content: string) => void;
  onRunPreview: () => void;
  onMembershipChanged: () => void;
  onSelectHistory: (document: SiteDocument, revision: string) => void;
}) {
  return (
    <>
      <SitePreview
        isCurrentSnapshot={previewIsCurrent}
        previewExpiresAt={previewExpiresAt}
        configured={previewConfigured}
        disabled={disabled}
        error={previewError}
        loading={previewLoading}
        onRun={onRunPreview}
        previewUrl={previewUrl}
      />
      <details className="rounded-xl border border-border/50 bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Edit code
        </summary>
        <div className="mt-4">
          <SiteCodeEditor
            disabled={disabled}
            onChange={onUpdateFile}
            value={document.files}
          />
        </div>
      </details>
      <details className="rounded-xl border border-border/50 bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Access and version history
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <SiteAccessPanel
            channelId={channel.id}
            channelName={channel.name}
            disabled={disabled}
            memberCount={channel.memberCount}
            onMembershipChanged={onMembershipChanged}
            scope={context.scope}
          />
          <SiteVersionHistory
            currentRevision={revision}
            disabled={disabled}
            key={`${channel.id}:${revision}`}
            onSelect={onSelectHistory}
            parentBusinessChannelId={businessChannelId}
            scope={context.scope}
            channelId={channel.id}
          />
        </div>
      </details>
    </>
  );
}
