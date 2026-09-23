# Built-in apps

`desktop/src/features/aios-apps/` owns the modular app registry, serializable
documents, editors, and persistence adapter. The desktop shell can mount the
workspace with:

```tsx
import { AppsWorkspace } from "@/features/aios-apps";
import type { CanvasScope } from "@/shared/api/canvasTypes";

function renderApps(
  channelId: string,
  companyName: string,
  companySummary: string,
  nativeScope: CanvasScope,
) {
  return (
    <AppsWorkspace
      channelId={channelId}
      companyName={companyName}
      companySummary={companySummary}
      nativeScope={nativeScope}
      onDirtyChange={setAppsDirty}
    />
  );
}
```

The lead checkout exposes native `CanvasScope` with required
`expectedRelayUrl` and `expectedSignerPubkey` strings. The parent passes that
render-captured object through the required `nativeScope` prop. The feature
never reads a fresh relay or signer after an await. Editors receive typed document values and
`onChange` callbacks. They do not own relay calls, identity, community context,
or storage. `AppsWorkspace` accepts an optional `documentStore` for an alternate
adapter. `onDirtyChange` stays true for unsaved document edits, an active save,
a failed save, or text in the unfinished Calendar form. All three editors stay
mounted while switching apps so transient drafts remain in place.

The root and app navigation expose stable Playwright selectors
`[data-testid="aios-apps-workspace"]` and
`[data-testid="aios-app-nav-slides|calendar|design"]`. The `documentStore` and
`nativeScope` props also provide a deterministic fixture seam for integrated
browser tests without adding a preview route.

## App documents and relay storage

The workspace snapshot and each app document have schema version `1`:

- `slides` stores a deck title and up to 20 editable slides.
- `calendar` stores up to 100 local events and an explicit
  `googleCalendarStatus: "not_connected"` value.
- `design` stores up to 100,000 characters of HTML.

Each app document is stored in its own private channel Canvas. The channel
description and the Canvas JSON both carry the exact marker
`aios.app-document:v1:<encoded-business-channel-id>:<app-id>`. This leaves the
business channel Canvas and its schema untouched. The adapter checks the
business-channel membership before setup, requires each app channel to be
private and include the active identity, and passes the expected relay and
signer to Canvas reads and writes. Writes use the current Canvas event ID as
`expectedRevision`; an empty Canvas uses the explicit `"none"` sentinel to
reject a competing first write instead of appending unconditionally. A bounded
100-scope LRU retains per-app Canvas revisions. If the document changed
concurrently, the editor keeps the current draft and offers a recovery download
or an explicit reload. When native Canvas reports that it accepted a write but
could not verify the resulting head, the workspace reports that state and
offers to load the latest version. Unsent autosaves are canceled when their
workspace unmounts or changes scope. A native write already in flight cannot be
canceled and may still complete after the parent discards the visible draft.

Private app-channel access is a separate ACL. Business-channel membership is
not inherited, and the app setup does not invite business-channel members.
Until a user is explicitly added to an app channel, that user cannot read its
Canvas. The current slice has no app-channel membership editor, so app
documents created by one identity remain private to that identity unless an
administrator manages the app channel separately. Do not describe these app
documents as team-shared by default.

The normal store is `CanvasAppDocumentStore`. `LocalAppDocumentStore` is only
offered after a relay load/save problem as an explicit device-only recovery
choice. Its single versioned snapshot key includes the relay URL, signer pubkey,
and business channel ID, plus community ID when the parent provides one; it
never stores unscoped business data.
The UI labels this mode “This device only”. It is not synchronized or backed
up by Buzz.

The adapter calls the relay/signer-scoped Canvas and private-channel APIs from
the lead integration. This isolated base clone predates their TypeScript
signatures, so it keeps narrow structural casts around those calls until the
branches are combined. Keep the app feature and Canvas scope changes together;
do not remove the scope fields to make an older native build compile.

## App flows

- **Slides** edits slide text and order, supports adding/removing slides, and
  exports a standalone HTML presentation file.
- **Calendar** renders a month and selected-day agenda, adds/removes events,
  and exports `.ics`. Events are local Buzz app data; Google Calendar is
  visibly not connected.
- **Design** edits HTML, previews it in a sandboxed iframe, and exports an HTML
  file. The preview removes scripts, forms, navigation links, URL-bearing
  attributes, and CSS network loads. The iframe has an empty `sandbox`
  attribute, an opaque origin, and a restrictive CSP. Export creates a file;
  it does not deploy a site.

The Tauri native CSP needs a narrowly scoped `frame-src` allowance for the
sandboxed `srcDoc` preview. This feature does not change `tauri.conf.json`;
verify the exact local asset origin and policy behavior in the native WebView
when integrating the app.

## Source provenance

The Agent Native Slides, Calendar, and Design templates were inspected for
their editor boundaries and domain flows. Their templates depend on separate
auth, database, and server stacks that are not part of Buzz's desktop surface.
No Agent Native source code or assets were copied, so no additional upstream
license notice is required. The implementation uses Buzz's installed React
controls, Lucide icons, Catppuccin theme tokens, and Inter typography.
