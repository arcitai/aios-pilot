# Local specialist skills

Agent definitions can carry a private set of specialist skills. Each skill is a
reviewable `SKILL.md` with optional supporting files. Skills guide an agent's
workflow; selecting one does not grant tools, credentials, or permission to
take actions. Existing ACP approvals and runtime policy continue to govern
those actions.

## Privacy and sharing

Skills are stored with the local agent definition. Public persona events use an
explicit projection that excludes the skill bundle and its text. Matching an
incoming public persona update therefore does not replace local skills.

Snapshot format v1 remains importable. Format v2 can carry skills, but local
export omits them by default and includes them only after the owner selects the
local opt-in. Native snapshot send and persona catalog publication omit skills
regardless of that export setting. Review the raw `SKILL.md` text before
importing a v2 snapshot that contains skills.

## Runtime discovery and workspace staging

The Rust runtime catalog declares whether a runtime supports skill discovery
and which directory it reads. The editor uses that metadata; it does not infer
support from a runtime name. Current built-in support is declared for Goose,
Claude Code, and Codex. A selected skill on a runtime without declared support
blocks agent start until the runtime changes or the skills are removed.

At start, Buzz prepares a private workspace under
`~/.buzz/agent-workspaces/<agent-pubkey>`. It stages a copy of the selected
bundles under `.agents/skills`, along with the generic `buzz-cli` skill, then
links that directory into the runtime's declared discovery location. Where
directory links are unavailable, Buzz copies the skill files instead. Shared
workspace context such as `AGENTS.md`, `GUIDES`, and `RESEARCH` is linked when
possible and copied otherwise; `.scratch` and staged skills are per agent.

This workspace keeps staged skill files separate between agents. It is not an
OS security sandbox: a runtime process may still have access to other files or
resources available to the same user. Do not put secrets in skill instructions
or supporting files.

## Starter skills

The Company analyst starter uses the existing private business CLI:

```sh
buzz business show --channel <CHANNEL_ID>
buzz business source list --channel <CHANNEL_ID>
buzz business export --channel <CHANNEL_ID> --output <PATH>
```

It expects the channel ID from the current company context and does not
initialize a workspace. The owner must explicitly request canvas changes; the
agent should read the current revision first and pass it as
`--expected-revision` to a requested update. See [the CLI guide](CLI.md) for
its full behavior. The slide writer and business planner starters are
workflow guidance and do not assume an integrations CLI or connected apps.
