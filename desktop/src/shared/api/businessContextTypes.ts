/** Company knowledge is scoped to a private agent instance and one host. */
export type BusinessContextSelection = {
  contextId: string;
  relayUrl: string;
  loading: "when_needed" | "full";
};

export type CreateAgentBusinessContext = {
  selection: BusinessContextSelection;
  acknowledgeChannelHistory: boolean;
};

/** A persisted operation survives ambiguous delivery and failed verification. */
export type AgentBusinessContextOperation = {
  id: string;
  phase:
    | "grant_pending"
    | "granting"
    | "verifying_grant"
    | "revoke_pending"
    | "revoking"
    | "verifying_revoke"
    | "failed";
  candidate: BusinessContextSelection;
  cancelRequested: boolean;
  lastError: string | null;
};

export type AgentBusinessContext = {
  desired: BusinessContextSelection | null;
  applied: BusinessContextSelection | null;
  operation: AgentBusinessContextOperation | null;
};
