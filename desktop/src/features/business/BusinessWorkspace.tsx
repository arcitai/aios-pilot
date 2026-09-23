import * as React from "react";
import {
  Building2,
  Check,
  ChevronRight,
  FileText,
  Layers,
  Link2,
  LockKeyhole,
  MessageCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { cn } from "@/shared/lib/cn";
import { CompanyEditor } from "./CompanyEditor";
import { SourceEditor } from "./SourceEditor";
import { businessProgress } from "./document";
import { BusinessAgentControls } from "./BusinessAgentControls";
import { useBusinessWorkspace } from "./useBusinessWorkspace";
import { useDraftGuard } from "./useDraftGuard";
import { ContextHistory } from "./ContextHistory";
import { BusinessConnectionsPanel } from "@/features/business-connections";

type Pane = "conversation" | "company" | "sources" | "connections" | "apps";
const panes = [
  { id: "conversation", title: "Main agent", icon: MessageCircle },
  { id: "company", title: "Company context", icon: Building2 },
  { id: "sources", title: "Sources", icon: FileText },
  { id: "connections", title: "Connections", icon: Link2 },
  { id: "apps", title: "Apps", icon: Layers },
] as const;

export function BusinessWorkspace({
  renderConversation,
  renderApps,
}: {
  renderConversation: (channelId: string) => React.ReactNode;
  renderApps?: (
    channelId: string,
    companyName: string,
    companySummary: string,
  ) => React.ReactNode;
}) {
  const workspace = useBusinessWorkspace();
  const drafts = useDraftGuard();
  const [pane, setPane] = React.useState<Pane>("conversation");
  const [name, setName] = React.useState("");
  const [startedChannel, setStartedChannel] = React.useState<string | null>(
    null,
  );
  const [reloadVersion, setReloadVersion] = React.useState(0);
  const [verifiedConnections, setVerifiedConnections] = React.useState<
    Record<string, boolean>
  >({});
  const document = workspace.context.data?.document;
  const started = startedChannel === workspace.channel?.id;
  const reload = () =>
    drafts.request(() => {
      void workspace.reload().then((loaded) => {
        if (loaded) setReloadVersion((version) => version + 1);
      });
    });
  const error =
    workspace.error ??
    workspace.channels.error?.message ??
    workspace.context.error?.message;
  const history = workspace.channel ? (
    <ContextHistory
      key={workspace.channel.id}
      channelId={workspace.channel.id}
      scope={workspace.canvasScope}
      requestOpen={drafts.request}
      onRestored={async () => {
        if (await workspace.reload()) setReloadVersion((value) => value + 1);
      }}
    />
  ) : null;

  if (
    workspace.channels.isPending ||
    (workspace.channel && workspace.context.isPending)
  ) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
        role="status"
      >
        Opening your business workspace…
      </div>
    );
  }

  if (!document)
    return (
      <div className="flex h-full flex-col overflow-auto p-6 sm:p-10">
        <div className="m-auto w-full max-w-xl space-y-7">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="size-6" />
          </div>
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Your business workspace
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              A place to work.
              <br />
              An agent that knows your business.
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Start with your company. Build up its context together, connect
              the tools you use, and turn that understanding into useful work.
            </p>
          </div>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void workspace.initialize(name);
            }}
          >
            <label className="text-sm font-medium" htmlFor="business-name">
              What is your business called?
            </label>
            <Input
              autoComplete="organization"
              autoFocus
              id="business-name"
              maxLength={300}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your company name"
              required
              value={name}
            />
            <Button
              className="w-full"
              disabled={
                workspace.busy ||
                Boolean(workspace.context.error) ||
                !name.trim()
              }
              type="submit"
            >
              {workspace.busy
                ? "Preparing your workspace…"
                : workspace.channel
                  ? "Finish workspace setup"
                  : "Create my workspace"}
              <ChevronRight />
            </Button>
          </form>
          {error ? (
            <div className="space-y-2 text-sm text-destructive" role="alert">
              <p>{error}</p>
              <Button
                onClick={() => {
                  void workspace.channels.refetch();
                  void workspace.context.refetch();
                }}
                variant="outline"
              >
                Retry loading
              </Button>
            </div>
          ) : null}
          {history}
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <LockKeyhole className="mt-0.5 size-4 shrink-0" />
            Starts as a private room on your workspace's relay. You decide which
            people and agents to invite.
          </p>
        </div>
      </div>
    );

  const progress = businessProgress(
    document,
    Object.values(verifiedConnections).some(Boolean),
  );
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-testid="business-workspace"
    >
      {drafts.dialog}
      <header className="shrink-0 border-b border-border/40 px-5 pt-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-primary" />
              <h1 className="text-base font-semibold">
                {document.company.name || "My business"}
              </h1>
              <LockKeyhole
                aria-label="Private workspace"
                className="size-3.5 text-muted-foreground"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              A shared understanding. A useful next step.
            </p>
          </div>
          {(workspace.channels.data?.length ?? 0) > 1 ? (
            <select
              aria-label="Business workspace"
              className="rounded-md border bg-background p-2 text-sm"
              onChange={(event) =>
                drafts.request(() =>
                  workspace.setSelectedId(event.target.value),
                )
              }
              value={workspace.channel?.id}
            >
              {workspace.channels.data?.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          ) : null}
          <Button
            disabled={workspace.busy || workspace.context.isFetching}
            onClick={reload}
            size="sm"
            variant="ghost"
          >
            <RefreshCw className="size-3.5" />
            Refresh context
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/agents">
              Your agents
              <ChevronRight />
            </Link>
          </Button>
          {history}
        </div>
        <nav
          aria-label="Business workspace"
          className="flex gap-4 overflow-x-auto"
        >
          {panes.map(({ id, title, icon: Icon }) => (
            <button
              aria-current={pane === id ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-b-2 px-1 pb-3 text-sm transition-colors",
                pane === id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              key={id}
              onClick={() => drafts.request(() => setPane(id))}
              type="button"
            >
              <Icon className="size-3.5" />
              {title}
            </button>
          ))}
        </nav>
      </header>
      {workspace.hasRemoteUpdate && !workspace.busy ? (
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-primary/15 bg-primary/5 px-5 py-3 text-sm"
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
          className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-muted/30 px-5 py-3 text-sm"
          role={error ? "alert" : "status"}
        >
          <p>{error ?? workspace.notice}</p>
          <Button onClick={reload} size="sm" variant="outline">
            Reload saved context
          </Button>
        </div>
      ) : null}
      <div
        className="min-h-0 flex-1 overflow-auto"
        key={`${workspace.channel?.id}:${pane}`}
      >
        {pane === "company" ? (
          <CompanyEditor
            key={`${workspace.channel?.id}:${reloadVersion}`}
            busy={workspace.busy}
            document={document}
            onSave={workspace.save}
            onDirtyChange={drafts.setDirty}
          />
        ) : null}
        {pane === "sources" ? (
          <SourceEditor
            key={`${workspace.channel?.id}:${reloadVersion}`}
            busy={workspace.busy}
            document={document}
            onSave={workspace.save}
            onDirtyChange={drafts.setDirty}
          />
        ) : null}
        {pane === "conversation" ? (
          <div className="flex h-full min-h-0 flex-col xl:flex-row">
            <div className="flex min-h-80 min-w-0 flex-1 flex-col">
              {workspace.channel
                ? renderConversation(workspace.channel.id)
                : null}
            </div>
            <aside className="w-full shrink-0 space-y-5 border-t border-border/40 p-5 xl:w-72 xl:overflow-y-auto xl:border-l xl:border-t-0">
              <div>
                <h2 className="text-sm font-semibold">
                  Make this workspace yours
                </h2>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Your main agent helps you understand and organise the business
                  before you build a team of specialists.
                </p>
              </div>
              <div className="space-y-3">
                {progress.map((item, index) => (
                  <button
                    className="flex w-full items-center gap-3 text-left text-sm"
                    key={item.title}
                    onClick={() =>
                      setPane(
                        index === 1
                          ? "sources"
                          : index === 3
                            ? "connections"
                            : "company",
                      )
                    }
                    type="button"
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border text-xs",
                        item.done
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "text-muted-foreground",
                      )}
                    >
                      {item.done ? <Check className="size-3" /> : index + 1}
                    </span>
                    {item.title}
                  </button>
                ))}
              </div>
              {workspace.channel ? (
                <BusinessAgentControls
                  key={workspace.channel.id}
                  channelId={workspace.channel.id}
                  scope={workspace.canvasScope}
                  started={started}
                  onStarted={() =>
                    setStartedChannel(workspace.channel?.id ?? null)
                  }
                />
              ) : null}
              <div className="border-t border-border/40 pt-4">
                <p className="text-xs font-medium">Your company context</p>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {document.company.summary ||
                    "Add what you do, who you help and what matters next. You can edit it at any time."}
                </p>
                <Button
                  className="mt-3"
                  onClick={() => setPane("company")}
                  size="xs"
                  variant="ghost"
                >
                  Review company context
                  <ChevronRight />
                </Button>
              </div>
            </aside>
          </div>
        ) : null}
        {pane === "connections" ? (
          <div className="mx-auto max-w-3xl space-y-5 p-6">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <LockKeyhole className="mt-0.5 size-4 shrink-0" />
              Imported text becomes a source in{" "}
              {document.company.name || "this business"}. Everyone invited to
              this private business room can read it. Disconnecting removes the
              local credential; imported sources can be removed in Sources.
            </p>
            <BusinessConnectionsPanel
              {...workspace.canvasScope}
              onConnectionStatus={(status) =>
                setVerifiedConnections((current) => ({
                  ...current,
                  [status.providerId]: status.verified,
                }))
              }
              onImportSource={async (source) => {
                if (
                  source.url &&
                  document.sources.some((item) => item.url === source.url)
                )
                  throw new Error(
                    "This source is already in your workspace. Review it in Sources before replacing it.",
                  );
                await workspace.save({
                  ...document,
                  sources: [
                    ...document.sources,
                    {
                      ...source,
                      id: crypto.randomUUID(),
                      createdAt: new Date().toISOString(),
                    },
                  ],
                });
              }}
            />
          </div>
        ) : null}
        {pane === "apps" && workspace.channel
          ? (renderApps?.(
              workspace.channel.id,
              document.company.name,
              document.company.summary,
            ) ?? (
              <div className="p-6 text-sm text-muted-foreground">
                App editors are being integrated into this workspace.
              </div>
            ))
          : null}
      </div>
    </section>
  );
}
