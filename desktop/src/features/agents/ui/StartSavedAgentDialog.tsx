import * as React from "react";
import { toast } from "sonner";
import {
  useAvailableAcpRuntimes,
  useCreateManagedAgentMutation,
} from "../hooks";
import { useGlobalAgentConfig } from "../useGlobalAgentConfig";
import { useCreatedAgentChannelAttachment } from "../useCreatedAgentChannelAttachment";
import {
  availableRuntimesForStart,
  buildInstanceInputForDefinition,
  resolveStartRuntimeForDefinition,
} from "../lib/instanceInputForDefinition";
import type { AgentPersona } from "@/shared/api/types";
import { requireBusinessContextSupport } from "@/shared/api/tauriAgentBusinessContext";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { ChooserDialogContent } from "@/shared/ui/chooser-dialog-content";
import { CompanyKnowledgeField } from "./CompanyKnowledgeField";
import { useCompanyKnowledgeDraft } from "./useCompanyKnowledgeDraft";
import { resolveScopedManagedAgentAvatarUrl } from "./managedAgentAvatar";

/** A saved definition is reusable; knowledge access belongs to its new instance. */
export function StartSavedAgentDialog({
  persona,
  onClose,
}: {
  persona: AgentPersona;
  onClose: () => void;
}) {
  const knowledge = useCompanyKnowledgeDraft(true);
  const runtimes = useAvailableAcpRuntimes();
  const { globalConfig } = useGlobalAgentConfig();
  const create = useCreateManagedAgentMutation();
  const { presentCreatedAgent } = useCreatedAgentChannelAttachment();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const locked = React.useRef(false);
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const openedScope = React.useRef<string | null>(null);
  const scopeChanged = React.useRef(false);
  const currentScope = React.useRef(knowledge.scopeKey);
  currentScope.current = knowledge.scopeKey;
  if (
    !openedScope.current &&
    knowledge.scope.expectedRelayUrl &&
    knowledge.scope.expectedSignerPubkey
  )
    openedScope.current = knowledge.scopeKey;
  if (openedScope.current && openedScope.current !== knowledge.scopeKey)
    scopeChanged.current = true;

  async function submit() {
    if (locked.current || scopeChanged.current || !knowledge.ready) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const setup = knowledge.capture();
      const scopeKey = knowledge.scopeKey;
      const assertScope = () => {
        if (
          !mounted.current ||
          scopeChanged.current ||
          currentScope.current !== scopeKey
        )
          throw new Error(
            "The workspace or identity changed. Reopen this setup to continue.",
          );
      };
      if (setup.businessContext) await requireBusinessContextSupport();
      const available = await availableRuntimesForStart(runtimes);
      const { runtime, warnings } = resolveStartRuntimeForDefinition(
        persona,
        available,
        globalConfig.preferred_runtime,
      );
      assertScope();
      const avatarUrl = await resolveScopedManagedAgentAvatarUrl(
        persona.avatarUrl,
        setup.requestScope,
      );
      // The definition mapper receives the resolved URL, so it cannot perform
      // another upload using whichever workspace happens to be active later.
      const input = await buildInstanceInputForDefinition(
        { ...persona, avatarUrl: avatarUrl ?? null },
        runtime,
      );
      assertScope();
      const created = await create.mutateAsync({ ...input, ...setup });
      // A durable identity must close this create flow even when setup failed.
      onClose();
      await presentCreatedAgent(created);
      for (const warning of warnings) toast.warning(warning);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <ChooserDialogContent
        title={`Start ${persona.displayName}`}
        headerSubtitle="Choose what this agent can use in your workspace."
        className="max-w-lg border-0"
        footerClassName="border-t-0"
        data-testid="start-saved-agent-dialog"
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || !knowledge.ready || scopeChanged.current}
              onClick={() => void submit()}
            >
              {busy ? "Starting…" : "Start agent"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <CompanyKnowledgeField
            draft={knowledge}
            available
            disabled={busy || scopeChanged.current}
          />
          {scopeChanged.current ? (
            <p role="alert" className="text-sm text-destructive">
              The workspace or identity changed. Close and reopen this setup to
              continue.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </ChooserDialogContent>
    </Dialog>
  );
}
