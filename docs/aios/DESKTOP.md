# Local desktop pilot

The pilot uses Buzz's native desktop with a separate app identity, keyring,
agent workspace and deep-link scheme. It connects to the self-hosted relay at
`ws://127.0.0.1:3341`. The existing Buzz installation is independent.

```sh
scripts/aios-desktop doctor
scripts/aios-desktop build
scripts/aios-desktop open
```

After packaging, double-click `deploy/aios/Open AIOS.command` to open the app.
If the configured local server is stopped, the launcher starts it with the
existing data, waits for health, and then opens the app. Docker must be running;
first-time server setup is still required. The launcher never resets accounts,
model credentials or data.
See [self-hosting](SELF_HOSTING.md) for first-time setup, stop and restore.

`build` packages a local debug `.app` and refreshes all six bundled agent/CLI
tools from this checkout. It is a development build, not a notarized public
release or an automatic update channel. The launcher applies and verifies an
ad-hoc local signature after packaging; no Apple signing account is required.
The bundle's `Contents/Resources/aios-build.json` records the source revision,
whether the checkout had changes, and the build time. Build tools are pinned by Hermit and
the dependency lockfiles. The app bundle is under
`desktop/src-tauri/target/debug/bundle/macos/AIOS Pilot.app`.

The launcher enables the native `mesh-llm` feature so local model sharing and
client controls are present in the pilot. Sharing remains an explicit choice
in Settings. The runtime and selected model are installed on demand; see
[Mesh](MESH.md). A successful default-feature build alone does not verify that
this optional capability was packaged.

For development, `scripts/aios-desktop dev` uses Vite on port 1437 and the same
isolated pilot identity. Close a running pilot before starting another copy.
Model and tool credentials are configured in the app, never compiled into it.
The launcher clears inherited test identity and production update settings.

The scripts target this macOS pilot. Other operating systems and publicly
distributed installers retain the upstream build workflows; they have not
been verified for this fork. Current observed packaging and runtime results
are recorded in [STATUS](STATUS.md).
