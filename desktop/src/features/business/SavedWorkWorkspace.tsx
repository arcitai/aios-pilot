import * as React from "react";
import { ArrowLeft } from "lucide-react";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import type { CanvasScope } from "@/shared/api/canvasTypes";
import { Button } from "@/shared/ui/button";
import { BusinessAgentControls } from "./BusinessAgentControls";
import { useBusinessWorkspace } from "./useBusinessWorkspace";
import { useDraftGuard } from "./useDraftGuard";

/** Compatibility surface for pre-channel-app documents; preserves their existing ACLs. */
export function SavedWorkWorkspace({
  contextId,
  renderApps,
  renderConversation,
}: {
  contextId?: string;
  renderConversation: (channelId: string) => React.ReactNode;
  renderApps: (
    channelId: string,
    companyName: string,
    summary: string,
    scope: CanvasScope,
    onDirtyChange: (dirty: boolean) => void,
  ) => React.ReactNode;
}) {
  const workspace = useBusinessWorkspace(contextId);
  const drafts = useDraftGuard();
  const navigation = useAppNavigation();
  const [pane, setPane] = React.useState<"apps" | "conversation">("apps");
  const [started, setStarted] = React.useState(false);
  const document = workspace.context.data?.document;
  const error =
    workspace.error ??
    workspace.channels.error?.message ??
    workspace.context.error?.message;
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-testid="saved-work-workspace"
    >
      {drafts.dialog}
      <header className="space-y-3 border-b border-border/40 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Saved pilot work</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Earlier drafts and conversation · {document?.company.name}
            </p>
          </div>
          <Button
            onClick={() => void navigation.goBusiness()}
            size="sm"
            variant="ghost"
          >
            <ArrowLeft />
            Business
          </Button>
        </div>
        <nav className="flex gap-2" aria-label="Saved work">
          <Button
            size="sm"
            variant={pane === "apps" ? "secondary" : "ghost"}
            aria-pressed={pane === "apps"}
            onClick={() => drafts.request(() => setPane("apps"))}
          >
            Apps
          </Button>
          <Button
            size="sm"
            variant={pane === "conversation" ? "secondary" : "ghost"}
            aria-pressed={pane === "conversation"}
            onClick={() => drafts.request(() => setPane("conversation"))}
          >
            Main agent
          </Button>
        </nav>
      </header>
      {error ? (
        <div className="space-y-3 p-6 text-sm" role="alert">
          <p className="text-destructive">{error}</p>
          <Button
            onClick={() => {
              void workspace.channels.refetch();
              void workspace.reload();
            }}
            variant="outline"
          >
            Retry loading
          </Button>
        </div>
      ) : !document || !workspace.channel ? (
        <p className="p-6 text-sm text-muted-foreground" role="status">
          {workspace.resolving ||
          workspace.channels.isPending ||
          (workspace.channel && workspace.context.isPending)
            ? "Loading saved work…"
            : "No earlier saved work is available."}
        </p>
      ) : pane === "apps" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          {renderApps(
            workspace.channel.id,
            document.company.name,
            document.company.summary,
            workspace.canvasScope,
            drafts.setDirty,
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
          <div className="flex min-h-80 min-w-0 flex-1 flex-col">
            {renderConversation(workspace.channel.id)}
          </div>
          <aside className="w-full shrink-0 overflow-auto border-t border-border/40 p-5 xl:w-64 xl:border-l xl:border-t-0">
            <BusinessAgentControls
              channelId={workspace.channel.id}
              channelName={workspace.channel.name}
              scope={workspace.canvasScope}
              started={started}
              onStarted={() => setStarted(true)}
            />
          </aside>
        </div>
      )}
    </section>
  );
}
