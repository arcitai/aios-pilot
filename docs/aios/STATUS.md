# AIOS implementation status

Updated 24 September 2026 (Europe/Copenhagen).

## Current integration checkpoint — 24 September, midday

The host-context backend is integrated at `8b00b84` (worker `cce82b9`). Lead
reviewed the transaction/authority changes and the recorded real CLI, signed
HTTP/WebSocket and restore results before integration. The only merge conflict
was additive status history, retained below. The worker reports DB tests 4/4
and relay tests 5/5; their inline raw stdout was not retained, so those counts
remain worker-reported. The real-host logs and harness were read independently.
Disposable proof hosts, volumes and fixture identities are now cleaned up;
the user's relay on 3341 and its saved data were not migrated or changed.

The isolated Browser MCP repair is integrated at `f713ef5` (worker `8359de8`).
Five production-bound Rust checks, the ACP binary build and real Chromium
navigation to a disposable loopback page pass. Lead read those logs and the
final source. The fixture also observes process-group cleanup. It fixes the
macOS socket path, private socket-directory permissions, managed npx path and
installer output on MCP stdout. Provisioning has an overall deadline and the
launcher strips parent credentials. This is an isolated headless browser;
shared human-visible browser handoff remains F15 work. Windows was source
reviewed, not run. Evidence: `/tmp/aios-browser-candidate-{rust-tests,build}.log`
and `/tmp/aios-browser-candidate-fixture-rerun.log`. Previous lead browser WIP
is preserved in the named Git stash; its fixes are included in the candidate.

Shared Business metadata/access interpretation is extracted into
`buzz-business::context` at `56cc024`, preserving CLI error behavior. The full
affected library suites pass: Business 9/9 and CLI 530/530. This exposed one
stale CLI inventory expectation; it now includes the already shipped Apps,
Calls and Sites groups. Clippy for both crates/all targets, scoped formatting,
diff checks and the integrated file-size gate pass. Logs:
`/tmp/aios-context-shared-tests-final.log`,
`/tmp/aios-context-shared-clippy.log`,
`/tmp/aios-context-integrated-filesize.log`.

Agent creation UI is checkpointed at `b179c7d`. ACP prompt loading is integrated
at `86c90ed` (worker `d44f9aa`). Lead reviewed the signed metadata/current
membership/full Canvas boundary, framing and production prompt dispatch.
The clean worker source's nine focused tests were rerun by the lead, with raw
results retained in `/tmp/aios-acp-context-focused.log`: default prompts omit
source bodies, full mode includes the validated document and exact revision,
and revocation blocks the next prompt in the same provider session. Failure,
size, deadline and capability checks also pass. The worker reports the broader
997-test unit suite plus 2 git-bootstrap and 9 lifecycle tests passing; their
original raw stdout was not retained. These remain worker-reported counts.
The fixture uses a synthetic signed relay and fake ACP stdio provider, not a
live model or the user's relay. The document limit does not prove model fit.

Clippy found two existing needless-return warnings in ACP's permission-mode
handling (`pool.rs`); the backend worker owns their bounded repair and retained
final checks, with the sole heavy Cargo slot (jobs=1). Lead runs no Cargo during
that repair. Transfer the slot explicitly to the native worker afterwards.
The browser worker is source-only, implementing the reviewed native
instance/grant/revocation/retry contract in
`/Users/gustavanderson/Documents/Codex/2026-09-24/aios-native-agent-context`,
branch `native-agent-context-setup`, verified from clean `19c8063`. Lead owns React
and integration; no third worker or concurrent heavy build. Non-secret runtime
selection uses `BUZZ_ACP_BUSINESS_CONTEXT_ID`,
`BUZZ_ACP_BUSINESS_CONTEXT_RELAY`, and
`BUZZ_ACP_BUSINESS_CONTEXT_LOADING` (`when_needed` or explicit `full`). These
are routing/settings, never grants. No configuration preserves old behavior.
The shared policy is not authentication; every adapter obtains current host
metadata and membership under the agent identity.

Native setup and ACP also require a versioned capability check: an older
configured ACP binary that ignores the context environment must not receive a
new grant or be reported as supporting the loading policy. The two workers
coordinate that boundary before native verification; no extra build runs.

Agent creation recovery is now corrected: after a durable creation followed
by a setup/start failure, the form closes and its warning opens the existing
agent's settings. Retrying the creation form no longer mints a duplicate.
Profile-sync failure uses the same recovery route. A controlled browser fixture
exercises the real observer request, creation UI and saved-agent editor; nine
affected recovery, permission and onboarding browser tests pass. Restoring the
old throw makes the new regression fail because the creation form stays open.
Evidence: `/tmp/aios-agent-recovery-final.log` (9/9),
`/tmp/aios-agent-recovery-mutation.log` (expected failure),
`/tmp/aios-agent-recovery-tsc-final.log`,
`/tmp/aios-agent-recovery-format-final.log`, and
`/tmp/aios-agent-recovery-filesize.log`. These are controlled bridge fixtures,
not real new agents or memberships on the user's relay. This recovery slice is
checkpointed in `bf43ebd`.

The next frontend slice adds a private Company knowledge choice to new-agent
creation, ahead of the Advanced section. It proposes only the host's canonical
context, defaults to When needed and offers explicit Full company context.
Legacy contexts require a deliberate choice; both modes disclose the real
group/history access and require acknowledgement. Context IDs, mode and scope
travel only to the private instance, never to a shared persona. The scope is
captured before asynchronous avatar/definition work. Directory failure has
retry and an explicit no-knowledge choice. If instance validation fails after
saving a definition, the draft stays open and retry reuses that definition.

The adapter requires native `managed_agent_business_context_protocol` = 1
before context-bearing creation. This is essential because the older running
companion silently ignores unknown create fields. Missing/malformed support
fails before a definition or agent is created. The native worker owns that
marker and the separate resolved ACP `capabilities --json` probe, whose
`schemaVersion` and `business_context_protocol` must both be 1. A frontend
selection or a marker does not itself establish a host grant.

Ten controlled browser fixtures pass in
`/tmp/aios-agent-knowledge-e2e-final.log`: selective/full wire payloads, no grant
from legacy discovery, old-companion denial before creation, retry without
duplicate definitions, prior start-failure recovery and onboarding. These
tests simulate the native responses; they do not prove host grants or model
loading. Real localhost readback opened the create form, listed Browser Studio
as saved context, selected it with When needed and acknowledgement unchecked,
then discarded the unsent draft. No real identity or membership changed.
Lead visual review against `DESIGN.md` v2 uses the existing Buzz form controls,
visible labels, one primary action and no added navigation. Screenshot:
`/tmp/aios-agent-company-knowledge.png`. The full product design review is pending.
The same explicit-choice flow also passes at 760×900 without page overflow
(`/tmp/aios-agent-knowledge-narrow.log` and
`/tmp/aios-agent-company-knowledge-narrow.png`). The test opens and closes
Buzz's mobile sidebar before entering the form. Typecheck, scoped Biome and
the file-size ratchet pass in `/tmp/aios-agent-knowledge-ui-tsc-final.log`,
`/tmp/aios-agent-knowledge-format-final.log` and
`/tmp/aios-agent-knowledge-filesize-final.log`.

The current native companion is still the prior verified build. Lead reopened
Fizz's definition editor on real localhost and cancelled without changing it;
its shared instructions/skills are distinct from the private running instance.
Native setup must cover start-from-definition as well as new create/edit.
Draft prompt/nest guidance is still uncommitted pending runtime binding. The
full-context frontend and ACP prompt path are present; native grant recovery and integrated
UI/model proof are still pending. Existing-agent edit/retry, start from a saved
definition and first-agent context setup must use this same contract next.
The wider 22-flow product remains incomplete.

