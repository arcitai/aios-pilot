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
The first agent is the user's persistent home base: it learns the business,
helps connect tools, proposes source-backed company context, accepts corrections,
and only then helps create specialist agents and useful apps. Kylon is a
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

## Architecture decisions

Keep Buzz's Rust relay, Nostr-signed events, membership enforcement, Tauri/React
desktop, ACP agents and existing CLI. Nostr is a message/auth protocol; the
product does not require a blockchain or cryptocurrency purchase.

Use one dedicated private channel as the first business workspace. Its canvas
can hold the versioned structured context document during the pilot, reusing
the existing relay storage, history, membership gate and conflict detection.
Do not overwrite ordinary channel canvases or the Welcome canvas. UI and CLI
must use the same document contract. This is a bounded initial storage adapter;
domain types must not depend on a canvas UI. Secrets never belong in the context
document, channel messages, exported apps or browser storage.

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
Workspace access initially follows private-channel membership; do not imply
finer source-level permissions than implemented. Context revisions use the
existing canvas expectedRevision contract; expose conflicts and retry safely.
Bound document/source sizes and reject malformed/unrecognized schema versions.
Individual string limits use UTF-16 code units, matching the desktop fields and
Zod parser; the complete serialized document is capped at 200,000 UTF-8 bytes.
Rust and TypeScript validators must pass the same Unicode/boundary fixtures.

Front-end ownership: `desktop/src/features/business/` and shared API adapters.
Reusable apps: `desktop/src/features/aios-apps/`; editor components consume
explicit values/callbacks, not hidden global credentials or provider clients.
Each app declares id, title, capabilities and document schema/version.
Each app must have a usable local editing/output path; provider integrations
remain adapters with explicit unconfigured states.

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
