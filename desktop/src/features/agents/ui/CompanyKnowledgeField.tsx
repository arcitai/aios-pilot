import { Button } from "@/shared/ui/button";
import { BUSINESS_CONTEXT_RESOURCE } from "@/shared/lib/appWorkspaceChannel";
import { PersonaDropdownField } from "./PersonaDropdownField";
import type { useCompanyKnowledgeDraft } from "./useCompanyKnowledgeDraft";

/** The compact access/loading choice is for this agent, not its shared template. */
export function CompanyKnowledgeField({
  draft,
  available,
  disabled,
  onDirty,
}: {
  draft: ReturnType<typeof useCompanyKnowledgeDraft>;
  available: boolean;
  disabled: boolean;
  onDirty?: () => void;
}) {
  const helpId = "agent-company-knowledge-help";
  return (
    <section className="space-y-2">
      <label
        className="text-sm font-medium text-foreground"
        htmlFor="agent-company-knowledge"
      >
        Company knowledge
      </label>
      <PersonaDropdownField
        id="agent-company-knowledge"
        ariaDescribedBy={helpId}
        disabled={disabled || !available}
        placeholder="Choose company knowledge"
        value={available ? (draft.contextId ?? "none") : "none"}
        options={[
          { value: "none", label: "No company knowledge" },
          ...(draft.directory.data ?? []).map((channel) => ({
            value: channel.id,
            label:
              channel.resourceType === BUSINESS_CONTEXT_RESOURCE
                ? channel.name
                : `${channel.name} (saved context)`,
          })),
        ]}
        onValueChange={(value) => {
          draft.select(value === "none" ? null : value);
          onDirty?.();
        }}
      />
      <p className="text-xs text-muted-foreground" id={helpId}>
        {available
          ? "Give this agent access to shared company knowledge. The host checks your permission when you save."
          : "Company knowledge setup is available for local agents using Buzz ACP."}
      </p>
      {available && draft.directory.isFetching ? (
        <p className="text-xs text-muted-foreground" role="status">
          Checking company knowledge…
        </p>
      ) : null}
      {available && draft.directory.isError ? (
        <div className="text-xs text-destructive" role="alert">
          <p>
            Company knowledge could not be loaded. Retry or choose no company
            knowledge.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => void draft.directory.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {available && draft.contextId ? (
        <div className="space-y-3">
          <fieldset disabled={disabled} className="space-y-1.5">
            <legend className="sr-only">Load company knowledge</legend>
            {(
              [
                [
                  "when_needed",
                  "When needed",
                  "Look up relevant knowledge as the agent works.",
                ],
                [
                  "full",
                  "Full company context",
                  "Include the complete Business document at each new turn. This uses more context.",
                ],
              ] as const
            ).map(([value, label, help]) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input
                  className="mt-1 accent-primary"
                  type="radio"
                  name="company-knowledge-loading"
                  value={value}
                  checked={draft.loading === value}
                  onChange={() => {
                    draft.setLoading(value);
                    onDirty?.();
                  }}
                />
                <span>
                  {label}
                  <span className="block text-xs text-muted-foreground">
                    {help}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input
              className="mt-0.5 accent-primary"
              type="checkbox"
              disabled={disabled}
              checked={draft.acknowledged}
              onChange={(event) => {
                draft.acknowledge(event.currentTarget.checked);
                onDirty?.();
              }}
            />
            <span>
              Allow this agent to read and update this knowledge, including its
              history and any earlier conversations. People allowed to use the
              agent may receive this information.
            </span>
          </label>
        </div>
      ) : null}
    </section>
  );
}
