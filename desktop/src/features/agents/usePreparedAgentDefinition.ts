import * as React from "react";
import type {
  AgentPersona,
  CreatePersonaInput,
  UpdatePersonaInput,
} from "@/shared/api/types";

/** Reuse a saved definition when instance validation fails before creation. */
export function usePreparedAgentDefinition(
  create: (input: CreatePersonaInput) => Promise<AgentPersona>,
  update: (input: UpdatePersonaInput) => Promise<AgentPersona>,
) {
  const prepared = React.useRef<{
    persona: AgentPersona;
    input: string;
  } | null>(null);
  return {
    clear: () => {
      prepared.current = null;
    },
    prepare: async (input: CreatePersonaInput) => {
      const fingerprint = JSON.stringify(input);
      if (prepared.current?.input === fingerprint)
        return prepared.current.persona;
      const persona = prepared.current
        ? await update({ ...input, id: prepared.current.persona.id })
        : await create(input);
      prepared.current = { persona, input: fingerprint };
      return persona;
    },
  };
}
