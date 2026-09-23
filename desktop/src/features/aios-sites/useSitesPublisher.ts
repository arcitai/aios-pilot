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
  const [preview, setPreview] = React.useState<
    (SitePreviewResult & { draftKey: string; expiresAt: number }) | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [isChecking, setIsChecking] = React.useState(false);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [isPreviewing, setIsPreviewing] = React.useState(false);
  const [isPublishing, setIsPublishing] = React.useState(false);
  const [isRevoking, setIsRevoking] = React.useState(false);
  const [revokeConfirmationOpen, setRevokeConfirmationOpen] =
    React.useState(false);
  const connectionGeneration = React.useRef(0);
  const siteStatusGeneration = React.useRef(0);

  const scope = React.useMemo(
    () => ({
      managerUrl: managerUrl.trim(),
      expectedRelayUrl,
      expectedSignerPubkey,
    }),
    [expectedRelayUrl, expectedSignerPubkey, managerUrl],
  );
  const draftKey = document
    ? JSON.stringify({ title: document.title, files: document.files })
    : "";
  const isPreviewCurrent = preview !== null && preview.draftKey === draftKey;
  const [isPublishedCurrent, setIsPublishedCurrent] = React.useState(false);

  React.useEffect(() => persistOrigin(managerUrl), [managerUrl]);

  React.useEffect(() => {
    if (!preview) return;
    const delay = Math.max(0, preview.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      setPreview(null);
      setMessage(
        "The temporary preview expired. Run it again to create a fresh preview.",
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [preview]);

  React.useEffect(() => {
    const generation = ++connectionGeneration.current;
    setConnected(false);
    setPublisherVersion(null);
    setSiteStatus(null);
    setPreview(null);
    setError(null);
    setMessage(null);
    if (!scope.managerUrl) return;
    setIsChecking(true);
    void getPublisherStatus(scope)
      .then((status) => {
        if (generation !== connectionGeneration.current) return;
        setConnected(status.connected);
        setPublisherVersion(status.version);
      })
      .catch((cause: unknown) => {
        if (generation === connectionGeneration.current)
          setError(errorMessage(cause));
      })
      .finally(() => {
        if (generation === connectionGeneration.current) setIsChecking(false);
      });
  }, [scope]);

  React.useEffect(() => {
    const generation = ++siteStatusGeneration.current;
    setSiteStatus(null);
    setIsPublishedCurrent(false);
    setPreview(null);
    if (!connected || !siteId) return;
    void getPublishedSiteStatus(scope, siteId)
      .then((status) => {
        if (generation === siteStatusGeneration.current) setSiteStatus(status);
      })
      .catch((cause: unknown) => {
        if (generation === siteStatusGeneration.current)
          setError(errorMessage(cause));
      });
    return () => {
      siteStatusGeneration.current += 1;
    };
  }, [connected, scope, siteId]);

  React.useEffect(() => {
    let cancelled = false;
    setIsPublishedCurrent(false);
    if (!siteStatus?.published || !document) return;
    void siteContentHash(document.siteId, document.title, document.files)
      .then((hash) => {
        if (!cancelled) setIsPublishedCurrent(hash === siteStatus.contentHash);
      })
      .catch(() => {
        if (!cancelled) setIsPublishedCurrent(false);
      });
    return () => {
      cancelled = true;
    };
  }, [document, siteStatus]);

  function setManagerUrl(value: string) {
    setManagerUrlState(value);
    setTokenDraft("");
  }

  async function connect() {
    setError(null);
    setMessage(null);
    setIsConnecting(true);
    const submittedToken = tokenDraft;
    try {
      const status = await connectPublisher(scope, submittedToken);
      setConnected(status.connected);
      setPublisherVersion(status.version);
      setMessage(
        "Connected. Buzz stored the publisher operator token in the OS keyring for this origin, community, and identity.",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setTokenDraft("");
      setIsConnecting(false);
    }
  }

  async function disconnect() {
    setError(null);
    setMessage(null);
    try {
      await disconnectPublisher(scope);
      setConnected(false);
      setPublisherVersion(null);
      setSiteStatus(null);
      setPreview(null);
      setMessage("Removed this publisher token from the OS keyring.");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function runPreview() {
    if (!document || !siteId) return;
    setError(null);
    setMessage(null);
    setIsPreviewing(true);
    try {
      const result = await createSitePreview(
        scope,
        siteId,
        document.title,
        document.files,
      );
      setPreview({
        ...result,
        draftKey,
        expiresAt: Date.now() + result.expiresInSeconds * 1000,
      });
      setMessage(
        `Preview is temporary and expires in ${Math.round(result.expiresInSeconds / 60)} minutes.`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setIsPreviewing(false);
    }
  }

  async function publish() {
    if (!document || !siteId || !canPublish) return;
    setError(null);
    setMessage(null);
    setIsPublishing(true);
    try {
      const result = await publishSite(
        scope,
        siteId,
        document.title,
        document.files,
      );
      const readback = await getPublishedSiteStatus(scope, siteId);
      if (
        !readback.published ||
        readback.contentHash !== result.contentHash ||
        readback.publicUrl !== result.publicUrl
      ) {
        throw new Error(
          "Publisher readback did not match the just-published snapshot.",
        );
      }
      setSiteStatus(readback);
      setIsPublishedCurrent(true);
      setMessage(
        result.alreadyPublished
          ? "This exact snapshot was already published and verified by the publisher."
          : "Site published and verified by the publisher.",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setIsPublishing(false);
    }
  }

  async function revoke() {
    if (!siteId) return;
    setError(null);
    setMessage(null);
    setIsRevoking(true);
    try {
      const revoked = await revokeSite(scope, siteId);
      if (!revoked)
        throw new Error("The publisher did not confirm revocation.");
      const readback = await getPublishedSiteStatus(scope, siteId);
      if (readback.published)
        throw new Error("Publisher readback still shows this site as public.");
      setSiteStatus(readback);
      setIsPublishedCurrent(false);
      setRevokeConfirmationOpen(false);
      setMessage(
        "Publication revoked. Buzz verified that the public URL returns HTTP 404.",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setIsRevoking(false);
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
    isPreviewCurrent,
    error,
    message,
    isChecking,
    isConnecting,
    isPreviewing,
    isPublishing,
    isRevoking,
    isPublishedCurrent,
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
