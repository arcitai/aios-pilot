import * as React from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  GitBranch,
  HardDrive,
  NotebookPen,
  Search,
  MessagesSquare,
} from "lucide-react";
import {
  BUSINESS_CONNECTION_PROVIDERS,
  type BusinessConnectionProviderId,
} from "@/features/business-connections";
import { agentSkillStarters } from "@/shared/lib/agentSkillStarters";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Markdown } from "@/shared/ui/markdown";

const providerIcons = {
  github: GitBranch,
  google: HardDrive,
  notion: NotebookPen,
  slack: MessagesSquare,
};
type Selection =
  | { kind: "connection"; id: BusinessConnectionProviderId }
  | { kind: "skill"; id: string };

/** Workspace library: selection is inspected here and assigned in agent setup. */
export function PluginsWorkspace({
  renderConnection,
}: {
  renderConnection: (provider: BusinessConnectionProviderId) => React.ReactNode;
}) {
  const [category, setCategory] = React.useState<"connections" | "skills">(
    "connections",
  );
  const [query, setQuery] = React.useState("");
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const navigation = useAppNavigation();
  const search = query.trim().toLocaleLowerCase();
  const providers = BUSINESS_CONNECTION_PROVIDERS.filter(
    (provider) =>
      provider.availability === "available" &&
      `${provider.name} ${provider.description}`
        .toLocaleLowerCase()
        .includes(search),
  );
  const skills = agentSkillStarters.filter((starter) =>
    `${starter.label} ${starter.skill.skillMd}`
      .toLocaleLowerCase()
      .includes(search),
  );
  const selectedSkill =
    selection?.kind === "skill"
      ? agentSkillStarters.find((starter) => starter.id === selection.id)
      : undefined;
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-testid="plugins-workspace"
    >
      <header className="shrink-0 border-b border-border/40 px-6 py-5">
        <h1 className="text-xl font-semibold tracking-tight">Plugins</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tools you can connect and specialist skills.
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl space-y-7 px-6 py-8">
          {selection ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelection(null)}
              >
                <ArrowLeft />
                Back to plugins
              </Button>
              {selection.kind === "connection" ? (
                renderConnection(selection.id)
              ) : selectedSkill ? (
                <section className="space-y-5">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {selectedSkill.label}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Included skill · choose it when creating or editing an
                      agent.
                    </p>
                  </div>
                  <Markdown
                    className="rounded-lg bg-muted/40 p-5"
                    interactive={false}
                    hardLineBreaks={false}
                    blockCode
                    content={selectedSkill.skill.skillMd
                      .replace(/^---\n[\s\S]*?\n---\n*/, "")
                      .replace(/^# [^\n]+\n*/, "")}
                  />
                  <Button
                    variant="outline"
                    onClick={() => void navigation.goAgents()}
                  >
                    Open agents
                    <ChevronRight />
                  </Button>
                </section>
              ) : null}
            </>
          ) : (
            <>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  aria-label="Search plugins"
                  className="pl-9"
                  placeholder="Search plugins"
                  maxLength={200}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <fieldset className="flex gap-1" aria-label="Plugin categories">
                <Button
                  size="sm"
                  variant={category === "connections" ? "secondary" : "ghost"}
                  aria-pressed={category === "connections"}
                  onClick={() => setCategory("connections")}
                >
                  Connections
                </Button>
                <Button
                  size="sm"
                  variant={category === "skills" ? "secondary" : "ghost"}
                  aria-pressed={category === "skills"}
                  onClick={() => setCategory("skills")}
                >
                  Skills
                </Button>
              </fieldset>
              <section
                className="space-y-2"
                aria-label={
                  category === "connections"
                    ? "Available connections"
                    : "Included skills"
                }
              >
                <h2 className="border-b border-border/50 pb-3 text-sm font-medium">
                  {category === "connections"
                    ? "Available connections"
                    : "Included skills"}
                </h2>
                <div className="grid gap-x-8 sm:grid-cols-2">
                  {category === "connections"
                    ? providers.map((provider) => {
                        const Icon = providerIcons[provider.id];
                        return (
                          <button
                            key={provider.id}
                            className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-5 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                            type="button"
                            onClick={() =>
                              setSelection({
                                kind: "connection",
                                id: provider.id,
                              })
                            }
                          >
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background">
                              <Icon aria-hidden="true" className="size-5" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium">
                                {provider.name}
                              </span>
                              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                                {provider.description}
                              </span>
                            </span>
                            <ChevronRight
                              aria-hidden="true"
                              className="size-4 shrink-0 text-muted-foreground"
                            />
                          </button>
                        );
                      })
                    : skills.map((starter) => (
                        <button
                          key={starter.id}
                          className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-5 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                          type="button"
                          onClick={() =>
                            setSelection({ kind: "skill", id: starter.id })
                          }
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background">
                            <BookOpen aria-hidden="true" className="size-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">
                              {starter.label}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              Available in agent setup
                            </span>
                          </span>
                          <ChevronRight
                            aria-hidden="true"
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                        </button>
                      ))}
                </div>
                {(category === "connections"
                  ? providers.length
                  : skills.length) === 0 ? (
                  <p
                    className="py-8 text-sm text-muted-foreground"
                    role="status"
                  >
                    No {category} match your search.
                  </p>
                ) : null}
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
