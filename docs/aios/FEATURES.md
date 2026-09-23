# Product capability map

This is the full product direction, not a promise that every upstream feature
already works in the fork. Gustav reaffirmed the platform scope on 23 September
2026: keep building beyond a bot with extra tools. A completed row requires
observed behavior through its real interface, not only source code.

| Capability | Reuse / implementation | Current evidence | Remaining work |
| --- | --- | --- | --- |
| Buzz visual identity and conversations | Actual Buzz desktop, tokens, components, rooms and threads | Source retained; frontend builds | Native and interaction regression checks |
| First agent as permanent home base | Existing welcome agent and private business conversation | New business route implemented | Live model conversation, context-update skill, recovery |
| Company context | Versioned domain document in dedicated private channel canvas | Parser tests and frontend typecheck pass | CLI round-trip, live relay persistence, conflicts and permission denial |
| Sources and business knowledge | Attributed source records; company/source editing | Initial UI implemented | Provider import, incremental indexing, search, stale-source detection |
| Connections | Native provider adapter with scoped secret storage | Dedicated task active | Verified connection UI, revoke/reconnect, provider adapters, agent access |
| Agent specialization and skills | Buzz persona packs, skills and ACP | Existing source inspected | Product-level setup and a specialist consuming approved context |
| Agent teams and delegation | Buzz team/persona runtime | Existing source | Context inheritance, visible work status and acceptance |
| More computers / remote agents | Buzz backend providers; OpenAgents reference | Source only | Pairing flow, remote execution, disconnection/recovery proof |
| Local models | OpenAI-compatible endpoints / Ollama | Existing source | Local model discovery, settings and tool-use proof |
| Browser use | Existing/runtime browser adapters; OpenAgents reference | Research only | Isolated browser session, visible control and access |
| Built-in Design, Slides and Calendar | Modular app registry with replaceable document storage | Dedicated task active | Integrate, persist on relay, rich editing, provider sync |
| Forms, Plans and Clips | Bounded app extensions informed by Agent Native | Research only | Implement after core app contract and two usable editors |
| Generated sites/webapps | Generate → edit → preview → share | Research only | Runtime isolation, build output, publication/access/revoke, durable hosting |
| Schedules, automations and follow-ups | Existing Buzz workflows | Source only; upstream approval executor gap noted | Trigger/retry/cancel/approval behavior, missed-run recovery |
| Voice conversations | Buzz huddles, agent STT/TTS | Existing code including release inspected | Native interaction, Danish quality and interruption behavior |
| Agent-initiated calls | Telephony adapter | Not implemented | Provider setup and explicit call policy; isolated call test |
| Self-host messages, threads, media | Buzz relay + Postgres/Redis/MinIO | Dedicated task active | Isolated stack, restart, backup/restore, operator path |
| CLI | Existing Buzz CLI plus business commands | Dedicated task active | Shared schema, JSON output, source/app operations, live tests |
| Access and approvals | Native signed events and channel membership | Scope pinning added to canvas; runtime verification pending | ACP permission policy, source/tool grants, denial/revoke tests |
| Nontechnical installation | Packaged desktop and self-host control commands | Research and scripts underway | Native bundle, first-run flow, update/recovery and simple operator docs |

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
