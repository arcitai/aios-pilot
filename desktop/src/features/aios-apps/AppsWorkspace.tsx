import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
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
import { AIOS_APP_REGISTRY } from "./registry";
import { canvasAppDocumentStore } from "./canvasStore";
import {
  localAppDocumentStore,
  type AppDocumentScope,
  type AppDocumentStore,
} from "./storage";
import { downloadTextFile } from "./htmlPreview";
import type { AppId } from "./types";
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
  const [selectedApp, setSelectedApp] = useState<AppId>("slides");
  const [storageMode, setStorageMode] = useState<StorageMode>("shared");
  const [recoveryError, setRecoveryError] = useState("");
  const [calendarDraftDirty, setCalendarDraftDirty] = useState(false);
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
  const statusText = workspace.saveVerificationUnavailable
    ? "Saved · confirmation unavailable"
    : describePhase(workspace.phase, appDocumentStore.label);
  const documentDirty =
    workspace.phase === "unsaved" ||
    workspace.phase === "saving" ||
    (workspace.phase === "error" && workspace.errorStage === "save");
  const dirty = documentDirty || calendarDraftDirty;

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
      className="aios-apps-workspace"
      aria-label="Business apps"
      data-testid="aios-apps-workspace"
    >
      <header className="aios-apps-header">
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
            <span className="aios-storage-label">{appDocumentStore.label}</span>
          )}
        </div>
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
                <p className="aios-eyebrow">Workspace app</p>
                <h2>{activeEntry.title}</h2>
              </div>
              <div className="aios-capabilities">
                {activeEntry.capabilities.map((capability) => (
                  <span key={capability}>{capability}</span>
                ))}
              </div>
            </div>
          ) : null}

          {workspace.phase === "loading" ? (
            <div className="aios-apps-state" role="status">
              <LoaderCircle className="aios-status-spin" aria-hidden="true" />
              <p>Loading your app documents…</p>
            </div>
          ) : null}

          {workspace.phase === "blocked" ? (
            <Card className="aios-apps-state-card">
              <AlertCircle aria-hidden="true" />
              <h3>Workspace access is needed</h3>
              <p>{workspace.error}</p>
            </Card>
          ) : null}

          {workspace.phase === "error" &&
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

          {workspace.phase === "error" && workspace.document ? (
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

          {workspace.saveVerificationUnavailable ? (
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
            <>
              <div className="aios-app-editor-shell">
                <div hidden={selectedApp !== "slides"}>
                  <SlidesEditor
                    document={workspace.document.documents.slides}
                    companyName={companyName}
                    onChange={(next) =>
                      workspace.updateDocument("slides", next)
                    }
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
                    onChange={(next) =>
                      workspace.updateDocument("design", next)
                    }
                  />
                </div>
              </div>
              {appDocumentStore === canvasAppDocumentStore ? (
                <p className="aios-private-access-note">
                  App documents live in separate private channels. Their access
                  list is independent from this business channel; no members are
                  added automatically.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
