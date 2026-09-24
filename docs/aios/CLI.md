# AIOS workspace CLI

The bundled `buzz` executable covers business context, built-in apps, Sites,
agent management, skills, workflows and in-app call requests. Run a command
with `--help` to inspect its flags. Credentials come from the managed runtime
or the operator's private environment, never from a saved app document.

## Apps, Sites and calls

```bash
buzz apps list --channel <business-id>
buzz apps show --channel <business-id> --app slides
buzz apps update --channel <business-id> --app slides \
  --expected-revision <revision> --document slides.json

buzz sites list --business-channel <business-id>
buzz sites show --business-channel <business-id> --site-channel <site-id>
buzz sites update --business-channel <business-id> --site-channel <site-id> \
  --expected-revision <revision> --document site.json

buzz calls request --channel <conversation-id> --wait-seconds 45
```

Apps are individually private. Open the app in Desktop and invite the intended
agent before asking it to change the document. `apps create` is also available,
but creates a workspace owned only by the caller. See [Apps](APPS.md) for the
data contract and [Sites](SITES.md) for preview, export and publication.
Updating or exporting a site does not publish it. Calls require a managed
local runtime with its owner authorization and current startup nonce; the
owner must accept before voice starts. See [Voice](VOICE.md).

## Business context

`buzz business` reads and updates the same version-one business document used
by Buzz Desktop. It stores that JSON in a dedicated private channel canvas and
uses Buzz's signed Nostr event and relay membership paths.

## Discover and read selectively

All commands use the current relay and signing identity. Company knowledge is
independent of the working conversation. Start with metadata-only discovery:

```bash
buzz business discover
buzz business index --channel <context-id>
buzz business search --channel <context-id> --query "brand tone" --limit 5
buzz business read --channel <context-id> --entry <entry-id> --limit 2000
```

`discover` returns `{canonical_context_id, contexts}`. Each context reference has
an ID, name and `registered` flag; no Canvas text is returned. Prefer an explicit
selected context, otherwise the canonical reference. Multiple old contexts do
not imply that an agent should choose one. No accessible canonical reference is
a visible setup/access prerequisite, never an instruction to self-grant access.

`index`, `search` and `read` return `{context_id, revision, result}`. Index entries
contain IDs, titles, character counts and available provenance without bodies.
Search matches one to eight literal whitespace-separated terms, case-insensitively,
in titles/text, in document order. It returns at most 20 hits, 300-character
excerpts, and a total match count. `title_only` means the excerpt is opening text
rather than a body match. It is lexical retrieval, not semantic search.
`read` returns at most 4,000 Unicode characters from exactly one entry. Company
entry IDs include `company:summary` and `company:goals`; source IDs have a
`source:` prefix. Preserve the IDs returned by the index.

For pagination, pass `next_offset` as `--offset` and the result's revision as
`--expected-revision`. Continuing without the revision fails; a changed revision
returns a conflict. Restart rather than combining pages from different versions.
Every lookup refreshes membership and the current snapshot. Revocation is an
error, not an empty successful result. The full document is fetched internally
under the caller's identity; only selected output reaches the CLI response.
These commands do not imply that agent setup grants or full-context loading
preferences have already been implemented.

## Explicit host registration

A host with typed context support can register an existing private Business
resource without rewriting its document or membership:

```bash
buzz business adopt --channel <context-id>
```

The relay must authorize both host administration and context administration.
Registration uses a signed metadata event and verifies the typed reference on
readback. A retry for the same ID is idempotent; an existing different canonical
ID is a conflict. An acknowledged write without verified readback is reported as
unknown delivery, not success. Retry with the same ID. An older relay may accept
the event without supporting the resource tag; that remains unverified.
Registration never grants company data to more people or agents.

## Initialize and inspect

```bash
buzz business init \
  --name "Northstar Studio" \
  --website "https://northstar.example" \
  --summary "A small design studio for independent retailers" \
  --audience "Independent retailers"

buzz business show --channel <channel-id>
```

`init` reuses an accessible canonical context when one exists. Otherwise it
trims the supplied company name and creates or finds a private stream with the
exact legacy Desktop marker, then writes the initial version-one document.
It does not implicitly register a canonical host reference. The
channel is named after the trimmed company name, or `My business` when the
company name is empty; the document keeps an empty name in that case. Repeated
`--offer` and `--goal` flags are joined with newlines into the corresponding
text fields. The JSON result includes `channel_id`; use that ID for every later
command. Repeating `init` for the same company leaves a valid document
unchanged. If the matching marked channel exists but its canvas is empty,
`init` fills it. A malformed canvas, archived workspace, duplicate matching
channel name, or ordinary channel using the generated name stops before any
canvas write. Run `init` deliberately when creating a workspace; agents should
use the channel ID from their current business context instead of initializing
one.

