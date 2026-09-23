import * as React from "react";

import type { AgentSkill } from "@/shared/api/types";
import { Textarea } from "@/shared/ui/textarea";
import type { AgentSkillCapability } from "../lib/agentConfigCore";
import {
  agentSkillStarters,
  customAgentSkillTemplate,
} from "./agentSkillStarters";

type AgentSkillsFieldProps = {
  skills: AgentSkill[];
  capability: AgentSkillCapability;
  disabled: boolean;
  onChange: (skills: AgentSkill[]) => void;
};

function skillName(skill: AgentSkill): string {
  return (
    skill.skillMd.match(/^name:\s*["']?([^\r\n"']+)/m)?.[1]?.trim() ??
    "Unnamed skill"
  );
}

function uniqueCustomSkill(selectedNames: Set<string>): AgentSkill {
  let name = "custom-skill";
  let suffix = 2;
  while (selectedNames.has(name)) {
    name = `custom-skill-${suffix}`;
    suffix += 1;
  }
  return {
    ...customAgentSkillTemplate,
    skillMd: customAgentSkillTemplate.skillMd.replace(
      "name: custom-skill",
      `name: ${name}`,
    ),
  };
}

export function AgentSkillsField({
  skills,
  capability,
  disabled,
  onChange,
}: AgentSkillsFieldProps) {
  const nextKeyRef = React.useRef(skills.length);
  const [skillKeys, setSkillKeys] = React.useState(() =>
    skills.map((_, index) => `skill-${index}`),
  );
  const supportsSkills = capability === "supported";
  const capabilityMessage = {
    supported: null,
    unsupported:
      skills.length > 0
        ? "This runtime does not declare local skill support. Starting this agent is blocked until you switch to a supported runtime or remove its skills."
        : "The selected runtime does not declare local skill support.",
    loading: "Checking the selected runtime's skill support.",
    error:
      "Runtime skill support could not be checked. Retry loading runtimes before adding or editing skills.",
    "no-runtime":
      "Select a runtime with declared skill support to add or edit skills.",
  }[capability];
  const selectedNames = new Set(
    skills.map((skill) => skillName(skill).toLowerCase()),
  );

  React.useEffect(() => {
    setSkillKeys((current) => {
      if (current.length === skills.length) return current;
      if (current.length > skills.length)
        return current.slice(0, skills.length);
      return [
        ...current,
        ...Array.from({ length: skills.length - current.length }, () => {
          const key = `skill-${nextKeyRef.current}`;
          nextKeyRef.current += 1;
          return key;
        }),
      ];
    });
  }, [skills.length]);

  function addSkill(skill: AgentSkill) {
    if (disabled || !supportsSkills) return;
    const key = `skill-${nextKeyRef.current}`;
    nextKeyRef.current += 1;
    setSkillKeys((current) => [...current, key]);
    onChange([...skills, structuredClone(skill)]);
  }

  function updateSkill(index: number, skillMd: string) {
    onChange(
      skills.map((skill, itemIndex) =>
        itemIndex === index ? { ...skill, skillMd } : skill,
      ),
    );
  }

  function removeSkill(index: number) {
    setSkillKeys((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
    onChange(skills.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <section
      aria-labelledby="persona-specialist-skills"
      className="space-y-3 rounded-xl border border-border/70 p-4"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-medium" id="persona-specialist-skills">
          Specialist skills
        </h3>
        <p className="text-xs text-muted-foreground">
          Give this agent a repeatable way to do its work. Pick a starting
          point, then adapt the instructions to your business.
        </p>
      </div>

      {capabilityMessage ? (
        <p
          className="rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning"
          role="status"
        >
          {capabilityMessage}
        </p>
      ) : null}

      {supportsSkills && !disabled ? (
        <div className="flex flex-wrap gap-2">
          {agentSkillStarters.map((starter) => {
            const alreadyAdded = selectedNames.has(starter.id);
            return (
              <button
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                disabled={alreadyAdded || skills.length >= 12}
                key={starter.id}
                onClick={() => addSkill(starter.skill)}
                type="button"
              >
                Add {starter.label}
              </button>
            );
          })}
          <button
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            disabled={skills.length >= 12}
            onClick={() => addSkill(uniqueCustomSkill(selectedNames))}
            type="button"
          >
            Add custom skill
          </button>
        </div>
      ) : null}

      {skills.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No specialist skills selected.
        </p>
      ) : (
        <div className="space-y-3">
          {skills.map((skill, index) => (
            <article
              className="space-y-2 rounded-lg bg-muted/25 p-3"
              key={skillKeys[index]}
            >
              <div className="flex items-center justify-between gap-3">
                <h4 className="min-w-0 truncate text-sm font-medium">
                  {agentSkillStarters.find(
                    (starter) => starter.id === skillName(skill),
                  )?.label ?? skillName(skill)}
                </h4>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {skill.assets.length} supporting{" "}
                    {skill.assets.length === 1 ? "file" : "files"}
                  </span>
                  <button
                    className="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
                    disabled={disabled}
                    onClick={() => removeSkill(index)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              </div>
              {skill.assets.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {skill.assets.map((asset) => asset.path).join(", ")}
                </p>
              ) : null}
              <details className="group space-y-2">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                  Review or edit instructions
                </summary>
                {supportsSkills ? (
                  <Textarea
                    aria-label={`${skillName(skill)} SKILL.md`}
                    className="min-h-44 resize-y font-mono text-xs leading-5"
                    disabled={disabled}
                    onChange={(event) => updateSkill(index, event.target.value)}
                    spellCheck={false}
                    value={skill.skillMd}
                  />
                ) : (
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background p-3 font-mono text-xs leading-5">
                    {skill.skillMd}
                  </pre>
                )}
              </details>
            </article>
          ))}
        </div>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Skills, access and sharing</summary>
        <p className="mt-2 leading-relaxed">
          These instructions stay with your local agent definition. They do not
          connect accounts or grant additional access. The agent keeps the file
          and tool access of its selected runtime. When exporting an agent, you
          can choose whether to include its skills.
        </p>
      </details>
    </section>
  );
}
