import * as React from "react";

import type { SiteDocument } from "./document";
import {
  SITES_PUBLISHER_DEFAULT_ORIGIN,
  connectPublisher,
  createSitePreview,
  disconnectPublisher,
  getPublishedSiteStatus,
  getPublisherStatus,
  publishSite,
  revokeSite,
  siteContentHash,
  type PublishedSiteStatus,
  type SitePreviewResult,
} from "./publisherApi";
import { errorMessage } from "./workspaceModel";

const PUBLISHER_ORIGIN_KEY = "aios-sites.publisher-origin.v1";

type OperationName =
  | "connection"
  | "siteStatus"
  | "preview"
  | "publish"
  | "revoke";
type OperationGenerations = Record<OperationName, number>;

type OperationTicket = {
  operation: OperationName;
  generation: number;
  scopeKey: string;
  scopeGeneration: number;
  siteContextKey: string | null;
  siteGeneration: number | null;
  siteId: string | null;
};

type ConfirmationTarget = {
  scopeKey: string;
  scopeGeneration: number;
  siteContextKey: string;
  siteGeneration: number;
  siteId: string;
};

type PreviewState = SitePreviewResult & {
  draftKey: string;
  expiresAt: number;
  ticket: OperationTicket;
};

function savedOrigin() {
  try {
    return (
      window.localStorage.getItem(PUBLISHER_ORIGIN_KEY) ||
      SITES_PUBLISHER_DEFAULT_ORIGIN
    );
  } catch {
    return SITES_PUBLISHER_DEFAULT_ORIGIN;
  }
}

function persistOrigin(origin: string) {
  try {
    window.localStorage.setItem(PUBLISHER_ORIGIN_KEY, origin);
  } catch {
    // The origin is non-sensitive convenience state; a blocked storage surface
    // simply means the owner enters it again next time.
  }
}