## Pause, reassessment and revised plan — 24 September morning

Gustav requested a development pause, an audit against Kylon/OpenAgents, and
autonomous resumption only after a coherent plan. Both active workers stopped
at preserved checkpoints. Lead made no implementation edits during the audit.
The revised contract and ordered acceptance are in `AIOS_PILOT.md`, with
`DESIGN.md` v2. Plugins, including connections and skills, now replaces the
proposed Connections sidebar item and sits directly below Business.
The latest correction places capability selection in agent creation/editing,
using the same Plugins catalog. The user expanded research to daily work and
operational flows too. Two existing workers completed read-only Kylon and
OpenAgents flow research on GPT-6 Luna/max before implementation resumed.

Read-only audit result: REVISE the information architecture and data ownership.
Retain the working Buzz shell, signed relay, context/history/CAS, provider
adapters, skill validator/staging, app editors, publisher and CLI. Do not merge
OpenAgents' identity/backend or use Codex's proprietary app as source code.

Observed gaps:

- At the pause, Business embedded a chat and every app/connection in a top navigation.
  Real localhost screenshot confirms three nested navigation/header layers in
  Sites, technical storage copy and competing create buttons.
- Business context is durable relay data, but its private-channel adapter leaks
  into product navigation. It lacks a canonical host-owned context reference
  and a complete team/agent grant flow independent of a conversation.
- Apps are separately private child channels. Membership is not inherited from
  a working channel; UI placement alone cannot make them shared channel tabs.
  Sites/CLI/Tables also enforce Business-specific parent markers.
- Connections are local read-only import adapters with scoped OS-keyring
  credentials, not host-owned shared tool execution. Imported sources are
  durable server data; live provider refresh and agent grants remain work.
- Skills exist in private local agent definitions, but are buried in specialist
  editing; there is no central installed library/package lifecycle yet.
- Localhost is a real backend development surface, not a headless production
  browser client. The user's VM/Mac mini host model remains explicit work.
- Static Sites, isolated headless MCP, in-app calls and same-host local-model
  proof do not establish authenticated generated apps, shared browser handoff,
  external phone calls or a physical second-machine deployment.

Reference review: Kylon workspace/rooms/memory/connections/agent-access docs;
walkthrough transcript 1:21–1:33; OpenAgents local pinned workspace navigation,
knowledge/integrations routers and selfhosting README; user Codex screenshots;
Codex Linux README and architecture/license boundary. See contract links.

Preserved checkpoints: lead `4067f99` plus uncommitted repairs (typecheck and
file-size gate pass before pause); Tables worker has 13 staged new files plus
two small unstaged follow-ups, no commit; Browser worker has one uncommitted
~500-line MCP revision, not formatted/built/tested. Do not call either accepted.
No worker-owned builds/runtimes remain. Real localhost/native companion stays running.

Next execution follows the contract: separate Business/Plugins/Welcome first,
then shared context and channel-app server boundaries. Do not resume the old
Business-only Tables host or hidden child-channel membership-copy approach.

Expanded audit completed: `FLOWS.md` maps F01–F22 across setup, knowledge,
plugins/agent capabilities, daily work, collaboration, files, tasks, automations,
browser, voice, app data/preview/sharing, CLI, remote machines and recovery.
Kylon reading covered 25 public pages plus its index; the walkthrough sections
around 2:00, 2:12 and 3:01–3:11 supplement onboarding. OpenAgents reading traced
14 UI/API/runner/storage flows at the pinned revision, with representative lead
readback. Source observations and unknowns are distinguished from our target.
The lead reviewed first-slice readiness and resumes the bounded navigation
patch under the revised contract. Further independent review remains useful
feedback; platform capability and final acceptance remain incomplete.

## Navigation slice — implemented and verified

Business is now a standalone knowledge overview with focused company/source
editing, history and conflict recovery. Plugins is directly beneath it in the
main sidebar, with search, four existing connection adapters and the same three
included skill bundles used by agent setup. Skill inspection is read-only;
agent creation/editing still applies the selected instructions and checks the
Rust runtime capability. No per-agent provider grant is claimed yet.

The old private business/app channels are hidden from the conversation list,
while an explicit Saved pilot work link keeps existing documents and agent
conversation accessible. Explicit unavailable context links fail visibly and
never fall back to another company's data. This is transitional recovery, not
the final channel-app data model. Existing ACLs and saved documents are intact.
First-run pending Welcome navigation again opens its ordinary channel.

Localhost readback on the real native backend confirms the existing Browser
Studio context, Plugins/Skills navigation and unsaved-edit guard. Focused browser
fixtures pass company/source editing, conflict/restore, four connector import
flows, legacy app autosave/drafts, calls and agent settings (31 tests); three
new navigation tests pass, and the real loopback publisher preview/publish/revoke
and runtime-sensitive skill editor also pass. The typography check found old
fixed-pixel text in app editors; it now uses Buzz rem-based text tokens, with
standalone exports using rem units. App/preview browser tests were rerun.
Unit checks: 60 context/provider/Welcome/skill checks and 30 app/Sites checks pass.
Typecheck, e2e build, file-size ratchet and px-text check pass. This is frontend
and existing-adapter evidence; no new host grants or headless-host proof.

Evidence logs: `/tmp/aios-nav-v2-e2e.log`,
`/tmp/aios-nav-v2-navigation-test.log`, `/tmp/aios-nav-v2-final-e2e.log`,
`/tmp/aios-nav-v2-publisher-test.log`, `/tmp/aios-nav-v2-skills-e2e.log`,
`/tmp/aios-nav-v2-unit.log`, `/tmp/aios-nav-v2-apps-unit.log`.
The combined acceptance run passes all 36 affected smoke flows, including the
real loopback publisher; the specialist-skill editor separately passes its
integration test. Final log: `/tmp/aios-nav-v2-acceptance.log`.
The Markdown-preview duplicate heading found earlier was fixed. Independent
review found an in-flight import destination race (also found by the lead),
misleading catalog copy and missing selected-pane semantics. All three are
fixed. The delayed import regression proves switching companies prevents a
late provider result from writing either context; alongside adjacent tests,
8/8 pass in `/tmp/aios-nav-v2-import-race.log`. Independent follow-up review
accepted this bounded navigation slice with no remaining findings. This does
not accept later host, permission or channel-resource features.
Actual localhost additionally reopened prior Slides and Calendar documents and
continued from Business into the ordinary Welcome channel. No data migration
or ACL expansion happened in this slice.
Snapshot before navigation edits: `/var/folders/7g/xcm5r8yx0896jskb9w0wz8yw0000gn/T/aios-before-navigation-cuteu_3l`.

## Next active work — host context

Navigation is checkpointed in `adf2ac0`. The existing server/Tables worker task
`01a0cfcd-f659-7ea1-a638-6a44ae8420f3` is assigned the first host-context layer in
`/Users/gustavanderson/Downloads/aios-pilot-host`, branch `ai-os-context-host`,
created from that checkpoint. Its prior Tables worktree remains preserved.
The worker first records its source-backed seam proposal and exact bounded
contract, then implements a typed, host-owned context reference/discovery path
through signed events, shared validation and CLI. A private NIP-29 group may be
reused as an internal ACL adapter; ordinary working-channel membership must
not silently grant Business access. No destructive migration or automatic
ACL expansion. Channel apps and host connectors wait for this layer.

