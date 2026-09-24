import assert from "node:assert/strict";
import test from "node:test";
import { parseDocument } from "yaml";

import {
  agentSkillStarters,
  customAgentSkillTemplate,
} from "../../../shared/lib/agentSkillStarters.ts";

function frontmatter(skillMd) {
  assert.ok(skillMd.startsWith("---\n"));
  const end = skillMd.indexOf("\n---\n", 4);
  assert.notEqual(end, -1);
  const doc = parseDocument(skillMd.slice(4, end));
  assert.deepEqual(doc.errors, []);
  return { metadata: doc.toJS(), body: skillMd.slice(end + 5).trim() };
}

test("starter skill bundles have valid metadata and instruction bodies", () => {
  for (const starter of [
    ...agentSkillStarters.map(({ skill }) => skill),
    customAgentSkillTemplate,
  ]) {
    const { metadata, body } = frontmatter(starter.skillMd);
    assert.match(metadata.name, /^[a-z0-9][a-z0-9_-]{0,63}$/);
    assert.ok(
      metadata.description.length > 0 && metadata.description.length <= 280,
    );
    assert.ok(body.length > 0);
    assert.deepEqual(starter.assets, []);
  }
});

test("company analyst starter uses only the verified private business CLI", () => {
  const analyst = agentSkillStarters.find(({ id }) => id === "company-analyst");
  assert.ok(analyst);
  assert.match(
    analyst.skill.skillMd,
    /buzz business show --channel <CHANNEL_ID>/,
  );
  assert.match(
    analyst.skill.skillMd,
    /buzz business source list --channel <CHANNEL_ID>/,
  );
  assert.match(
    analyst.skill.skillMd,
    /buzz business export --channel <CHANNEL_ID> --output <PATH>/,
  );
  assert.doesNotMatch(analyst.skill.skillMd, /buzz apps\b/);
});