export function useSitesPublisher({
  expectedRelayUrl,
  expectedSignerPubkey,
  siteId,
  document,
  canPublish,
}: {
  expectedRelayUrl: string;
  expectedSignerPubkey: string;
  siteId: string | null;
  document: SiteDocument | null;
  canPublish: boolean;
}) {
  const [managerUrl, setManagerUrlState] = React.useState(savedOrigin);
  const [tokenDraft, setTokenDraft] = React.useState("");
  const [connected, setConnected] = React.useState(false);
  const [publisherVersion, setPublisherVersion] = React.useState<string | null>(
    null,
  );
  const [siteStatus, setSiteStatus] =
    React.useState<PublishedSiteStatus | null>(null);
  const [preview, setPreview] = React.useState<PreviewState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [isChecking, setIsChecking] = React.useState(false);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [isDisconnecting, setIsDisconnecting] = React.useState(false);
  const [isPreviewing, setIsPreviewing] = React.useState(false);
  const [isPublishing, setIsPublishing] = React.useState(false);
  const [isRevoking, setIsRevoking] = React.useState(false);
  const [confirmationTarget, setConfirmationTarget] =
    React.useState<ConfirmationTarget | null>(null);
  const operationGenerations = React.useRef<OperationGenerations>({
    connection: 0,
    siteStatus: 0,
    preview: 0,
    publish: 0,
    revoke: 0,
  });
  const connectionStatusGeneration = React.useRef(0);
  const siteStatusGeneration = React.useRef(0);
  const publishedHashGeneration = React.useRef(0);
  const mounted = React.useRef(false);

  const scope = React.useMemo(
    () => ({
      managerUrl: managerUrl.trim(),
      expectedRelayUrl,
      expectedSignerPubkey,
    }),
    [expectedRelayUrl, expectedSignerPubkey, managerUrl],
  );
  const scopeKey = JSON.stringify([
    scope.managerUrl,
    scope.expectedRelayUrl,
    scope.expectedSignerPubkey.toLowerCase(),
  ]);
  const siteContextKey = JSON.stringify([scopeKey, siteId]);
  const activeScope = React.useRef({ key: scopeKey, generation: 0 });
  if (activeScope.current.key !== scopeKey) {
    activeScope.current = {
      key: scopeKey,
      generation: activeScope.current.generation + 1,
    };
  }
  const activeSiteContext = React.useRef({
    key: siteContextKey,
    siteId,
    generation: 0,
  });
  if (activeSiteContext.current.key !== siteContextKey) {
    activeSiteContext.current = {
      key: siteContextKey,
      siteId,
      generation: activeSiteContext.current.generation + 1,
    };
  }
  const previousScopeKey = React.useRef(scopeKey);
  const previousSiteContextKey = React.useRef(siteContextKey);
  const draftKey = document
    ? JSON.stringify({ title: document.title, files: document.files })
    : "";
  const currentDraftKey = React.useRef(draftKey);
  currentDraftKey.current = draftKey;

  const captureOperation = React.useCallback(
    (operation: OperationName, bindSite: boolean): OperationTicket => {
      const generation = ++operationGenerations.current[operation];
      const subject = activeSiteContext.current;
      return {
        operation,
        generation,
        scopeKey: activeScope.current.key,
        scopeGeneration: activeScope.current.generation,
        siteContextKey: bindSite ? subject.key : null,
        siteGeneration: bindSite ? subject.generation : null,
        siteId: bindSite ? subject.siteId : null,
      };
    },
    [],
  );

  const isScopeCurrent = React.useCallback(
    (ticket: OperationTicket) =>
      mounted.current &&
      ticket.scopeKey === activeScope.current.key &&
      ticket.scopeGeneration === activeScope.current.generation,
    [],
  );

  const isOperationCurrent = React.useCallback(
    (ticket: OperationTicket) => {
      if (
        !isScopeCurrent(ticket) ||
        operationGenerations.current[ticket.operation] !== ticket.generation
      ) {
        return false;
      }
      if (ticket.siteContextKey === null) return true;
      return (
        ticket.siteContextKey === activeSiteContext.current.key &&
        ticket.siteGeneration === activeSiteContext.current.generation &&
        ticket.siteId === activeSiteContext.current.siteId
      );
    },
    [isScopeCurrent],
  );

  const revokeConfirmationOpen =
    confirmationTarget !== null &&
    confirmationTarget.scopeKey === activeScope.current.key &&
    confirmationTarget.scopeGeneration === activeScope.current.generation &&
    confirmationTarget.siteContextKey === activeSiteContext.current.key &&
    confirmationTarget.siteGeneration ===
      activeSiteContext.current.generation &&
    confirmationTarget.siteId === siteId;

  function setRevokeConfirmationOpen(open: boolean) {
    if (!open) {
      setConfirmationTarget(null);
      return;
    }
    if (!siteId || !siteStatus?.published) return;
    setConfirmationTarget({
      scopeKey,
      scopeGeneration: activeScope.current.generation,
      siteContextKey,
      siteGeneration: activeSiteContext.current.generation,
      siteId,
    });
  }

  const previewIsCurrent = preview !== null && preview.draftKey === draftKey;
  const [publishedCurrent, setPublishedCurrent] = React.useState(false);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const operation of Object.keys(
        operationGenerations.current,
      ) as OperationName[]) {
        operationGenerations.current[operation] += 1;
      }
      connectionStatusGeneration.current += 1;
      siteStatusGeneration.current += 1;
      publishedHashGeneration.current += 1;
    };
  }, []);

  React.useLayoutEffect(() => {
    const scopeChanged = previousScopeKey.current !== scopeKey;
    const siteChanged = previousSiteContextKey.current !== siteContextKey;
    previousScopeKey.current = scopeKey;
    previousSiteContextKey.current = siteContextKey;

    if (scopeChanged) {
      setConnected(false);
      setPublisherVersion(null);
      setTokenDraft("");
      setIsChecking(false);
      setIsConnecting(false);
      setIsDisconnecting(false);
    }
    if (siteChanged) {
      siteStatusGeneration.current += 1;
      publishedHashGeneration.current += 1;
      setSiteStatus(null);
      setPreview(null);
      setPublishedCurrent(false);
      setIsPreviewing(false);
      setIsPublishing(false);
      setIsRevoking(false);
      setConfirmationTarget(null);
    }
    if (scopeChanged || siteChanged) {
      setError(null);
      setMessage(null);
    }
  }, [scopeKey, siteContextKey]);

  React.useEffect(() => persistOrigin(managerUrl), [managerUrl]);

  React.useEffect(() => {
    if (!preview) return;
    const delay = Math.max(0, preview.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      if (!isOperationCurrent(preview.ticket)) return;
      setPreview(null);
      setMessage(
        "The temporary preview expired. Run it again to create a fresh preview.",
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [preview, isOperationCurrent]);

  React.useEffect(() => {
    const generation = ++connectionStatusGeneration.current;
    const statusTicket = captureOperation("connection", false);
    setConnected(false);
    setPublisherVersion(null);
    setSiteStatus(null);
    setPreview(null);
    setError(null);
    setMessage(null);
    setIsChecking(false);
    if (!scope.managerUrl) return;
    setIsChecking(true);
    void getPublisherStatus(scope)
      .then((status) => {
        if (
          !isScopeCurrent(statusTicket) ||
          generation !== connectionStatusGeneration.current
        )
          return;
        setConnected(status.connected);
        setPublisherVersion(status.version);
      })
      .catch((cause: unknown) => {
        if (
          isScopeCurrent(statusTicket) &&
          generation === connectionStatusGeneration.current
        ) {
          setError(errorMessage(cause));
        }
      })
      .finally(() => {
        if (
          isScopeCurrent(statusTicket) &&
          generation === connectionStatusGeneration.current
        ) {
          setIsChecking(false);
        }
      });
    return () => {
      if (generation === connectionStatusGeneration.current)
        connectionStatusGeneration.current += 1;
    };
  }, [captureOperation, isScopeCurrent, scope]);

  React.useEffect(() => {
    const generation = ++siteStatusGeneration.current;
    const statusTicket = captureOperation("siteStatus", true);
    setSiteStatus(null);
    setPublishedCurrent(false);
    if (!connected || !siteId) return;
    void getPublishedSiteStatus(scope, siteId)
      .then((status) => {
        if (
          !isOperationCurrent(statusTicket) ||
          generation !== siteStatusGeneration.current
        )
          return;
        if (status.siteId !== siteId)
          throw new Error("Publisher returned status for a different site.");
        setSiteStatus(status);
      })
      .catch((cause: unknown) => {
        if (
          isOperationCurrent(statusTicket) &&
          generation === siteStatusGeneration.current
        ) {
          setError(errorMessage(cause));
        }
      });
    return () => {
      if (generation === siteStatusGeneration.current)
        siteStatusGeneration.current += 1;
    };
  }, [captureOperation, connected, isOperationCurrent, scope, siteId]);

  React.useEffect(() => {
    const generation = ++publishedHashGeneration.current;
    const scopeGeneration = activeScope.current.generation;
    const siteGeneration = activeSiteContext.current.generation;
    setPublishedCurrent(false);
    if (!siteStatus?.published || !document || !siteId) return;
    void siteContentHash(document.siteId, document.title, document.files)
      .then((hash) => {
        if (
          mounted.current &&
          generation === publishedHashGeneration.current &&
          scopeKey === activeScope.current.key &&
          scopeGeneration === activeScope.current.generation &&
          siteContextKey === activeSiteContext.current.key &&
          siteGeneration === activeSiteContext.current.generation &&
          siteStatus.siteId === siteId
        ) {
          setPublishedCurrent(hash === siteStatus.contentHash);
        }
      })
      .catch(() => {
        if (
          mounted.current &&
          generation === publishedHashGeneration.current &&
          scopeKey === activeScope.current.key &&
          scopeGeneration === activeScope.current.generation &&
          siteContextKey === activeSiteContext.current.key &&
          siteGeneration === activeSiteContext.current.generation
        ) {
          setPublishedCurrent(false);
        }
      });
    return () => {
      if (generation === publishedHashGeneration.current)
        publishedHashGeneration.current += 1;
    };
  }, [document, scopeKey, siteContextKey, siteId, siteStatus]);

  function setManagerUrl(value: string) {
    setManagerUrlState(value);
    setTokenDraft("");
  }

  async function connect() {
    const ticket = captureOperation("connection", false);
    const submittedToken = tokenDraft;
    connectionStatusGeneration.current += 1;
    setError(null);
    setMessage(null);
    setIsChecking(false);
    setIsConnecting(true);
    try {
      const status = await connectPublisher(scope, submittedToken);
      if (!isOperationCurrent(ticket)) return;
      setConnected(status.connected);
      setPublisherVersion(status.version);
      setMessage(
        "Connected. Buzz stored the publisher operator token in the OS keyring for this origin, community, and identity.",
      );
    } catch (cause) {
      if (isOperationCurrent(ticket)) setError(errorMessage(cause));
    } finally {
      if (isOperationCurrent(ticket)) {
        setTokenDraft("");
        setIsConnecting(false);
      }
    }
  }

  async function disconnect() {
    const ticket = captureOperation("connection", false);
    connectionStatusGeneration.current += 1;
    setError(null);
    setMessage(null);
    setIsDisconnecting(true);
    try {
      await disconnectPublisher(scope);
      if (!isOperationCurrent(ticket)) return;
      siteStatusGeneration.current += 1;
      setConnected(false);
      setPublisherVersion(null);
      setSiteStatus(null);
      setPreview(null);
      setPublishedCurrent(false);
      setMessage("Removed this publisher token from the OS keyring.");
    } catch (cause) {
      if (isOperationCurrent(ticket)) setError(errorMessage(cause));
    } finally {
      if (isOperationCurrent(ticket)) setIsDisconnecting(false);
    }
  }

  async function runPreview() {
    if (!document || !siteId) return;
    const ticket = captureOperation("preview", true);
    const capturedDraftKey = draftKey;
    const title = document.title;
    const files = { ...document.files };
    setError(null);
    setMessage(null);
    setPreview(null);
    setIsPreviewing(true);
    try {
      const result = await createSitePreview(scope, siteId, title, files);
      if (!isOperationCurrent(ticket)) return;
      setPreview({
        ...result,
        draftKey: capturedDraftKey,
        expiresAt: Date.now() + result.expiresInSeconds * 1000,
        ticket,
      });
      setMessage(
        `Preview is temporary and expires in ${Math.round(result.expiresInSeconds / 60)} minutes.`,
      );
    } catch (cause) {
      if (isOperationCurrent(ticket)) setError(errorMessage(cause));
    } finally {
      if (isOperationCurrent(ticket)) setIsPreviewing(false);
    }
  }

  async function publish() {
    if (!document || !siteId || !canPublish) return;
    const ticket = captureOperation("publish", true);
    const capturedDraftKey = draftKey;
    const snapshot = {
      siteId: document.siteId,
      title: document.title,
      files: { ...document.files },
    };
    siteStatusGeneration.current += 1;
    setError(null);
    setMessage(null);
    setIsPublishing(true);
    try {
      const expectedHash = await siteContentHash(
        snapshot.siteId,
        snapshot.title,
        snapshot.files,
      );
      if (!isOperationCurrent(ticket)) return;
      const result = await publishSite(
        scope,
        siteId,
        snapshot.title,
        snapshot.files,
      );
      if (!isOperationCurrent(ticket)) return;
      if (result.siteId !== siteId || result.contentHash !== expectedHash) {
        throw new Error(
          "Publisher did not confirm the requested site snapshot.",
        );
      }
      const readback = await getPublishedSiteStatus(scope, siteId);
      if (!isOperationCurrent(ticket)) return;
      if (
        readback.siteId !== siteId ||
        !readback.published ||
        readback.contentHash !== result.contentHash ||
        readback.publicUrl !== result.publicUrl
      ) {
        throw new Error(
          "Publisher readback did not match the just-published snapshot.",
        );
      }
      setSiteStatus(readback);
      setPublishedCurrent(
        currentDraftKey.current === capturedDraftKey &&
          readback.contentHash === expectedHash,
      );
      setMessage(
        result.alreadyPublished
          ? "This exact snapshot was already published and verified by the publisher."
          : "Site published and verified by the publisher.",
      );
    } catch (cause) {
      if (isOperationCurrent(ticket)) setError(errorMessage(cause));
    } finally {
      if (isOperationCurrent(ticket)) setIsPublishing(false);
    }
  }

  async function revoke() {
    if (!siteId || !revokeConfirmationOpen) return;
    const ticket = captureOperation("revoke", true);
    const confirmedForCurrentContext =
      confirmationTarget?.siteContextKey === ticket.siteContextKey &&
      confirmationTarget.scopeGeneration === ticket.scopeGeneration &&
      confirmationTarget.siteGeneration === ticket.siteGeneration &&
      confirmationTarget.siteId === siteId;
    if (!confirmedForCurrentContext) return;
    siteStatusGeneration.current += 1;
    setError(null);
    setMessage(null);
    setIsRevoking(true);
    try {
      const revoked = await revokeSite(scope, siteId);
      if (!isOperationCurrent(ticket)) return;
      if (!revoked)
        throw new Error("The publisher did not confirm revocation.");
      const readback = await getPublishedSiteStatus(scope, siteId);
      if (!isOperationCurrent(ticket)) return;
      if (readback.siteId !== siteId || readback.published)
        throw new Error("Publisher readback still shows this site as public.");
      setSiteStatus(readback);
      setPublishedCurrent(false);
      setConfirmationTarget(null);
      setMessage(
        "Publication revoked. Buzz verified that the public URL returns HTTP 404.",
      );
    } catch (cause) {
      if (isOperationCurrent(ticket)) setError(errorMessage(cause));
    } finally {
      if (isOperationCurrent(ticket)) setIsRevoking(false);
    }
  }

  return {
    managerUrl,
    setManagerUrl,
    tokenDraft,
    setTokenDraft,
    connected,
    publisherVersion,
    siteStatus,
    previewUrl: preview?.previewUrl ?? null,
    previewExpiresInSeconds: preview?.expiresInSeconds ?? null,
    previewExpiresAt: preview?.expiresAt ?? null,
    isPreviewCurrent: previewIsCurrent,
    error,
    message,
    isChecking,
    isConnecting,
    isDisconnecting,
    isPreviewing,
    isPublishing,
    isRevoking,
    isPublishedCurrent: publishedCurrent,
    canPublish,
    revokeConfirmationOpen,
    setRevokeConfirmationOpen,
    connect,
    disconnect,
    runPreview,
    publish,
    revoke,
  };
}
