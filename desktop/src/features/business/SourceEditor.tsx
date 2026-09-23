import * as React from "react";
import { FileText, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
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
import type { BusinessDocument, BusinessSource } from "./document";

export function SourceEditor({
  document,
  busy,
  onSave,
  onDirtyChange,
}: {
  document: BusinessDocument;
  busy: boolean;
  onSave: (document: BusinessDocument) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<BusinessSource | null>(null);
  const [removing, setRemoving] = React.useState<BusinessSource | null>(null);
  const changed = editing
    ? title !== editing.title ||
      content !== editing.content ||
      url !== (editing.url ?? "")
    : Boolean(title || content || url);
  const clearDraft = () => {
    setTitle("");
    setContent("");
    setUrl("");
    setFileName(null);
    setFileError(null);
    setEditing(null);
  };
  React.useEffect(() => {
    onDirtyChange(changed);
    return () => onDirtyChange(false);
  }, [changed, onDirtyChange]);
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold">
          The sources behind your business
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a brief, an offer or notes from a meeting. Everyone invited to
          this private workspace can read these sources.
        </p>
      </div>
      <form
        className="space-y-4 rounded-xl border border-border/50 bg-background/50 p-5"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            const source: BusinessSource = {
              id: editing?.id ?? crypto.randomUUID(),
              title: title.trim(),
              content,
              kind: editing?.kind ?? (fileName ? "file" : url ? "url" : "note"),
              ...(url ? { url } : {}),
              createdAt: editing?.createdAt ?? new Date().toISOString(),
            };
            await onSave({
              ...document,
              sources: editing
                ? document.sources.map((row) =>
                    row.id === editing.id ? source : row,
                  )
                : [...document.sources, source],
            });
            clearDraft();
          } catch {
            /* Keep the source draft available for correction or retry. */
          }
        }}
      >
        {editing ? (
          <p className="text-sm font-medium">Editing: {editing.title}</p>
        ) : null}
        <div className="space-y-2">
          <label
            className="flex items-center gap-2 text-sm font-medium"
            htmlFor="source-file"
          >
            <Upload className="size-4" /> Import a text document
          </label>
          <Input
            id="source-file"
            type="file"
            disabled={Boolean(editing) || changed || busy}
            accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setFileError(null);
              try {
                if (file.size > 100_000)
                  throw new Error(
                    "Choose a text document smaller than 100 KB.",
                  );
                if (!/\.(txt|md|csv|json)$/i.test(file.name))
                  throw new Error(
                    "Use a TXT, Markdown, CSV or JSON document. Copy text from other formats into the source field.",
                  );
                const text = await file.text();
                if (text.length > 40_000 || text.includes("\0"))
                  throw new Error(
                    "Use a plain-text document with no more than 40,000 characters.",
                  );
                setTitle(file.name.slice(0, 300));
                setContent(text);
                setUrl("");
                setFileName(file.name);
              } catch (cause) {
                setFileError(
                  cause instanceof Error ? cause.message : String(cause),
                );
              }
            }}
          />
          <p className="text-xs text-muted-foreground">
            {changed || editing
              ? "Save or clear the current draft before importing another document."
              : "Review the text below, then add it to your workspace."}
          </p>
          {fileError ? (
            <p className="text-xs text-destructive" role="alert">
              {fileError}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="source-title">
            Source title
          </label>
          <Input
            disabled={busy}
            id="source-title"
            maxLength={300}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Our services and pricing"
            required
            value={title}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="source-url">
            Source link{" "}
            <span className="text-muted-foreground">(optional)</span>
          </label>
          <Input
            disabled={busy}
            id="source-url"
            maxLength={2_000}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            type="url"
            value={url}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="source-content">
            Source text
          </label>
          <Textarea
            disabled={busy}
            className="min-h-36"
            id="source-content"
            maxLength={40_000}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste the information your agent should use…"
            required
            value={content}
          />
          <p className="text-xs text-muted-foreground">
            Links record provenance. This form saves the text you provide; it
            does not fetch the linked website.
          </p>
        </div>
        <Button
          disabled={
            busy ||
            !title.trim() ||
            !content.trim() ||
            (!editing && document.sources.length >= 100)
          }
          type="submit"
        >
          {editing ? <Pencil /> : <Plus />}
          {editing ? "Save source" : "Add source"}
        </Button>
        {editing || changed ? (
          <Button
            className="ml-2"
            disabled={busy}
            type="button"
            variant="ghost"
            onClick={clearDraft}
          >
            {editing ? "Cancel edit" : "Clear draft"}
          </Button>
        ) : null}
      </form>
      {document.sources.length ? (
        <Input
          disabled={busy}
          aria-label="Find a source"
          placeholder="Find a source…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      <div className="space-y-3">
        {document.sources
          .filter((source) =>
            `${source.title}\n${source.content}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((source) => (
            <details
              className="rounded-xl border border-border/50 px-4 py-3"
              key={source.id}
            >
              <summary className="cursor-pointer text-sm font-medium">
                <FileText aria-hidden="true" className="mr-2 inline size-4" />
                {source.title}
              </summary>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm">
                {source.content}
              </p>
              {source.url ? (
                <p className="mt-3 break-all text-xs text-muted-foreground">
                  Source: {source.url}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                Added {new Date(source.createdAt).toLocaleString()}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy || changed}
                  onClick={() => {
                    setEditing(source);
                    setTitle(source.title);
                    setContent(source.content);
                    setUrl(source.url ?? "");
                    setFileName(null);
                    setFileError(null);
                    window.document.getElementById("source-title")?.focus();
                  }}
                >
                  <Pencil /> Edit source
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy || changed || Boolean(editing)}
                  onClick={() => setRemoving(source)}
                >
                  <Trash2 /> Remove source
                </Button>
              </div>
            </details>
          ))}
      </div>
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this source?</AlertDialogTitle>
            <AlertDialogDescription>
              “{removing?.title}” will be removed from the current company
              context. Previous saved versions still contain it. Existing
              conversation messages are unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep source</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (event) => {
                event.preventDefault();
                if (!removing) return;
                try {
                  await onSave({
                    ...document,
                    sources: document.sources.filter(
                      (row) => row.id !== removing.id,
                    ),
                  });
                  setRemoving(null);
                } catch {
                  /* Preserve the selection and let the workspace show the save error. */
                }
              }}
            >
              Remove source
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
