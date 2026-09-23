import * as React from "react";
import { Globe2, LockKeyhole, Plus, RefreshCw, Sparkles } from "lucide-react";

import type { Channel } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { MAX_SITE_TITLE_LENGTH } from "./document";
import { siteChannelTitle } from "./repository";

export function SitesSidebar({
  channels,
  selectedChannelId,
  disabled,
  isLoading,
  isCreating,
  hasLoadError,
  onOpen,
  onCreate,
}: {
  channels: Channel[];
  selectedChannelId: string | null;
  disabled: boolean;
  isLoading: boolean;
  isCreating: boolean;
  hasLoadError: boolean;
  onOpen: (channelId: string) => void;
  onCreate: (title: string) => void;
}) {
  const [isCreateFormOpen, setIsCreateFormOpen] = React.useState(false);
  const [siteNameDraft, setSiteNameDraft] = React.useState("");

  function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = siteNameDraft.trim();
    if (!title) return;
    onCreate(title);
    setIsCreateFormOpen(false);
    setSiteNameDraft("");
  }

  return (
    <aside className="flex min-h-0 flex-col border-b border-border/50 bg-muted/15 lg:border-b-0 lg:border-r">
      <div className="border-b border-border/40 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Your sites
            </h2>
            <p className="mt-1 text-2xs text-muted-foreground">
              {channels.length} / 100 · each has a private channel
            </p>
          </div>
          <Button
            aria-label="Create a site"
            disabled={disabled || channels.length >= 100}
            onClick={() => setIsCreateFormOpen((value) => !value)}
            size="icon"
            variant="outline"
          >
            <Plus />
          </Button>
        </div>
        {isCreateFormOpen ? (
          <form
            className="mt-3 space-y-2 rounded-lg border border-border/50 bg-background p-3"
            onSubmit={submitCreate}
          >
            <label className="text-xs font-medium" htmlFor="new-site-title">
              Name this site
            </label>
            <Input
              autoFocus
              disabled={disabled}
              id="new-site-title"
              maxLength={MAX_SITE_TITLE_LENGTH}
              onChange={(event) => setSiteNameDraft(event.target.value)}
              placeholder="Spring campaign"
              required
              value={siteNameDraft}
            />
            <p className="text-2xs leading-relaxed text-muted-foreground">
              Buzz creates one private channel. You choose its members
              separately.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => setIsCreateFormOpen(false)}
                size="xs"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                disabled={disabled || !siteNameDraft.trim()}
                size="xs"
                type="submit"
              >
                {isCreating ? "Creating…" : "Create site"}
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      <nav
        aria-label="Sites list"
        className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2"
      >
        {channels.map((channel) => (
          <button
            aria-current={channel.id === selectedChannelId ? "page" : undefined}
            className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring ${channel.id === selectedChannelId ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/55 hover:text-foreground"}`}
            disabled={disabled}
            key={channel.id}
            onClick={() => onOpen(channel.id)}
            type="button"
          >
            <Globe2
              className={`mt-0.5 size-4 shrink-0 ${channel.id === selectedChannelId ? "text-primary" : ""}`}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {siteChannelTitle(channel)}
              </span>
              <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
                #{channel.name}
              </span>
            </span>
            <span className="mt-0.5 text-2xs tabular-nums text-muted-foreground">
              {channel.memberCount}
            </span>
          </button>
        ))}
        {isLoading ? (
          <p
            className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground"
            role="status"
          >
            <RefreshCw className="size-3.5 animate-spin" /> Loading private
            sites…
          </p>
        ) : channels.length === 0 && !hasLoadError ? (
          <div className="px-3 py-5 text-center">
            <Sparkles className="mx-auto size-5 text-muted-foreground/65" />
            <p className="mt-2 text-xs font-medium">
              Your first site starts here
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
              Create a private site channel and shape the page in HTML, CSS, and
              JavaScript.
            </p>
            <Button
              className="mt-3"
              onClick={() => setIsCreateFormOpen(true)}
              size="sm"
              variant="outline"
            >
              <Plus /> New site
            </Button>
          </div>
        ) : null}
      </nav>

      <div className="border-t border-border/40 p-3 text-2xs leading-relaxed text-muted-foreground">
        <p className="flex items-center gap-1.5 font-medium text-foreground/80">
          <LockKeyhole className="size-3" /> Channel membership controls access
        </p>
        <p className="mt-1">
          Private site canvases are not copied into the generated HTML.
        </p>
      </div>
    </aside>
  );
}
