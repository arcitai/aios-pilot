# Pi adapter integration

Buzz uses the [buzz-pi-acp fork](https://github.com/salman1993/buzz-pi-acp).
Install Node.js 22 or newer, configure Pi, and install the latest development
adapter from the fork's `main` branch:

```sh
npm install -g @earendil-works/pi-coding-agent
pi
npm install -g --install-links=true 'git+https://github.com/salman1993/buzz-pi-acp.git#main'
```

This test setup intentionally tracks `main`; the Desktop runtime catalog pins a
reviewed adapter revision for users.

Make sure `pi` and `buzz-pi-acp` are on PATH, then restart Buzz.

## Tests

```sh
cargo test -p buzz-acp
```

Managed agent sessions may already export harness options. Clear them when
running the package suite: three CLI parsing tests assert the unset defaults,
and inherited values would change the inputs those tests exercise. Running the
package serially also avoids scheduling flakes in existing short-deadline tests.

```sh
env -u BUZZ_ACP_ALLOWED_RESPOND_TO \
  -u BUZZ_ACP_LAZY_POOL \
  -u BUZZ_ACP_IDLE_POOL_SLEEP \
  cargo test -p buzz-acp -- --test-threads=1
```

The ignored permission relay fixture exercises an encrypted ACP permission
request through the local relay, an owner decision back to the agent, and one
temporary marker-file effect. It generates fresh test keys and does not reset
relay state. Run it only against an isolated test relay (the default is
`ws://127.0.0.1:3341`); set `BUZZ_PERMISSION_TEST_RELAY_URL` to override it:

```sh
BUZZ_PERMISSION_TEST_RELAY_URL=ws://127.0.0.1:3341 \
  cargo test -p buzz-acp encrypted_relay_permission_decision_runs_exactly_one_fixture_effect \
  -- --ignored --nocapture --test-threads=1
```

Run the ignored real-adapter test with a built fork checkout:

```sh
BUZZ_TEST_PI_ACP=/absolute/buzz-pi-acp/dist/index.js \
  cargo test -p buzz-acp real_pi_preserves -- --ignored
```

## Git bootstrap

`cargo test -p buzz-acp --test git_bootstrap` starts the actual harness with a
probe adapter, runs real signed commits/tags and scoped credential resolution,
and verifies key cleanup on startup failure and SIGTERM. No relay is contacted.

To exercise the real runtime boundaries on Unix:

```sh
cargo build -p buzz-acp -p buzz-agent -p buzz-dev-mcp
BUZZ_TEST_BIN_DIR="$PWD/target/debug" cargo test -p buzz-acp git_runtime_tests -- --ignored --nocapture
```

The Buzz Agent test uses a deterministic local OpenAI-compatible response to
invoke the actual MCP shell. The Goose test requires an installed, configured
Goose and uses its provider to invoke the native developer shell. Both operate
only on temporary local repositories, verify commit/tag signatures and identity,
check unrelated-remote credential scoping, and assert keyfile removal. They do
not replace authenticated relay clone/push/readback testing.

## Browser MCP loopback fixture

After building `buzz-acp` and locating Buzz's managed Node executable, run the
opt-in macOS proof:

```sh
AIOS_TEST_ACP="$PWD/target/debug/buzz-acp" \
AIOS_TEST_BROWSER_NODE="/absolute/path/to/managed/node" \
python3 scripts/tests/test_aios_browser_mcp.py
```

The fixture starts a disposable loopback HTTP page and a headless Browser MCP
server in a private process group. First run downloads the pinned MCP package
and Chromium into a temporary data directory under the implementation's
overall provisioning deadline. The test verifies JSON-only stdio,
`browser_navigate`, and cleanup of the owned process group. It never connects to
a user browser or navigates to an external page.
