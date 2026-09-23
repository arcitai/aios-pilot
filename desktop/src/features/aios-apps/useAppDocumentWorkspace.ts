import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  appDocumentStorageKey,
  type AppDocumentScope,
  type AppDocumentStore,
} from "./storage";
import {
  createInitialAppsWorkspace,
  parseAppsWorkspaceDocument,
  type AppDocument,
  type AppId,
  type AppsWorkspaceDocument,
} from "./types";
import { cancelPendingAutosave } from "./autosave";

export type AppDocumentPhase =
  | "loading"
  | "blocked"
  | "ready"
  | "unsaved"
  | "saving"
  | "saved"
  | "error";

type ErrorStage = "load" | "save" | null;

type PendingSave = {
  scope: AppDocumentScope;
  store: AppDocumentStore;
  document: AppsWorkspaceDocument;
  generation: number;
  timer: number;
};

export function useAppDocumentWorkspace({
  channelId,
  companyName,
  companySummary,
  scope,
  store,
}: {
  channelId: string;
  companyName?: string;
  companySummary?: string;
  scope: AppDocumentScope | null;
  store: AppDocumentStore;
}) {
  const defaults = useMemo(
    () => createInitialAppsWorkspace(channelId, companyName, companySummary),
    [channelId, companyName, companySummary],
  );
  const scopeKey = scope ? appDocumentStorageKey(scope) : null;
  const defaultsRef = useRef(defaults);
  const defaultsScopeKeyRef = useRef(scopeKey);
  if (defaultsScopeKeyRef.current !== scopeKey) {
    defaultsRef.current = defaults;
    defaultsScopeKeyRef.current = scopeKey;
  }

  const [document, setDocument] = useState<AppsWorkspaceDocument | null>(null);
  const [phase, setPhase] = useState<AppDocumentPhase>("loading");
  const [error, setError] = useState("");
  const [errorStage, setErrorStage] = useState<ErrorStage>(null);
  const [saveVerificationUnavailable, setSaveVerificationUnavailable] =
    useState(false);
  const [reloadSequence, setReloadSequence] = useState(0);
  const documentRef = useRef<AppsWorkspaceDocument | null>(null);
  const generationRef = useRef(0);
  const saveSequenceRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveRef = useRef<PendingSave | null>(null);
  const lastLoadedScopeRef = useRef<string | null>(null);

  const enqueueSave = useCallback(
    (request: PendingSave, updateStatus = true) => {
      const sequence = ++saveSequenceRef.current;
      if (updateStatus && generationRef.current === request.generation) {
        setPhase("saving");
        setError("");
        setErrorStage(null);
        setSaveVerificationUnavailable(false);
      }
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(() => {
          // A queued save has not reached native storage yet. Discarding or
          // changing this workspace cancels it just like an unsent timer.
          if (generationRef.current !== request.generation) return;
          return request.store.save(request.scope, request.document);
        })
        .then((saveResult) => {
          if (!saveResult) return;
          if (
            updateStatus &&
            generationRef.current === request.generation &&
            saveSequenceRef.current === sequence &&
            documentRef.current === request.document
          ) {
            setPhase("saved");
            setError("");
            setErrorStage(null);
            setSaveVerificationUnavailable(!saveResult.verified);
          }
        })
        .catch((saveError: unknown) => {
          if (
            updateStatus &&
            generationRef.current === request.generation &&
            saveSequenceRef.current === sequence &&
            documentRef.current === request.document
          ) {
            setPhase("error");
            setError(
              saveError instanceof Error
                ? saveError.message
                : "The app documents could not be saved.",
            );
            setErrorStage("save");
          }
        });
    },
    [],
  );

  const cancelPendingSave = useCallback((generation?: number) => {
    const pending = pendingSaveRef.current;
    if (!pending) return;
    if (
      cancelPendingAutosave(
        pending,
        generation ?? pending.generation,
        (timer) => window.clearTimeout(timer),
      )
    ) {
      pendingSaveRef.current = null;
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadSequence intentionally retriggers this load effect after Retry or Reload.
  useEffect(() => {
    const generation = ++generationRef.current;
    let cancelled = false;
    if (!scope) {
      documentRef.current = null;
      setDocument(null);
      setPhase("blocked");
      setError(
        "An active relay and signer scope is required for app documents.",
      );
      setErrorStage("load");
      return () => {
        cancelled = true;
      };
    }

    if (scopeKey !== lastLoadedScopeRef.current) {
      documentRef.current = null;
      setDocument(null);
      lastLoadedScopeRef.current = scopeKey;
    }
    setPhase("loading");
    setError("");
    setErrorStage(null);
    setSaveVerificationUnavailable(false);

    store
      .load(scope, defaultsRef.current)
      .then((loaded) => {
        if (cancelled || generationRef.current !== generation) return;
        if (loaded === null) {
          documentRef.current = defaultsRef.current;
          setDocument(defaultsRef.current);
          setPhase("ready");
          return;
        }
        const parsed = parseAppsWorkspaceDocument(loaded, channelId);
        if (!parsed.ok) {
          throw new Error(parsed.reason);
        }
        documentRef.current = parsed.document;
        setDocument(parsed.document);
        setPhase("saved");
      })
      .catch((loadError: unknown) => {
        if (cancelled || generationRef.current !== generation) return;
        setPhase("error");
        setError(
          loadError instanceof Error
            ? loadError.message
            : "The app documents could not be loaded.",
        );
        setErrorStage("load");
      });

    return () => {
      cancelled = true;
      cancelPendingSave(generation);
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [channelId, cancelPendingSave, reloadSequence, scope, scopeKey, store]);

  const updateDocument = useCallback(
    (appId: AppId, nextDocument: AppDocument) => {
      const current = documentRef.current;
      if (!current || !scope || nextDocument.kind !== appId) return;
      const next: AppsWorkspaceDocument = {
        ...current,
        updatedAt: new Date().toISOString(),
        documents: {
          ...current.documents,
          [appId]: nextDocument,
        } as AppsWorkspaceDocument["documents"],
      };
      const parsed = parseAppsWorkspaceDocument(next, channelId);
      if (!parsed.ok) {
        setPhase("error");
        setError(parsed.reason);
        setErrorStage("save");
        return;
      }
      documentRef.current = parsed.document;
      setDocument(parsed.document);
      setPhase("unsaved");
      setError("");
      setErrorStage(null);

      const previous = pendingSaveRef.current;
      if (previous) window.clearTimeout(previous.timer);
      const request: PendingSave = {
        scope,
        store,
        document: parsed.document,
        generation: generationRef.current,
        timer: 0,
      };
      request.timer = window.setTimeout(() => {
        if (pendingSaveRef.current !== request) return;
        pendingSaveRef.current = null;
        enqueueSave(request);
      }, 500);
      pendingSaveRef.current = request;
    },
    [channelId, enqueueSave, scope, store],
  );

  const retrySave = useCallback(() => {
    const snapshot = documentRef.current;
    if (!snapshot || !scope) return;
    const existing = pendingSaveRef.current;
    if (existing) window.clearTimeout(existing.timer);
    pendingSaveRef.current = null;
    enqueueSave({
      scope,
      store,
      document: snapshot,
      generation: generationRef.current,
      timer: 0,
    });
  }, [enqueueSave, scope, store]);

  const reload = useCallback(() => {
    cancelPendingSave();
    setReloadSequence((current) => current + 1);
  }, [cancelPendingSave]);

  const isConflict =
    error.includes("Someone else changed") ||
    error.includes("APP_CANVAS_CONFLICT");

  return {
    document,
    phase,
    error,
    errorStage,
    saveVerificationUnavailable,
    isConflict,
    updateDocument,
    retrySave,
    reload,
    cancelPendingSave,
  };
}
