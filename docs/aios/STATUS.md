# AIOS implementation status

Updated during the night of 23–24 September 2026 (Europe/Copenhagen).

## Current state

- Local independent Buzz fork: `/Users/gustavanderson/Downloads/aios-pilot`.
- Base: `5621006bcf84b82e5da489824a5b4d76568d8602`.
- Product contract: `AIOS_PILOT.md`.
- Research sources: `/tmp/ai-os-research-20260923/` (read-only references).
- Business context, sources/history, main-agent creation and settings,
  GitHub/Notion/Slack, per-app Slides/Calendar/Design, business CLI, and a local
  self-hosted relay with backup/restore are integrated and tested.
- The isolated macOS package was built with Mesh and signature-verified from
  clean `fd68911`. Later skills, Sites and Slack-link fixes must be included
  in the next package. Native window interaction remains unavailable
  while the computer is locked. Detailed evidence and limits are below.
- Skills, Apps access and integrated Sites have landed. Google Drive is wired
  and its selected-document browser flow passes. Its credential race fix is
  integrated and 50 connection checks pass. Active work includes app/Sites agent actions,
  browser use, tables and workflow approvals. Incoming-call recovery now passes. The full
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

1. Complete agent-facing app/Sites CLI and exercise real agent-created output.
2. Finish Drive credential-generation fencing, then rerun its native checks.
3. Verify Publisher hosting/restore against real Docker volumes and finish
   durable workflow approvals, isolated browser use and private typed tables.
4. Continue multi-computer operation and data-backed app contracts, then refresh
   the packaged desktop and installation/recovery evidence.

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