The backend worker released the heavy slot after its isolated Docker build and
real CLI scenario. The Browser worker now owns that sole slot, with one Cargo
job, for its existing MCP candidate's compile/navigation/cleanup proof. The
backend worker finishes recovery and static review against its cached image;
any recompilation requires a coordinated handoff. Neither worker may reset the
user's relay or replace the running native/browser companion. Isolated fixtures
may use the lead Rust build cache without concurrent heavy work.
Read `/tmp/aios-server-seams.md` and `/tmp/aios-host-context-handback.md` when
available, verify actual commits/tests, then review and integrate. Keep one
writer on backend paths. `/tmp/aios-browser-candidate.md` is still an unaccepted
candidate until its actual runtime handback. The same worker is also mapping
the agent context-preference/runtime seams read-only; its expected handback is
`/tmp/aios-agent-context-seams.md`. Agent runtime integration follows that audit.

Gustav clarified context loading: every workspace agent should have a short
entrypoint to company knowledge, with selective retrieval as the default and
full-document loading as an explicit agent setup option. The target contract
and falsifiable prompt/read checks are in `FLOWS.md`. The lead has drafted a
bounded index/search/read module in `buzz-business` and corresponding CLI
commands, now checkpointed in `21116f6`. Independent source review accepts the
bounded CLI capability; 9 Business tests, 23 CLI tests, 7 Apps tests and the
affected Clippy/build/help checks pass. The isolated real-CLI host scenario now
passes; final backend review/integration and the full recovery handback remain
pending.
Automatic agent setup grants and the
explicit full-context preference/runtime path are not implemented yet.

The follow-up Kylon check distinguishes shared knowledge, private agent memory,
conversation history and live connected data. `FLOWS.md` records primary
sources, limitations and scoped activation/long-history acceptance. Full
context opt-in means the Business document, not every mailbox or conversation.
The docs support live retrieval, but not the blanket claim that no indexing or
RAG exists. The newly supplied video was not retrieved; automatic scanning of
all sources during onboarding is not established. Agent entrypoint guidance is
drafted but remains uncommitted and not runtime proven.

Lead checkout still has pre-existing uncommitted browser-MCP repair/test and
Rust formatting-only changes; they were deliberately excluded from `adf2ac0`.
Do not lose them or treat them as accepted. Native browser navigation remained
unverified at the last recorded proof. The real localhost app remains running
on 1437 with its native bridge on 1438, profile `aios-browser-local`.

## Current state

- Local independent Buzz fork: `/Users/gustavanderson/Downloads/aios-pilot`.
- Base: `5621006bcf84b82e5da489824a5b4d76568d8602`.
- Product contract: `AIOS_PILOT.md`.
- Research sources: `/tmp/ai-os-research-20260923/` (read-only references).
- Business context, sources/history, main-agent creation and settings,
  GitHub/Notion/Slack, per-app Slides/Calendar/Design, business CLI, and a local
  self-hosted relay with backup/restore are integrated and tested.
- The last isolated macOS package was signature-verified at `fd68911` and is
  now outdated. Packaging is deferred. The real localhost UI uses the native
  backend; company context, Slides and Calendar survived a process restart.
- Skills, Apps access and integrated Sites have landed. Google Drive is wired
  and its selected-document browser flow passes. Its credential race fix is
  integrated and 50 connection checks pass. Active work includes app/Sites agent actions,
  browser use, tables and workflow approvals. Implementation has resumed under
  the revised flow map and ordered plan above. Incoming-call recovery now passes. The full
  platform is not complete; [FEATURES](FEATURES.md) tracks the wider outcome.
- An hourly heartbeat in the lead task resumes authorized work until the
  product goal is verified or meaningful progress requires a missing external
  prerequisite. Morning status after 08:00 on 24 September. Automation id:
  `aios-pilot-natlig-udvikling`.

## Active isolated tasks (GPT-6 Luna / max)

- CLI / skills, now workflow approvals: `01a0cfc6-4a16-74e2-9bec-ff2383fed3d0`, clone under
  `/Users/gustavanderson/Documents/Codex/2026-09-23/aios-business-cli/buzz`.
- Apps: `01a0cfc6-93fe-7d32-b714-ff6611505ca7`, clone under
  `/Users/gustavanderson/Documents/Codex/2026-09-23/aios-built-in-apps/buzz`.
- Self-host: `01a0cfc6-dc9e-7312-9e86-e20bb153cd4f`, clone under
  `/Users/gustavanderson/Documents/Codex/2026-09-23/aios-self-hosting/buzz`.
- Connections: `01a0cfcd-f659-7ea1-a638-6a44ae8420f3`, clone under
  `/Users/gustavanderson/Documents/Codex/2026-09-23/aios-connections/buzz`.
- Permissions and real-model proof: `01a0cfeb-1ee1-7cb0-9aa5-f202480c8af9`.
- Sites: `01a0d001-aa57-7bc1-ba54-117aa13fe2d0`.
- Voice and calls: `01a0d015-95a6-7d83-b20c-cc96cd82e185`.

All are under AIOS Development. Use compact `wait_threads` snapshots and reuse
the same worker for revisions. They return isolated commits; lead integrates.

## Next work

1. Exercise real model-created Apps/Sites output in the integrated application.
   CLI contracts and private relay writes already pass; guided UI is integrated.
2. Finish the observed browser MCP socket-path defect and bounded provisioning,
   integrate private Tables, and run the corrected call fixture on isolated services.
3. Verify combined workflow approval changes against an isolated relay. Preserve
   the completed Publisher backup/restore and Drive credential-fencing evidence.
4. Continue multi-computer operation and authenticated data-backed app contracts.
   Review the whole UI for minimal Buzz-style presentation using the working real
   localhost application. Desktop packaging remains deferred until product readiness.

## Proof

Business browser E2E passed using Buzz's mock native bridge: create private
workspace, save company context, add source, reopen editor, unavailable-agent
error and unconfigured-connections state. Desktop and narrow screenshots were
inspected. This does not prove live relay persistence or model execution.


## Lead checkpoint — 22:15 local

- Four browser E2E cases now pass: context/source persistence in the mock bridge,
  conflict preservation and deliberate reload, unsaved-draft protection with
  text-file import/search, and publish-before-start for a stopped main agent.
- Latest desktop/narrow screenshots were inspected and match Buzz components.
- TypeScript, changed-file Biome and px-text checks pass. Domain tests: 4 passed.
  File-size gate passes. Native canvas tests: 14 passed; native check passes.
- Fizz now has durable business-onboarding instructions; the bundled CLI skill
  documents explicit channel and expected-revision targeting. CLI task is
  implementing that exact interface; it has not yet been merged.
- Native sidecars built and the isolated Tauri app started. App identity:
  `xyz.block.buzz.app.demo.aios-pilot-local`; demo slug `aios-pilot-local`;
  Vite port 1437. Shell session 3709, log `/tmp/aios-desktop-live.log`.
  Mac is locked, so native visual/onboarding proof remains pending. Do not try
  to bypass the lock. Browser tests and backend work remain available.
- The selfhost worker's source stack is healthy on loopback port 3341.
  It is verifying backup/restore and Docker build-context exclusions.
- Worker Apps is implementing relay persistence. App rooms must be private to
  their creator with explicit app-specific membership; copying company members
  is NOT inherited authorization or proof of revocation.
- Prior offline research HTML was corrected to the accepted own Buzz-fork
  direction; its internal anchors validate. It no longer recommends migrating
  the whole product to Agent Native.


## Native server proof and approvals task

- Native production commands passed against the live relay at port 3341:
  private channel creation, context save, read from fresh native state, update,
  stale-revision rejection, outsider read filtering and outsider write denial.
  Test channel: `b829c28f-db42-4a61-826b-e0355493d4f8`.
  `AIOS_TEST_RELAY_URL=ws://127.0.0.1:3341 cargo test --manifest-path
  desktop/src-tauri/Cargo.toml commands::business_live_tests --
  --include-ignored --nocapture` passed 2 tests.
- Desktop visual testing still awaits an unlocked Mac; this native command
  proof does not claim native-window interaction or real model execution.
