# Source ownership and development handoff

This application is maintained by Arcitai at https://github.com/arcitai/aios-pilot.
It is a separate open-source product developed from Buzz, using AIOS Pilot as a
working name. The personal AIOS plugin is maintained separately and is not part
of this application's installation.

Upstream: https://github.com/block/buzz, initial fork reference
5621006bcf84b82e5da489824a5b4d76568d8602. Apache-2.0 and upstream attribution remain
in effect; Arcitai's changes do not imply upstream endorsement. Internal Buzz
crate and command names are retained where required for the existing software.

The development checkout and preserved work are on the Z13 under
`/home/gustav/Developer/aios-pilot`, with a separate recovered native-context
worktree. The migration preserves existing commits and work in progress. The
`migration/z13-wip` branch is an explicitly unverified checkpoint, not a release.
No private workspace data, saved account identity, model credentials, personal
AIOS home or exported Codex conversation history belongs in this public repo.

Development is ready for a later explicitly started Software & Defence Factory
job. The migration does not launch that work. The pre-existing implementation
status remains in STATUS.md; source publication alone is not validation of the
pending native integration or scoped-media changes.

Inherited upstream automation is disabled at the repository level pending an
Arcitai-specific review. No upstream publishing credentials or release authority
are transferred with this repository.
