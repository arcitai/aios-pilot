import { AlertTriangle, FileJson2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { serializeSiteDocument } from "./document";
import { downloadText } from "./workspaceModel";
import type { CanvasConflict } from "./workspaceTypes";

export function SiteConflictNotice({
  conflict,
  disabled,
  isDirty,
  onDownloadDraft,
  onUseLatest,
  onRequestOverwrite,
}: {
  conflict: CanvasConflict;
  disabled: boolean;
  isDirty: boolean;
  onDownloadDraft: () => void;
  onUseLatest: () => void;
  onRequestOverwrite: () => void;
}) {
  return (
    <div
      className="space-y-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4"
      role="alert"
    >
      <div className="flex flex-wrap items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            This site changed in Buzz while you were editing
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Your draft remains in the editor. The newest canvas version is
            preserved separately. Review it, download both copies, or
            deliberately create a new revision from your draft.
          </p>
          <details className="mt-3 rounded-lg border border-border/40 bg-background/70 p-3">
            <summary className="cursor-pointer text-xs font-medium">
              Review the latest canvas version
            </summary>
            <p className="mt-2 text-2xs text-muted-foreground">
              Revision {conflict.revision.slice(0, 12)}…
              {conflict.updatedAt
                ? ` · ${new Date(conflict.updatedAt * 1000).toLocaleString()}`
                : ""}
            </p>
            <SourcePreview
              label="HTML"
              source={conflict.document.files.indexHtml}
            />
            <SourcePreview
              label="CSS"
              source={conflict.document.files.styleCss}
            />
            <SourcePreview
              label="JavaScript"
              source={conflict.document.files.appJs}
            />
          </details>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onDownloadDraft} size="sm" variant="outline">
          <FileJson2 /> Download my draft
        </Button>
        <Button
          onClick={() =>
            downloadText(
              "latest-site-canvas.json",
              serializeSiteDocument(conflict.document),
              "application/json;charset=utf-8",
            )
          }
          size="sm"
          variant="outline"
        >
          <FileJson2 /> Download latest
        </Button>
        <Button
          disabled={disabled}
          onClick={onUseLatest}
          size="sm"
          variant="ghost"
        >
          Use latest version
        </Button>
        <Button
          disabled={disabled || !isDirty}
          onClick={onRequestOverwrite}
          size="sm"
        >
          Save my draft as a new revision
        </Button>
      </div>
    </div>
  );
}

function SourcePreview({ label, source }: { label: string; source: string }) {
  return (
    <>
      <p className="mt-2 text-xs font-medium">{label}</p>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 font-mono text-2xs">
        {source}
      </pre>
    </>
  );
}
