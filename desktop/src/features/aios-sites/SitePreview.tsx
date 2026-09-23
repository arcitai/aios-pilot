import { ExternalLink, Eye, Play, ShieldCheck } from "lucide-react";

import { Button } from "@/shared/ui/button";

export function SitePreview({
  previewUrl,
  canEmbed,
  configured,
  loading,
  error,
  onRun,
  disabled,
}: {
  previewUrl: string | null;
  canEmbed: boolean;
  configured: boolean;
  loading: boolean;
  error: string | null;
  onRun: () => void;
  disabled: boolean;
}) {
  return (
    <section
      aria-label="Site preview"
      className="flex min-h-[30rem] min-w-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Eye className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Live preview</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Run the current draft in the isolated Sites origin.
            </p>
          </div>
        </div>
        <Button
          disabled={disabled || !configured || loading}
          onClick={onRun}
          size="sm"
          variant="outline"
        >
          <Play />
          {loading ? "Preparing…" : "Run preview"}
        </Button>
      </header>
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/20 px-4 py-2 text-2xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0 text-primary" />
        <p>
          Separate origin · opaque sandbox · no parent access · network and
          storage blocked
        </p>
      </div>
      {error ? (
        <p
          className="border-b border-destructive/25 bg-destructive/5 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {previewUrl && canEmbed ? (
        <iframe
          aria-label="Sandboxed generated site preview"
          className="min-h-[26rem] w-full flex-1 bg-white"
          key={previewUrl}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts"
          src={previewUrl}
          title="Sandboxed site preview"
        />
      ) : previewUrl ? (
        <div className="flex min-h-[26rem] flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
            <Eye className="size-5" />
          </span>
          <p className="text-sm font-medium">
            Preview is ready in a separate origin
          </p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            This publisher address is not on the desktop’s narrow iframe
            allowlist. Open the sandboxed preview in your browser.
          </p>
          <Button asChild size="sm" variant="outline">
            <a href={previewUrl} rel="noopener noreferrer" target="_blank">
              <ExternalLink /> Open preview
            </a>
          </Button>
        </div>
      ) : (
        <div className="flex min-h-[26rem] flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
            <Eye className="size-5" />
          </span>
          <p className="text-sm font-medium">
            {configured
              ? "Run the preview when you are ready"
              : "Connect a self-hosted Sites publisher to preview"}
          </p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            Preview runs on a separate local publisher origin with an opaque
            sandbox policy. The Buzz desktop shell keeps its own script policy
            unchanged.
          </p>
        </div>
      )}
    </section>
  );
}
