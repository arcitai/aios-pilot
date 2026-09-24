# AIOS Pilot

Accepted product direction, 23 September 2026. This is Gustav's independent
open-source product, forked locally from block/buzz at
5621006bcf84b82e5da489824a5b4d76568d8602. The bachelor repository is unrelated.

## Product contract

Build a coherent business workspace for nontechnical people. Preserve Buzz's
actual components, typography, colors, navigation and conversation experience.
On 24 September Gustav emphasized minimal UI with little visual noise. Show
the current task and one primary next action; reveal setup and technical
details only when useful. Perform a final design-skill review across the real
product flows and fix findings before delivery. `DESIGN.md` owns these visual
and interaction rules.
The first agent learns the business in a Welcome conversation, helps connect
tools, proposes source-backed company context, accepts corrections, and then
helps create specialist agents and useful apps. It remains an ordinary agent
that can work in other channels. Business is the shared knowledge surface,
not the conversation or a container for the entire product. Kylon is a
behavioral reference, not a source of private implementation. Agent Native and
OpenAgents are possible sources of bounded modules, not replacement products.

The intended product includes:

- Self-hosted messages, rooms, threads, context and files through the Buzz relay.
- Editable business context, source provenance, scoped connections and recovery.
- Agent skills, specialist agents, local/remote runtimes and local model support.
- Modular built-in apps and a clear extension interface. Prioritize Design,
  Slides and Calendar; useful features must work rather than merely be cards.
- A path from generated app to preview and deliberately shared deployment.
- Voice interaction and a later outbound-call adapter with honest status.
- A CLI providing the same business/app capabilities as the human interface.

Gustav authorized local implementation, tests, installations needed for local
development, separate work tasks on GPT-6 Luna with max reasoning, and continued
work overnight without further questions. Keep tasks under AIOS Development.
Do not publish to GitHub, buy services or connect private accounts merely to
fill a missing live credential. Use isolated test data and continue independent
work. Record limitations rather than presenting mocks as real integrations.

## Product structure — revised 24 September 2026

This revision incorporates Gustav's explicit architecture correction, request
to pause and reassess before building, and four supplied Codex Plugins/Skills
screenshots. The implementation order below supersedes the original
Business-tab layout and its one-private-channel-per-app assumption. Continue
autonomously after the plan is reviewed; no owner approval gate is requested.

- Main sidebar: Business, Plugins directly beneath Business, Inbox, Agents,
  existing enabled workspace destinations, then channels and direct messages.
- Business: company knowledge, attributed sources, history and explicit access.
  A normal page like Inbox/Agents, with no chat header, huddle, channel-created
  events, app launcher, or product-wide top navigation. A simple overview with
  focused edit/detail views avoids a second permanent sidebar.
- Plugins: a workspace-owned catalog, independent of Business. One searchable
  library for connections and skills. A small local
  category selector is appropriate here, as in the supplied screenshots.
  Installed packages and connected accounts are visible here; the library does
  not become a separate agent-assignment workflow.
  Connection is a plugin capability; skill is an instruction bundle. Installing
  either does not implicitly grant an agent new data or account access.
- Agent creation/editing: a coherent Tools & skills section selects from that
  same library. Show the chosen account, available actions and skill version;
  choose business context and channels explicitly. Missing connection setup
  returns to the preserved agent draft. Save deliberately applies the selection.
  A skill alone grants no account, channel or operating-system access.
- Channels: conversation is the default. The user can add named Calendar,
  Slides, Design, Sites or Tables tabs to that channel. These tabs are resources
  used by its people and agents. Multiple app instances must be possible;
  an app's type is not its identity. Adding tabs is intentional, not automatic.
- Onboarding: first host/workspace setup, then one Welcome conversation with
  the first ordinary agent. It gathers context progressively and directs the
  user to Plugins only when a connection is useful. Existing Welcome and prior
  onboarding history remain reachable; restarting must not create duplicates.

## Architecture decisions

For new resources, the explicit context/plugin/agent grants below supersede
VISION.md's upstream channel-membership-only rule. Existing channel data keeps
its current ACLs until an additive, verified migration is ready.

For the first Business context slice, the dedicated typed private NIP-29 group
is the resource and its existing membership is the internal access adapter.
That membership is separate from ordinary working-channel membership; no
second ACL store is introduced. Existing groups and contexts remain discoverable
and retain their current membership and history until an explicit adoption.

