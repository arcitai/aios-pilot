import * as React from "react";

import type { Channel } from "@/shared/api/types";
import {
  MalformedSiteCanvasError,
  createSiteChannel,
  listSiteChannels,
  loadSiteCanvas,
  makeNewSiteDocument,
  saveSiteCanvas,
} from "./repository";
import {
  serializeSiteDocument,
  type SiteDocument,
  type SiteFiles,
} from "./document";
import {
  contextKey,
  downloadDraftJson,
  downloadRawCanvas,
  errorMessage,
  isDraftDirty,
  measureDocument,
  siteTitleFromChannelName,
} from "./workspaceModel";
import type {
  CanvasConflict,
  SitesWorkspaceProps,
  WorkspaceContext,
} from "./workspaceTypes";
import { useSitesDraftGuard } from "./useSitesDraftGuard";

export function useSitesWorkspace({
  businessChannelId,
  expectedRelayUrl,
  expectedSignerPubkey,
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
  const [showConflictOverwrite, setShowConflictOverwrite] =
    React.useState(false);

  const channelLoadGeneration = React.useRef(0);
  const canvasLoadGeneration = React.useRef(0);
  const selectedChannelIdRef = React.useRef(selectedChannelId);
  selectedChannelIdRef.current = selectedChannelId;

  const selectedChannel =
    siteChannels.find((channel) => channel.id === selectedChannelId) ?? null;
  const isDirty = isDraftDirty(draft, savedCanvasContent);
  const contextIsStale =
    loadedContextKey !== null && loadedContextKey !== currentContextKey;
  const contextIsBlocked = contextChangePending || contextIsStale;
  const isBusy = isLoadingChannels || isLoadingCanvas || isCreating || isSaving;
  const canEdit =
    !contextIsBlocked &&
    selectedChannel !== null &&
    !isLoadingCanvas &&
    loadError === null;
  const draftGuard = useSitesDraftGuard({
    isDirty,
    isCreating,
    isSaving,
    onDirtyChange,
  });

  const loadSite = React.useCallback(
    async (
      channel: Channel,
      targetContext: WorkspaceContext,
      keepCurrentDraft = false,
    ) => {
      const generation = ++canvasLoadGeneration.current;
      const targetKey = contextKey(targetContext);
      setSelectedChannelId(channel.id);
      setIsLoadingCanvas(true);
      if (!keepCurrentDraft) {
        setDraft(null);
        setSavedCanvasContent(null);
        setRevision("none");
      }
      setSourceRevision(null);
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
        )
          return;
        const document =
          loaded.document ??
          makeNewSiteDocument(
            channel.id,
            targetContext.businessChannelId,
            siteTitleFromChannelName(channel.name),
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
        )
          return;
        setLoadError(errorMessage(cause));
        if (cause instanceof MalformedSiteCanvasError)
          setMalformedCanvas(cause.rawContent);
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
      // A refresh invalidates any canvas request started by the workspace it
      // is replacing, even while the refreshed channel list is still loading.
      canvasLoadGeneration.current += 1;
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
        )
          return;
        setSiteChannels(channels);
        setIsLoadingChannels(false);
        if (channels.length > 0) void loadSite(channels[0], targetContext);
      } catch (cause) {
        if (
          generation !== channelLoadGeneration.current ||
          contextKey(liveContextRef.current) !== targetKey
        )
          return;
        setLoadError(errorMessage(cause));
      } finally {
        if (generation === channelLoadGeneration.current)
          setIsLoadingChannels(false);
      }
    },
    [loadSite],
  );

  // Sample the refs only when the external workspace context changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Draft state must not trigger a context switch by itself.
  React.useEffect(() => {
    if (loadedContextKey === currentContextKey) return;
    if (
      loadedContextKey !== null &&
      (draftGuard.dirtyRef.current || draftGuard.operationInFlightRef.current)
    ) {
      setContextChangePending(true);
      return;
    }
    void loadWorkspace(liveContextRef.current);
  }, [currentContextKey, loadedContextKey, loadWorkspace]);

  function openSite(channelId: string) {
    const channel = siteChannels.find(
      (candidate) => candidate.id === channelId,
    );
    if (channel)
      draftGuard.runAfterDraftDecision(
        () =>
          void loadSite(
            channel,
            liveContextRef.current,
            channel.id === selectedChannelIdRef.current,
          ),
      );
  }

  async function createSite(title: string) {
    const targetContext = liveContextRef.current;
    const targetKey = contextKey(targetContext);
    draftGuard.operationInFlightRef.current = true;
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
      if (contextKey(liveContextRef.current) !== targetKey)
        setContextChangePending(true);
      setSiteChannels((current) => [...current, createdChannel as Channel]);
      setSelectedChannelId(createdChannel.id);
      setDraft(initialDocument);
      setSavedCanvasContent(null);
      setRevision("none");
      setSourceRevision(null);
      setCanvasConflict(null);
      setIsLoadingCanvas(false);
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
      setSaveError(
        createdChannel && initialDocument
          ? `The private site channel was created, but its first canvas save failed. Your draft is still here; save again to retry. ${errorMessage(cause)}`
          : errorMessage(cause),
      );
    } finally {
      draftGuard.operationInFlightRef.current = false;
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
        selectedChannelIdRef.current !== channel.id ||
        !latest.document
      )
        return;
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
    draftGuard.operationInFlightRef.current = true;
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
      if (contextKey(liveContextRef.current) !== targetKey)
        setContextChangePending(true);
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
      draftGuard.operationInFlightRef.current = false;
      setIsSaving(false);
    }
  }

  function saveDraft() {
    if (!selectedChannel || !draft || !canEdit || !isDirty || canvasConflict)
      return;
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
    setShowConflictOverwrite(false);
    void persistDocument(
      selectedChannel,
      draft,
      canvasConflict.revision,
      liveContextRef.current,
    );
  }

  function applyLatestCanvas() {
    if (!canvasConflict) return;
    draftGuard.runAfterDraftDecision(() => {
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

  function selectHistoryVersion(document: SiteDocument, source: string) {
    draftGuard.runAfterDraftDecision(() => {
      setDraft(document);
      setSourceRevision(source);
      setStatus(
        "Historical version loaded into this draft. Saving will create a new canvas revision and keep later versions in history.",
      );
    });
  }

  async function refreshChannels() {
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

  function refreshWorkspace() {
    draftGuard.runAfterDraftDecision(
      () => void loadWorkspace(liveContextRef.current),
    );
  }

  function discardAndSwitch() {
    void loadWorkspace(liveContextRef.current);
  }

  const { siteBytes, siteIsTooLarge } = measureDocument(draft);

  return {
    context,
    contextIsBlocked,
    siteChannels,
    selectedChannelId,
    selectedChannel,
    draft,
    revision,
    sourceRevision,
    isDirty,
    isBusy,
    isLoadingChannels,
    isLoadingCanvas,
    isCreating,
    isSaving,
    canEdit,
    loadError,
    malformedCanvas,
    saveError,
    status,
    canvasConflict,
    siteBytes,
    siteIsTooLarge,
    pendingAction: draftGuard.pendingAction,
    showConflictOverwrite,
    setShowConflictOverwrite,
    setStatus,
    setSaveError,
    setPendingAction: draftGuard.setPendingAction,
    setDraft,
    setSourceRevision,
    loadWorkspace,
    createSite,
    openSite,
    saveDraft,
    saveDraftOverLatest,
    applyLatestCanvas,
    updateDraft,
    updateFile,
    selectHistoryVersion,
    downloadDraft: () => draft && downloadDraftJson(draft),
    downloadRawCanvas: () =>
      malformedCanvas && downloadRawCanvas(malformedCanvas),
    refreshChannels,
    refreshWorkspace,
    discardAndSwitch,
    confirmPendingAction: draftGuard.confirmPendingAction,
    runAfterDraftDecision: draftGuard.runAfterDraftDecision,
  };
}