- Fifth isolated Luna/max task: `01a0cfeb-1ee1-7cb0-9aa5-f202480c8af9`,
  `/Users/gustavanderson/Documents/Codex/2026-09-23/aios-agent-permissions/buzz`.
  Owns ACP permission request/decision handling and dedicated approval UI,
  shared API adapter and native command module. Lead retains central wiring.
  Trigger: upstream auto-approves ACP permission requests; persona text cannot
  enforce a user's decision. Require actual deny/approve-once/cancel tests.
- Lead checkpoint commit `a3a05d4` contains business workspace, domain, source
  import, draft guards and scoped native canvas/creation changes.
- CLI syntax changed after parser checks to leaf flags: `buzz business show
  --channel UUID`; update/source subcommands also take `--channel` themselves.
  Bundled skill updated accordingly; worker final verification still pending.


## Model and recovery proof — 22:30 local

- Installed pinned `@agentclientprotocol/codex-acp@1.13.1` locally in
  `/tmp/aios-runtime-tools` (no global package change). Existing Codex CLI
  reports ChatGPT login. Adapter discovery returned `gpt-6-luna[max]`.
- Isolated real ACP harness test used that exact model, a generated test
  identity, one private test channel and synthetic restaurant-webdesign company
  data. Agent read the canvas via CLI and published one accurate Danish summary
  plus one relevant onboarding question. Relay readback verified the reply.
  Channel: `d7a045c1-5adc-4b44-9916-51bb94c4e31c`; proof files under
  `/tmp/aios-harness-proof` (agent.env is private; never print or commit it).
  Runtime exited cleanly on its bounded inactivity timer. Metrics publication
  returned 403 because this standalone test actor was not registered as a managed
  agent; the requested conversation result succeeded. This proof uses upstream
  permission behavior; it is NOT acceptance of the new approval feature.
- Context history/recovery UI is implemented; it lists 20 saved versions,
  validates the selected document, restores with captured head revision and
  retains history. Canvas history IPC now also accepts relay/signer fences.
- Five browser tests passed, including recovery from a damaged raw canvas.
  Native live tests reran with history readback and passed.
- Connections task delivered b89030e9865cb00c76e3283335c01f91d8404226.
  Fetched but NOT cherry-picked: review requested a correction so the provider
  API uses scope captured by the rendered UI, not a fresh active-workspace
  lookup that could silently retarget old input. Worker is implementing that.


## Connections and editable sources — 22:50 local

- Integrated GitHub commits `b89030e9` and `6e37fe85` as `eafed97` and
  `0154e93`. Captured relay/signer props reach all five native commands.
  Central native handlers are wired; full Tauri check and 9 adapter/scope
  tests pass. Live GitHub with a real credential remains unverified.
- Business Connections imports attributed README snapshots through the shared
  context save path, rejects repeated source URLs, and discloses room access
  before import. Onboarding progress uses verified provider callbacks, never
  an editable JSON `connected` label. Each provider has independent progress.
- Sources now supports edit, remove with review, draft protection, and restore
  through saved context versions. Inputs pause during saves. Imported text can
  be retained after disconnect; removing a source preserves historical copies.
- TypeScript, 10 focused frontend tests, seven browser business flows, native
  formatting, file-size gate and diff whitespace checks pass. Browser cases use
  an explicit provider fixture; they do not authenticate a real GitHub account.
  Logs: `/tmp/aios-connections-{unit,native-tests,native-check}.log` and
  `/tmp/aios-ui-e2e.log`. Latest narrow connections screenshot visually reviewed.
- Native dev session 3709 was deliberately stopped after startup proof to avoid
  repeated watch recompiles while the Mac is locked. It is not currently a
  running user-facing app. Native-window verification still awaits unlock.
- CLI review found shared schema mismatches in `b5557a5` (offers/goals arrays,
  cross-collection ID checks, null handling). Do not integrate that revision
  alone. Worker is matching the canonical desktop parser and shared fixtures.
- Connection worker continues with Notion, the 40,000 UTF-16 source cap and
  serial provider actions. Other feature paths remain with their original owners.
- Sixth Luna/max task: `01a0d001-aa57-7bc1-ba54-117aa13fe2d0`,
  `/Users/gustavanderson/Documents/Codex/2026-09-23/aios-sites-webapps/buzz`.
  Owns `features/aios-sites`, optional native `commands/aios_sites`, SITES.md
  and a proposed isolated publisher; no central routing/Cargo/compose edits.
- Upstream shared compute already includes a native MeshLLM feature, model
  picker and signed membership admission. Started a separate native feature
  compile; no local-model or second-machine inference proof claimed yet.


## Self-host integration and cross-language checks — 23:09 local

- Selfhost commits `37afdcb` and `ed21036` integrated as `a869abb` and
  `8c97692`. The lead checkout now has the existing private environment file
  (mode 0600, ignored), so its operator commands target the same healthy stack.
  `scripts/aios-selfhost doctor` and `status` pass. No credentials were reset.
- Worker verified message, reply, history and media persistence, backup of all
  four volumes, and restore/readback in a separate fresh project. Restored
  community host mappings are rebound before relay startup. Archive restore
  rejects absolute paths, any parent traversal component and all symbolic/hard
  links; 14 permanent regression tests pass in the lead checkout. Existing real
  backup (1,840 entries) passed read-only validation after this restriction.
- CLI base and schema alignment integrated as `36d7be4` and `c525dc9`.
  Desktop tests now load the exact shared Rust fixtures through the actual
  production parser: 24 shared fixtures now run permanently in Desktop.
  Follow-up `af91955` integrated as `e032236`, aligning control characters
  and reporting unverified CLI writes as DeliveryUnknown.
- Native business tests reran successfully against 3341, including history scope
  denial. Native → actual CLI → native context update, stale CLI revision
  rejection and outsider CLI denial passed on channel
  `0d1d5196-6f97-47b8-8271-103f19441832`, using only generated identities
  and synthetic data. Log: `/tmp/aios-native-cli-roundtrip.log`.
  CLI task now continues with genuine per-agent skill selection and runtime
  discovery; it must coordinate runtime.rs ownership with the approval task.
- Mesh feature native compile passed; 2 mesh browser tests passed. Real
  `mesh_admission_smoke` downloaded the 105 MB SmolLM2 test model and started
  serving, but the allowlisted client timed out joining and never saw the model.
  This is a failed single-machine multiprocess experiment, not multi-machine
  proof. Selfhost task now owns focused diagnosis without changing the server.
- Native huddle tests: 196 passed, 1 hardware diagnostic ignored. Browser
  voice/settings/transcription tests: 44 passed with synthetic media. This does
  not establish Danish STT quality or real microphone/speaker interaction.
- Seventh Luna/max task: `01a0d015-95a6-7d83-b20c-cc96cd82e185`, isolated
  `aios-voice-calls` projectless directory. Owns business voice component and
  huddle scope/lifecycle, then bounded signed in-app call requests. Lead wires
  central navigation/native modules. No physical phone calls or room recording.


## Agent-written context integration — 23:12 local

- Native → built CLI → native update proof passed. The permanent ignored
  native test enables this extra path when `AIOS_TEST_CLI` names the built Buzz
  binary. It uses generated keys, a loopback relay and bounded subprocesses.
- 28 desktop schema/domain tests passed (24 shared fixtures), TypeScript and
  E2E build passed. All 7 business browser scenarios passed, including remote
  context notification while a local draft remains intact and its stale write
  is rejected. The head watcher polls every 10 seconds only in the foreground;
  it never silently advances the editor's expected revision.
- Main-agent kickoff now includes the concrete `buzz business show/update`
  commands and mandates revision checks plus readback. The updated packaged
  CLI sidecar and permission-gated real model write still need combined proof.

