# AIOS implementation status

Updated 23 September 2026, evening (Europe/Copenhagen).

## Current state

- Local independent Buzz fork: `/Users/gustavanderson/Downloads/aios-pilot`.
- Base: `5621006bcf84b82e5da489824a5b4d76568d8602`.
- Product contract: `AIOS_PILOT.md`.
- Research sources: `/tmp/ai-os-research-20260923/` (read-only references).
- Implementation authorized. Business route, typed context, source editor,
  first-agent invitation and scoped canvas/creation operations implemented.
- Frontend typecheck and initial E2E-mode build passed; 4 document tests passed.
  Two initial browser scenarios passed, including a concurrent edit conflict.
  `just desktop-tauri-check` and all 14 native canvas unit tests passed.
  Sidecars built successfully. The isolated native app is being compiled and
  extended browser tests are underway.
- An hourly heartbeat in the lead task resumes authorized work until the
  product goal is verified or meaningful progress requires a missing external
  prerequisite. Morning status after 08:00 on 24 September. Automation id:
  `aios-pilot-natlig-udvikling`.

## Active isolated tasks (GPT-6 Luna / max)

- CLI: `01a0cfc6-4a16-74e2-9bec-ff2383fed3d0`, clone under
  `/Users/gustavanderson/Documents/Codex/2026-09-23/aios-business-cli/buzz`.
- Apps: `01a0cfc6-93fe-7d32-b714-ff6611505ca7`, clone under
  `/Users/gustavanderson/Documents/Codex/2026-09-23/aios-built-in-apps/buzz`.
- Self-host: `01a0cfc6-dc9e-7312-9e86-e20bb153cd4f`, clone under
  `/Users/gustavanderson/Documents/Codex/2026-09-23/aios-self-hosting/buzz`.
- Connections: `01a0cfcd-f659-7ea1-a638-6a44ae8420f3`, clone under
  `/Users/gustavanderson/Documents/Codex/2026-09-23/aios-connections/buzz`.

All are under AIOS Development. Use compact `wait_threads` snapshots and reuse
the same worker for revisions. They return isolated commits; lead integrates.

## Next work

1. Finish business UI E2E and scoped native checks; inspect screenshots.
2. Lead: complete main-agent onboarding and shared context interaction.
3. Integrate worker patches and exercise the combined interface.
4. Continue source connections, preview/deployment and voice as working
   prerequisites become available; retain an honest list of unfinished paths.

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
