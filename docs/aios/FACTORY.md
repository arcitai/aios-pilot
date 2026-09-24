# Factory development

AIOS Pilot is an independent Arcitai application derived from Buzz. Its source
and CI live at [arcitai/aios-pilot](https://github.com/arcitai/aios-pilot).
Personal AIOS plugin installation or owner context is not a build dependency.

## Reproducible verification

Hermit pins the tools in `bin/`; `rust-toolchain.toml` pins Rust. JavaScript and
Flutter dependencies use their checked-in lockfiles. On Linux, install the
native prerequisites listed in `ops/factory.Dockerfile`, then run:

```sh
bash scripts/factory-check.sh
```

This installs the pinned JavaScript and Flutter dependencies and runs the existing
`just ci`: Rust formatting/clippy/unit tests, desktop lint/tests/build and Tauri
checks/tests, web checks/build, mobile checks/tests and repository policy checks.
Failures remain failures; a configured environment is not a passing product.
Relay/database changes additionally need the isolated integration proof described
in `TESTING.md`; never use a running personal workspace database as a fixture.

`ops/factory.Dockerfile` builds the Linux toolchain image. The verification command
creates writable Hermit, Cargo and Flutter caches in ignored `.factory-build/`.
During Factory verification, executable temporary files use the job's private
home outside the checkout. This avoids the non-executable `/tmp` mount without
letting isolated fixtures inherit the application's Git root or project hints.
Other read-only containers must likewise provide an executable `TMPDIR` outside
the checkout; ordinary host checks keep the operating system's temporary path.
Factory 0.3.4 or newer supplies `FACTORY_BASE_REVISION`; the entrypoint passes
that immutable candidate base to the existing file-size ratchet. It never uses
the candidate head as a substitute for a missing comparison base.
Git must support credential `authtype` (Git 2.46 or newer). Run containers with
`--init` so process lifecycle tests can reap orphaned children correctly.
Use a disposable checkout with sufficient disk, non-root execution, bounded CPU
and memory, and no operator credentials or Docker socket inside the job.

## Independent CI and delivery

`AIOS Pilot CI` runs relevant checks before PR merge and batches the complete
four-lane Linux matrix every three hours on main, at minute 37 UTC. There is
no additional push trigger. Scheduled/manual full runs retain every dependency
of `just ci` and disposable-database integration. **Run workflow** always runs
the full matrix; scheduled runs omit expensive work only when a successful
scheduled/manual full run already covers the same SHA. Failures remain eligible
for retry. GitHub may delay a schedule, and its workflow must exist on the
default branch before the timer becomes active.

For PRs, frontend/repository policy checks always run. Native desktop changes
also select native checks; mobile changes select mobile checks. Shared backend,
toolchain, build configuration and unrecognized paths conservatively select all
four lanes. The selector compares the recorded PR base with the tested merge
revision, includes deletions and fails on an unavailable base. A newer PR
revision cancels its obsolete run. Needed native compilation and relevant builds
still run before merge; the three-hour interval does not waive those checks.

The `AIOS acceptance` check requires every selected lane to pass. Full scheduled
or manual runs also store commit-labelled desktop/web build artifacts; use them
only together with that complete revision's acceptance result. A scoped PR pass
does not establish full-matrix or release readiness. Factory acceptance remains
the complete `bash scripts/factory-check.sh` gate.
These are not signed desktop installers. Signing, auto-update publishing and
production deployment need their own Arcitai destinations and release setup.
All 26 inherited Buzz workflows are disabled in this repository's Actions
settings; their source remains available for upstream comparison and policy tests.

## Preserved development

`migration/z13-wip` preserves the lead's in-progress changes. The separate native
agent-context worktree and specialist recovery branches remain independent until
their changes are reviewed and integrated. Do not assume an archived conversation
means every native or relay integration test has passed. Private migration
handoffs identify the remaining tests and exact source revisions.

Factory jobs start from committed source, use the CLI-supplied method/skills and
produce independently reviewed candidates. A passing candidate does not itself
merge, deploy or start further product work.

## Database integration without a shared Docker stack

Provision disposable PostgreSQL 17 and Redis 7 services, then set
`BUZZ_TEST_EXTERNAL_INFRA=1`, `DATABASE_URL` and `REDIS_URL` and run `just test`.
This explicit mode checks the actual services and migrates only the selected
fixture database. It does not read an operator `.env` or start the shared Compose
stack. Never point it at an existing workspace or production database. Without
this flag the established local development command remains unchanged.
