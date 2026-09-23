# Run the AIOS Buzz relay locally

This checkout has a local self-hosting stack built on Buzz's existing relay,
Postgres, Redis, MinIO, and Git services. The relay image is built from this
checkout's `Dockerfile`. Its only published port binds to `127.0.0.1`; the
database, Redis, MinIO, health, and metrics ports stay inside the Compose
network. The dedicated default Compose project is `aios-buzz-local`, with its
own network and named volumes. It does not share the root development stack's
containers or data.

The local relay accepts Nostr identities without a relay membership list so a
fresh desktop can connect. That open mode is safe only while the relay remains
loopback-only. Other processes on the same computer can reach it. Use the
hosted HTTPS steps below before making a relay reachable from a network.

## Requirements and first run

- Docker Engine, running, with Docker Compose v2.24.4 or newer.
- Python 3.10 or newer and OpenSSL (`openssl`) for local secret generation.
- Enough disk space for the Buzz Docker build, database, and uploaded media.

From the repository root:

```bash
scripts/aios-selfhost setup
scripts/aios-selfhost doctor
scripts/aios-selfhost start
scripts/aios-selfhost status
```

`setup` creates `deploy/aios/.env` once, with mode `0600`. It generates a
stable relay signing key plus distinct Postgres, Redis, MinIO, and Git-hook
secrets. It refuses to overwrite an existing file. Compose builds the relay
from this source checkout and publishes it at
`ws://127.0.0.1:3341` (HTTP requests use `http://127.0.0.1:3341`). Set a
different port with `scripts/aios-selfhost setup --port 3342` before setup.

The relay signing key is a Nostr protocol key, not a cryptocurrency wallet.
Buzz uses Nostr to sign and route messages; this setup does not need a
blockchain, token, hosted Buzz account, or third-party credentials. The relay
key is separate from each person's locally held Buzz identity.

For a local CLI smoke test, create a separate test identity:

```bash
scripts/aios-selfhost identity
```

It writes `deploy/aios/test-identity.env` with mode `0600`, prints only the
public key, and refuses to overwrite an existing identity. Use this identity
only with the isolated loopback relay. To load it for the CLI without putting
the secret directly into shell history:

```bash
set -a
source deploy/aios/test-identity.env
set +a
export BUZZ_RELAY_URL=http://127.0.0.1:3341
buzz channels list
```

The local relay starts in loopback-only open-membership mode, so this test key
needs no invite or server-side admission. Desktop relay-backed E2E can use the
repository's explicit fixture identities under `desktop/tests/helpers/bridge.ts`
against this stack only; do not reuse those fixtures with another relay.

The generated `.env` contains secrets and is ignored by Git. Keep it stable
across restarts and protect local copies. `doctor` checks its permissions,
Compose's resolved project/volume names, loopback binding, internal-only data
services, and whether Docker Engine is reachable. If the Engine is stopped,
start Docker Desktop (or the configured daemon) and rerun it.

## Connect Buzz Desktop or the CLI

In Buzz Desktop, choose **Add community** in the community rail and enter:

```text
ws://127.0.0.1:3341
```

The desktop stores a community's relay URL locally and connects to that relay.
For a custom port, use the URL printed by `scripts/aios-selfhost status` or
read `BUZZ_HTTP_PORT` from the private environment file. Create or use a local
Nostr identity in Buzz Desktop; no external wallet or hosted account is part
of connecting to this relay.

The Buzz CLI chooses its relay through `BUZZ_RELAY_URL` (or its `--relay`
option) and signs requests with the local `BUZZ_PRIVATE_KEY` identity. For
example, in a shell where `buzz` is already installed:

```bash
export BUZZ_RELAY_URL=http://127.0.0.1:3341
export BUZZ_PRIVATE_KEY='<your locally held Nostr secret>'
buzz channels list
```

The placeholder is not a real key; do not save a private key in shell history
or commit it. The relay endpoint is the only setting that chooses this
community. The user key is a signing identity, not a wallet.

## Stop and preserve data

```bash
scripts/aios-selfhost stop
```

This removes the project's containers and network but retains all named data
volumes. Starting again rebuilds the local relay image as needed. Do not add
`--volumes` or `-v` to Compose cleanup commands for a live data project.

The relay's messages, threads, channels, and event history live in Postgres;
Redis persists its append-only data; media lives in MinIO; relay-hosted Git
repositories have a separate persistent volume. The `backup` command stops
this isolated project briefly, archives all four volumes as one consistent
local snapshot, then restarts the services that were running:

