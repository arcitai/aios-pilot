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
