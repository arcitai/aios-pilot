---
name: AIOS Pilot
version: 2
---

# A quiet business workspace

Gustav's direction, reaffirmed 24 September 2026: preserve the actual Buzz
look and conversation experience, with minimal visual noise. The audience is
nontechnical people doing business work. The main agent is the home base;
context, connections and useful apps support that conversation.

On 24 September Gustav corrected the information architecture: Business is
the knowledge page, Plugins sits immediately below it in the main sidebar,
and apps attach to channels. Welcome owns conversational onboarding. Keep
Buzz's visual identity; use the four supplied Codex Plugins/Skills screenshots
for a searchable library, quiet installed rows and a small category switch.
The Linux Codex wrapper is a reference, not reusable source for Codex's UI.

## Reference and identity

Use the fork's existing Buzz components, Inter typography, theme tokens,
sidebar gradient, soft surfaces and restrained borders. The source is
block/buzz at 5621006bcf84b82e5da489824a5b4d76568d8602, retained with its
license and attribution. Existing working UI and inspected browser captures
are the reference, not a separately invented theme. Kylon informs onboarding
and platform behavior; it does not replace Buzz's visual identity.

## Hierarchy and composition

- Make the current task and its next action obvious. Keep one primary action
  in each active task area, with secondary actions visually quieter.
- Put conversations and actual work ahead of settings, status tiles and copy.
- The main sidebar is the global navigation. No Business top bar containing
  Main agent, Context, Sources, Connections and Apps. Context and sources are
  Business content/detail views. No permanent extra app sidebar by default.
- A channel may have its own named document/app tabs beside Conversation.
  This is local resource navigation, not a second product navigation bar.
- Plugins can group Connections and Skills inside its own library. Installed,
  connected and assigned describe different states and must not be conflated.
  Agent creation/editing owns selection of permitted tools, accounts and skills
  from this same library. Inline connection setup preserves the agent draft;
  users should not need a competing assignment flow elsewhere.
- Use ordinary spacing and dividers before introducing another card. Avoid
  repeated headings, icon boxes, success banners, badges and explanatory text.
- Keep setup, connection details, revision IDs, export formats and code behind
  explicit controls. Show them when needed to fix a problem or make a choice.
- Use familiar words in product UI. Canvas, signer, relay, schema, keyring,
  tombstone and command-line examples belong in operator details or docs.
- Keep input text readable; do not create visual quiet by shrinking everything.

## States and interaction

Use compact save feedback. Keep failures and recovery actions visible next to
the relevant task. A collapsed advanced section must not conceal the only
retry. Explain real capability limits at the affected action, without repeated
warning panels. Never use an attractive empty state to imply working behavior.

Preserve keyboard focus, native labels and visible focus rings. Status requires
text as well as color. Dirty drafts survive switching tools and require an
explicit decision before replacement. Avoid motion unrelated to feedback and
respect reduced-motion settings.

## Responsive behavior

Judge available content width, not only viewport width: Buzz already has a
sidebar, and Apps has its own tool navigation. Collapse secondary navigation
and arrange controls in natural reading order before the content becomes
cramped. Tables and code may scroll inside their own boundary. The overall app
must not gain horizontal overflow. Check typical laptop, wide and narrow views.

## Implementation and review

Use the real application in localhost during development. Mock-bridge tests
remain useful for deterministic failures but are not proof of real persistence
or agent execution. Desktop packaging is deferred until the product is ready.

The lead applies the installed Design and Review design skills after functional
integration, inspecting onboarding, conversation, context, sources, connections,
agent setup/skills, app editing, Sites, tables, workflows and voice states.
Inspect real interactions and capture meaningful comparable desktop/narrow
views. Record findings and remaining limitations in docs/aios/STATUS.md, repair
in scope, and refresh affected proof. No extra owner approval is introduced.

Plugins is workspace-owned, independently of Business. Included instruction packages
and runtime skill-discovery support remain distinct. Phase one shows supported
local adapters and bundled skills; host catalog management and per-agent account
grants arrive with the permission model, not as inactive controls.
