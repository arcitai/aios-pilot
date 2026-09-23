import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  PanelsTopLeft,
  Server,
  HardDrive,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { cn } from "@/shared/lib/cn";
import { CalendarEditor } from "./apps/CalendarEditor";
import { DesignEditor } from "./apps/DesignEditor";
import { SlidesEditor } from "./apps/SlidesEditor";
import { AppAccessPanel } from "./AppAccessPanel";
import { AIOS_APP_REGISTRY } from "./registry";
import { canvasAppDocumentStore } from "./canvasStore";
import {
  localAppDocumentStore,
  type AppDocumentScope,
  type AppDocumentStore,
} from "./storage";
import { downloadTextFile } from "./htmlPreview";
import type { AppsExtensionApp } from "./extensions";
import { useAppDocumentWorkspace } from "./useAppDocumentWorkspace";
import "./apps-workspace.css";

/**
 * Modular business-app workspace. Editors receive serializable values and
 * callbacks; applications can replace the default Canvas store through
 * `documentStore` without changing editor implementations.
 */
export type AppsWorkspaceProps = {
  channelId: string;
  companyName?: string;
  companySummary?: string;
  /** Render-captured values passed unchanged to native Canvas operations. */
  nativeScope: NativeCanvasScope;
  communityId?: string;
  documentStore?: AppDocumentStore;
  /** True while a document save or unfinished Calendar form draft is pending. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Use the compact chrome when the workspace is hosted inside Business. */
  embedded?: boolean;
  /** Optional independent apps hosted inside the existing Apps rail. */
  extensionApps?: readonly AppsExtensionApp[];
};

/** Structural match for the CanvasScope consumed by the native API. */
export type NativeCanvasScope = {
  expectedRelayUrl: string;
  expectedSignerPubkey: string;
};

type StorageMode = "shared" | "local-recovery";

function describePhase(
  phase: ReturnType<typeof useAppDocumentWorkspace>["phase"],
  storeLabel: string,
): string {
  if (phase === "loading") return "Loading app documents";
  if (phase === "blocked") return "Waiting for workspace access";
  if (phase === "unsaved") return "Unsaved changes";
  if (phase === "saving") return "Saving…";
  if (phase === "saved") {
    return `Saved · ${storeLabel}`;
  }
  if (phase === "error") return "Save needs attention";
  return `Ready · saves to ${storeLabel}`;
}

function StatusIcon({
  phase,
  isLocal,
}: {
  phase: ReturnType<typeof useAppDocumentWorkspace>["phase"];
  isLocal: boolean;
}) {
  if (phase === "loading" || phase === "saving") {
    return <LoaderCircle className="aios-status-spin" aria-hidden="true" />;
  }
  if (phase === "error") return <AlertCircle aria-hidden="true" />;
  return isLocal ? (
    <HardDrive aria-hidden="true" />
  ) : phase === "saved" ? (
    <Check aria-hidden="true" />
  ) : (
    <Server aria-hidden="true" />
  );
}

export function AppsWorkspace(props: AppsWorkspaceProps) {
  return <AppsWorkspaceView {...props} />;
}

