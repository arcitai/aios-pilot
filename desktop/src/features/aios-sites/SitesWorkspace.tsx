import * as React from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  CloudOff,
  FileJson2,
  Globe2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";

import type { CanvasScope } from "@/shared/api/canvasTypes";
import type { Channel } from "@/shared/api/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  MalformedSiteCanvasError,
  createSiteChannel,
  listSiteChannels,
  loadSiteCanvas,
  makeNewSiteDocument,
  saveSiteCanvas,
  siteChannelTitle,
} from "./repository";
import {
  MAX_SITE_DOCUMENT_BYTES,
  MAX_SITE_TITLE_LENGTH,
  serializeSiteDocument,
  siteDownloadName,
  type SiteDocument,
  type SiteFiles,
} from "./document";
import { SiteAccessPanel } from "./SiteAccessPanel";
import { SiteCodeEditor } from "./SiteCodeEditor";
import { SitePreview } from "./SitePreview";
import { SiteVersionHistory } from "./SiteVersionHistory";
import { buildStandaloneHtml } from "./preview";

export type SitesWorkspaceProps = {
  businessChannelId: string;
  expectedRelayUrl: string;
  expectedSignerPubkey: string;
  companyName?: string;
  onDirtyChange?: (dirty: boolean) => void;
};

type WorkspaceContext = {
  businessChannelId: string;
  scope: CanvasScope;
};

type CanvasConflict = {
  document: SiteDocument;
  revision: string;
  updatedAt: number | null;
};