Packaged skills are instructions selected by the user. Runtime skill discovery
is a separate capability whose sole authority remains the Rust runtime catalog.
Unknown or unsettled runtime metadata is neither unsupported nor successfully
applied; the UI must preserve that distinction.

Keep Buzz's Rust relay, Nostr-signed events, membership enforcement, Tauri/React
desktop, ACP agents and existing CLI. Nostr is a message/auth protocol; the
product does not require a blockchain or cryptocurrency purchase.

The host is the canonical home of shared data. A Mac mini or Linux VM runs the
Buzz relay, Postgres, media storage and enabled agent/connector services. A
work computer joins that workspace with its own identity. Agent runners may
be on the host or explicitly paired machines. Joining a workspace does not
grant control over the host's filesystem or every agent/account.

The current business document uses a dedicated private channel Canvas as its
storage adapter. Its data and history already persist on the relay; this
does not make Business a chat page. Retain this working adapter during the
navigation correction, behind a context repository interface. Do not overwrite
ordinary channel canvases or Welcome. UI, CLI and agents use one document
contract. Explicit relay/workspace, actor, context and resource IDs travel
through every operation; never infer business access merely from a channel.

The next server slice owns a durable workspace context reference, explicit
grants and typed channel-app resources in the existing relay/Postgres unit.
App rows have stable IDs, parent channel IDs, type/schema version, title,
document revision and archived status. Parent membership is checked by the
server on list/read/write and live delivery; removal revokes future access.
Human owner/admin policy governs attachment and archival; app editing follows
the channel's supported write policy. Do not simulate inheritance by copying
membership lists into child channels. Existing private app documents remain
under their current ACL until an explicit, verified migration/attachment.

F10 implementation direction (24 September, afternoon): new app resources
require actual current parent membership even in open/public channels. Parent
owner/admin authority governs create, title changes, attachment and archive;
member/bot document edits follow the parent's existing write policy. Community
administration alone is not a bypass. Parent and app type are immutable. A
separate app event/head coordinate must preserve ordinary Canvas behavior;
exact kind allocation and metadata/document revision protocol remain a design
gate before relay implementation. Extract the current CLI app and Sites schema
validation into a shared `buzz-apps` module first, preserving existing behavior.
The source audit found that Blossom GET/HEAD authorizes at relay/blob scope,
not parent-channel scope. Private app-media acceptance therefore remains open
until blob association and current parent authorization are implemented; app
metadata/document protection must not be described as blob privacy.

The shared context reference does not make previously private knowledge
workspace-public. Context-group membership is separate from ordinary channel
membership; plugin and agent grants remain distinct. New grants and imported
data must show their actual destination. Use the native signed-event pipeline,
tenant binding, rate limits and transactional revision preconditions. New
shared resources and grants should use Nostr kinds and the existing
event/query bridge, following AGENTS.md; reserve HTTP-specific adapters for
genuine provider/app-delivery boundaries. Reuse the existing `buzz-business`
validator. Extract app/Sites schemas from CLI-only code before adding another
validator.

Secrets never belong in context documents, channel messages, exported apps or
browser storage. Existing connection credentials are currently client-local
OS-keyring entries, not shared host connections. Evolve the provider adapters
into a host-owned connector service within the relay deployment, with separate
personal/workspace ownership, per-agent grants, bounded provider operations,
revocation and source-refresh provenance. Do not copy client credentials as
part of navigation changes or claim a shared proxy already exists.

Initial shared document contract (JSON in the dedicated channel canvas):

```
schemaVersion: 1
kind: "aios.business-workspace"
company: { name, website, summary, audience, offers, goals } // strings
sources: [{ id, title, kind: "note" | "url" | "file", content, url?, createdAt }]
connections: [{ id, provider, label, status: "not_configured" | "connected" | "error", details? }]
```

All timestamps are ISO-8601 strings. A connection is only `connected` after a
successful provider operation; adding its descriptor does not connect it.
Workspace access follows membership in its dedicated private context group; do
not imply finer source-level permissions than implemented. Context revisions
use the existing canvas expectedRevision contract; expose conflicts and do not
automatically retry or merge. Bound document/source sizes and reject
malformed/unrecognized schema versions.
Individual string limits use UTF-16 code units, matching the desktop fields and
Zod parser; the complete serialized document is capped at 200,000 UTF-8 bytes.
Rust and TypeScript validators must pass the same Unicode/boundary fixtures.

### Phase 2 host-context implementation contract — accepted 24 September 2026