## App-wide permissions and local model admission — 23:38 local

- ACP broker commit `3927986` integrated as `04f4541`. Owner prompts now mount
  in the main app independently of the active conversation. Three combined
  browser tests passed: navigate while pending, approve once with the exact
  binding, and reject requests for another owner. TypeScript and targeted
  formatting passed. Screenshot: `desktop/test-results/aios-agent-permission.png`.
- Integration caught and fixed a null error-state startup crash. The decision
  adapter now copies only named binding fields; an injected observer `type`
  cannot replace the `resolve_permission` control verb. That attack-shaped
  payload is covered in the browser test. Provider mode confirmation and the
  signed relay runtime roundtrip remain in progress; the UI fixture proof does
  not establish either.
- The Mesh task repaired the bounded same-host admission smoke. Its real
  SmolLM2 run admitted the trusted client and returned PONG; a non-member saw
  model gossip but inference was rejected. Production desktop join paths are
  being audited separately. No two-machine inference claim is made.
- Local desktop packaging entrypoint/config are in place, including a distinct
  application/keyring namespace. `scripts/aios-desktop doctor` passed; the
  actual macOS bundle still needs building after integration.

## Notion integration — 23 September

- Notion provider commit `63af27d` integrated as `080b9ac`; five native
  commands are registered in the main desktop handler. Connection docs stay
  at the canonical `docs/aios/CONNECTIONS.md` route.
- All 23 native connection tests, all 10 frontend connection tests, TypeScript
  and the E2E build passed. Eight combined business/browser scenarios passed,
  including Notion verification/import/partial content notice/attribution,
  duplicate refusal, disconnect, empty token field, and absence of the
  credential from the saved business canvas. Tests use synthetic provider
  fixtures; real Notion access is not claimed.
- Mesh smoke commit `37ceabe` integrated as `7941cbf`. The Mesh task continues
  by checking the production node constructor and desktop join/status path.
- Connections task continues with an explicit read-only Slack source adapter,
  bounded user-selected imports and clearer setup copy. No external accounts
  are connected by the development tasks.

## Main-agent configuration in place — 23:44 local

- Main-agent controls now reuse Buzz's existing per-agent editor from the
  business conversation. AI defaults remain reachable for missing-agent
  recovery and visibly explain their effect on all agents. No second model
  configuration system was introduced.
- TypeScript/build passed and all nine targeted business/onboarding browser
  tests passed, including opening/canceling both configuration surfaces while
  retaining the business room. A stopped agent is labeled stopped; no response
  or model-readiness claim is inferred from merely having an agent record.
- Fresh missing-Fizz provisioning still uses the upstream Agents/onboarding
  path; the new settings shortcut alone does not create a main agent.

## Integrated apps and desktop package — 24 September, 00:02 local

- App task commit `60fc417` integrated as `63fba9f`; Business now renders
  Slides, Calendar and Design with captured relay/identity and the shared
  unsaved-draft guard. Documents live in separate private app channels.
- All five combined app browser tests pass under the production parent CSP:
  scoped writes/reopen/export, unfinished Calendar drafts, Design isolation,
  older-save/newer-draft status, and canceling queued writes after discard.
  Eleven app domain/export tests, TypeScript, build and targeted formatting
  pass. CSP denied the escaped CSS URL before network interception; a browser
  request event alone was not evidence of an outgoing request.
- The lead corrected two real save races, placed preview CSP ahead of all
  supplied markup, and escaped lone carriage returns in calendar exports.
  These editors remain bounded initial tools, not full Agent Native parity.
  Main-agent app membership and app CLI operations are the next app task.
- The first real isolated macOS bundle built successfully from `3eb821d`.
  Its display name was corrected and all bundled sidecars plus the app were
  ad-hoc signed; deep signature verification and packaged business CLI help
  passed. The build script now repeats those steps and records source revision
  and dirty state. The artifact must be rebuilt for integrated apps; native
  window interaction is still unverified because the computer is locked.

## First-agent recovery and provider mode evidence — 00:16 local

- The app package was rebuilt from clean `ca01845`, including the three app
  editors. The automatic display-name correction, sidecar/app ad-hoc signing,
  deep signature check and source metadata file all passed. It is a local debug
  distribution, not a notarized release.
- ACP follow-up `274194a` integrated as `0b8e3b8`. Worker evidence: 978 ACP
  unit tests, two Git bootstrap and nine lifecycle tests passed, four tests
  ignored. A separately enabled live test on relay 3341 delivered the encrypted
  owner decision and observed exactly one fixture effect. Real model context
  updating with the new broker is being tested separately.
- The global tool-access notice now uses actual provider session state,
  distinguishes unconfirmed/unsupported/rejected settings, and only describes
  bypass when the provider reported it. Four permission browser flows and
  thirteen focused parser/API tests pass. The worker's full desktop run had
  one unrelated deterministic call-order assertion failure in
  `useKnownAgentPubkeys.test.mjs`; this remains to assess in combined review.
- “Begin with my agent” now creates a missing Fizz directly in Business,
  using the existing persona/runtime configuration. Creation stays stopped;
  membership, the kickoff message and scoped start follow in order. Existing
  agents are reused, including after a profile sync interruption.
- Native creation captures owner keys, relay and retention scope before its
  effects; scoped callers cannot silently start or deploy a different backend.
  Two new native scope/denial tests and all eleven business/onboarding browser
  flows pass. TypeScript/build, file-size policy and targeted formatting pass.
  These are mock-bridge UI tests plus real native validation, not a claim that
  the locked native window was exercised.

## Voice, Mesh and Slack integration — 24 September

- Voice task `3eea308` integrated as `8d2d355`. Business exposes an explicit
  voice action for its running main agent. Three combined browser tests pass
  with synthetic media: captured workspace start/end, refusal before opening
  a microphone when the binding differs, and microphone cleanup when the
  binding changes after capture. Seven focused voice tests pass. English-only
  Parakeet remains the current STT; native hardware and Danish speech are not
  verified. Incoming signed call requests and their CLI are still in progress.
- Mesh task `773957b` integrated as `7a90590`. Worker results: 85 native Mesh
  tests passed, one ignored; eight frontend state tests and two browser tests
  passed. Production joins are awaited and advertised readiness depends on
  real inference. The next desktop package explicitly enables `mesh-llm`;
  the earlier default-feature package did not include that capability.
- Slack task `1f17413` integrated as `3ec4a9a`; five native commands are wired.
  All 35 native connection tests now pass in the lead desktop crate. Combined
  Slack browser proof and a correction to its source deep links are pending.
  Google Drive work uses read-only OAuth and synthetic fixtures; no private
  external account has been connected by these development tasks.


## Integrated checkpoint — 00:45 local, 24 September

- Clean `fd68911` produced a Mesh-enabled AIOS Pilot app. Metadata records
  that revision with dirty=false; all six sidecars and the bundle pass
  ad-hoc deep/strict signature verification. Later commits are not in it yet.
- A real `gpt-6-luna[max]` turn updated only `company.goals` in an isolated
  private business document. Lead readback review confirms a changed revision
  and exactly that changed path. The retry used an absolute CLI path after
  bare `buzz` was unavailable; the ACP task is investigating that distinction.
  No permission request was observed and no owner decision was sent. This
  proves the authorized synthetic update, not the real-model approval dialog.
  Evidence: `/tmp/aios-agent-permissions-proof-20260924-001858-6be24b/readback.json`.
- Slack workspace-aware link fix `d3f0abb` is integrated. Combined Notion and
  Slack browser flows pass (2): scoped import, partial notice, provenance,
  duplicate rejection, disconnect and preservation of imported sources.
  The saved document contains neither the token nor an unselected channel.
