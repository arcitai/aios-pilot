# Managed agent tool permissions

Buzz uses the ACP `session/request_permission` flow to ask the owner before a
managed agent runs a tool call. A request is shown only for the signed-in owner,
the currently selected community, and a ready managed-agent runtime. The prompt
stays mounted at the app level, so changing conversations does not hide it.

## Decisions

- **Approve once** returns the agent's ACP `allow_once` option for that single
  request. It does not create a remembered grant.
- **Deny** returns `reject_once` when the adapter offers it.
- Requests expire after 45 seconds. Expiry, cancelling the ACP turn, a missing
  owner prompt, or unavailable runtime identity fails closed. Buzz uses
  `reject_once` when available and otherwise returns ACP's `cancelled` outcome.
- Adapters without an `allow_once` option cannot receive an approval. Buzz
  responds with `cancelled` rather than selecting a broader permission option.

The in-memory decision is bound to the owner, managed agent, relay URL, runtime
start nonce, pool slot, ACP session, turn, and channel. The encrypted owner
control frame must match that complete binding and the current runtime's pending
request. A decision is consumed once; replays, stale requests, and decisions
from a previous runtime are rejected.

## Transport and request details

Requests and results use the existing encrypted agent-observer stream. Decisions
use its signed, owner-authenticated control path. No permission decision is
stored as agent configuration. The prompt displays the tool name, requested
action, and bounded request context. Common credential fields and token forms
are redacted before request context is emitted; this is a safety filter, not a
secret-scanning guarantee.

The app only presents requests from managed agents on the active community
relay. A request that belongs to another community remains unanswered and will
expire safely. When a runtime restarts, requests from its previous start nonce
are not offered to the owner.

## Explicit autonomous mode

ACP adapters may expose permission modes such as `auto`, `acceptEdits`, or
`bypassPermissions`. Selecting an adapter's autonomous mode is an explicit
opt-in and may allow tool calls without Buzz approval prompts. Buzz shows a
persistent in-app notice when a managed runtime reports `bypassPermissions`.

For direct harness launches, `--permission-mode bypass-permissions` or
`BUZZ_ACP_PERMISSION_MODE=bypassPermissions` explicitly selects bypass mode.
Managed desktop launches set the harness default to `default`, so an inherited
shell bypass setting does not silently make a managed agent autonomous.

## Limits

The broker is process-local, holds at most eight pending permission requests,
and keeps decisions only in memory. A request with missing owner, runtime,
observer, session, or turn identity is denied. This flow covers ACP adapters
that implement `session/request_permission`; it does not intercept tools that
an adapter executes without requesting ACP permission.
