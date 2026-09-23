# AIOS business connections

Business connections provide optional, local, read-only access to external
business context. The current desktop pilot supports GitHub README imports,
Notion page search and text imports, and explicitly selected Slack channel
history imports. Google remains planned.

Each provider credential is stored in the Buzz OS keyring and scoped to the
active relay URL, Nostr identity public key, provider, and keyring namespace
version. Native commands compare the caller's captured relay and signer against
the active workspace before using a credential, then recheck the scope after
asynchronous provider requests. GitHub, Notion, and Slack actions share one UI
busy lock so provider operations cannot overlap.

## GitHub

The sign-in path accepts a user-created fine-grained personal access token.
Limit it to the repositories Buzz should read and grant only:

- Repository permissions: **Metadata: read** to list accessible repositories.
- Repository permissions: **Contents: read** to fetch a selected README.

Buzz calls `GET /user` before saving a token and before reporting a saved token
as connected. It reads only the account login. The API origin is fixed to
`https://api.github.com`; authenticated requests do not follow redirects,
connect attempts time out after 3 seconds, requests time out after 10 seconds,
and response bodies are bounded. The repository list is limited to the first
25 accessible repositories ordered by recent update. Import rechecks that the
selected repository ID is in that list and reads the README through GitHub's
API. Source text passed to the business workspace is capped at 40,000 UTF-16
code units. Longer text is shortened with a visible truncation marker and a
separate `truncated` flag. The source URL is constructed on `github.com`;
provider-supplied download URLs are never fetched.

## Notion

The current flow uses a Notion **internal integration token**. Create an
internal integration in the workspace, grant it only the **Read content**
capability, then share the pages to expose with that integration. Notion
integrations can read only content shared with them.

Enter the token in the Notion card. Buzz verifies it with `GET /v1/users/me`
before storing it and before reporting the saved connection as verified. The
UI receives only the integration's name and ID, not workspace user details or
email addresses. The token is stored locally in the same scope-specific OS
keyring as GitHub tokens.

Notion requests use the fixed `https://api.notion.com` origin, the
`Notion-Version: 2026-03-11` header, no redirects, a 3-second connect timeout,
and a 10-second per-request timeout. Search uses `POST /v1/search` with a
page-only filter, title query, and a page size of 25. The UI can continue with
the provider's opaque cursor; it cannot submit an arbitrary URL or block ID for
search. Search results are limited to pages accessible to the integration.

Import accepts only a selected page ID from the search list. Buzz verifies the
page through the API, then reads block children sequentially. It requests at
most 100 blocks per page, follows at most 8 child-list pages, traverses at most
2 block levels below the page, and processes at most 400 blocks. Each response
is limited to 512 KiB, the import's combined response budget is 4 MiB, and the
whole import stops after 20 seconds. Imported text is capped at 40,000 UTF-16
code units. If the combined response, depth, block, or pagination bound is
reached—or a non-text block such as an image or file is omitted—the content
includes a partial-import marker and the result reports `truncated: true`. An
individual response over 512 KiB or an import timeout returns an error. Text
is read from Notion's block text fields; Buzz does not download files, images,
embeds, or other linked resources. Buzz validates the page URL returned by
Notion against an official Notion host and the selected page ID. It stores
that URL as provenance only and never fetches it. The UI accumulates at most
100 unique page IDs across search pages; duplicate IDs update their metadata
without increasing the count. At the cap, it asks the user to narrow the search.

## Slack

Slack setup is a **manual bot token** connection. Create and install a Slack
app, add it only to channels the user may choose, then paste its bot token into
Buzz. The setup links in the card open Slack's app settings and token guide.
The adapter accepts bot tokens beginning with `xoxb-`; it rejects user tokens.
`auth.test` verifies the workspace before the token is stored, and status checks
verify the saved token again.

For public and private channels, request only these bot scopes:

- `channels:read` and `groups:read` to list and check channels.
- `channels:history` and `groups:history` to read recent channel messages.