function contextKey(context: WorkspaceContext) {
  return `${context.businessChannelId}\u0000${context.scope.expectedRelayUrl}\u0000${context.scope.expectedSignerPubkey.toLowerCase()}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The Sites operation failed.";
}

function downloadText(fileName: string, content: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function serializeForDraft(document: SiteDocument) {
  return JSON.stringify(document, null, 2);
}

function documentSize(document: SiteDocument) {
  return new TextEncoder().encode(serializeForDraft(document)).byteLength;
}

export function SitesWorkspace({
  businessChannelId,
  expectedRelayUrl,
  expectedSignerPubkey,
  companyName,
  onDirtyChange,
}: SitesWorkspaceProps) {
  const context: WorkspaceContext = {
    businessChannelId,
    scope: { expectedRelayUrl, expectedSignerPubkey },
  };
  const currentContextKey = contextKey(context);
  const liveContextRef = React.useRef(context);
  liveContextRef.current = context;

  const [siteChannels, setSiteChannels] = React.useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = React.useState<
    string | null
  >(null);
  const [draft, setDraft] = React.useState<SiteDocument | null>(null);
  const [savedCanvasContent, setSavedCanvasContent] = React.useState<
    string | null
  >(null);
  const [revision, setRevision] = React.useState("none");
  const [sourceRevision, setSourceRevision] = React.useState<string | null>(
    null,
  );
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [isPreviewLoading] = React.useState(false);
  const [siteNameDraft, setSiteNameDraft] = React.useState("");
  const [isCreateFormOpen, setIsCreateFormOpen] = React.useState(false);
  const [isLoadingChannels, setIsLoadingChannels] = React.useState(true);
  const [isLoadingCanvas, setIsLoadingCanvas] = React.useState(false);
  const [isCreating, setIsCreating] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [loadedContextKey, setLoadedContextKey] = React.useState<string | null>(
    null,
  );
  const [contextChangePending, setContextChangePending] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [malformedCanvas, setMalformedCanvas] = React.useState<string | null>(
    null,
  );
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [canvasConflict, setCanvasConflict] =
    React.useState<CanvasConflict | null>(null);
  const [pendingAction, setPendingAction] = React.useState<(() => void) | null>(
    null,
  );
  const [showConflictOverwrite, setShowConflictOverwrite] =
    React.useState(false);

  const channelLoadGeneration = React.useRef(0);
  const canvasLoadGeneration = React.useRef(0);
  const operationInFlightRef = React.useRef(false);
  const dirtyCallbackRef = React.useRef(onDirtyChange);
  dirtyCallbackRef.current = onDirtyChange;

  const selectedChannel =
    siteChannels.find((channel) => channel.id === selectedChannelId) ?? null;
  const currentDraftJson = draft ? serializeForDraft(draft) : null;
  const isDirty =
    draft !== null &&
    (savedCanvasContent === null || currentDraftJson !== savedCanvasContent);
  const contextIsStale =
    loadedContextKey !== null && loadedContextKey !== currentContextKey;
  const contextIsBlocked = contextChangePending || contextIsStale;
  const isBusy = isLoadingChannels || isLoadingCanvas || isCreating || isSaving;
  const canEdit =
    !contextIsBlocked && selectedChannel !== null && !isLoadingCanvas;
  const dirtyRef = React.useRef(isDirty);
  dirtyRef.current = isDirty || operationInFlightRef.current;

  React.useEffect(() => {
    dirtyCallbackRef.current?.(isDirty || isCreating || isSaving);
  }, [isDirty, isCreating, isSaving]);

  React.useEffect(() => {
    const guardReload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guardReload);
    return () => window.removeEventListener("beforeunload", guardReload);
  }, []);

  React.useEffect(() => () => dirtyCallbackRef.current?.(false), []);

  const loadSite = React.useCallback(
    async (channel: Channel, targetContext: WorkspaceContext) => {
      const generation = ++canvasLoadGeneration.current;
      const targetKey = contextKey(targetContext);
      setSelectedChannelId(channel.id);
      setIsLoadingCanvas(true);
      setDraft(null);
      setSavedCanvasContent(null);
      setRevision("none");
      setSourceRevision(null);
      setPreviewUrl(null);
      setPreviewError(null);
      setLoadError(null);
      setMalformedCanvas(null);
      setSaveError(null);
      setCanvasConflict(null);
      setStatus(null);
      try {
        const loaded = await loadSiteCanvas(
          channel,
          targetContext.businessChannelId,
          targetContext.scope,
        );
        if (
          generation !== canvasLoadGeneration.current ||
          contextKey(liveContextRef.current) !== targetKey
        ) {
          return;
        }
        const document =
          loaded.document ??
          makeNewSiteDocument(
            channel.id,
            targetContext.businessChannelId,
            siteChannelTitle(channel),
          );
        setDraft(document);
        setSavedCanvasContent(
          loaded.document ? serializeSiteDocument(loaded.document) : null,
        );
        setRevision(loaded.revision);
        if (!loaded.document) {
          setStatus(
            "This private site channel has no canvas version yet. Save the draft to create its first version.",
          );
        }
      } catch (cause) {
        if (
          generation !== canvasLoadGeneration.current ||
          contextKey(liveContextRef.current) !== targetKey
        ) {
          return;
        }
        setLoadError(errorMessage(cause));
        if (cause instanceof MalformedSiteCanvasError) {
          setMalformedCanvas(cause.rawContent);
        }
      } finally {
        if (
          generation === canvasLoadGeneration.current &&
          contextKey(liveContextRef.current) === targetKey
        ) {
          setIsLoadingCanvas(false);
        }
      }
    },
    [],
  );

  const loadWorkspace = React.useCallback(
    async (targetContext: WorkspaceContext) => {
      const generation = ++channelLoadGeneration.current;
      const targetKey = contextKey(targetContext);
      setLoadedContextKey(targetKey);
      setContextChangePending(false);
      setIsLoadingChannels(true);
      setSiteChannels([]);
      setSelectedChannelId(null);
      setDraft(null);
      setSavedCanvasContent(null);
      setRevision("none");
      setSourceRevision(null);
      setPreviewUrl(null);
      setPreviewError(null);
      setCanvasConflict(null);
      setLoadError(null);
      setMalformedCanvas(null);
      setSaveError(null);
      setStatus(null);
      try {
        const channels = await listSiteChannels(
          targetContext.businessChannelId,
        );
        if (
          generation !== channelLoadGeneration.current ||
          contextKey(liveContextRef.current) !== targetKey
        ) {
          return;
        }
        setSiteChannels(channels);
        setIsLoadingChannels(false);
        if (channels.length > 0) {
          void loadSite(channels[0], targetContext);
        }
      } catch (cause) {
        if (
          generation !== channelLoadGeneration.current ||
          contextKey(liveContextRef.current) !== targetKey
        ) {
          return;
        }
        setLoadError(errorMessage(cause));
      } finally {
        if (generation === channelLoadGeneration.current) {
          setIsLoadingChannels(false);
        }
      }
    },
    [loadSite],
  );

  React.useEffect(() => {
    const loadedKey = loadedContextKey;
    if (loadedKey === currentContextKey) return;
    if (
      loadedKey !== null &&
      (dirtyRef.current || operationInFlightRef.current)
    ) {
      setContextChangePending(true);
      return;
    }
    void loadWorkspace(liveContextRef.current);
  }, [currentContextKey, loadedContextKey, loadWorkspace]);

  function runAfterDraftDecision(action: () => void) {
    if (dirtyRef.current) {
      setPendingAction(() => action);
      return;
    }
    action();
  }

  function openSite(channelId: string) {
    const channel = siteChannels.find(
      (candidate) => candidate.id === channelId,
    );
    if (!channel) return;
    runAfterDraftDecision(() => void loadSite(channel, liveContextRef.current));
  }

  async function createSite(title: string) {
    const targetContext = liveContextRef.current;
    const targetKey = contextKey(targetContext);
    operationInFlightRef.current = true;
    setIsCreating(true);
    setSaveError(null);
    setLoadError(null);
    setStatus(null);
    let createdChannel: Channel | null = null;
    let initialDocument: SiteDocument | null = null;
    try {
      createdChannel = await createSiteChannel(
        title,
        targetContext.businessChannelId,
        targetContext.scope,
      );
      initialDocument = makeNewSiteDocument(
        createdChannel.id,
        targetContext.businessChannelId,
        title,
      );
      if (contextKey(liveContextRef.current) !== targetKey) {
        setContextChangePending(true);
      }
      setSiteChannels((current) => [...current, createdChannel as Channel]);
      setSelectedChannelId(createdChannel.id);
      setDraft(initialDocument);
      setSavedCanvasContent(null);
      setRevision("none");
      setSourceRevision(null);
      setPreviewUrl(null);
      setPreviewError(null);
      setCanvasConflict(null);
      setIsLoadingCanvas(false);
      setIsCreateFormOpen(false);
      setSiteNameDraft("");

      const result = await saveSiteCanvas(
        createdChannel.id,
        initialDocument,
        "none",
        targetContext.scope,
      );
      setSavedCanvasContent(serializeSiteDocument(initialDocument));
      setRevision(result.eventId);
      setStatus(
        result.verified
          ? "Site created and saved to its private Buzz canvas."
          : "The first save was accepted, but Buzz could not verify the current canvas head. Reload before making another change.",
      );
    } catch (cause) {
      if (createdChannel && initialDocument) {
        setSaveError(
          `The private site channel was created, but its first canvas save failed. Your draft is still here; save again to retry. ${errorMessage(cause)}`,
        );
      } else {
        setSaveError(errorMessage(cause));
      }
    } finally {
      operationInFlightRef.current = false;
      setIsCreating(false);
    }
  }

  async function refreshConflict(
    channel: Channel,
    targetContext: WorkspaceContext,
    error: unknown,
  ) {
    const message = errorMessage(error);
    if (!message.includes("conflict:")) return;
    const targetKey = contextKey(targetContext);
    try {
      const latest = await loadSiteCanvas(
        channel,
        targetContext.businessChannelId,
        targetContext.scope,
      );
      if (
        contextKey(liveContextRef.current) !== targetKey ||
        selectedChannelId !== channel.id ||
        !latest.document
      ) {
        return;
      }
      setCanvasConflict({
        document: latest.document,
        revision: latest.revision,
        updatedAt: latest.updatedAt,
      });
    } catch (cause) {
      setSaveError(
        `${message} The latest canvas could not be loaded; your draft remains unchanged. ${errorMessage(cause)}`,
      );
    }
  }

  async function persistDocument(
    channel: Channel,
    document: SiteDocument,
    expectedRevision: string,
    targetContext: WorkspaceContext,
  ) {
    const targetKey = contextKey(targetContext);
    operationInFlightRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    setStatus(null);
    try {
      const result = await saveSiteCanvas(
        channel.id,
        document,
        expectedRevision,
        targetContext.scope,
      );
      if (contextKey(liveContextRef.current) !== targetKey) {
        setContextChangePending(true);
      }
      setSavedCanvasContent(serializeSiteDocument(document));
      setRevision(result.eventId);
      setCanvasConflict(null);
      setSourceRevision(null);
      setStatus(
        result.verified
          ? "Saved to the private Buzz canvas."
          : "Buzz accepted the save, but could not verify the current canvas head. Reload to confirm the latest version.",
      );
    } catch (cause) {
      const message = errorMessage(cause);
      setSaveError(message.includes("conflict:") ? null : message);
      if (message.includes("conflict:")) {
        setStatus(
          "The canvas revision changed before the save completed. Your draft is safe while the latest version loads.",
        );
      }
      await refreshConflict(channel, targetContext, cause);
    } finally {
      operationInFlightRef.current = false;
      setIsSaving(false);
    }
  }

  function saveDraft() {
    if (!selectedChannel || !draft || !canEdit || !isDirty) return;
    void persistDocument(
      selectedChannel,
      draft,
      revision,
      liveContextRef.current,
    );
  }

  function saveDraftOverLatest() {
    if (!selectedChannel || !draft || !canvasConflict || contextIsBlocked)
      return;
    const latestRevision = canvasConflict.revision;
    setShowConflictOverwrite(false);
    void persistDocument(
      selectedChannel,
      draft,
      latestRevision,
      liveContextRef.current,
    );
  }

  function applyLatestCanvas() {
    if (!canvasConflict) return;
    runAfterDraftDecision(() => {
      if (!canvasConflict) return;
      setDraft(canvasConflict.document);
      setSavedCanvasContent(serializeSiteDocument(canvasConflict.document));
      setRevision(canvasConflict.revision);
      setCanvasConflict(null);
      setSourceRevision(null);
      setSaveError(null);
      setStatus(
        "Loaded the latest canvas version. Your earlier draft can still be downloaded from the conflict notice before replacing it.",
      );
    });
  }

  function updateDraft(update: (current: SiteDocument) => SiteDocument) {
    setDraft((current) => (current ? update(current) : current));
    setSaveError(null);
    setStatus(null);
  }

  function updateFile(file: keyof SiteFiles, content: string) {
    updateDraft((current) => ({
      ...current,
      files: { ...current.files, [file]: content },
    }));
  }

  function downloadStandalone() {
    if (!draft) return;
    try {
      downloadText(
        siteDownloadName(draft.title),
        buildStandaloneHtml(draft),
        "text/html;charset=utf-8",
      );
      setStatus(
        "Downloaded a standalone HTML file with this site’s HTML, CSS, and JavaScript.",
      );
    } catch (cause) {
      setSaveError(errorMessage(cause));
    }
  }

  function downloadDraftJson() {
    if (!draft) return;
    downloadText(
      `${siteDownloadName(draft.title).replace(/\.html$/, "")}.site.json`,
      serializeForDraft(draft),
      "application/json;charset=utf-8",
    );
  }

  function downloadRawCanvas() {
    if (!malformedCanvas) return;
    downloadText(
      "untouched-site-canvas.json",
      malformedCanvas,
      "application/json;charset=utf-8",
    );
  }

  function runPreview() {
    if (!draft || !canEdit) return;
    setPreviewError(
      "The isolated preview service is not connected on this Buzz host yet.",
    );
  }

  async function updateSiteChannelList() {
    const targetContext = liveContextRef.current;
    const targetKey = contextKey(targetContext);
    try {
      const channels = await listSiteChannels(targetContext.businessChannelId);
      if (contextKey(liveContextRef.current) === targetKey)
        setSiteChannels(channels);
    } catch (cause) {
      setLoadError(errorMessage(cause));
    }
  }

  function handleCreateSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = siteNameDraft.trim();
    if (!title) return;
    runAfterDraftDecision(() => void createSite(title));
  }

  const siteBytes = draft ? documentSize(draft) : 0;
  const siteIsTooLarge = siteBytes > MAX_SITE_DOCUMENT_BYTES;

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col"
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
              {companyName ? `For ${companyName} · ` : ""}Build static sites in
              versioned Buzz canvases.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={isBusy || contextIsBlocked}
            onClick={() =>
              runAfterDraftDecision(
                () => void loadWorkspace(liveContextRef.current),
              )
            }
            size="sm"
            variant="ghost"
          >
            <RefreshCw className={isLoadingChannels ? "animate-spin" : ""} />
            Refresh
          </Button>
          <Button
            disabled={
              !draft ||
              contextIsBlocked ||
              isSaving ||
              isCreating ||
              !isDirty ||
              siteIsTooLarge
            }
            onClick={saveDraft}
            size="sm"
          >
            <Save />
            {isSaving || isCreating ? "Saving…" : "Save"}
          </Button>
          <Button
            disabled={!draft || isBusy}
            onClick={downloadStandalone}
            size="sm"
            variant="outline"
          >
            <ArrowDownToLine />
            Export HTML
          </Button>
        </div>
      </header>

      {contextIsBlocked ? (
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
            <Button onClick={downloadDraftJson} size="xs" variant="outline">
              Download draft JSON
            </Button>
          ) : null}
          <Button
            onClick={() => void loadWorkspace(liveContextRef.current)}
            size="xs"
            variant="destructive"
          >
            Discard and switch
          </Button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-border/50 bg-muted/15 lg:border-b-0 lg:border-r">
          <div className="border-b border-border/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Your sites
                </h2>
                <p className="mt-1 text-2xs text-muted-foreground">
                  {siteChannels.length} / 100 · each has a private channel
                </p>
              </div>
              <Button
                aria-label="Create a site"
                disabled={
                  isBusy || contextIsBlocked || siteChannels.length >= 100
                }
                onClick={() => setIsCreateFormOpen((value) => !value)}
                size="icon"
                variant="outline"
              >
                <Plus />
              </Button>
            </div>
            {isCreateFormOpen ? (
              <form
                className="mt-3 space-y-2 rounded-lg border border-border/50 bg-background p-3"
                onSubmit={handleCreateSubmit}
              >
                <label className="text-xs font-medium" htmlFor="new-site-title">
                  Name this site
                </label>
                <Input
                  autoFocus
                  disabled={isBusy}
                  id="new-site-title"
                  maxLength={MAX_SITE_TITLE_LENGTH}
                  onChange={(event) => setSiteNameDraft(event.target.value)}
                  placeholder="Spring campaign"
                  required
                  value={siteNameDraft}
                />
                <p className="text-2xs leading-relaxed text-muted-foreground">
                  Buzz creates one private channel. You choose its members
                  separately.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={() => setIsCreateFormOpen(false)}
                    size="xs"
                    type="button"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={isBusy || !siteNameDraft.trim()}
                    size="xs"
                    type="submit"
                  >
                    {isCreating ? "Creating…" : "Create site"}
                  </Button>
                </div>
              </form>
            ) : null}
          </div>

          <nav
            aria-label="Sites list"
            className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2"
          >
            {siteChannels.map((channel) => (
              <button
                aria-current={
                  channel.id === selectedChannelId ? "page" : undefined
                }
                className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${channel.id === selectedChannelId ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/55 hover:text-foreground"}`}
                disabled={isBusy || contextIsBlocked}
                key={channel.id}
                onClick={() => openSite(channel.id)}
                type="button"
              >
                <Globe2
                  className={`mt-0.5 size-4 shrink-0 ${channel.id === selectedChannelId ? "text-primary" : ""}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {siteChannelTitle(channel)}
                  </span>
                  <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
                    #{channel.name}
                  </span>
                </span>
                <span className="mt-0.5 text-2xs tabular-nums text-muted-foreground">
                  {channel.memberCount}
                </span>
              </button>
            ))}
            {isLoadingChannels ? (
              <p
                className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground"
                role="status"
              >
                <RefreshCw className="size-3.5 animate-spin" /> Loading private
                sites…
              </p>
            ) : siteChannels.length === 0 && !loadError ? (
              <div className="px-3 py-5 text-center">
                <Sparkles className="mx-auto size-5 text-muted-foreground/65" />
                <p className="mt-2 text-xs font-medium">
                  Your first site starts here
                </p>
                <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                  Create a private site channel and shape the page in HTML, CSS,
                  and JavaScript.
                </p>
                <Button
                  className="mt-3"
                  onClick={() => setIsCreateFormOpen(true)}
                  size="sm"
                  variant="outline"
                >
                  <Plus /> New site
                </Button>
              </div>
            ) : null}
          </nav>
          <div className="border-t border-border/40 p-3 text-2xs leading-relaxed text-muted-foreground">
            <p className="flex items-center gap-1.5 font-medium text-foreground/80">
              <LockKeyhole className="size-3" /> Channel membership controls
              access
            </p>
            <p className="mt-1">
              Private site canvases are not copied into the generated HTML.
            </p>
          </div>
        </aside>

        <main className="min-h-0 min-w-0 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[112rem] flex-col gap-4 p-4 sm:p-5 xl:p-6">
            {loadError ? (
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
                      {loadError}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Its canvas has not been changed. Check access and relay
                      status, then refresh. Malformed documents are rejected
                      instead of being overwritten.
                    </p>
                    {malformedCanvas ? (
                      <Button
                        className="mt-3"
                        onClick={downloadRawCanvas}
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

            {!selectedChannel && !loadError && !isLoadingChannels ? (
              <div className="mx-auto flex min-h-[35rem] max-w-xl flex-col items-center justify-center px-6 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Globe2 className="size-6" />
                </span>
                <h2 className="mt-5 text-xl font-semibold tracking-tight">
                  Make a useful page for your business
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Start with a landing page, a small internal tool, or a web
                  app. Your drafts live in private Buzz canvases, and you can
                  export a standalone HTML file whenever you need it.
                </p>
                <Button
                  className="mt-5"
                  onClick={() => setIsCreateFormOpen(true)}
                >
                  <Plus /> Create a site
                </Button>
              </div>
            ) : null}

            {selectedChannel && draft ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border/50 bg-card p-4 sm:p-5">
                  <div className="min-w-0 flex-1">
                    <label className="sr-only" htmlFor="site-document-title">
                      Site name
                    </label>
                    <Input
                      className="h-auto border-0 bg-transparent px-0 py-0 text-lg font-semibold shadow-none focus-visible:ring-0 md:text-lg"
                      disabled={!canEdit || isCreating || isSaving}
                      id="site-document-title"
                      maxLength={MAX_SITE_TITLE_LENGTH}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      value={draft.title}
                    />
                    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <LockKeyhole className="size-3.5" />
                      Private canvas in{" "}
                      <code className="rounded bg-muted/55 px-1.5 py-0.5 font-mono text-2xs">
                        #{selectedChannel.name}
                      </code>
                      <span aria-hidden>·</span>
                      Revision{" "}
                      <code className="rounded bg-muted/55 px-1.5 py-0.5 font-mono text-2xs">
                        {revision === "none"
                          ? "not saved"
                          : `${revision.slice(0, 12)}…`}
                      </code>
                      {sourceRevision ? (
                        <span className="text-primary">
                          Editing a past version · saving creates a new revision
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                    <span
                      className={isDirty ? "text-amber-600" : "text-primary"}
                    >
                      {isDirty ? "Unsaved changes" : "Saved to Buzz"}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{(siteBytes / 1024).toFixed(1)} KB / 195 KB</span>
                  </div>
                </div>

                {status ? (
                  <p
                    className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-foreground"
                    role="status"
                  >
                    {status}
                  </p>
                ) : null}
                {saveError ? (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
                    role="alert"
                  >
                    <AlertTriangle className="size-4 shrink-0 text-destructive" />
                    <p className="min-w-0 flex-1 break-words text-xs text-destructive">
                      {saveError}
                    </p>
                    {draft ? (
                      <Button
                        onClick={downloadDraftJson}
                        size="xs"
                        variant="outline"
                      >
                        Download draft JSON
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {canvasConflict ? (
                  <div
                    className="space-y-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4"
                    role="alert"
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">
                          This site changed in Buzz while you were editing
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Your draft remains in the editor. The newest canvas
                          version is preserved separately. Review it, download
                          both copies, or deliberately create a new revision
                          from your draft.
                        </p>
                        <details className="mt-3 rounded-lg border border-border/40 bg-background/70 p-3">
                          <summary className="cursor-pointer text-xs font-medium">
                            Review the latest canvas version
                          </summary>
                          <p className="mt-2 text-2xs text-muted-foreground">
                            Revision {canvasConflict.revision.slice(0, 12)}…
                            {canvasConflict.updatedAt
                              ? ` · ${new Date(canvasConflict.updatedAt * 1000).toLocaleString()}`
                              : ""}
                          </p>
                          <p className="mt-2 text-xs font-medium">HTML</p>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-2xs">
                            {canvasConflict.document.files.indexHtml}
                          </pre>
                          <p className="mt-2 text-xs font-medium">CSS</p>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-2xs">
                            {canvasConflict.document.files.styleCss}
                          </pre>
                          <p className="mt-2 text-xs font-medium">JavaScript</p>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-2xs">
                            {canvasConflict.document.files.appJs}
                          </pre>
                        </details>
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        onClick={downloadDraftJson}
                        size="sm"
                        variant="outline"
                      >
                        <FileJson2 /> Download my draft
                      </Button>
                      <Button
                        onClick={() =>
                          downloadText(
                            "latest-site-canvas.json",
                            serializeSiteDocument(canvasConflict.document),
                            "application/json;charset=utf-8",
                          )
                        }
                        size="sm"
                        variant="outline"
                      >
                        <FileJson2 /> Download latest
                      </Button>
                      <Button
                        disabled={contextIsBlocked || isBusy}
                        onClick={applyLatestCanvas}
                        size="sm"
                        variant="ghost"
                      >
                        Use latest version
                      </Button>
                      <Button
                        disabled={contextIsBlocked || isBusy || !isDirty}
                        onClick={() => setShowConflictOverwrite(true)}
                        size="sm"
                      >
                        Save my draft as a new revision
                      </Button>
                    </div>
                  </div>
                ) : null}

                {draft.title.trim().length === 0 ? (
                  <p className="text-xs text-destructive" role="alert">
                    Enter a site name before saving.
                  </p>
                ) : null}
                {siteIsTooLarge ? (
                  <p className="text-xs text-destructive" role="alert">
                    This document exceeds the 200 KB limit. Shorten the code
                    before saving.
                  </p>
                ) : null}

                <div className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2">
                  <SiteCodeEditor
                    disabled={!canEdit || isCreating || isSaving}
                    onChange={updateFile}
                    value={draft.files}
                  />
                  <SitePreview
                    canEmbed={
                      previewUrl?.startsWith("http://127.0.0.1:3351/") ?? false
                    }
                    configured={false}
                    disabled={!canEdit || isCreating || isSaving}
                    error={previewError}
                    loading={isPreviewLoading}
                    onRun={runPreview}
                    previewUrl={previewUrl}
                  />
                </div>

                <SiteAccessPanel
                  channelId={selectedChannel.id}
                  channelName={selectedChannel.name}
                  disabled={contextIsBlocked || isBusy}
                  memberCount={selectedChannel.memberCount}
                  onMembershipChanged={() => void updateSiteChannelList()}
                  scope={context.scope}
                />

                <SiteVersionHistory
                  currentRevision={revision}
                  disabled={contextIsBlocked || isBusy}
                  key={`${selectedChannel.id}:${revision}`}
                  onSelect={(historicalDocument, historicalRevision) => {
                    runAfterDraftDecision(() => {
                      setDraft(historicalDocument);
                      setSourceRevision(historicalRevision);
                      setStatus(
                        "Historical version loaded into this draft. Saving will create a new canvas revision and keep later versions in history.",
                      );
                    });
                  }}
                  parentBusinessChannelId={businessChannelId}
                  scope={context.scope}
                  channelId={selectedChannel.id}
                />

                <section className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/10 p-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
                    <CloudOff className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold">
                      Self-hosted sharing
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      This Buzz host has no Sites publisher configured. Nothing
                      is public. Export an offline HTML file above; connect the
                      self-hosted publisher to enable deliberate publish and
                      revoke actions.
                    </p>
                  </div>
                  <Button disabled size="sm" variant="outline">
                    Publisher not configured
                  </Button>
                </section>

                <section className="rounded-xl border border-border/45 bg-muted/15 px-4 py-3">
                  <p className="text-xs font-medium">
                    Agents and the CLI use the same canvas document
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    The saved JSON includes{" "}
                    <code className="rounded bg-muted/65 px-1 py-0.5 font-mono text-2xs">
                      schemaVersion: 1
                    </code>
                    , site and parent channel ids, title, and the three fixed
                    files. A specialist can read and write it with{" "}
                    <code className="rounded bg-muted/65 px-1 py-0.5 font-mono text-2xs">
                      buzz canvas get/set --channel &lt;site-channel-id&gt;
                    </code>
                    ; each accepted canvas write is a version in Buzz history.
                  </p>
                </section>
              </>
            ) : null}
          </div>
        </main>
      </div>

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Keep this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved site changes. Download a copy first, or discard
              them and continue. Saved canvas revisions remain in Buzz history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button onClick={downloadDraftJson} size="sm" variant="outline">
              Download draft JSON
            </Button>
            <AlertDialogAction
              onClick={() => {
                const action = pendingAction;
                setPendingAction(null);
                action?.();
              }}
            >
              Discard and continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={showConflictOverwrite}
        onOpenChange={setShowConflictOverwrite}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Save your draft over the latest version?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This creates a new Buzz canvas revision containing your draft. The
              incoming version stays in history. If another edit arrives before
              the save, Buzz will reject this attempt and keep both drafts
              available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={saveDraftOverLatest}>
              Save as new revision
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
