import type {
  AgentBusinessContext,
  BusinessContextSelection,
} from "@/shared/api/businessContextTypes";
import { canonicalRelayUrl } from "@/shared/lib/relayUrl";

export function sameCompanyKnowledge(
  first: BusinessContextSelection | null | undefined,
  second: BusinessContextSelection | null | undefined,
) {
  if (!first || !second) return !first && !second;
  return (
    first.contextId === second.contextId &&
    first.loading === second.loading &&
    canonicalRelayUrl(first.relayUrl) !== null &&
    canonicalRelayUrl(first.relayUrl) === canonicalRelayUrl(second.relayUrl)
  );
}

export function companyKnowledgeSettled(
  context: AgentBusinessContext | null | undefined,
) {
  return (
    !context?.operation &&
    sameCompanyKnowledge(context?.desired, context?.applied)
  );
}
