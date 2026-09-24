import type * as React from "react";
import {
  ExternalLink,
  Globe2,
  KeyRound,
  PlugZap,
  ShieldCheck,
  Unplug,
} from "lucide-react";

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
import type { useSitesPublisher } from "./useSitesPublisher";

type PublisherController = ReturnType<typeof useSitesPublisher>;

export function SitesPublisherPanel({
  publisher,
  siteId,
}: {
  publisher: PublisherController;
  siteId: string | null;
}) {
  const published = publisher.siteStatus?.published === true;

  function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void publisher.connect();
  }

  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Globe2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Share your site</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Publish a saved version and share its link.
          </p>
        </div>
        {publisher.isDisconnecting ? (
          <span className="text-2xs text-muted-foreground" role="status">
            Disconnecting…
          </span>
        ) : publisher.connected ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-2xs font-medium text-primary"
            role="status"
          >
            <ShieldCheck className="size-3.5" /> Connected
            {publisher.publisherVersion
              ? ` · v${publisher.publisherVersion}`
              : ""}
          </span>
        ) : publisher.isChecking ? (
          <span className="text-2xs text-muted-foreground" role="status">
            Checking connection…
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-2xs text-muted-foreground">
            <PlugZap className="size-3.5" /> Not connected
          </span>
        )}
      </div>

      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
          Hosting settings
        </summary>
        <form className="mt-3 max-w-lg space-y-3" onSubmit={connect}>
          <div className="space-y-1.5">
            <label
              className="text-xs font-medium"
              htmlFor="sites-publisher-url"
            >
              Publisher address
            </label>
            <Input
              autoCapitalize="off"
              autoComplete="url"
              autoCorrect="off"
              id="sites-publisher-url"
              onChange={(event) => publisher.setManagerUrl(event.target.value)}
              placeholder="https://sites.example.com"
              spellCheck={false}
              value={publisher.managerUrl}
            />
            <p className="text-2xs leading-relaxed text-muted-foreground">
              Remote publishers must use HTTPS. The local default is
              http://127.0.0.1:3352.
            </p>
          </div>

          {!publisher.connected ? (
            <>
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium"
                  htmlFor="sites-publisher-token"
                >
                  Publisher operator token
                </label>
                <Input
                  autoComplete="new-password"
                  id="sites-publisher-token"
                  onChange={(event) =>
                    publisher.setTokenDraft(event.target.value)
                  }
                  placeholder="Paste the publisher’s admin token"
                  type="password"
                  value={publisher.tokenDraft}
                />
              </div>
              <Button
                disabled={
                  !publisher.tokenDraft ||
                  publisher.isConnecting ||
                  publisher.isDisconnecting ||
                  publisher.isChecking
                }
                size="sm"
                type="submit"
              >
                <KeyRound />{" "}
                {publisher.isConnecting ? "Connecting…" : "Connect publisher"}
              </Button>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={publisher.isDisconnecting}
                onClick={() => void publisher.disconnect()}
                size="sm"
                type="button"
                variant="outline"
              >
                <Unplug />
                {publisher.isDisconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          )}
        </form>

        <p className="mt-3 max-w-lg text-xs leading-relaxed text-muted-foreground">
          This administrator token can publish or remove any site on this host.
          It is saved securely on this computer and is never included in a
          shared site.
        </p>
      </details>

      {publisher.error ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {publisher.error}
        </p>
      ) : null}
      {publisher.message ? (
        <p
          className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs"
          role="status"
        >
          {publisher.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">
            {siteId ? "Selected site publication" : "Choose a site to publish"}
          </p>
          {siteId ? (
            <p className="mt-1 text-2xs text-muted-foreground">
              {publisher.siteStatus === null && publisher.connected
                ? "Checking publication…"
                : published
                  ? publisher.isPublishedCurrent
                    ? "Your latest saved version is published."
                    : "Your published site has an earlier version."
                  : "This site is private."}
            </p>
          ) : null}
        </div>
        {published && publisher.siteStatus?.publicUrl ? (
          <Button asChild size="sm" variant="outline">
            <a
              href={publisher.siteStatus.publicUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              <ExternalLink /> Open published site
            </a>
          </Button>
        ) : null}
        {siteId && publisher.connected ? (
          <Button
            disabled={
              !publisher.canPublish ||
              publisher.isConnecting ||
              publisher.isDisconnecting ||
              publisher.isPublishing ||
              publisher.isRevoking
            }
            onClick={() => void publisher.publish()}
            size="sm"
          >
            <Globe2 />
            {publisher.isPublishing
              ? "Publishing…"
              : published
                ? "Publish updated snapshot"
                : "Publish site"}
          </Button>
        ) : null}
        {published ? (
          <Button
            disabled={
              !publisher.connected ||
              publisher.isConnecting ||
              publisher.isDisconnecting ||
              publisher.isRevoking ||
              publisher.isPublishing
            }
            onClick={() => publisher.setRevokeConfirmationOpen(true)}
            size="sm"
            variant="destructive"
          >
            Revoke public site
          </Button>
        ) : null}
      </div>
      {siteId && publisher.connected && !publisher.canPublish ? (
        <p className="text-2xs text-muted-foreground">
          Save your changes before publishing. You can preview your current
          draft.
        </p>
      ) : null}

      <AlertDialog
        open={publisher.revokeConfirmationOpen}
        onOpenChange={publisher.setRevokeConfirmationOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this public site?</AlertDialogTitle>
            <AlertDialogDescription>
              The shared link will stop working. Your private site and its saved
              versions will remain available, so you can publish it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={publisher.isRevoking}>
              Keep published
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={publisher.isRevoking}
              onClick={() => void publisher.revoke()}
            >
              {publisher.isRevoking ? "Revoking…" : "Revoke site"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
