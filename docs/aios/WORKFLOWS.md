# Workflows

Workflows run a saved YAML definition against an event, schedule, webhook, or
manual trigger. A run records its status and step trace. See [Desktop
features](FEATURES.md) for the broader workflow surface.

## Approval gates

Use `request_approval` to stop a run until an authorized channel member makes a
decision:

```yaml
steps:
  - id: review-release
    action: request_approval
    from: "@Release Manager"
    message: "Approve release {{trigger.text}}?"
    timeout: 4h
  - id: publish
    action: send_message
    text: "Release approved."
```

`from` accepts `any`, a channel role (`role:admin`, `owner`, `member`, `guest`,
or `bot`), a public key in hex or `npub` form, or an exact channel-member
display name with an optional leading `@`. Role checks use the member's current
role when they act. A display name or public key is resolved when the request
is created; ambiguous names and users outside the channel do not become
approvers. `from` is fixed in the workflow definition and cannot use trigger
templates. The request `message` may use templates.

The default timeout is 24 hours. Timeouts must be positive and cannot exceed 30
days. The approval request, saved workflow definition, and run's
`waiting_approval` state are written atomically. The API returns an
`approval_ref` for Desktop to submit; the database stores only the hash of the
random token. The relay checks the signed actor, current membership in the
request's original channel, the saved approver policy, and the community-scoped
approval reference before accepting a decision.

Pending requests appear on the selected run in the Desktop workflow detail
panel. Approve and deny commands are saved in the same database transaction as
the signed command event. A denial immediately fails the run with
`approval_denied`, so no later step runs. Expiry changes the request to
`expired` and fails the waiting run with `approval_expired`.

Each grant can claim one resume across relay instances. An unclaimed grant is
recovered after a restart. The worker renews a two-minute lease while it runs;
if the lease expires after a process interruption, the run fails with
`approval_resume_interrupted` and is not replayed automatically. This is an
at-most-once boundary: if the process stops after a resumed step caused an
external effect but before the run records that step's result, the run fails
for review rather than risking a duplicate effect. Start a new run to retry.

An invalid approver, missing channel context, or persistence failure fails the
run with an explicit `approval_*` error code. Editing the workflow after a
request does not change the saved definition used for that run's resume.
