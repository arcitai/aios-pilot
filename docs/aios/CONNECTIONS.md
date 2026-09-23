# AIOS business connections

This pilot adds one usable external provider: a local, read-only GitHub
connection for importing repository READMEs as business-context sources. The
connection is optional and remains on the desktop device.

## GitHub setup and permissions

The current sign-in path accepts a user-created fine-grained personal access
token (PAT). Limit it to the repositories Buzz should read and grant only:

- Repository permissions: **Metadata: read** to list accessible repositories.
- Repository permissions: **Contents: read** to fetch a selected README.

No write permission is used or requested. The adapter calls `GET /user` before
it stores a token and before it reports a saved token as connected. It reads
only the account login from that response. GitHub may reject a request when an
organization requires approval or the token does not cover the selected
repository; Buzz shows that request as an error and does not claim the
connection is usable.

The API origin is fixed to `https://api.github.com`. Authenticated requests do
not follow redirects. Requests time out after 10 seconds, connect attempts
time out after 3 seconds, and response bodies are streamed under limits. The
repository list is limited to the first 25 accessible repositories ordered by
recent update. Import rechecks that the selected repository ID appears in that
list, reads its README through the GitHub API, and rejects content over 256 KiB.
The imported source URL is constructed on `github.com`; provider-supplied
download URLs are never fetched.

## Local credential handling and scope

PATs are stored through Buzz's native `SecretStore` in the OS keyring. Keyring
entries are namespaced by the active Buzz relay URL, active Nostr identity
public key, provider, and namespace version. Every command derives the active
scope from native `AppState` and rejects a caller whose expected relay or
signer does not match. Async operations recheck the native scope before
returning data. The adapter uses the existing `SecretStore::shared` instance
and `keyring_service()` selection, including the per-demo service, rather than
creating another store or falling back to the default keyring service.

Disconnect removes only the current community and identity's GitHub keyring
entry. It does not revoke the PAT at GitHub; revoke the token separately in
GitHub settings when desired. Credentials are not written to browser storage,
logs, canvases, Buzz messages, or shared context. They are not shared between
devices or sent to an agent. The shared business-context backend remains a
separate integration point; it has no credential-vault role in this pilot.

## Desktop surface

`BusinessConnectionsPanel` is exported from
`desktop/src/features/business-connections`. Its caller supplies
`onImportSource`, which receives `{ title, content, url?, kind: "url" }` only
after a user chooses a listed repository and selects **Import README**. The
caller remains responsible for storing that source through the shared business
context contract. The optional `onConnectionStatus` callback reports GitHub as
`connected` only after native `/user` verification; `checking`, `not_connected`,
and `unknown` carry `verified: false` so unverified workspace descriptors cannot
claim an active connection.

Google and Notion appear only as **Planned** catalog entries. They have no
connection commands or credential paths yet. The GitHub adapter is read-only;
it does not create repositories, push commits, edit files, or interact with
issues or pull requests.

The token form is a bootstrap path, not a polished sign-in flow. A future
browser-free sign-in flow needs configured GitHub OAuth App or GitHub App
client details, a public-client PKCE flow, and a registered native redirect
path. Do not embed an OAuth client secret in the desktop application.

## Local verification

Adapter tests use a local fixture HTTP service and an injectable in-memory
credential store. They do not contact GitHub or use real PATs. Live provider
access is unverified until a user supplies a token in the desktop UI.

References: [GitHub REST API: list repositories for the authenticated user](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user),
[GitHub REST API: get a repository README](https://docs.github.com/en/rest/repos/contents#get-a-repository-readme),
and [GitHub credential security guidance](https://docs.github.com/en/rest/authentication/keeping-your-api-credentials-secure).
