# Local browser development

The React app can run in an ordinary browser against the actual local native
backend. This is the preferred development and manual-test path. Desktop
packaging is deferred until the product is ready.

```sh
scripts/aios-selfhost doctor
scripts/aios-browser
```

Open <http://127.0.0.1:1437/#/business>, including in Codex's built-in browser.
The existing self-hosted relay must be healthy on port 3341. If it is stopped,
start Docker and `scripts/aios-selfhost start`; first-time setup is described in
[Self-hosting](SELF_HOSTING.md). The browser launcher does not reset the relay,
install a desktop package, or connect private model/tool accounts.

The first native compile takes longer; later React edits use Vite hot reload.
Rust changes require stopping and restarting the launcher. Wait for its ready
message before opening the app. Ctrl+C stops only this launcher's process
groups and removes its temporary transport token. Builds use one Cargo job.
Save before changing source: Vite may remount a component during hot reload.

## Profile and transport

Browser development uses the separate `aios-browser-local` identity, keyring
service, agent workspace and native app identifier. It does not borrow the
packaged pilot's identity or production Buzz credentials. Its own saved profile
and relay data persist between launches. Normal OS keyring access remains in
force. Model/provider setup belongs to this profile; a browser tab is not a
way to inherit the user's Codex account or private tool credentials.

Vite serves the app on 127.0.0.1:1437. A hidden debug-only native companion
listens on 127.0.0.1:1438 and invokes the existing Tauri command handlers, with
the app's main-window capabilities. It starts only after persisted identity
resolution and native setup. No alternative business store or mock bridge is
used. Native file pickers still run on this computer; arbitrary native file URLs
are not exposed to the browser.

A server-side proxy owns a random bearer token in a private temporary file.
It never enters the browser bundle, URLs or normal logs. Both proxy and native
transport enforce exact loopback Host and Origin; requests must be JSON POSTs.
Sessions, listeners, event queues, request sizes and concurrent operations are
bounded. Socket ownership and disconnect are scoped to the browser session.
A lost live-update connection preserves the page and displays recovery advice.
Multiple tabs share the same native active workspace; use one working tab when
switching communities or identities.

This is a local development companion, not an authenticated production web
server. Do not put Vite or the native bridge behind a public tunnel. A browser-only
self-hosted installation needs its own deployment and authentication boundary;
that remains separate work. Release builds exclude this development transport.

## Verification

With the real launcher and relay running:

```sh
node desktop/scripts/browser-api-smoke.mjs
```

This exercises the real backend, origin/session denial, captured relay/signer
scope on membership and people-search commands, native event roundtrip,
per-tab socket ownership and channel completion. Rejected membership requests
target a random nonexistent context. It uses temporary transport sessions,
does not create business data, and logs no keys or identity values.
Deterministic mocked browser regressions are still useful; they are not proof
of real persistence or model execution. Current manual evidence and limits are
recorded in [Status](STATUS.md).
