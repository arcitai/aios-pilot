import * as React from "react";
import { FileText, Plus, Upload } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import type { BusinessDocument } from "./document";

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
  const changed = Boolean(title || content || url);
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
            await onSave({
              ...document,
              sources: [
                ...document.sources,
                {
                  id: crypto.randomUUID(),
                  title: title.trim(),
                  content,
                  kind: fileName ? "file" : url ? "url" : "note",
                  ...(url ? { url } : {}),
                  createdAt: new Date().toISOString(),
                },
              ],
            });
            setTitle("");
            setContent("");
            setUrl("");
            setFileName(null);
          } catch {
            /* Keep the source draft available for correction or retry. */
          }
        }}
      >
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
            Review the text below, then add it to your workspace.
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
            id="source-url"
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
            document.sources.length >= 100
          }
          type="submit"
        >
          <Plus />
          Add source
        </Button>
      </form>
      {document.sources.length ? (
        <Input
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
            </details>
          ))}
      </div>
    </div>
  );
}
