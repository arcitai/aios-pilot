import type * as React from "react";
import {
  ExternalLink,
  Globe2,
  KeyRound,
  LockKeyhole,
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
          <h2 className="text-sm font-semibold">Publisher connection</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Preview temporarily or publish a saved snapshot to a static Sites
            publisher.
          </p>
        </div>
        {publisher.connected ? (
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
            Checking keyring…
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-2xs text-muted-foreground">
            <PlugZap className="size-3.5" /> Not connected
          </span>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <form className="space-y-3" onSubmit={connect}>
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
              <p className="text-2xs text-muted-foreground">
                Token stays in the OS keyring.
              </p>
            </div>
          )}
        </form>

        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <LockKeyhole className="size-3.5 text-amber-700" /> Publisher-wide
            administrator access
          </p>
          <p className="mt-1.5 text-muted-foreground">
            This token can publish or revoke every site on this publisher. It
            does not grant Buzz channel membership. Buzz stores it in the OS
            keyring, scoped to this publisher address, community, and identity.
            The token is kept out of browser storage, logs, links, and exported
            site files.
          </p>
        </div>
      </div>

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
                ? "Checking publisher readback…"
                : published
                  ? publisher.isPublishedCurrent
                    ? "The saved canvas matches the published snapshot."
                    : "A published snapshot exists; the current draft differs or is not saved."
                  : "This site has no active publication."}
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
            disabled={publisher.isRevoking || publisher.isPublishing}
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
          Save this draft to its Buzz canvas before publishing. Preview can use
          the current unsaved draft.
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
              The publisher will replace its active pointer with a revocation
              tombstone. Buzz will then check that the public URL returns HTTP
              404. Your private Buzz canvas and its version history remain
              available.
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
