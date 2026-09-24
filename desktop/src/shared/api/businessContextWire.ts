import type {
  AgentBusinessContext,
  AgentBusinessContextOperation,
  BusinessContextSelection,
  CreateAgentBusinessContext,
} from "./businessContextTypes";

export type RawBusinessContextSelection = {
  context_id: string;
  relay_url: string;
  loading: BusinessContextSelection["loading"];
};

export type RawAgentBusinessContext = {
  desired: RawBusinessContextSelection | null;
  applied: RawBusinessContextSelection | null;
  operation: null | {
    id: string;
    phase: AgentBusinessContextOperation["phase"];
    candidate: RawBusinessContextSelection;
    cancel_requested: boolean;
    last_error: string | null;
  };
};

export function toRawBusinessContextSelection(
  selection: BusinessContextSelection,
): RawBusinessContextSelection {
  return {
    context_id: selection.contextId,
    relay_url: selection.relayUrl,
    loading: selection.loading,
  };
}

function fromRawSelection(
  selection: RawBusinessContextSelection,
): BusinessContextSelection {
  return {
    contextId: selection.context_id,
    relayUrl: selection.relay_url,
    loading: selection.loading,
  };
}

export function toRawCreateBusinessContext(input: CreateAgentBusinessContext) {
  return {
    selection: toRawBusinessContextSelection(input.selection),
    acknowledge_channel_history: input.acknowledgeChannelHistory,
  };
}

/** Absence is compatibility with an older companion, never an implicit grant. */
export function fromRawBusinessContext(
  binding: RawAgentBusinessContext | null | undefined,
): AgentBusinessContext | null {
  if (!binding) return null;
  return {
    desired: binding.desired ? fromRawSelection(binding.desired) : null,
    applied: binding.applied ? fromRawSelection(binding.applied) : null,
    operation: binding.operation
      ? {
          id: binding.operation.id,
          phase: binding.operation.phase,
          candidate: fromRawSelection(binding.operation.candidate),
          cancelRequested: binding.operation.cancel_requested,
          lastError: binding.operation.last_error,
        }
      : null,
  };
}
