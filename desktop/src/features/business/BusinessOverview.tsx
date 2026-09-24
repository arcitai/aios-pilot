import { ChevronRight, FileText } from "lucide-react";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { isWelcomeChannel } from "@/features/onboarding/welcome";
import { Button } from "@/shared/ui/button";
import type { BusinessDocument } from "./document";

/** A compact reading surface; editing, history and compatibility work are explicit. */
export function BusinessOverview({
  document,
  contextId,
  onEdit,
  onSources,
}: {
  document: BusinessDocument;
  contextId: string;
  onEdit: () => void;
  onSources: () => void;
}) {
  const navigation = useAppNavigation();
  const channels = useChannelsQuery();
  const welcome = channels.data?.find(
    (channel) =>
      isWelcomeChannel(channel) && channel.isMember && !channel.archivedAt,
  );
  const { company, sources } = document;
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-6 py-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-semibold tracking-tight">
              {company.name || "Your company"}
            </h2>
            {company.website ? (
              <p className="mt-1 break-all text-sm text-muted-foreground">
                {company.website}
              </p>
            ) : null}
          </div>
          <Button onClick={onEdit} size="sm" variant="outline">
            Company context
          </Button>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {company.summary ||
            "Describe what you do and who you help. You can build this understanding in conversation and correct it here."}
        </p>
        {[
          ["Customers", company.audience],
          ["Products & services", company.offers],
          ["Current priorities", company.goals],
        ]
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div className="space-y-1.5" key={label}>
              <h3 className="text-sm font-medium">{label}</h3>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
                {value}
              </p>
            </div>
          ))}
      </section>
      <section className="space-y-3 border-t border-border/50 pt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">
            Sources{" "}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              {sources.length}
            </span>
          </h2>
          <Button onClick={onSources} size="sm" variant="ghost">
            Sources
            <ChevronRight />
          </Button>
        </div>
        {sources.length ? (
          <div className="divide-y divide-border/40">
            {sources.slice(0, 5).map((source) => (
              <button
                className="flex w-full items-center gap-3 py-3 text-left text-sm hover:text-primary"
                key={source.id}
                onClick={onSources}
                type="button"
              >
                <FileText
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{source.title}</span>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Add a brief, company notes or a document from a connected tool.
          </p>
        )}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-5 text-xs text-muted-foreground">
        <span>Available to the people and agents invited to this context.</span>
        {welcome ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void navigation.goChannel(welcome.id)}
          >
            Continue in Welcome
            <ChevronRight />
          </Button>
        ) : null}
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Earlier pilot work</summary>
        <p className="mt-3 leading-relaxed">
          Your previous conversations and app drafts are preserved while apps
          move into channel tabs.
        </p>
        <Button
          className="mt-2"
          onClick={() => void navigation.goSavedWork(contextId)}
          size="sm"
          variant="ghost"
        >
          Open saved work
          <ChevronRight />
        </Button>
      </details>
    </div>
  );
}
