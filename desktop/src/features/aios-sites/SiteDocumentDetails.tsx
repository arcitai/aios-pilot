import { AlertTriangle, FileJson2, LockKeyhole } from "lucide-react";

import type { Channel } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { MAX_SITE_TITLE_LENGTH, type SiteDocument } from "./document";
import { SiteConflictNotice } from "./SiteConflictNotice";
import type { CanvasConflict } from "./workspaceTypes";

export function SiteDocumentDetails({
  channel,
  draft,
  revision,
  sourceRevision,
  isDirty,
  siteBytes,
  isTooLarge,
  canEdit,
  isBusy,
  status,
  saveError,
  conflict,
  onChangeTitle,
  onDownloadDraft,
  onUseLatest,
  onRequestOverwrite,
}: {
  channel: Channel;
  draft: SiteDocument;
  revision: string;
  sourceRevision: string | null;
  isDirty: boolean;
  siteBytes: number;
  isTooLarge: boolean;
  canEdit: boolean;
  isBusy: boolean;
  status: string | null;
  saveError: string | null;
  conflict: CanvasConflict | null;
  onChangeTitle: (title: string) => void;
  onDownloadDraft: () => void;
  onUseLatest: () => void;
  onRequestOverwrite: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border/50 bg-card p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="site-document-title">
            Site name
          </label>
          <Input
            className="h-auto border-0 bg-transparent px-0 py-0 text-lg font-semibold shadow-none focus-visible:ring-0 md:text-lg"
            disabled={!canEdit || isBusy}
            id="site-document-title"
            maxLength={MAX_SITE_TITLE_LENGTH}
            onChange={(event) => onChangeTitle(event.target.value)}
            value={draft.title}
          />
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <LockKeyhole className="size-3.5" /> Private workspace
            {sourceRevision ? (
              <span className="text-primary">
                Editing a past version · saving keeps its history
              </span>
            ) : null}
          </p>
          <details className="mt-2 text-2xs text-muted-foreground">
            <summary className="cursor-pointer">Version details</summary>
            <p className="mt-1 break-all">
              #{channel.name} ·{" "}
              {revision === "none" ? "Not saved yet" : revision} ·{" "}
              {(siteBytes / 1024).toFixed(1)} KB / 195 KB
            </p>
          </details>
        </div>
        <div className="flex items-center gap-2 text-2xs text-muted-foreground">
          <span className={isDirty ? "text-amber-600" : "text-primary"}>
            {isDirty ? "Unsaved changes" : "Saved privately"}
          </span>
        </div>
      </div>

      {status ? (
        <p
          className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-xs text-foreground"
          role="status"
        >
          {status}
        </p>
      ) : null}
      {saveError ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
          role="alert"
        >
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 break-words text-xs text-destructive">
            {saveError}
          </p>
          <Button onClick={onDownloadDraft} size="xs" variant="outline">
            <FileJson2 /> Download draft JSON
          </Button>
        </div>
      ) : null}

      {conflict ? (
        <SiteConflictNotice
          conflict={conflict}
          disabled={isBusy || !canEdit}
          isDirty={isDirty}
          onDownloadDraft={onDownloadDraft}
          onRequestOverwrite={onRequestOverwrite}
          onUseLatest={onUseLatest}
        />
      ) : null}
      {draft.title.trim().length === 0 ? (
        <p className="text-xs text-destructive" role="alert">
          Enter a site name before saving.
        </p>
      ) : null}
      {isTooLarge ? (
        <p className="text-xs text-destructive" role="alert">
          This document exceeds the 200 KB limit. Shorten the code before
          saving.
        </p>
      ) : null}
    </>
  );
}