The connection does not request message posting, user-token access, or channel
joining. The user must click **Browse channels**; Slack returns one page of at
most 100 non-archived public or private channels, and Buzz shows only channels
where the bot is already a member. The UI deduplicates channel IDs and caps the
accumulated list at 200. DMs are excluded. Import happens only after the user
chooses one displayed channel and clicks **Import recent messages**. Before
reading history, Buzz checks that the bot is still a member of that selected
channel.

Slack requests use the fixed `https://slack.com/api/` origin, bearer bot-token
authorization, HTTPS, and no redirects. The Web API uses method-specific
endpoints such as `auth.test` and `conversations.history`; it does not use a
Notion-style version header. `conversations.history` is called once for the
selected channel with a limit of 15. Messages are rendered in time order;
older pages, thread replies, file contents, attachment content, and non-text
content are not imported. If Slack indicates more history or omitted content
is detected, Buzz marks the import as partial. Responses are bounded to 64 KiB
for identity and channel checks, 1 MiB for a channel-list page, and 512 KiB for
history; a selected-channel import has a 20-second total deadline. Imported
text uses the shared 40,000 UTF-16-unit limit. The source URL is constructed
from the chosen channel ID and verified workspace ID using Slack's
`https://slack.com/app_redirect` channel link, then retained only as provenance.

## Credential handling and desktop surface

PATs, integration tokens, and Slack bot tokens use Buzz's native `SecretStore`
in the OS keyring.
The existing `SecretStore::shared` instance and `keyring_service()` selection
are used, including the isolated service for demo builds. Credentials are not
written to browser storage, logs, canvases, Buzz messages, or shared context.
They are not shared between devices or sent to an agent. Disconnect deletes
only the current relay, identity, and provider entry from the local keyring; it
does not revoke a GitHub PAT, Notion integration token, or Slack bot token at
the provider. The UI refreshes provider status after local disconnect. Revoke
the token at its provider separately when desired.

`BusinessConnectionsPanel` is exported from
`desktop/src/features/business-connections`. Its caller passes the relay and
signer captured by the rendered workspace as required `expectedRelayUrl` and
`expectedSignerPubkey` props. The caller supplies `onImportSource`, which
receives only `{ title, content, url?, kind: "url" }` after the user selects a
repository, page, or Slack channel and confirms import. The caller remains
responsible for storing that source through the shared business-context
contract. The optional `onConnectionStatus` callback reports a provider as
connected only after its native credential verification; checking,
disconnected, and unknown states carry `verified: false`.

## Local verification

Adapter tests use local fixture HTTP services and an injectable in-memory
credential store. They do not contact GitHub, Notion, or Slack and do not use
real credentials. Live provider access remains unverified until a user
configures a token in the desktop UI.

References: [Notion API versioning](https://developers.notion.com/reference/versioning),
[page object](https://developers.notion.com/reference/page),
[search pages](https://developers.notion.com/reference/post-search),
[retrieve a page](https://developers.notion.com/reference/retrieve-a-page),
[list block children](https://developers.notion.com/reference/get-block-children),
[pagination](https://developers.notion.com/reference/intro#pagination),
[retrieve the current user](https://developers.notion.com/reference/get-self),
[Notion internal integrations](https://www.notion.com/help/create-integrations-with-the-notion-api),
[sharing pages with connections](https://www.notion.com/en-gb/help/add-and-manage-connections-with-the-api),
[GitHub list repositories](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user),
[GitHub retrieve a README](https://docs.github.com/en/rest/repos/contents#get-a-repository-readme),
[GitHub credential security](https://docs.github.com/en/rest/authentication/keeping-your-api-credentials-secure),
[Slack Web API](https://docs.slack.dev/apis/web-api/),
[Slack bot tokens](https://docs.slack.dev/authentication/tokens/),
[Slack scopes](https://docs.slack.dev/reference/scopes/),
[Slack `auth.test`](https://docs.slack.dev/reference/methods/auth.test/),
[Slack `conversations.list`](https://docs.slack.dev/reference/methods/conversations.list/),
[Slack `conversations.info`](https://docs.slack.dev/reference/methods/conversations.info/),
and [Slack `conversations.history`](https://docs.slack.dev/reference/methods/conversations.history/).
