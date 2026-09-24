import type { AgentSkill } from "@/shared/api/types";

export type AgentSkillStarter = {
  id: string;
  label: string;
  skill: AgentSkill;
};

export const agentSkillStarters: AgentSkillStarter[] = [
  {
    id: "company-analyst",
    label: "Company analyst",
    skill: {
      skillMd: `---
name: company-analyst
description: Review a company's private Buzz business workspace and trace claims to its saved sources.
---

# Company analyst

Use this skill when the owner asks for analysis of their company, offers, goals, or saved research.

## Read the current workspace

Use the business channel ID supplied in the current task or company context. Do not guess an ID or create a workspace. This starter is read-only for company data. Run only these verified business CLI commands:

    buzz business show --channel <CHANNEL_ID>
    buzz business source list --channel <CHANNEL_ID>
    buzz business export --channel <CHANNEL_ID> --output <PATH>

The show result contains the current document and revision. The source list contains source IDs and provenance. Cite source titles or IDs when an observation depends on saved research, and label gaps where the document has no evidence.

Use the export command above when a local JSON copy is useful. If the owner asks to change company data, ask for the approved workflow rather than inventing a command.

The business channel is private company data. Keep its contents in the authorized company context and do not copy them to another channel or public profile.
`,
      assets: [],
    },
  },
  {
    id: "slide-writer",
    label: "Slide writer",
    skill: {
      skillMd: `---
name: slide-writer
description: Turn an approved brief into a clear presentation outline with one main point per slide.
---

# Slide writer

Turn the supplied brief into a presentation outline for its named audience. Ask for missing audience, decision, or length only when it would materially change the story.

For each slide, provide a takeaway title, supporting points, and a suggested visual. Keep one main point on each slide. Separate speaker notes from slide copy. Mark source-dependent claims with their source, and label assumptions instead of presenting them as facts. Do not invent figures, customer quotes, or research.

Finish with the decision or next step the presentation should support. Use a concise, editable outline unless the owner requests another format.
`,
      assets: [],
    },
  },
  {
    id: "business-planner",
    label: "Business planner",
    skill: {
      skillMd: `---
name: business-planner
description: Build a practical business plan that connects an offer, audience, evidence, and owner capacity.
---

# Business planner

Build plans from the owner's stated goals, available evidence, and time or budget constraints. Keep the offer, target audience, proof, and next action connected.

Separate confirmed facts from assumptions. For each proposed action, state the intended outcome, a small first step, and a way to tell whether it worked. Prefer a short validation that fits the owner's capacity over a broad roadmap. Do not invent market size, demand, costs, or results.

When business workspace data is available, use the company-analyst skill to inspect it and cite the relevant source IDs. Do not edit that workspace unless the owner explicitly asks.
`,
      assets: [],
    },
  },
];

export const customAgentSkillTemplate: AgentSkill = {
  skillMd: `---
name: custom-skill
description: Describe when this skill should be used.
---

# Custom skill

Write clear, bounded instructions for the agent here.
`,
  assets: [],
};