- V1 has at most one canonical Business context per community. It is an
  explicitly registered or adopted existing private `stream` channel, marked
  by a durable `resource_type` and NIP-29 `kind:39000` tag
  `resource=aios.business-context:v1`. The relay-signed metadata `d` value is
  the backing group/channel ID. The community comes from the selected relay
  tenant and the actor from the authenticated signer; clients cannot supply a
  trusted community ID.
- Initial registration is an explicit `kind:9002` event authorized by both a
  current community owner/admin and an owner/admin of the context group. This
  prevents an ordinary member from claiming the single canonical slot by
  creating a private group. Repeated registration of that same group remains
  idempotent but keeps the same two-tier authority check. It conflicts if
  another group is already canonical and has no unregister or retarget
  operation in v1, including after soft deletion. The group must be private,
  unarchived and of type `stream`; once typed, it cannot become
  public or untyped. Registration preserves every existing member and event;
  adoption itself never changes membership. Human grants are explicit and
  disclose that the person can read this group's prior messages as well as the
  Business document. Agent provisioning follows the accepted [F02/F05 flows](docs/aios/FLOWS.md#connected-target-flows),
  with the host checking the agent identity; it does not make old private
  history public. All active members can read and write the context; do not
  promise finer read-only/source permissions.
- Context membership uses existing NIP-29 membership, private metadata,
  queries, fanout and revocation. Ordinary working-channel membership does not
  grant Business access. No parallel ACL table or feature HTTP endpoint is
  added. Legacy untyped contexts stay visible and unchanged.
- Context access and agent prompt loading are separate. Follow the
  [accepted Business and agent flows](docs/aios/FLOWS.md#connected-target-flows)
  for default provisioning, selective retrieval and any explicit full-context
  opt-in. CLI index/search/read now use the same context access checks in a
  separate client slice. Shared metadata interpretation lives in `buzz-business`;
  each authenticated adapter must supply fresh host metadata and membership.
- Business Canvas events keep `KIND_CANVAS=40100` and the shared
  `buzz-business` schema (`schemaVersion:1`, maximum 200,000 UTF-8 bytes).
  The relay applies this validator only to typed Business contexts and requires
  exactly one `expected-revision` tag: `none` for no head, or the current
  event ID. Missing, duplicate, malformed, stale, unsupported-schema and
  oversized writes fail; there is no automatic retry or merge. Untyped Canvas behavior
  remains unchanged. Strict writes use the existing channel-head CAS path.
- Add one additive migration after 0049 and mirror it in `schema/schema.sql`.
  Backup/restore must retain the resource type, context ID, roster and complete
  event history. Existing user-local databases are not migrated by this task.
- Native `remove_channel_member` accepts optional paired relay/signer scope
  assertions, captures the relay base URL and signing keys once, validates the
  assertions and submits with those captured values. `search_users` accepts the
  same optional scope and pins all query requests to its captured relay and
  signer. Frontend wrappers and the human-only Access dialog remain lead-owned.

Front-end ownership: `desktop/src/features/business/` and shared API adapters.
Reusable apps: `desktop/src/features/aios-apps/`; editor components consume
explicit values/callbacks, not hidden global credentials or provider clients.
Each app declares id, title, capabilities and document schema/version.
Each app must have a usable editing/output path; provider integrations remain
adapters with explicit unconfigured states. App editors consume a document,
revision and callbacks, independently of the surrounding page. Remove the
Business-only app host once channel attachment and legacy recovery are ready.

Plugin packages have an identity/version, source, declared capabilities,
runtime requirements and inspectable instructions/assets. Reuse existing
SKILL.md validation/staging; make a central library and explicit assignments
instead of a second per-agent skill implementation. Start with bundled and
user-imported packages. Do not present an invented marketplace or unavailable
integration as installed. Pin package revisions; separate install, authorize,
assign, disable and remove. Updates retain an identifiable rollback version.

The browser development bridge is a debug-only local companion, not the
production web host. A later headless web adapter must serve the same React
application and authenticated domain APIs without depending on macOS Keychain,
Tauri windows or exposing arbitrary native IPC. Keep desktop and web adapters
at the edges; no second chat/auth/backend stack from OpenAgents is needed.

Static Sites publishing remains separate from authenticated data-backed apps.
Generated app access requires scoped server data operations and a separate
preview/public origin. Neither a table editor nor static HTML proves that
full-stack generated apps, shared browser control or external phone calls work.

## Reassessment and implementation order

The audit basis is lead HEAD `4067f99` plus the preserved uncommitted localhost,
Apps and navigation repairs. Detailed proof and worker WIP are in
`docs/aios/STATUS.md`; `docs/aios/FEATURES.md` retains the broader scope.
`docs/aios/FLOWS.md` maps the whole product (F01–F22), reference evidence,
cross-flow permissions and representative acceptance journey. It includes
daily collaboration, files, one-off follow-ups, automation, browser, publishing,
voice and operations as well as onboarding. The order below does not narrow
that scope to the first visible navigation repair.

| Order | Deliverable | Acceptance before moving on |
| --- | --- | --- |
| 1 | Separate Business, Plugins and Welcome; preserve the real Buzz shell | Main sidebar is the only global navigation. Business opens saved knowledge without chat chrome. Plugins sits immediately below it. Existing context, sources, drafts and conversation history survive navigation/restart. |
| 2 | Host-owned context reference and permission-aware knowledge access | Two independent client identities on one isolated host see only granted context, same revisions and attributed sources. Outsider and revoked-member reads/writes fail. Backup/restore preserves the context reference and history. |
| 3 | Typed channel-app instances and additive legacy migration | Add two named apps to an ordinary channel; a second admitted member and an invited agent use the same saved documents through UI/CLI. Remove membership and prove denial. Existing channel Canvas is untouched; legacy drafts remain recoverable. |
| 4 | Plugins library, agent capability selection and host connections | Search, inspect and import a skill in Plugins; select its pinned version and allowed connected tools while creating/editing an agent. Inline setup preserves the agent draft. A supported runtime uses the selected version; removing a grant denies future calls. A host-side fixture proves source import and agent use without handing credentials to the model. |
| 5 | Coherent onboarding through first useful result | Create/join host, choose/configure one agent, start Welcome, describe company, optionally import source, confirm saved context, create a specialist and a channel app. Repeat/restart reuses IDs and acknowledged requests. |
| 6 | Remote clients and agent operation | Headless host runs without a desktop session. Browser and CLI join with separate identities. Test invitation, reconnect, remote runner stop/restart and local model path; distinguish two-client same-machine tests from a physical second-machine proof. |
| 7 | Complete wider capabilities and review | Integrate verified Tables, browser, workflow approvals and voice; then authenticated app data and publishing. Review real laptop/narrow flows, denied/failed/recovery states, CLI parity and operational docs. Desktop packaging stays deferred until the product is ready. |

Orders are dependencies, not independent feature races. The first slice can
reuse the current adapters while the bounded server contract is prepared.
For this first slice, Business presents an overview and focused company/source
editing with history/conflict recovery. Plugins offers searchable supported
connections and the included skill catalog used in agent setup. Current local
source-import adapters stay honestly labeled; do not expose nonfunctional
agent connection grant controls. Only current adapters and bundled skills are
exposed in this slice; full catalog management, host provider authorization and
per-agent provider grants belong to phase four. Installed, connected and
assigned are distinct states. Restore ordinary Welcome entry. Preserve
existing private app documents through an explicitly temporary Saved drafts
route and prior conversation links until channel-resource migration is ready.
This compatibility route is not the final app organization. No data or ACL
migration is part of the navigation patch.
One writer per overlapping checkout; at most two lightweight workers and one
heavy build/test after the prior OOM. Workers remain GPT-6 Luna/max as requested.
The lead retains architecture/integration judgment and real-interface review.
Preserve checkpoint changes before broad refactoring. Migrations are additive,
transactional and idempotent; old Canvas/event history is not deleted. Do not
run migrations against the user's local data before isolated representative
fixtures and a recoverable backup exist.

## Rechecked references and what they support

- [Kylon workspace](https://docs.kylon.io/concepts/workspace),
  [rooms](https://docs.kylon.io/concepts/rooms), and
  [memory](https://docs.kylon.io/concepts/memory): workspace scope is distinct
  from room work and durable shared knowledge. This supports separate surfaces,
  not putting the whole product inside Business.
- [Kylon connections](https://docs.kylon.io/concepts/connections) and
  [agent access](https://docs.kylon.io/agents/access): managed proxy operations
  and agent-specific access are separate responsibilities. Our local import
  adapters are a foundation, not equivalent capability.
- [Kylon agent setup](https://docs.kylon.io/agents/bring-your-own-agent) and
  [Tools API](https://docs.kylon.io/proxy/tools-api): profiles configure skills,
  memory and connections; tool access follows agent-linked connections. The
  exact combined creation flow above is Gustav's product choice, not a claim
  that we exercised Kylon's private UI.
- [Walkthrough, 1:21:30](https://www.youtube.com/watch?v=ONd2UNBmQ40&t=4890s):
  inspected transcript through 1:34 and 2:00–2:03. Team/agent setup leads to Welcome, then
  connections help populate company context. This is behavioral evidence,
  not access to Kylon's implementation. At 1:33:35 the presenter describes
  pinning apps to a channel; at 2:00 he describes persona, skills and connections
  together. These support Gustav's chosen channel tabs and agent capability flow.
- [OpenAgents](https://github.com/openagents-org/openagents), local reference
  `fd523077a000f9f17efa2ca4fa8cf7628610305d`: inspected workspace README,
  navigation, knowledge and integration routers. Useful separation of persistent
  hub, runners, knowledge, files and shared browser. It also has Slack/Telegram/
  Lark chat bridges, so calling it entirely without integrations would be
  inaccurate. Those bridges are not a general business-data connector layer.
  Its Skills view queues installs for a chosen agent and waits for the runner
  to report success/failure; the agent profile shows enabled skills. Preserve
  that distinction between requested configuration and applied runtime state.
- [Codex Linux architecture](https://github.com/ilysenko/codex-desktop-linux/blob/main/docs/architecture.md)
  and [repository](https://github.com/ilysenko/codex-desktop-linux): community
  wrapper/packaging around the upstream app; the README explicitly limits its
  MIT license to community-owned material. It is not an open-source source tree
  of the proprietary Plugins UI. Use Gustav's screenshots for interaction and
  hierarchy; implement our own components and open package contract.

Spec readiness: READY for the first bounded navigation slice after lead review
of the expanded F01–F22 flow map and source evidence. Input, scope, reference
limits, existing local authority, recovery and replacement UI proof are explicit
above. No data/ACL migration is authorized by this slice. The lead keeps coupled
architecture/design judgment; existing read-only workers use the requested
GPT-6 Luna/max. An independent plan review may supply further corrections;
it is not an extra user approval gate. The native plan update succeeded (the
tool exposes no independent state readback); no native goal was requested.
The platform itself remains incomplete. Existing authority covers local work,
not public hosting, paid services or connecting private accounts for tests.

## Work allocation

Lead owns product contract, onboarding/business UI, navigation integration,
combined verification, shared status and final review. Delegated tasks own
isolated checkouts and return commits/patches; never edit the lead checkout.
Each worker records exact cwd/root, base, scope, checks and limitations. No task
may overwrite another task's files without coordinating with the lead.

1. Business CLI: shared Rust business-document validation and CLI commands over
   the existing relay/canvas surface. No desktop UI edits.
2. Built-in apps: modular React app registry and real local Design/Slides/
   Calendar editing surfaces. No central navigation/onboarding changes.
3. Self-hosting: reproducible private relay setup, operational CLI/scripts,
   backup/restore and a verified development path. No business or app UI edits.

## Browser development surface

On 24 September Gustav requested the same application at localhost so it can
be developed, debugged and tested in Codex's browser. This must use the actual
native backend and saved relay data, not the E2E mock bridge. Keep the Tauri
backend as a local development companion initially, with the UI served by Vite.
A debug-only authenticated loopback transport can reuse the registered native
commands and event delivery; production desktop builds must not expose it.
The localhost launcher owns process cleanup and uses the existing isolated
pilot identity. Desktop packaging is deferred until the product is ready.

## Acceptance and delivery

Start from the real Buzz interface. A new user can find the main agent, describe
their company, create/edit/save/reopen context, inspect its source and access,
and create an app output inside the same visual workspace. CLI reads the same
saved data. A denied or failed action is visibly denied/failed. Reopening and
switching communities must not leak or lose state. Test relevant conflicts,
malformed content, unavailable providers and repeated effects.

Self-hosting must include messages/threads/history/media, not only an agent
process. Use existing deploy/compose as the foundation, private defaults,
persistent volumes and documented restore. Build/test results must distinguish
mock-bridge UI evidence, native checks and live relay evidence.

The first overnight milestone is a working vertical slice and verified host
setup. Keep progressing down the wider product list as prerequisites permit.
Do not label the whole platform complete while live connections, native tests,
app publishing or voice remain unverified. `docs/aios/STATUS.md` owns current
progress, commands, task handles, next work and known limitations.