```bash
scripts/aios-selfhost backup
```

Backups are created under `deploy/aios/backups/` with mode-restricted files.
They contain the private environment file and potentially sensitive relay
records. They are unencrypted; keep them local, restrict access, and do not
upload them to source control or a third-party service.

Restore always creates a new Compose project and fresh named volumes. Existing
volumes are never overwritten. For a local restore:

```bash
scripts/aios-selfhost restore deploy/aios/backups/<backup-directory>
```

By default this assigns a new project name and an available loopback port,
restores the data, builds the relay, and starts the new stack. To restore data
without leaving containers running, add `--no-start`. To choose a project name, add
`--project-name aios-buzz-recovered`. If any target volume already exists,
restore refuses to proceed; choose another project name so existing data stays
untouched.

A local restore uses a different loopback port so the source relay can remain
running. Since Buzz maps a local community to its host and port, restore moves
that mapping inside the fresh Postgres volume before starting the relay. With
`--no-start`, it starts only the isolated Postgres service briefly for this
update, then stops the project; all restored volumes remain in place.
Before extracting, restore rejects absolute or parent-traversing member paths
and archives containing symbolic or hard links. If a backup uses links, keep it
intact and use a separately reviewed recovery procedure.

## Continue the runtime from another checkout

After the self-hosting files and root `.dockerignore` are present in another
checkout, and if that checkout does not already have `deploy/aios/.env`, copy
the private environment from the checkout that owns the running `aios-buzz-local`
project:

```bash
install -m 600 /path/to/isolated-checkout/deploy/aios/.env deploy/aios/.env
scripts/aios-selfhost doctor
scripts/aios-selfhost status
```

The default project name resolves the same `aios-buzz-local` containers and
named volumes on this Docker Engine. Keep the copied environment values intact:
Postgres, Redis, and MinIO volumes depend on the credentials with which they
were initialized. Do not run `setup` to generate replacement credentials for
an existing project. Run `scripts/aios-selfhost start` only if that project is
stopped.

## Hosted HTTPS

The local commands deliberately do not open firewall ports. To host on a VPS,
first point a domain's DNS records at the server, allow inbound TCP 80 and 443
in its firewall, and prepare a separate private environment file. For example:

```bash
cp -p deploy/aios/.env deploy/aios/hosted.env
chmod 600 deploy/aios/hosted.env
$EDITOR deploy/aios/hosted.env
```

Set the public values in that file, including:

```dotenv
BUZZ_DOMAIN=buzz.example.com
RELAY_URL=wss://buzz.example.com
BUZZ_MEDIA_BASE_URL=https://buzz.example.com/media
BUZZ_MEDIA_SERVER_DOMAIN=buzz.example.com
BUZZ_CORS_ORIGINS=https://buzz.example.com
BUZZ_REQUIRE_AUTH_TOKEN=true
BUZZ_REQUIRE_RELAY_MEMBERSHIP=true
RELAY_OWNER_PUBKEY=<your operator identity's 64-character public key>
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443
```

Use the operator's public Nostr key for `RELAY_OWNER_PUBKEY`; keep its private
key separate from `BUZZ_RELAY_PRIVATE_KEY`. The first boot adds that owner to
the relay membership table. Select a published relay image or build the relay
from this checkout as shown here. Caddy obtains and renews HTTPS certificates
after the domain resolves to this host:

```bash
AIOS_ENV_FILE="$PWD/deploy/aios/hosted.env" docker compose \
  --project-name aios-buzz-hosted \
  --env-file deploy/aios/hosted.env \
  -f deploy/compose/compose.yml \
  -f deploy/aios/compose.yml \
  -f deploy/compose/compose.caddy.yml \
  up -d --build --wait
```

The TLS override removes the relay's direct host port and publishes Caddy on
ports 80 and 443. That is the explicit public-hosting step; do not use it for
the local-only setup. Back up the environment and all data before moving a
local relay to another project. Restoring to a new project preserves the old
volumes if the hosted deployment needs to be rolled back.

## Current boundary

This setup runs the relay and its persistent services. It does not provision a
VPS, DNS, TLS firewall rules, backups off the machine, hosted Buzz identity,
or managed agents. Media and Git data use the bundled MinIO and Git volume, not
an external S3 account. An unavailable Docker Engine means the runtime has not
started; successful secret generation or Compose parsing alone is not runtime
verification.
