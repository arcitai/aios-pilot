import * as React from "react";
import { History, RotateCcw } from "lucide-react";

import type { CanvasScope } from "@/shared/api/canvasTypes";
import { Button } from "@/shared/ui/button";
import type { SiteDocument } from "./document";
import { getSiteHistory } from "./repository";

export function SiteVersionHistory({
  channelId,
  parentBusinessChannelId,
  scope,
  currentRevision,
  disabled,
  onSelect,
}: {
  channelId: string;
  parentBusinessChannelId: string;
  scope: CanvasScope;
  currentRevision: string;
  disabled: boolean;
  onSelect: (document: SiteDocument, sourceRevision: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revisions, setRevisions] = React.useState<
    Awaited<ReturnType<typeof getSiteHistory>>
  >([]);

  async function loadHistory() {
    setOpen((current) => !current);
    if (open || revisions.length > 0 || pending) return;
    setPending(true);
    setError(null);
    try {
      setRevisions(
        await getSiteHistory(channelId, parentBusinessChannelId, scope),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load site history.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Canvas history</h2>
            <p className="text-xs text-muted-foreground">
              Each save creates a Buzz canvas revision. Up to 20 recent
              revisions are shown.
            </p>
          </div>
        </div>
        <Button
          disabled={disabled || pending}
          onClick={() => void loadHistory()}
          size="sm"
          variant="ghost"
        >
          {pending ? "Loading…" : open ? "Hide history" : "Show history"}
        </Button>
      </div>
      {open ? (
        <div className="border-t border-border/40 px-4 py-3">
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {!pending && !error && revisions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No saved revisions yet.
            </p>
          ) : null}
          <ol className="space-y-2">
            {revisions.map(({ revision, document }) => {
              const isCurrent = revision.eventId === currentRevision;
              return (
                <li
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted/25 px-3 py-2"
                  key={revision.eventId}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {document.title}
                      {isCurrent ? (
                        <span className="ml-2 text-primary">Current</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-2xs text-muted-foreground">
                      {new Date(revision.createdAt * 1000).toLocaleString()} ·{" "}
                      {revision.author.slice(0, 12)}…
                    </p>
                  </div>
                  {!isCurrent ? (
                    <Button
                      disabled={disabled}
                      onClick={() => onSelect(document, revision.eventId)}
                      size="xs"
                      variant="outline"
                    >
                      <RotateCcw />
                      Load for restore
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {revisions.length > 0 ? (
            <p className="mt-2 text-2xs text-muted-foreground">
              Loading an older version only changes this draft. Saving it
              creates a new revision and keeps the later canvas versions in
              history.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
