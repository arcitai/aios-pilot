import * as React from "react";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import type { ManagedAgent } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { AgentCompanyKnowledgeDialog } from "./AgentCompanyKnowledgeDialog";
import { companyKnowledgeSettled } from "../lib/companyKnowledge";

/** Private access has its own durable save, independent of model/name drafts. */
export function AgentCompanyKnowledgeSection({
  agent,
  disabled,
}: {
  agent: ManagedAgent;
  disabled: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const agents = useManagedAgentsQuery();
  const current =
    agents.data?.find((entry) => entry.pubkey === agent.pubkey) ?? agent;
  const context = current.businessContext;
  const label = !companyKnowledgeSettled(context)
    ? "Setup needs attention"
    : context?.applied
      ? context.applied.loading === "full"
        ? "Full company context"
        : "When needed"
      : "No company knowledge";

  return (
    <section className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Company knowledge</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => setOpen(true)}
          aria-label="Manage company knowledge"
        >
          {context?.operation ? "Review" : "Manage"}
        </Button>
      </div>
      {open ? (
        <AgentCompanyKnowledgeDialog
          agent={current}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}
