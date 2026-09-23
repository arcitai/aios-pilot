import * as React from "react";
import { History, RotateCcw } from "lucide-react";
import type { CanvasRevision, CanvasScope } from "@/shared/api/canvasTypes";
import {
  getCanvas,
  getCanvasHistory,
  setCanvas,
} from "@/shared/api/tauriCanvas";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  type BusinessDocument,
  parseBusinessDocument,
  serializeBusinessDocument,
} from "./document";

/** Restore an explicit supported version without overwriting a later edit. */
export function ContextHistory({
  channelId,
  scope,
  requestOpen,
  onRestored,
}: {
  channelId: string;
  scope: CanvasScope;
  requestOpen: (open: () => void) => void;
  onRestored: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<CanvasRevision[]>([]);
  const [head, setHead] = React.useState("none");
  const [selected, setSelected] = React.useState<CanvasRevision | null>(null);
  const [hasOlder, setHasOlder] = React.useState(false);
  async function load() {
    setBusy(true);
    setError(null);
    setSelected(null);
    try {
      const [current, history] = await Promise.all([
        getCanvas(channelId, scope),
        getCanvasHistory(channelId, { limit: 20, scope }),
      ]);
      setHead(current.eventId ?? "none");
      setRows(history.revisions);
      setHasOlder(Boolean(history.nextCursor));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          requestOpen(() => {
            setOpen(true);
            void load();
          })
        }
      >
        <History className="size-3.5" /> Saved versions
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Saved company context</DialogTitle>
            <DialogDescription>
              Review a previous version before restoring it. Restoring creates a
              new version and keeps the existing history.
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {busy ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading or saving context…
            </p>
          ) : null}
          <div className="space-y-2">
            {rows.map((row) => {
              let doc: BusinessDocument | undefined;
              try {
                doc = parseBusinessDocument(row.content);
              } catch {
                /* Unknown content remains in history. */
              }
              return (
                <Button
                  className="h-auto w-full justify-between gap-3 px-3 py-3 text-left"
                  disabled={busy || !doc}
                  key={row.eventId}
                  variant={
                    selected?.eventId === row.eventId ? "secondary" : "outline"
                  }
                  onClick={() => setSelected(row)}
                >
                  <span className="min-w-0 truncate">
                    {doc?.company.name || "Unsupported document"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {row.eventId === head ? "Current · " : ""}
                    {new Date(row.createdAt * 1000).toLocaleString()}
                  </span>
                </Button>
              );
            })}
          </div>
          {!busy && !rows.length ? (
            <p className="text-sm text-muted-foreground">
              No saved versions found.
            </p>
          ) : null}
          {hasOlder ? (
            <p className="text-xs text-muted-foreground">
              Showing the latest 20 versions. Older versions remain in this
              room's canvas history.
            </p>
          ) : null}
          {selected ? (
            <div className="space-y-3 rounded-xl border p-4">
              <p className="whitespace-pre-wrap text-sm">
                {parseBusinessDocument(selected.content).company.summary ||
                  "No company summary in this version."}
              </p>
              <p className="text-xs text-muted-foreground">
                {parseBusinessDocument(selected.content).sources.length} sources
                · company details and source records will be restored together.
              </p>
              <Button
                disabled={busy || selected.eventId === head}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const result = await setCanvas({
                      ...scope,
                      channelId,
                      content: serializeBusinessDocument(
                        parseBusinessDocument(selected.content),
                      ),
                      expectedRevision: head,
                    });
                    if (!result.verified) {
                      setError(
                        "Restored to the relay, but readback is unavailable. Reload versions before making another change.",
                      );
                      return;
                    }
                    await onRestored();
                    setOpen(false);
                  } catch (cause) {
                    setError(
                      cause instanceof Error ? cause.message : String(cause),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RotateCcw className="size-3.5" /> Restore selected version
              </Button>
            </div>
          ) : null}
          <Button disabled={busy} onClick={() => void load()} variant="ghost">
            Reload versions
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
