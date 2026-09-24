import {
  AlertTriangle,
  ArrowDownToLine,
  FileJson2,
  Globe2,
  LockKeyhole,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { siteDownloadName } from "./document";
import { SiteDocumentDetails } from "./SiteDocumentDetails";
import { SiteEditorPanels } from "./SiteEditorPanels";
import { SiteMainAgentPanel } from "./SiteMainAgentPanel";
import { SitesSidebar } from "./SitesSidebar";
import { SitesPublisherPanel } from "./SitesPublisherPanel";
import { SitesWorkspaceDialogs } from "./SitesWorkspaceDialogs";
import { buildStandaloneHtml } from "./preview";
import {
  downloadDraftJson,
  downloadText,
  errorMessage,
} from "./workspaceModel";
import { useSitesWorkspace } from "./useSitesWorkspace";
import { useSitesPublisher } from "./useSitesPublisher";
import type { SitesWorkspaceProps } from "./workspaceTypes";

export type { SitesWorkspaceProps } from "./workspaceTypes";

export function SitesWorkspace({
  businessChannelId,
  expectedRelayUrl,
  expectedSignerPubkey,
  companyName,
  onDirtyChange,
  renderConversation,
}: SitesWorkspaceProps) {
  const workspace = useSitesWorkspace({
    businessChannelId,
    expectedRelayUrl,
    expectedSignerPubkey,
    onDirtyChange,
  });
  const { context, selectedChannel, draft } = workspace;
  const publisher = useSitesPublisher({
    expectedRelayUrl,
    expectedSignerPubkey,
    siteId: selectedChannel?.id ?? null,
    document: draft,
    canPublish:
      !!draft &&
      workspace.canEdit &&
      !workspace.isBusy &&
      !workspace.isDirty &&
      !workspace.isSaving &&
      !workspace.isCreating &&
      !workspace.contextIsBlocked,
  });

  function downloadStandalone() {
    if (!draft) return;
    try {
      downloadText(
        siteDownloadName(draft.title),
        buildStandaloneHtml(draft),
        "text/html;charset=utf-8",
      );
      workspace.setStatus(
        "Downloaded a standalone HTML file with this site’s HTML, CSS, and JavaScript.",
      );
    } catch (cause) {
      workspace.setSaveError(errorMessage(cause));
    }
  }

  function runPreview() {
    if (!draft || !workspace.canEdit || !publisher.connected) return;
    void publisher.runPreview();
  }

  const editorDisabled = !workspace.canEdit || workspace.isBusy;

  return (
    <section
      className="@container flex h-full min-h-0 min-w-0 flex-col"
      data-testid="aios-sites-workspace"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border/50 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Globe2 className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold">Sites & webapps</h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted/55 px-2 py-0.5 text-2xs text-muted-foreground">
                <LockKeyhole className="size-3" /> Private drafts
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {companyName ? `For ${companyName} · ` : ""}Create, preview and
              share a page for your business.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={workspace.isBusy || workspace.contextIsBlocked}
            onClick={workspace.refreshWorkspace}
            size="sm"
            variant="ghost"
          >
            <RefreshCw
              className={workspace.isLoadingChannels ? "animate-spin" : ""}
            />{" "}
            Refresh
          </Button>
          <Button
            disabled={
              !draft ||
              !workspace.canEdit ||
              workspace.contextIsBlocked ||
              workspace.isSaving ||
              workspace.isCreating ||
              !workspace.isDirty ||
              workspace.siteIsTooLarge ||
              workspace.canvasConflict !== null
            }
            onClick={workspace.saveDraft}
            size="sm"
          >
            <Save />{" "}
            {workspace.isSaving || workspace.isCreating ? "Saving…" : "Save"}
          </Button>
          <Button
            disabled={!draft || workspace.isBusy}
            onClick={downloadStandalone}
            size="sm"
            variant="outline"
          >
            <ArrowDownToLine /> Export HTML
          </Button>
        </div>
      </header>

      {workspace.contextIsBlocked ? (
        <div
          className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-5 py-3"
          role="alert"
        >
          <AlertTriangle className="size-4 shrink-0 text-amber-600" />
          <p className="min-w-0 flex-1 text-xs leading-relaxed">
            The business workspace, relay, or signer changed while this draft
            was open. Saving is paused so it cannot cross into the new
            workspace. Export the draft, or discard it to continue there.
          </p>
          {draft ? (
            <Button
              onClick={() => downloadDraftJson(draft)}
              size="xs"
              variant="outline"
            >
              Download draft JSON
            </Button>
          ) : null}
          <Button
            onClick={workspace.discardAndSwitch}
            size="xs"
            variant="destructive"
          >
            Discard and switch
          </Button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 [@container(min-width:76rem)]:grid-cols-[15rem_minmax(0,1fr)]">
        <SitesSidebar
          channels={workspace.siteChannels}
          disabled={workspace.isBusy || workspace.contextIsBlocked}
          hasLoadError={workspace.loadError !== null}
          isCreating={workspace.isCreating}
          isLoading={workspace.isLoadingChannels}
          onCreate={(title) =>
            workspace.runAfterDraftDecision(
              () => void workspace.createSite(title),
            )
          }
          onOpen={workspace.openSite}
          selectedChannelId={workspace.selectedChannelId}
        />

        <main className="min-h-0 min-w-0 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[112rem] flex-col gap-4 p-4 sm:p-5 xl:p-6">
            {workspace.loadError ? (
              <div
                className="rounded-xl border border-destructive/30 bg-destructive/5 p-4"
                role="alert"
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      Could not open this site
                    </p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {workspace.loadError}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Its canvas has not been changed. Check access and relay
                      status, then refresh. Malformed documents are rejected
                      instead of being overwritten.
                    </p>
                    {workspace.malformedCanvas ? (
                      <Button
                        className="mt-3"
                        onClick={workspace.downloadRawCanvas}
                        size="sm"
                        variant="outline"
                      >
                        <FileJson2 /> Download untouched canvas
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {!selectedChannel &&
            !workspace.loadError &&
            !workspace.isLoadingChannels ? (
              <div className="mx-auto flex min-h-[35rem] max-w-xl flex-col items-center justify-center px-6 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Globe2 className="size-6" />
                </span>
                <h2 className="mt-5 text-xl font-semibold tracking-tight">
                  Make a useful page for your business
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Start with a landing page, a small internal tool, or a web
                  app. Work with your main agent, preview the result and choose
                  when to share it. Your drafts start private.
                </p>
                <Button
                  className="mt-5"
                  onClick={() =>
                    workspace.runAfterDraftDecision(
                      () => void workspace.createSite("New site"),
                    )
                  }
                >
                  <Sparkles /> Create a site
                </Button>
              </div>
            ) : null}

            {selectedChannel && draft ? (
              <>
                <SiteDocumentDetails
                  canEdit={workspace.canEdit}
                  channel={selectedChannel}
                  conflict={workspace.canvasConflict}
                  draft={draft}
                  isBusy={workspace.isBusy}
                  isDirty={workspace.isDirty}
                  isTooLarge={workspace.siteIsTooLarge}
                  onChangeTitle={(title) =>
                    workspace.updateDraft((current) => ({ ...current, title }))
                  }
                  onDownloadDraft={workspace.downloadDraft}
                  onRequestOverwrite={() =>
                    workspace.setShowConflictOverwrite(true)
                  }
                  onUseLatest={workspace.applyLatestCanvas}
                  revision={workspace.revision}
                  saveError={workspace.saveError}
                  siteBytes={workspace.siteBytes}
                  sourceRevision={workspace.sourceRevision}
                  status={workspace.status}
                />
                <SiteMainAgentPanel
                  key={`${selectedChannel.id}:${context.scope.expectedRelayUrl}:${context.scope.expectedSignerPubkey}`}
                  businessChannelId={businessChannelId}
                  disabled={workspace.isBusy || workspace.contextIsBlocked}
                  isDirty={workspace.isDirty}
                  onLoadLatest={() => workspace.openSite(selectedChannel.id)}
                  onMembershipChanged={workspace.refreshChannels}
                  renderConversation={renderConversation}
                  scope={context.scope}
                  siteChannelId={selectedChannel.id}
                  siteTitle={draft.title}
                />
                <SiteEditorPanels
                  businessChannelId={businessChannelId}
                  channel={selectedChannel}
                  context={context}
                  disabled={editorDisabled}
                  document={draft}
                  onMembershipChanged={workspace.refreshChannels}
                  onRunPreview={runPreview}
                  onSelectHistory={workspace.selectHistoryVersion}
                  onUpdateFile={workspace.updateFile}
                  previewConfigured={
                    publisher.connected &&
                    !publisher.isConnecting &&
                    !publisher.isDisconnecting
                  }
                  previewError={publisher.error}
                  previewLoading={publisher.isPreviewing}
                  previewUrl={publisher.previewUrl}
                  previewIsCurrent={publisher.isPreviewCurrent}
                  previewExpiresAt={publisher.previewExpiresAt}
                  revision={workspace.revision}
                />
                <SitesPublisherPanel
                  publisher={publisher}
                  siteId={selectedChannel.id}
                />
              </>
            ) : null}
          </div>
        </main>
      </div>

      <SitesWorkspaceDialogs
        onCancelPending={() => workspace.setPendingAction(null)}
        onConflictDialogChange={workspace.setShowConflictOverwrite}
        onConfirmPending={workspace.confirmPendingAction}
        onDownloadDraft={() => draft && downloadDraftJson(draft)}
        onSaveOverLatest={workspace.saveDraftOverLatest}
        pendingAction={workspace.pendingAction}
        showConflictOverwrite={workspace.showConflictOverwrite}
      />
    </section>
  );
}
