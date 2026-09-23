# Product capability map

This is the full product direction, not a promise that every upstream feature
already works in the fork. Gustav reaffirmed the platform scope on 23 September
2026: keep building beyond a bot with extra tools. A completed row requires
observed behavior through its real interface, not only source code.

| Capability | Reuse / implementation | Current evidence | Remaining work |
| --- | --- | --- | --- |
| Buzz visual identity and conversations | Actual Buzz desktop, tokens, components, rooms and threads | Nine business/onboarding browser flows pass; desktop and narrow screenshots reviewed | Native-window interaction awaits unlocked desktop |
| First agent as permanent home base | Fizz is created/reused directly in Business; private conversation and onboarding instructions | Eleven business/onboarding browser flows pass; real Luna/max read and updated one synthetic company goal with exact readback via the self-hosted relay | Bare CLI discovery follow-up; real-model approval prompt and full first-run native window flow |
| Company context | Versioned domain document in dedicated private channel canvas | Live native and CLI round-trip, history, stale-write/outsider denial; browser conflict/recovery pass | Canvas conflict checks remain advisory, not atomic CAS |
| Sources and business knowledge | Attributed text/file/link snapshots with editing, removal, search and history | Browser add/edit/remove/recover and GitHub import-to-context flows pass | More formats, incremental indexing, provider refresh and stale-source detection |
| Connections | Native read-only GitHub, Notion and Slack adapters with OS-keyring credentials scoped to relay and identity | GitHub/Notion browser flows and native checks pass; Slack selected-channel/attribution/duplicate/disconnect browser flow passes, with workspace-aware links | Real account credentials not exercised; Drive OAuth in progress; provider refresh and runtime agent access remain |
| Agent specialization and skills | Private per-agent skills, capability-based discovery, starter workflows and opt-in snapshot export | Eight native skills checks and specialist-editor browser flow pass in the integrated checkout; public sharing omits skills | Real specialist consuming its selected skill and approved context |
| Agent teams and delegation | Buzz team/persona runtime | Existing source | Context inheritance, visible work status and acceptance |
| More computers / remote agents | Buzz backend providers; OpenAgents reference | Source only | Pairing flow, remote execution, disconnection/recovery proof |
| Local models | OpenAI-compatible endpoints / Ollama; optional MeshLLM | Same-host real SmolLM2 inference returned PONG for an admitted peer; non-member denied; production join/readiness fix integrated with 85 native and two browser checks; clean Mesh-enabled macOS package built | Model tool-use and real second-machine proof |
| Browser use | OpenAgents reference; runtime adapter still to select and verify | Research only; no verified built-in agent browser adapter | Isolated browser session, visible control and access |
| Built-in Design, Slides and Calendar | Modular app registry, private per-app Canvas documents, replaceable storage | Editors integrated in Business; scoped write/reopen, draft guards and save-race browser checks pass; 11 domain/export checks pass | Agent access and app CLI underway; rich visual design, provider sync and real-relay app roundtrip remain |
| Forms, Plans and Clips | Bounded app extensions informed by Agent Native | Research only | Implement after core app contract and two usable editors |
| Generated sites/webapps | Private HTML/CSS/JS documents, isolated preview and static Publisher service | Worker browser flow proves save/preview/JavaScript/publish/revoke404; service 9 checks pass; lead native scope 4 and document/export 5 checks pass | Combined UI integration, reviewed asynchronous-state fixes, agent generation and CLI, hosting/restore; full-stack apps remain beyond static sites |
| Schedules, automations and follow-ups | Existing Buzz workflows | Source only; upstream approval executor gap noted | Trigger/retry/cancel/approval behavior, missed-run recovery |
| Voice conversations | Buzz huddles, agent STT/TTS and workspace voice action | Three business voice browser flows pass with synthetic media, including scope refusal and microphone cleanup; seven focused UI tests pass; earlier 196 native tests passed (one ignored) | Native microphone/speaker proof; optional Danish STT adapter and quality evaluation |
| Agent-initiated calls | In-app call requests, with a separate future telephony adapter | Dedicated voice task active | Signed request/accept/decline, explicit microphone consent; external phone provider remains unconfigured |
| Self-host messages, threads, media | Buzz relay + Postgres/Redis/MinIO and operational CLI | Healthy local stack; message/thread/media readback and fresh-project backup/restore passed; 14 archive-validation regressions pass | Public host/TLS/member-admission deployment not exercised |
| CLI | Existing Buzz CLI plus business commands | Shared fixtures, live native/CLI/native round-trip and model-driven synthetic goal update pass; packaged business CLI refreshed | App-specific operations and bare-command discovery follow-up |
| Access and approvals | Native signed owner events, ACP approval broker and channel membership | Four permission browser flows include binding tamper protection and actual mode reporting; signed relay fixture executes exactly once; scope/outsider/connection denial checks pass | Real model write proof underway; finer source/tool grants remain |
| Nontechnical installation | Packaged desktop and self-host control commands | First isolated AIOS Pilot macOS bundle built; ad-hoc signature and packaged business CLI verified | Refresh bundle after feature integration; native first-run interaction, update/recovery and wider distribution |

## Reference boundaries

Kylon: public docs and Liam Ottley's walkthrough transcript, especially
[onboarding from 1:21:30](https://www.youtube.com/watch?v=ONd2UNBmQ40&t=4890s),
connections and access during setup, and agent-team planning from 1:48:40.
Its private implementation has not been inspected.

OpenAgents: fd523077a000f9f17efa2ca4fa8cf7628610305d. Reuse architecture ideas or
bounded adapters; do not merge two competing identity/history/permission systems.

Agent Native: b67f795fc1b12c43819198c957e09c9e3bc26ecc. App code is available for
inspection. A working app editor is not equivalent to a complete hosted app
builder; retain provenance and check the actual component's license on reuse.

Buzz: 5621006bcf84b82e5da489824a5b4d76568d8602 is the local fork base. Preserve
upstream attribution and independently verify the product flows we expose.