Every `show`, `export`, `update`/`import`, and `source` command requires an
explicit channel selector. This lets one identity work with multiple company
workspaces without accidentally selecting one. The selector may appear before
or after the operation's other flags:

```bash
buzz business show --channel <channel-id>
buzz business source list --channel <channel-id>
```

The CLI verifies the canonical Business resource type, or the exact legacy
marker when no resource type exists. Unknown resource types cannot fall back to
the marker. The selected resource must be private, unarchived and include the
current signer as a member. Relay denials
remain errors. The channel's private membership is the access boundary; the
CLI does not add finer-grained source permissions.

## Import, update, and export

`update` and `import` replace the full document after validating it. Input is a
UTF-8 JSON file; pass `-` to read from stdin. `export` prints compact JSON that
can be imported by Buzz Desktop or the CLI, or writes it to a path:

```bash
buzz business export --channel <channel-id> --output business.json
buzz business update --channel <channel-id> --file business.json \
  --expected-revision <revision-from-show>
buzz business import --channel <channel-id> --file - \
  --expected-revision <revision-from-show> < business.json
buzz business export --channel <channel-id>
```

`show` returns `{"channel_id":"…","revision":"…","document":{…}}`.
Pass the returned `revision` with every agent-authored update/import and source
mutation. The flag is optional for a human edit, but when supplied the CLI
checks it against the current head before writing; the relay then enforces the
same revision as a compare-and-swap precondition.

The contract is strict. Unknown fields, unknown schema versions, malformed
timestamps or URLs, duplicate IDs, and documents over 200,000 UTF-8 bytes are
rejected. The same byte bound applies to file/stdin reads before parsing.
Individual field bounds use UTF-16 code units, matching JavaScript string
length, Zod `.max()`, and HTML `maxlength`: company name 300 (and may be
empty), website 2,000, and summary, audience, offers, and goals 12,000 each;
up to 100 sources with IDs up to 128, titles up to 300, and content up to
40,000; and 50 connections with IDs up to 128, provider names up to 100, labels
up to 300, and details up to 2,000.
Source and connection IDs must be unique within their own collections. Optional
source URLs are limited to 2,000 UTF-16 code units and must be valid absolute
URLs starting with lowercase `http://` or `https://`. Omitted URLs and details
are accepted; explicit `null` is rejected.
Timestamps must be ISO-8601/RFC 3339 strings.
Shared valid and invalid cross-language JSON fixtures live in
`crates/buzz-business/tests/fixtures/`.

```json
{
  "schemaVersion": 1,
  "kind": "aios.business-workspace",
  "company": {
    "name": "Northstar Studio",
    "website": "https://northstar.example",
    "summary": "A small design studio",
    "audience": "Independent retailers",
    "offers": "Brand design",
    "goals": "Sign five new clients"
  },
  "sources": [
    {
      "id": "source-1",
      "title": "Customer interview notes",
      "kind": "note",
      "content": "Retailers need seasonal campaign support.",
      "createdAt": "2026-09-23T12:00:00Z"
    }
  ],
  "connections": [
    {
      "id": "connection-1",
      "provider": "google_drive",
      "label": "Research folder",
      "status": "not_configured"
    }
  ]
}
```

The schema has no credential fields; never put secrets in company text, source
content, connection details, or exported documents. Unknown fields such as
tokens or passwords are rejected. The CLI has no provider authentication
operation: it rejects adding a `connected` status or changing a connection to
`connected` unless that same ID and provider were already connected in the
stored document. Existing status values can round-trip unchanged. As a result,
an import from another workspace that contains a `connected` descriptor must
have that status changed to `not_configured` or `error` first; importing it does
not authenticate a provider.

Every edit uses the canvas `expected-revision` compare-and-swap. If another
writer changes the document after it is read, the CLI returns a conflict
(process exit code 5) instead of replacing that writer's changes. After a
conflict, inspect `buzz business show` and reapply the intended edit.

## Source records

Sources can be listed, added, and removed independently. `source add` generates
an ID and an ISO-8601 timestamp. Use `--content -` to read source text from
stdin:

```bash
buzz business source add --channel <channel-id> \
  --kind note \
  --title "Customer interview" \
  --content "Retailers want a simpler way to plan seasonal campaigns." \
  --expected-revision <revision-from-show>

cat interview.txt | buzz business source add --channel <channel-id> \
  --kind file \
  --title "Interview transcript" \
  --content - \
  --expected-revision <revision-from-show>

buzz business source list --channel <channel-id>
buzz business source remove --channel <channel-id> \
  --id source-1 \
  --expected-revision <revision-from-show>
```

All output is JSON on stdout. Errors use the CLI's structured JSON stderr
format. Set `BUZZ_PRIVATE_KEY` and, when needed, `BUZZ_RELAY_URL` as for other
relay-backed `buzz` commands.
