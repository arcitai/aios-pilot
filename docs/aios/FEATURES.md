# Product capability map

This is the full product direction, not a promise that every upstream feature
already works in the fork. Gustav reaffirmed the platform scope on 23 September
2026: keep building beyond a bot with extra tools. A completed row requires
observed behavior through its real interface, not only source code.

| Capability | Reuse / implementation | Current evidence | Remaining work |
| --- | --- | --- | --- |
| Buzz visual identity and conversations | Actual Buzz shell; separate Business, Plugins and ordinary channels | Real localhost Business/Plugins review; navigation, draft guards and compatibility app flows pass | Typed channel-app resources and final cross-flow review |
| First agent as permanent home base | Ordinary Welcome entry restored; prior Business-bound Fizz conversation preserved under Saved pilot work | Eleven business/onboarding browser flows pass; real Luna/max read and updated one synthetic company goal with exact readback via the self-hosted relay | Real-model approval prompt and full first-run native window flow; packaged sibling CLI discovery now passes an actual child-process test |
| Company context | Versioned domain document in dedicated private channel canvas | Live native and CLI round-trip, history, stale-write/outsider denial; browser conflict/recovery pass | Server-side atomic canvas preconditions verified with two concurrent signed writes; source/tool-level permissions remain separate work |
| Sources and business knowledge | Attributed text/file/link snapshots with editing, removal, search and history | Browser add/edit/remove/recover and GitHub import-to-context flows pass | More formats, incremental indexing, provider refresh and stale-source detection |
| Plugins and connections | Searchable workspace Plugins surface with included skills; native read-only GitHub, Notion, Slack and Google Drive adapters with OS-keyring credentials scoped to relay and identity | GitHub/Notion browser flows and native checks pass; Slack selected-channel/attribution/duplicate/disconnect browser flow passes, with workspace-aware links | Drive selected-Doc import/disconnect/canceled-login browser flows pass; native credential race fix passes delayed-refresh/revoke/connect tests; real account authentication, provider refresh and runtime agent access remain |
| Agent specialization and skills | Plugins and agent setup share one included skill catalog; private per-agent instructions, runtime capability checks and opt-in snapshot export | Eight native skills checks and specialist-editor browser flow pass; bundled-agent skill discovery/staging has additional native and real-process checks; public sharing omits skills | Real specialist consuming its selected skill and approved context |
| Agent teams and delegation | Buzz team/persona runtime | Existing source | Context inheritance, visible work status and acceptance |
| More computers / remote agents | Buzz backend providers; OpenAgents reference | Source only | Pairing flow, remote execution, disconnection/recovery proof |
| Local models | OpenAI-compatible endpoints / Ollama; optional MeshLLM | Same-host real SmolLM2 inference returned PONG for an admitted peer; non-member denied; production join/readiness fix integrated with 85 native and two browser checks; clean Mesh-enabled macOS package built | Model tool-use and real second-machine proof |
| Browser use | Opt-in isolated Playwright MCP adapter integrated; OpenAgents reference | Credential-isolation tests, real MCP initialization/tools-list and process cleanup pass; real navigation exposed a macOS socket-path defect | Socket-path repair, bounded provisioning and successful actual navigation |
| Built-in Design, Slides and Calendar | Modular app registry, private per-app Canvas documents, replaceable storage | Editors integrated in Business; scoped write/reopen, draft guards and save-race browser checks pass; 11 domain/export checks pass | Explicit per-app agent access integrated; real-relay CLI creation/update/readback passes for all three apps; guided agent request/conversation/load-result and dirty-draft browser flow passes; real model-generated output, rich visual design and provider sync remain |
| Tables and data-backed apps | Kylon typed tables, saved views and database-app flow are behavioral references | Public documentation reviewed; private typed-table editor/CLI assigned; no database-backed generated app implemented yet | Typed fields/rows, useful views, agent/CLI parity, then a separate authenticated data adapter for generated apps |
| Forms, Plans and Clips | Bounded app extensions informed by Agent Native | Research only | Implement after core app contract and two usable editors |
| Generated sites/webapps | Private HTML/CSS/JS documents, isolated preview and static Publisher service | Worker browser flow proves save/preview/JavaScript/publish/revoke404; service 9 checks pass; lead native scope 4 and document/export 5 checks pass | Combined Apps/Sites browser flow passes with real loopback publisher, JS preview/publish/revoke; scope/connection race fixes pass 13 tests. Real Sites CLI roundtrip/denials/export pass; guided browser flow and live five-volume hosting/restore pass; real-model site generation remains; full-stack apps remain beyond static sites |
| Schedules, automations and follow-ups | Buzz workflows with durable approval gates | Approved/denied/expired state, saved definition and resume-claim integration landed; 171 lead unit checks pass; worker reports isolated live proof | Combined relay proof, visible end-to-end approval, missed-run recovery |
| Voice conversations | Buzz huddles, agent STT/TTS and workspace voice action | Three business voice browser flows pass with synthetic media, including scope refusal and microphone cleanup; seven focused UI tests pass; earlier 196 native tests passed (one ignored) | Native microphone/speaker proof; optional Danish STT adapter and quality evaluation |
| Agent-initiated calls | In-app call requests, with a separate future telephony adapter | Signed call protocol and CLI integrated; mounted accept/decline/stale/expiry flows pass. Collapsed cleanup-failure recovery passes with visible retry and microphone release | Signed request/accept/decline, explicit microphone consent; external phone provider remains unconfigured |
| Self-host messages, threads, media | Buzz relay + Postgres/Redis/MinIO and operational CLI | Healthy local stack; message/thread/media readback and fresh-project backup/restore passed; 14 archive-validation regressions pass | Public host/TLS/member-admission deployment not exercised |
| CLI | Existing Buzz CLI plus business commands | Shared fixtures, live native/CLI/native round-trip and model-driven synthetic goal update pass; packaged business CLI refreshed | Apps/Sites operations and live scoped readback/denials pass; actual ACP child finds the sibling CLI without an absolute command path |
| Access and approvals | Native signed owner events, ACP approval broker and channel membership | Four permission browser flows include binding tamper protection and actual mode reporting; signed relay fixture executes exactly once; scope/outsider/connection denial checks pass | Real model write proof underway; finer source/tool grants remain |
| Nontechnical installation | Packaged desktop and self-host control commands | First isolated AIOS Pilot macOS bundle built; ad-hoc signature and packaged business CLI verified | Packaging deliberately deferred. Real localhost app runs with the native backend; context, Slides and Calendar survive process restart. Full onboarding, update/recovery and wider distribution remain |

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

Kylon also separates [tables](https://docs.kylon.io/concepts/tables) from
[database apps](https://docs.kylon.io/concepts/database-apps). Our static Sites
Publisher does not supply that database or authenticated data access. A private
table editor is the next bounded app contract; exposing its data to a generated
app will need an explicit server-side access boundary, not a public copy of the
company context or its signing key.