- Skills `c76d61f` are integrated. Eight native tests pass in the lead checkout,
  including staging/discovery, public omission and snapshot opt-in. The
  specialist editor browser flow passes after making instruction editing an
  explicit expandable action. Three business voice flows still pass after
  the more accurate microphone-connected status and English STT disclosure.
- Sites `bb78b0b` and `5c83f35` are integrated with seven registered native
  handlers. Four native scope/validation and five document/export checks pass.
  Worker evidence includes 9 service tests and a real browser preview/save/
  publish/revoke flow. Central Apps integration is pending its extension slot.
  Lead review found unfenced publisher mutation completions and stale revoke
  confirmation risk on a site switch; worker is fixing those before release.
- Work continues: Apps access/CLI, Sites generation/CLI and race fixes,
  Publisher self-hosting and recovery, Google Drive OAuth, incoming calls,
  workflow approval gates and broader platform verification.


## Integrated checkpoint — 01:45 local, 24 September

- Apps extension host and Sites share the Business Apps rail. Eight combined
  browser tests pass, including private persistence, draft navigation guards,
  and real loopback Publisher preview JavaScript, published JavaScript and
  revoke-to-404. Desktop IPC/keyring is substituted in that test; Publisher
  HTTP and the browser iframe are real. Chromium's local-network permission
  is granted only to the disposable test context; production CSP is unchanged.
- Slide preview typography now follows its pane width. The original 1280px
  window cropped the headline; the fixed screenshot and geometry check pass.
  Sites completions are fenced by selected site/scope and publisher connection
  generation (13 focused lifecycle checks).
- Drive handlers and UI are integrated. Two browser tests pass: selected Doc
  import, provenance, duplicate rejection, disconnect preservation, canceled
  sign-in and retry. All 46 native connection tests pass. No real Google account
  was connected. Review found that delayed refresh/connect could restore a
  deleted credential; the connection task owns that follow-up before release.
- Incoming-call CLI/protocol and global gate are integrated in the working tree.
  Six combined incoming/manual voice browser cases pass with synthetic media.
  A seventh case proves the microphone stops after a failed call confirmation,
  but found that the collapsed sidebar lacked the new durable cleanup-error
  retry control. Voice task is fixing the real collapsed surface; retain this
  failing regression until it passes. Native mic/speaker remains unverified.
- Publisher Compose/backup v2 support is integrated as 27c10fa; 37 controller
  tests pass. Live fifth-volume backup/restore is underway in an isolated
  project on ports distinct from the lead relay. Do not equate mocks with
  volume recovery evidence.
- Corrected a stale upstream comment and our capability map: this Buzz base
  already enforces atomic Canvas expected-revision checks at the relay/DB.
  Native live proof against :3341 now submits two signed writes built from
  the same head concurrently: exactly one succeeds, the other conflicts, and
  only the winner enters history. Both live/scope tests pass. Channel:
  185acd48-83f3-4674-b67d-27e640dcb250; log /tmp/aios-canvas-atomic-live.log.
- Sibling CLI PATH discovery is fixed (806dd57) and an actual spawned process
  test passes. The earlier real model update used an absolute path; do not
  relabel that earlier turn as proof of bare-command model use.
- Fixture coordination: voice and workflow workers initially collided on the
  generated buzz-harness :3030 database. Workflow task now owns that runtime;
  voice was told to use generated private fixtures on :3341 without any reset.
  The workflow owner was told to invalidate any proof affected by the fixture
  reset. User data and the lead :3341 volumes were not reset.


## Integrated checkpoint — 01:58 local, 24 September

- Incoming-call recovery follow-up 1c6c725 fixes the collapsed sidebar control.
  All seven combined incoming/manual voice browser cases now pass, including
  microphone release after failed confirmation, durable native-leave error,
  visible retry, and clearing the error on successful retry. Central CLI/gate
  and refreshed built-in call instructions are committed as 4c7d994.
- Sites CLI is wired and built. Its six focused checks pass. A separate real
  CLI test against :3341 passes create-private-room, show/update/list, exact
  parent scoping, stale revision rejection, invalid-document rejection,
  outsider denial and offline HTML export without publishing. Test source:
  scripts/tests/test_aios_sites_cli_live.py; log /tmp/aios-sites-cli-live.log.
- Apps CLI module 6d57f05 is integrated; root wiring and strict parent-business
  validation/strong reads are under review and test. Guided agent UI remains
  with the Apps task. Worker code is not release acceptance by itself.
- Parallel scratch Rust/Docker builds overloaded the local machine (load over
  130). A 15-second CLI startup timed out; after load fell, the bounded live
  test completed in 3.91s. Further lead Cargo commands use CARGO_BUILD_JOBS=2.
  Task message/status tools subsequently stopped returning promptly; outgoing
  coordination calls were terminated after yielding without acknowledgement.
  Do not assume those last resource-control messages were delivered. Read-only
  worker checkout inspection confirms work continues. No worker process or
  user container was killed to work around this.


## Recovery and integrated Sites — 08:16 local, 24 September

- The owner reported the Mac ran out of memory. Commits and all lead edits
  survived. App task communication recovered after restart. Resume with at
  most two lightweight worker tasks and one heavy build/test process at a time;
  Cargo jobs = 1 for the lead. Do not resume every scratch Rust/Docker build.
  Workflow review and Apps guided UI resumed; browser, tables and call-relay
  work remain preserved in their isolated worktrees.
- Integrated publisher Docker-context fix `3dd6902`, Drive operation fencing
  `ecd0c2a`, and guided Sites worker commit `c25db97`. Lead fixed the Sites
  native test imports and verified 50 connection, 27 Nest and 2 native Sites
  length-contract tests. The scoped member-read change then passed one native
  stale-tenant/signer test and 32 channel tests.
- Guided Sites now verifies parent and selected-site membership, grants only
  the chosen main agent, sends before starting, and retains a failed-start
  receipt only in the mounted UI. Retry never resends; a new identical request
  works. Load agent changes respects unsaved drafts and retains the conversation.
  Code, access/history and version identifiers are collapsed. Agent instructions
  use scoped CLI updates and disclose static-site capability limits.
- Four mounted Sites browser flows pass after recovery, including one with the
  actual Publisher process, real preview JavaScript, publication and revoke404.
  Native IPC is mocked in these browser tests; this does not prove a real model
  generated the site. Typecheck, 27 Sites JS tests and the file-size gate pass.
- Self-host worker's actual Docker proof was recovered and its command output
  inspected: v2 backup contains five volumes; fresh restore on distinct ports
  served the same site with CSP, two messages/root-reply thread and 70-byte
  media. Both generated projects were then removed with label-scoped cleanup.
  Evidence is in task `01a0cfc6-dc9e-7312-9e86-e20bb153cd4f`, successful command
  outputs `exec-884a28a2-a2ff-4b80-aa47-52b2f0effe92`,
  `exec-14d4ff56-7d60-4055-9d40-9b821fbb3dcf` and
  `exec-d9e1337c-e978-45ae-a6bf-90c751486ad6`.
- The owner reaffirmed minimal UI and asked for a final design pass. Design
  and Review design skills are selected; final product-wide review remains
  open. No public release or updated desktop package is claimed.


## Lead checkpoint — 09:00 local: real browser development

- Added the real localhost path at `http://127.0.0.1:1437/#/business`, using Vite
  plus a hidden native companion. See BROWSER.md. No new desktop package.
- Browser development now owns a separate `aios-browser-local` profile. The
  earlier attempt to reuse the packaged pilot hit OS keyring access. A real
  startup race was found and fixed: the transport now starts only after native
  setup/identity resolution, never against the temporary AppState identity.
  The pre-fix local fixture is not persistence evidence.
