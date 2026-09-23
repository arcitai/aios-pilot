# AIOS Sites & webapps

AIOS Sites provides a small workspace for building static business sites and
webapps in Buzz. Drafts are private Buzz channel canvases, so they inherit
Buzz's revision history and can be edited by the Buzz UI, CLI, or an authorized
agent. Preview and public hosting are handled by a separate, self-hosted static
publisher.

## Workspace and document format

Each site uses its own private stream channel. The channel description contains
an exact parent-business-channel marker:

```text
AIOS private site workspace for business channel <parent-id> [aios.site-channel:v1]
```

The Sites list only includes channels that are active, private streams, joined
by the current identity, and marked for the selected business channel. Creating
a site does not copy members from the business channel. Access to the document
and its history is controlled by the site's private channel membership.

The canvas stores one strict JSON document. Its fixed v1 files are `indexHtml`,
`styleCss`, and `appJs`:

```json
{
  "schemaVersion": 1,
  "kind": "aios.site",
  "siteId": "<private-site-channel-id>",
  "parentBusinessChannelId": "<business-channel-id>",
  "title": "Example site",
  "files": {
    "indexHtml": "<body markup>",
    "styleCss": "<inline CSS>",
    "appJs": "<inline JavaScript>"
  }
}
```

Each text field is limited in UTF-16 code units, matching JavaScript string
length and browser editor limits: title 120, HTML 120,000, CSS 80,000, and
JavaScript 80,000. The complete serialized document is limited to 200,000
UTF-8 bytes. A title with 100 Danish letters such as `æ` uses 100 field units
even though it takes 200 UTF-8 bytes. Desktop, native publisher requests, the
CLI, and the publisher service share these limits. Unknown fields and
unsupported schema versions are rejected. If a canvas is malformed, the editor
leaves it untouched and offers the original content as a download.

Canvas writes use the existing compare-and-set revision. A stale save is
reported as a conflict, the latest version is loaded for comparison, and the
draft is retained until the owner chooses to use the latest version or
explicitly overwrite it. History selection loads a past document into the
current draft; saving it creates a new revision rather than rewriting history.

Agents and CLI users can use the same saved document contract:

```sh
buzz sites list --business-channel <business-channel-id>
buzz sites show --business-channel <business-channel-id> --site-channel <site-channel-id>
buzz sites update --business-channel <business-channel-id> --site-channel <site-channel-id> \
  --expected-revision <canvas-event-id> --document - < site.json
buzz sites export --business-channel <business-channel-id> --site-channel <site-channel-id>
```

The update document is the complete strict `aios.site` v1 JSON object shown
above. Its `siteId` and `parentBusinessChannelId` must exactly match the two
explicit channel flags. Updates require the current canvas event ID (or
`none` only when no canvas head exists); Buzz preserves accepted writes in
canvas history. A direct CLI or agent edit can cause an editor conflict if it
changes the head while the UI has a draft open.

## Preview and publishing

The standalone HTML export embeds the three files in one `.html` download. It
does not publish the site. Preview, publish, and revoke are separate explicit
actions.

The publisher has two HTTP listeners:

| Listener | Default bind | Purpose |
| --- | --- | --- |
| Public | `127.0.0.1:3351` | Published sites and temporary previews |
| Management | `127.0.0.1:3352` | Token-protected health, preview, publish, status, and revoke APIs |

The local desktop defaults to `http://127.0.0.1:3352` for management. Remote
publisher origins must use HTTPS. The public origin is independently
configured with `AIOS_SITES_PUBLIC_ORIGIN`; remote deployments must set it to
their public HTTPS origin so returned URLs point to the correct host.

Preview creates an opaque, in-memory URL on the public listener. A preview
expires after 30 minutes; the service allows at most eight live previews and
2 MB of aggregate preview data. Previews are not saved to the published-site
store. The desktop embeds only `http://127.0.0.1:3351/previews/<32-hex-id>` in
an iframe with `sandbox="allow-scripts"`, no `allow-same-origin`, and no
referrer. Other preview origins open in the browser instead of being embedded.

The generated page response has a restrictive Content Security Policy: inline
page scripts and styles are allowed, while network connections, forms, nested
frames, plugins, base URLs, and access to the parent's origin are blocked. The
preview response allows only the Tauri desktop origins as frame ancestors. For
Vite and E2E development, set `AIOS_SITES_ENABLE_DEV_PREVIEW=1`; this
additionally allows `http://127.0.0.1:4173`, `http://localhost:1437`, and
`http://127.0.0.1:1437`. Public published responses deny framing.

Publishing sends a saved document snapshot to the management API. The service
stores the JSON under a content hash and atomically switches the site's active
pointer. It serves only the active snapshot as generated HTML; it does not
provide a general file server or accept customer-supplied paths. Publisher
storage retains the active and immediately previous snapshots per site; older
objects are pruned on publish. Buzz canvas history remains the durable edit
history. Revoke writes a tombstone, after which the native adapter verifies
that the public URL returns HTTP 404. Revoking does not change the private
canvas or its history.

## Publisher setup

Build and run the standalone service from this directory:

```sh
cargo build --release --locked
AIOS_SITES_ADMIN_TOKEN='<32-512 printable non-space ASCII characters>' \
AIOS_SITES_DATA_DIR='./aios-sites-data' \
./target/release/aios-sites-publisher
```

The service refuses to start without a valid operator token. It hashes the
token in memory and does not log request bodies or credentials. Management
requests require `Authorization: Bearer <token>` and do not enable CORS. The
Buzz native adapter validates the active community relay and signer, uses a
bounded HTTP client with redirects and ambient proxies disabled, and stores the
operator token in the OS keyring under a scope derived from publisher origin,
community, and identity. The UI keeps the submitted token only long enough to
connect and does not place it in browser storage.

For a container, the provided Dockerfile sets container mode and stores data
under `/data`. A host deployment should publish only loopback ports when used
locally, for example `127.0.0.1:3351:3351` and `127.0.0.1:3352:3352`. A remote
deployment needs a TLS reverse proxy for both listeners, separate operator
credentials, and an HTTPS `AIOS_SITES_PUBLIC_ORIGIN`. The service binds to
loopback by default; `AIOS_SITES_CONTAINER_MODE=1` permits container binds to
all interfaces. `AIOS_SITES_PUBLIC_BIND` and `AIOS_SITES_ADMIN_BIND` can set
explicit socket addresses. Keep the management listener behind an appropriate
private network or access gateway when it is remote.

## Native desktop wiring

The frontend entry point is `desktop/src/features/aios-sites/index.ts` and
exports `SitesWorkspace`. Its required props are the business channel ID,
expected relay URL, and expected signer public key; company name and dirty-state
callback are optional. The native command module exports these seven commands:

```text
sites_publisher_status
connect_sites_publisher
disconnect_sites_publisher
sites_publisher_preview
sites_publisher_site_status
publish_sites_site
revoke_sites_site
```

The host Tauri application registers those commands and adds
`http://127.0.0.1:3351` to the existing `frame-src` policy. The separate
publisher response policy remains responsible for constraining generated site
content. No preview uses `srcdoc`, and the Buzz app's script policy should not
be weakened to render generated code.

Sites currently supports self-contained static documents with inline HTML,
CSS, and JavaScript. It does not provide server-side routes, package installs,
custom build steps, secret injection, or unattended publication.