/** Presentational workspace seam used by focused UI previews and tests. */
export function AppsWorkspaceView({
  channelId,
  companyName,
  companySummary,
  nativeScope,
  communityId,
  documentStore,
  onDirtyChange,
  embedded = false,
  extensionApps = [],
}: AppsWorkspaceProps) {
  const scope = useMemo<AppDocumentScope | null>(() => {
    const expectedRelayUrl = nativeScope.expectedRelayUrl.trim();
    const expectedSignerPubkey = nativeScope.expectedSignerPubkey.trim();
    if (!expectedRelayUrl || !expectedSignerPubkey) {
      return null;
    }
    return {
      communityId,
      expectedRelayUrl,
      expectedSignerPubkey,
      channelId,
    };
  }, [
    channelId,
    communityId,
    nativeScope.expectedRelayUrl,
    nativeScope.expectedSignerPubkey,
  ]);
  const [selectedApp, setSelectedApp] = useState<string>("slides");
  const [visitedExtensions, setVisitedExtensions] = useState<Set<string>>(
    () => new Set(),
  );
  const [storageMode, setStorageMode] = useState<StorageMode>("shared");
  const [recoveryError, setRecoveryError] = useState("");
  const [calendarDraftDirty, setCalendarDraftDirty] = useState(false);
  const [extensionDirtyById, setExtensionDirtyById] = useState<
    Record<string, boolean>
  >({});
  const appDocumentStore =
    storageMode === "local-recovery"
      ? localAppDocumentStore
      : (documentStore ?? canvasAppDocumentStore);
  const isLocalStore =
    storageMode === "local-recovery" ||
    appDocumentStore.label === localAppDocumentStore.label;
  const workspace = useAppDocumentWorkspace({
    channelId,
    companyName,
    companySummary,
    scope,
    store: appDocumentStore,
  });
  const activeEntry = AIOS_APP_REGISTRY.find(
    (entry) => entry.id === selectedApp,
  );
  const uniqueExtensionApps = useMemo(() => {
    const ids = new Set<string>(AIOS_APP_REGISTRY.map((entry) => entry.id));
    return extensionApps.filter((entry) => {
      if (!entry.id.trim() || ids.has(entry.id)) return false;
      ids.add(entry.id);
      return true;
    });
  }, [extensionApps]);
  const activeExtension = uniqueExtensionApps.find(
    (entry) => entry.id === selectedApp,
  );
  const statusText = workspace.saveVerificationUnavailable
    ? "Saved · confirmation unavailable"
    : describePhase(workspace.phase, appDocumentStore.label);
  const documentDirty =
    workspace.phase === "unsaved" ||
    workspace.phase === "saving" ||
    (workspace.phase === "error" && workspace.errorStage === "save");
  const extensionDirty = uniqueExtensionApps.some(
    ({ id }) => extensionDirtyById[id],
  );
  const dirty = documentDirty || calendarDraftDirty || extensionDirty;
  const updateExtensionDirty = useCallback((id: string, nextDirty: boolean) => {
    setExtensionDirtyById((current) =>
      current[id] === nextDirty ? current : { ...current, [id]: nextDirty },
    );
  }, []);
  const extensionIdsKey = JSON.stringify(
    uniqueExtensionApps.map((extension) => extension.id),
  );
  const extensionIds = useMemo(
    () => JSON.parse(extensionIdsKey) as string[],
    [extensionIdsKey],
  );
  const extensionContexts = useMemo(
    () =>
      new Map(
        extensionIds.map(
          (id) =>
            [
              id,
              {
                onDirtyChange: (nextDirty: boolean) =>
                  updateExtensionDirty(id, nextDirty),
              },
            ] as const,
        ),
      ),
    [extensionIds, updateExtensionDirty],
  );

  function selectExtension(id: string) {
    setSelectedApp(id);
    setVisitedExtensions((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  async function chooseLocalRecovery() {
    setRecoveryError("");
    workspace.cancelPendingSave();
    if (workspace.document && scope) {
      try {
        await localAppDocumentStore.save(scope, workspace.document);
      } catch (error) {
        setRecoveryError(
          error instanceof Error
            ? error.message
            : "The local recovery copy could not be written.",
        );
        return;
      }
    }
    setStorageMode("local-recovery");
  }

  function downloadRecoveryCopy() {
    if (!workspace.document) return;
    const filename = `buzz-apps-recovery-${new Date().toISOString().slice(0, 10)}.json`;
    downloadTextFile(
      filename,
      `${JSON.stringify(workspace.document, null, 2)}\n`,
      "application/json;charset=utf-8",
    );
  }

  return (
    <section
      className={cn("aios-apps-workspace", embedded && "is-embedded")}
      aria-label="Business apps"
      data-testid="aios-apps-workspace"
    >
      <header className={cn("aios-apps-header", embedded && "is-embedded")}>
        {!embedded ? (
          <div className="aios-apps-brand">
            <span className="aios-apps-mark" aria-hidden="true">
              A
            </span>
            <div>
              <p className="aios-eyebrow">Business workspace</p>
              <h1>{companyName?.trim() || "Apps"}</h1>
              {companySummary?.trim() ? (
                <p className="aios-apps-summary">{companySummary}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {embedded ? (
          <div
            className={cn(
              "aios-storage-status",
              workspace.phase === "error" && "is-error",
              isLocalStore && "is-local",
            )}
            role="status"
            aria-live="polite"
            data-testid="aios-apps-embedded-save-status"
          >
            <StatusIcon phase={workspace.phase} isLocal={isLocalStore} />
            <span>
              {workspace.phase === "saved"
                ? isLocalStore
                  ? "Saved on this computer"
                  : "Saved privately"
                : workspace.phase === "loading"
                  ? "Loading apps…"
                  : workspace.phase === "saving"
                    ? "Saving…"
                    : workspace.phase === "unsaved"
                      ? "Unsaved changes"
                      : workspace.phase === "error"
                        ? "Save needs attention"
                        : isLocalStore
                          ? "Ready to save on this computer"
                          : "Ready to save privately"}
            </span>
          </div>
        ) : (
          <div className="aios-storage-status-wrap">
            <div
              className={cn(
                "aios-storage-status",
                workspace.phase === "error" && "is-error",
                isLocalStore && "is-local",
              )}
              role="status"
              aria-live="polite"
            >
              <StatusIcon phase={workspace.phase} isLocal={isLocalStore} />
              <span>{statusText}</span>
            </div>
            {storageMode === "local-recovery" ? (
              <span className="aios-storage-label">This device only</span>
            ) : (
              <span className="aios-storage-label">
                {appDocumentStore.label}
              </span>
            )}
          </div>
        )}
      </header>

      <div className="aios-apps-layout">
        <aside className="aios-apps-rail" aria-label="Apps">
          <p className="aios-rail-heading">Your tools</p>
          <nav className="aios-app-nav" aria-label="Choose an app">
            {AIOS_APP_REGISTRY.map(({ id, title, summary, Icon }) => (
              <button
                className={cn(
                  "aios-app-nav-item",
                  selectedApp === id && "is-active",
                )}
                data-testid={`aios-app-nav-${id}`}
                key={id}
                type="button"
                aria-current={selectedApp === id ? "page" : undefined}
                onClick={() => setSelectedApp(id)}
              >
                <span className="aios-app-nav-icon">
                  <Icon aria-hidden="true" />
                </span>
                <span className="aios-app-nav-copy">
                  <strong>{title}</strong>
                  <span>{summary}</span>
                </span>
              </button>
            ))}
            {uniqueExtensionApps.map(({ id, title, description, Icon }) => (
              <button
                className={cn(
                  "aios-app-nav-item",
                  selectedApp === id && "is-active",
                )}
                data-testid={`aios-app-nav-${id}`}
                key={id}
                type="button"
                aria-current={selectedApp === id ? "page" : undefined}
                onClick={() => selectExtension(id)}
              >
                <span className="aios-app-nav-icon">
                  {Icon ? (
                    <Icon aria-hidden="true" />
                  ) : (
                    <PanelsTopLeft aria-hidden="true" />
                  )}
                </span>
                <span className="aios-app-nav-copy">
                  <strong>{title}</strong>
                  <span>{description}</span>
                </span>
              </button>
            ))}
          </nav>
          <div className="aios-apps-rail-note">
            <span className="aios-rail-note-dot" aria-hidden="true" />
            <p>App access is managed separately from the business channel.</p>
          </div>
        </aside>

        <div className="aios-apps-main">
          {activeEntry ? (
            <div className="aios-app-heading">
              <div>
                {!embedded ? (
                  <p className="aios-eyebrow">Workspace app</p>
                ) : null}
                <h2>{activeEntry.title}</h2>
              </div>
              <div className="aios-app-heading-actions">
                {!embedded ? (
                  <div className="aios-capabilities">
                    {activeEntry.capabilities.map((capability) => (
                      <span key={capability}>{capability}</span>
                    ))}
                  </div>
                ) : null}
                <AppAccessPanel
                  key={JSON.stringify([
                    activeEntry.id,
                    scope?.communityId ?? null,
                    scope?.channelId ?? null,
                    scope?.expectedRelayUrl ?? null,
                    scope?.expectedSignerPubkey ?? null,
                    appDocumentStore === canvasAppDocumentStore,
                  ])}
                  appId={activeEntry.id}
                  scope={scope}
                  enabled={appDocumentStore === canvasAppDocumentStore}
                />
              </div>
            </div>
          ) : null}

          {activeExtension ? (
            <div className="aios-app-heading">
              <div>
                <h2>{activeExtension.title}</h2>
              </div>
            </div>
          ) : null}

          {activeEntry && workspace.phase === "loading" ? (
            <div className="aios-apps-state" role="status">
              <LoaderCircle className="aios-status-spin" aria-hidden="true" />
              <p>Loading your app documents…</p>
            </div>
          ) : null}

          {activeEntry && workspace.phase === "blocked" ? (
            <Card className="aios-apps-state-card">
              <AlertCircle aria-hidden="true" />
              <h3>Workspace access is needed</h3>
              <p>{workspace.error}</p>
            </Card>
          ) : null}

          {activeEntry &&
          workspace.phase === "error" &&
          workspace.errorStage === "load" &&
          !workspace.document ? (
            <Card className="aios-apps-state-card is-error" role="alert">
              <AlertCircle aria-hidden="true" />
              <h3>Couldn’t load app documents</h3>
              <p>{workspace.error}</p>
              <div className="aios-toolbar-actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={workspace.reload}
                >
                  <RotateCcw aria-hidden="true" />
                  Try again
                </Button>
                {storageMode !== "local-recovery" ? (
                  <Button type="button" onClick={chooseLocalRecovery}>
                    <HardDrive aria-hidden="true" />
                    Use this device for recovery
                  </Button>
                ) : null}
              </div>
              {recoveryError ? (
                <p className="aios-inline-error" role="alert">
                  {recoveryError}
                </p>
              ) : null}
            </Card>
          ) : null}

          {activeEntry && workspace.phase === "error" && workspace.document ? (
            <div className="aios-apps-save-error" role="alert">
              <AlertCircle aria-hidden="true" />
              <div>
                <strong>These edits are still open here.</strong>
                <p>{workspace.error}</p>
              </div>
              <div className="aios-toolbar-actions">
                {workspace.isConflict ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={downloadRecoveryCopy}
                    >
                      Download recovery copy
                    </Button>
                    <Button type="button" onClick={workspace.reload}>
                      Load latest
                    </Button>
                  </>
                ) : workspace.errorStage === "save" ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={workspace.retrySave}
                  >
                    <RotateCcw aria-hidden="true" />
                    Retry save
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={workspace.reload}
                  >
                    <RotateCcw aria-hidden="true" />
                    Reload
                  </Button>
                )}
                {storageMode !== "local-recovery" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={chooseLocalRecovery}
                  >
                    <HardDrive aria-hidden="true" />
                    Save recovery copy on this device
                  </Button>
                ) : null}
              </div>
              {recoveryError ? (
                <p className="aios-inline-error" role="alert">
                  {recoveryError}
                </p>
              ) : null}
            </div>
          ) : null}

          {activeEntry && workspace.saveVerificationUnavailable ? (
            <div
              className="aios-apps-verification-note"
              role="status"
              data-testid="aios-apps-save-verification-note"
            >
              <p>
                The relay accepted this save, but could not confirm the latest
                Canvas head. Load the latest version before editing again.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={workspace.reload}
              >
                <RotateCcw aria-hidden="true" />
                Load latest
              </Button>
            </div>
          ) : null}

          {workspace.document &&
          workspace.phase !== "loading" &&
          workspace.phase !== "blocked" ? (
            <div className="aios-app-editor-shell" hidden={!activeEntry}>
              <div hidden={selectedApp !== "slides"}>
                <SlidesEditor
                  document={workspace.document.documents.slides}
                  companyName={companyName}
                  onChange={(next) => workspace.updateDocument("slides", next)}
                />
              </div>
              <div hidden={selectedApp !== "calendar"}>
                <CalendarEditor
                  document={workspace.document.documents.calendar}
                  onChange={(next) =>
                    workspace.updateDocument("calendar", next)
                  }
                  onDraftDirtyChange={setCalendarDraftDirty}
                />
              </div>
              <div hidden={selectedApp !== "design"}>
                <DesignEditor
                  document={workspace.document.documents.design}
                  onChange={(next) => workspace.updateDocument("design", next)}
                />
              </div>
            </div>
          ) : null}
          {uniqueExtensionApps
            .filter(({ id }) => visitedExtensions.has(id))
            .map(({ id, render }) => (
              <div
                className="aios-app-extension-shell"
                hidden={selectedApp !== id}
                key={id}
                data-testid={`aios-app-extension-${id}`}
              >
                {render(extensionContexts.get(id) ?? {})}
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}