- Actual Codex browser interaction in the new profile created Browser Studio,
  saved company summary/priorities and read both back after reload. Slides title
  and headline were saved and read back after reload. A new Calendar event
  reached Saved privately. No mock bridge or private provider account was used.
- Real Apps editing exposed metadata-only create-channel replies and the native
  empty/no-event Canvas representation. The Apps adapter now reads scoped
  membership before accepting a created channel and treats only empty content
  with no event as absent. Existing malformed events still fail. Dedicated
  native-shape regression tests cover these contracts.
- The recovery key is now masked using the existing shared component; explicit
  reveal/copy and optional backup remain available. The full onboarding still
  needs the planned simplification. The main-agent panel incorrectly labels a
  setup-listener Fizz as running/ready, and app navigation can reset during
  initial business load; both remain product fixes to address.
- Native transport unit tests, final socket cleanup smoke and affected browser
  regressions are being finalized. Do not infer completion from first render.
- Workflow approvals worker committed dbd08cb; isolated browser-MCP worker
  committed ed20c998. Both await lead integration/review. Guided Apps remains
  active. At most two lightweight workers plus one heavy check are scheduled.


### 09:07 verification checkpoint

Six native browser-transport tests, three Apps native-response contract tests,
TypeScript and the E2E frontend build pass. Seventeen affected browser tests
pass (five Apps flows and twelve recovery/onboarding cases). The updated
recovery screen was also inspected in the real localhost UI and its private
key stayed masked. Logs: `/tmp/aios-browser-native-tests-final.log`,
`/tmp/aios-apps-native-contract-tests.log`, `/tmp/aios-browser-typecheck-final.log`,
`/tmp/aios-browser-regression-e2e.log`.

The final native development build compiles. Its restart is waiting in macOS
keyring access while the Mac is locked (confirmed by native process sample and
computer-use inventory). The transport correctly remains unavailable until
setup finishes. The launcher was stopped, preserving all profile/relay data;
there is no currently ready localhost server. Final native event/socket smoke
and full-process restart readback remain unverified until keyring access is
available. Browser-only reload persistence above was observed before restart.
No OS security prompt was accepted and no existing credentials were changed.

Guided Apps fbcf80f is also ready for lead integration. Broader platform work,
minimal onboarding, Tables and full UI review continue; this is a checkpoint,
not completion of the AIOS product.

## Lead checkpoint — 09:32 local: real localhost restart and integrations

- Workflow approval gates (`5f734d1`), opt-in browser MCP (`96ca6ad`), guided
  Apps (`3ca150a`) and isolated calls fixture (`4067f99`) are integrated.
- The user approved the macOS keyring prompts. The browser companion now starts
  successfully at `http://127.0.0.1:1437/#/business`, with the real Rust backend
  and separate `aios-browser-local` identity. No desktop package was produced.
- A live startup defect was repaired: Wry owns a non-configurable global `ipc`
  and Tauri makes `runCallback` read-only. The hidden host now uses local names
  and its debug callback Map to forward foreign channel completion, leaving
  native callbacks intact. Readiness retries native setup; frontend startup
  waits up to two minutes for transient unavailability.
- `desktop/scripts/browser-api-smoke.mjs` passes against that actual process:
  identity read (no credential output), origin/session denial, native event
  roundtrip, WebSocket ownership denial and channel-end callback cleanup.
- In Codex's browser after a full native process restart, company `Browser Studio`,
  its saved summary and priorities, Slides `Browser Studio — localhost proof` /
  `Rigtig lokal gemning`, and Calendar `Lokal browser-test` (09:00–09:30) were
  read back. These are synthetic local fixtures, not private company data.
- Guided Apps now renders its private conversation. A new browser regression
  exposed conversation/receipt loss during Load agent changes; moving the panel
  outside the document loading branch preserves it and its retry state. All six
  Apps browser cases now pass, including load-result and dirty-draft refusal.
- Main-agent status no longer equates a running setup listener with AI readiness.
  Sites hosting settings are collapsed; publication state and errors remain
  visible, and user-facing copy omits keyring/canvas/tombstone internals.
- Read evidence: 24 Apps/access JS checks; six native browser transport tests;
  four browser MCP native checks; 171 workflow unit checks (two ignored);
  TypeScript and E2E build. The combined E2E run had 20 passes and one genuine
  guided-App failure, repaired and rerun as six Apps passes. The other 15
  unchanged cases include real Publisher preview/publish/revoke and synthetic
  voice/incoming-call flows. Logs: `/tmp/aios-integrated-native.log`,
  `/tmp/aios-guided-apps-tests.log`, `/tmp/aios-workflows-lead.log`,
  `/tmp/aios-integrated-e2e.log`, `/tmp/aios-guided-app-retest.log`,
  `/tmp/aios-browser-host-test.log`, `/tmp/aios-browser-api-live.log`.
- Browser MCP's real fixture initialized, listed tools and cleaned up its process
  group, but navigation exposed a macOS socket-path length failure. The browser
  worker owns that repair plus an overall provisioning deadline. Lead fixed the
  managed Node npx path, installation stdout contamination, required app cache,
  network limits and Windows moved-value bug; no navigation success is claimed.
- Remaining visual findings from the real UI: generated app-storage channel names
  clutter the global sidebar; business conversation repeats ordinary channel
  setup cards and places onboarding below the composer at laptop width. Address
  these in the full minimal-Buzz design review.
- Resource allocation: Tables is lightweight only. Browser worker owns the single
  heavy slot (Cargo jobs=1 and one browser fixture at a time). Lead's native dev
  server remains running; avoid rebuilding it unnecessarily after keyring approval.

## Business access UI — verified with native scope fences

The lead added a compact Access dialog to the standalone Business page. It
reads the dedicated context group's roster, offers owner/admin-controlled
explicit teammate selection, and confirms the data/history scope before a
grant or removal. Agent skills and account selection remain a separate agent
setup responsibility. No users are invited automatically and no legacy data
or membership was migrated. Legacy group grants explicitly include any
conversation history already stored with that context.

Seven affected browser fixture flows pass in
`/tmp/aios-access-acceptance.log`: add/remove/cancel with captured context and
identity, agent exclusion from the human picker, denied-grant retry, ordinary
member read-only controls, accepted-write/readback-failure recovery, keyboard
focus and adjacent navigation/draft guards. Typecheck, e2e build, changed-file
Biome, px-text and differential file-size checks pass. Real localhost inspection
read Browser Studio's existing owner roster and checked the dialog layout;
no real membership was changed. Independent code review accepted the bounded
UI/native scope slice with no remaining finding. Lead reconciled the final
seven passing browser results after fixing a duplicate React key detected in
the real localhost console; keyboard close restores focus to Access.

Native scope fences for `remove_channel_member` and both `search_users` query
paths are integrated in `4cba4c3` (worker `7900a43`). The actual Tauri companion
compiled and restarted successfully. A real RPC regression fails before the
fix because stale-scope removal reaches the relay; the unchanged test passes
afterward for relay and signer mismatch on get/add/remove members and search,
as well as origin/session/event/socket boundaries. Logs:
`/tmp/aios-access-native-before.log`, `/tmp/aios-access-native-after.log`, and
`/tmp/aios-browser-access-restart.log`. The random nonexistent context used by
this test caused no real membership changes. The running companion keeps the
same browser-development profile and saved data. Typed-context registration,
server owner/admin policy and its isolated relay proof remain separate work;
this UI slice does not claim them or fine source-level permissions.

The backend worker owns the single heavy-build slot again. The other existing
worker is resuming its paused Browser MCP repair as source/format work only,
with test/build scheduling still coordinated by the lead. Its candidate is
not yet accepted. No additional worker tasks were created.

## Host context discovery in clients — 11:39 local

