import * as React from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { CompanyEditor } from "./CompanyEditor";
import { SourceEditor } from "./SourceEditor";
import { BusinessOverview } from "./BusinessOverview";
import { ContextHistory } from "./ContextHistory";
import { BusinessAccess } from "./BusinessAccess";
import { useBusinessWorkspace } from "./useBusinessWorkspace";
import { useDraftGuard } from "./useDraftGuard";

type Detail = "company" | "sources" | null;

/** Company knowledge has its own page; conversations and apps keep their own routes. */
export function BusinessWorkspace() {
  const workspace = useBusinessWorkspace();
  const drafts = useDraftGuard();
  const [detail, setDetail] = React.useState<Detail>(null);
  const [name, setName] = React.useState("");
  const [reloadVersion, setReloadVersion] = React.useState(0);
  const document = workspace.context.data?.document;
  const error =
    workspace.error ??
    workspace.channels.error?.message ??
    workspace.context.error?.message;
  const loading =
    workspace.resolving ||
    workspace.channels.isPending ||
    (workspace.channel && workspace.context.isPending);
  const reload = () =>
    drafts.request(() => {
      void workspace.reload().then((loaded) => {
        if (loaded) setReloadVersion((value) => value + 1);
      });
    });

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-testid="business-workspace"
    >
      {drafts.dialog}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/40 px-6 py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Business</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The knowledge behind your team's work.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {(workspace.channels.data?.length ?? 0) > 1 ? (
            <select
              aria-label="Business workspace"
              className="max-w-48 rounded-md border bg-background p-2 text-sm"
              disabled={workspace.busy}
              value={workspace.channel?.id}
              onChange={(event) =>
                drafts.request(() =>
                  workspace.setSelectedId(event.target.value),
                )
              }
            >
              {workspace.channels.data?.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          ) : null}
          {workspace.channel ? (
            <>
              <BusinessAccess
                key={`access:${workspace.channel.id}`}
                contextId={workspace.channel.id}
                companyName={document?.company.name || workspace.channel.name}
                scope={workspace.canvasScope}
              />
              <ContextHistory
                key={workspace.channel.id}
                channelId={workspace.channel.id}
                scope={workspace.canvasScope}
                requestOpen={drafts.request}
                onRestored={async () => {
                  if (await workspace.reload())
                    setReloadVersion((value) => value + 1);
                }}
              />
              <Button
                aria-label="Refresh context"
                title="Refresh context"
                disabled={workspace.busy || workspace.context.isFetching}
                onClick={reload}
                size="icon"
                variant="ghost"
              >
                <RefreshCw className="size-4" />
              </Button>
            </>
          ) : null}
        </div>
      </header>
      {workspace.hasRemoteUpdate && !workspace.busy ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3 text-sm"
          role="status"
        >
          <p>Your agent or a teammate saved new company context.</p>
          <Button onClick={reload} size="sm" variant="outline">
            Review updated context
          </Button>
        </div>
      ) : null}
      {error || workspace.notice ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3 text-sm"
          role={error ? "alert" : "status"}
        >
          <p className={error ? "text-destructive" : undefined}>
            {error ?? workspace.notice}
          </p>
          <Button
            onClick={() => {
              void workspace.channels.refetch();
              reload();
            }}
            size="sm"
            variant="outline"
          >
            Reload saved context
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground" role="status">
            Loading business knowledge…
          </p>
        ) : document && workspace.channel ? (
          <>
            {detail ? (
              <div className="mx-auto max-w-3xl px-6 pt-5">
                <Button
                  onClick={() => drafts.request(() => setDetail(null))}
                  size="sm"
                  variant="ghost"
                >
                  <ArrowLeft />
                  Back to business
                </Button>
              </div>
            ) : null}
            {detail === "company" ? (
              <CompanyEditor
                key={`${workspace.channel.id}:${reloadVersion}`}
                busy={workspace.busy}
                document={document}
                onSave={workspace.save}
                onDirtyChange={drafts.setDirty}
              />
            ) : detail === "sources" ? (
              <SourceEditor
                key={`${workspace.channel.id}:${reloadVersion}`}
                busy={workspace.busy}
                document={document}
                onSave={workspace.save}
                onDirtyChange={drafts.setDirty}
              />
            ) : (
              <BusinessOverview
                document={document}
                contextId={workspace.channel.id}
                onEdit={() => setDetail("company")}
                onSources={() => setDetail("sources")}
              />
            )}
          </>
        ) : !error ? (
          <form
            className="mx-auto max-w-xl space-y-5 px-6 py-12"
            onSubmit={(event) => {
              event.preventDefault();
              void workspace.initialize(name);
            }}
          >
            <div>
              <h2 className="text-lg font-semibold">
                Give your agents a shared understanding
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Start with your company name. Add its priorities and source
                material as you work.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="business-name">
                What is your business called?
              </label>
              <Input
                id="business-name"
                autoComplete="organization"
                maxLength={300}
                required
                placeholder="Your company name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <Button disabled={workspace.busy || !name.trim()} type="submit">
              {workspace.busy ? "Saving…" : "Create company context"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Only people and agents invited to this context can read it.
            </p>
          </form>
        ) : null}
      </div>
    </section>
  );
}