The native channel metadata projection now retains the host's `resource` tag
through list/detail responses and the stable directory hash. Malformed or
duplicate discriminators reject conversion. Business prefers the registered
`aios.business-context:v1` resource independently of its display description;
explicit legacy IDs remain available for old drafts. Unknown future resource
types cannot masquerade as legacy Business through the old about marker.

An open Business editor pins its resolved context ID. A directory refresh that
discovers the new canonical context therefore cannot replace the company
under an unsaved draft. A production-bound browser regression exercises failed
save → reload saved context → Keep editing while the new host reference arrives.
Removing the pin loses the draft (`/tmp/aios-context-selection-mutation-browser.log`);
restoring it passes. The final four navigation flows pass in
`/tmp/aios-context-metadata-browser-final.log`, along with three native parser/hash
tests (`/tmp/aios-context-metadata-native.log`), three TypeScript selection tests,
typecheck, frontend build, changed-file formatting and differential size checks.

The actual localhost UI still reopens Browser Studio's existing summary and
priorities when moving between Business and Plugins. This confirms compatibility
with the current untyped relay. The new native projection has compiled in tests;
the companion and user relay have not been replaced or migrated for this slice.
Typed registration and its real multi-identity authorization/restore proof remain
the backend worker's phase-two work. No ACL, stored document or credential was
changed by this client patch. Independent source review accepted the bounded
metadata/navigation slice (`/tmp/aios-context-client-review.md`); it did not
accept subsequent retrieval/runtime work.


## Selective knowledge lookup — active verification

The lead added `business discover`, `adopt`, `index`, `search` and `read`.
Discovery returns only accessible context references; indexing omits text
bodies. Search returns bounded literal excerpts and provenance; read returns
one selected entry with Unicode character pagination. Every lookup reloads the
current authorized snapshot. Continuation requires the exact revision so pages
from different versions cannot silently mix. The document is still fetched
internally in full under the agent identity; the CLI emits only selected output.

Compiled proof: `buzz-business` 9/9, final focused CLI Business tests 23/23,
Apps tests 7/7, help inventory 2/2 and actual binary help pass. Evidence is in
`/tmp/aios-knowledge-business-tests.log`, `/tmp/aios-knowledge-cli-final.log`
and `/tmp/aios-knowledge-cli-help.log`. Clippy exposed a pre-existing Apps helper
with eight arguments; it now derives the duplicated app ID from its checked
channel instead. A new CLI regression also rejects forum/ambiguous channel
types. Final clippy is clean for both crates
(`/tmp/aios-knowledge-clippy-final.log`) and the real CLI binary was rebuilt
(`/tmp/aios-knowledge-cli-build-final.log`). The root file-size gate and scoped
formatting pass. Independent CLI/retrieval source review accepts checkpoint
`21116f6`; `/tmp/aios-knowledge-cli-review.md` records its exact scope and limits.

`test_aios_business_cli_live.py` passes against a fresh disposable typed host:
adoption preserves documents/membership, agent access
is denied before a grant and after revocation, selected reads omit unrelated
text, stale pagination conflicts, and generic Canvas writes cannot bypass the
Business schema. Lead inspected `/tmp/aios-context-proof-20260924-01-live-cli.log`:
the actual unittest reports one passing scenario, and CLI reads after isolated
restore retain canonical context, document revision, members and selected source
results. Source host is loopback 3399 and restored host is 3400; neither is the
user's existing relay. Image and relay binary digests are in that evidence log.
Final backend handback, source review and integration remain pending. No new
schema or access change has been applied to the user's host.

Additional restored-host proof is in
`/tmp/aios-context-proof-20260924-01-signed-http-ws.log`. Lead read the result and
its reproduction harness: signed HTTP query/count expose 3 Canvas events to
both admitted identities before removal and zero to the revoked agent after;
the owner can still write/read. The authenticated agent WebSocket receives
history and a live update before removal, is closed on revocation and receives
no subsequent update. This proves the isolated host boundary, not the running
user host or an agent model's behavior. The restored fixture now has its agent
revoked; its original backup retains the earlier grant.

Bundled agent guidance is being updated to use company discovery and selective
reads from ordinary conversations; the nest skill version is bumped to refresh
existing installs after a native build. This is drafted guidance, not proof that
new running agents already receive it. Actual localhost agent creation was
inspected without creating or changing an agent. Full-context opt-in and
workspace agent provisioning remain the next implementation boundary.
The new guidance requires an explicit context reference or canonical discovery;
wire this into setup/run metadata before claiming legacy Welcome/Saved pilot
work compatibility. Do not expose storage UUIDs in ordinary onboarding messages
as a substitute for that runtime binding. Existing channel Canvas injection
already carries metadata and a lookup route, not the full Canvas body.
The read-only agent audit is available at `/tmp/aios-agent-context-seams.md`.
It identifies instance-scoped create/update/store/spawn fields and ACP prompt
assembly; `FLOWS.md` records the relay binding and partial-grant recovery
contract. Existing Buzz private memory and bounded thread history are reusable;
there is no evidence of an archive retaining every pre-compaction model/tool
turn. Do not equate retained relay messages with lossless model history.


## Phase 2 host-context backend — 24 September 2026

- Implemented the accepted backend contract in isolated checkout
  `/Users/gustavanderson/Downloads/aios-pilot-host`, branch
  `ai-os-context-host`. This adds durable channel resource typing, the
  one-context-per-community constraint, explicit signed adoption/registration,
  kind:39000 discovery metadata and typed Business Canvas validation with
  expected-revision compare-and-swap. Existing untyped groups keep their
  behavior; adoption preserves their roster and event history. CLI index/search
  implementation and frontend ownership remain outside this slice.
- Registration requires current owner/admin authority in both the selected
  private group and its community. Authority and the current Canvas head are
  rechecked transactionally. The resource type cannot be removed or retargeted;
  a soft-deleted canonical slot remains reserved. Mention indexing is in the
  registration transaction, so indexing failure rolls back the event and type.
- Four PostgreSQL-backed `buzz-db` tests pass against a uniquely named
  disposable database: member denial, idempotent replay/authority recheck and
  uniqueness/type/CAS fences, mention-index rollback, and untyped Canvas versus
  adoption serialization. Five relay context unit tests pass, including strict
  Business document/revision validation. Latest Docker release build compiled
  the final relay source.
- Against a disposable selfhost relay, the rebuilt lead CLI live test passes
  discovery, adoption/replay, ACL/history preservation, explicit grant, index
  omission, selected read/search, stale pagination conflict and revocation.
  Signed HTTP query/count and NIP-42 WebSocket checks confirm reads and live
  delivery stop after revoke while the owner retains access and write ability.
  A fresh-volume backup/restore retained the context ID, type, roster and
  complete history; the restored CLI and relay checks passed before a deliberate
  revoke on the restored copy.
- Migration 0050 and `schema/schema.sql` agree. Restore readback confirms
  migration 50, the unique community index and immutable-type trigger. Docker
  image digest: `sha256:349753f731b53d6073393837c0fbd3cc691a82716a19badab19fa8f3dcb010cc`;
  relay binary SHA-256:
  `4cd05f7a8bacb5d6daeb1575a7f8a625333866e6cd7511c4c8a36ad6a5308fb8`.
- Scoped Rust formatting, `git diff --check`, and `just file-size-check` pass.
  The repository-wide format check remains blocked only by unchanged baseline
  files; repository-wide test discovery likewise reports one pre-existing
  ignored-test discovery failure in `buzz-test-client`. No broad Cargo run was
  started because the lead assigned the sole heavy Cargo slot to Browser.
- This is an isolated implementation checkpoint. Lead review and integration
  remain pending; no production deployment or migration of user-local data is
  claimed. Detailed test/restore outputs and full source/image binding are in
  `/tmp/aios-host-context-handback.md`.
