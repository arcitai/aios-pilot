import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createCalendarEvent,
  createInitialAppsWorkspace,
  deserializeAppsWorkspaceDocument,
  MAX_APP_CANVAS_DOCUMENT_BYTES,
  MAX_CALENDAR_EVENTS,
  MAX_DESIGN_HTML_LENGTH,
  MAX_EVENT_DESCRIPTION_LENGTH,
  MAX_SLIDES,
  parseAppDocument,
  parseAppsWorkspaceDocument,
  serializeAppsWorkspaceDocument,
  sortCalendarEvents,
} from "./types.ts";
import {
  appCanvasExpectedRevision,
  appCanvasMarker,
  parseAppCanvasEnvelope,
  serializeAppCanvasEnvelope,
} from "./canvasDocument.ts";
import { LocalAppDocumentStore, appDocumentStorageKey } from "./storage.ts";
import { cancelPendingAutosave } from "./autosave.ts";
import {
  createCalendarIcs,
  createSandboxedPreviewDocument,
  createSlidesExportHtml,
} from "./htmlPreview.ts";

const CHANNEL_ID = "business-channel-17";
const FIXED_TIME = "2026-09-23T12:00:00.000Z";
const APP_DOCUMENT_CONTRACT = JSON.parse(
  readFileSync(
    new URL(
      "../../../../fixtures/aios-apps/app-document-v1-contract.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const SCOPE = {
  communityId: "community-a",
  expectedRelayUrl: "wss://relay-a.example",
  expectedSignerPubkey: "ab".repeat(32),
  channelId: CHANNEL_ID,
};

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("versioned app workspace round-trips and stays bound to its business channel", () => {
  const workspace = createInitialAppsWorkspace(
    CHANNEL_ID,
    "Northstar Studio",
    "A small design practice.",
    FIXED_TIME,
  );
  const serialized = serializeAppsWorkspaceDocument(workspace);
  const result = deserializeAppsWorkspaceDocument(serialized, CHANNEL_ID);

  assert.equal(result.ok, true);
  assert.deepEqual(result.document, workspace);
  assert.equal(result.document.documents.slides.schemaVersion, 1);
  assert.equal(result.document.documents.calendar.schemaVersion, 1);
  assert.equal(result.document.documents.design.schemaVersion, 1);
  assert.equal(
    deserializeAppsWorkspaceDocument(serialized, "another-business-channel").ok,
    false,
  );
});

test("document parser rejects unknown versions and oversized app collections", () => {
  const workspace = createInitialAppsWorkspace(CHANNEL_ID, "", "", FIXED_TIME);
  const unknownVersion = {
    ...workspace,
    schemaVersion: 2,
  };
  const versionResult = parseAppsWorkspaceDocument(unknownVersion, CHANNEL_ID);
  assert.equal(versionResult.ok, false);
  if (!versionResult.ok) assert.match(versionResult.reason, /version 2/);

  const tooManySlides = {
    ...workspace,
    documents: {
      ...workspace.documents,
      slides: {
        ...workspace.documents.slides,
        slides: Array.from({ length: MAX_SLIDES + 1 }, (_, index) => ({
          id: `slide-${index}`,
          title: "Slide",
          body: "Body",
        })),
      },
    },
  };
  assert.equal(parseAppsWorkspaceDocument(tooManySlides, CHANNEL_ID).ok, false);

  const tooManyEvents = {
    ...workspace,
    documents: {
      ...workspace.documents,
      calendar: {
        ...workspace.documents.calendar,
        events: Array.from({ length: MAX_CALENDAR_EVENTS + 1 }, (_, index) => ({
          id: `event-${index}`,
          title: "Event",
          description: "",
          startsAt: "2026-09-24T09:00:00.000Z",
          endsAt: "2026-09-24T10:00:00.000Z",
        })),
      },
    },
  };
  assert.equal(parseAppsWorkspaceDocument(tooManyEvents, CHANNEL_ID).ok, false);
});

test("calendar event creation validates time order and returns sorted events", () => {
  const invalid = createCalendarEvent(
    {
      title: "Planning",
      description: "",
      startsAt: "2026-09-24T10:00",
      endsAt: "2026-09-24T09:00",
    },
    "event-invalid",
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.reason, /after the start time/);

  const overlongNotes = createCalendarEvent(
    {
      title: "Planning",
      description: "n".repeat(MAX_EVENT_DESCRIPTION_LENGTH + 1),
      startsAt: "2026-09-24T09:00",
      endsAt: "2026-09-24T10:00",
    },
    "event-long-notes",
  );
  assert.equal(overlongNotes.ok, false);

  const early = createCalendarEvent(
    {
      title: "Earlier",
      description: "",
      startsAt: "2026-09-24T09:00",
      endsAt: "2026-09-24T09:30",
    },
    "event-early",
  );
  const late = createCalendarEvent(
    {
      title: "Later",
      description: "",
      startsAt: "2026-09-24T14:00",
      endsAt: "2026-09-24T14:30",
    },
    "event-late",
  );
  assert.equal(early.ok, true);
  assert.equal(late.ok, true);
  if (early.ok && late.ok) {
    assert.deepEqual(sortCalendarEvents([late.event, early.event]), [
      early.event,
      late.event,
    ]);
  }
});

test("empty app Canvas writes use the optimistic no-head sentinel", () => {
  assert.equal(appCanvasExpectedRevision(null), "none");
  assert.equal(appCanvasExpectedRevision("head-event-id"), "head-event-id");
});

test("effect cleanup cancels only the unsent autosave from its generation", () => {
  const cleared = [];
  const pending = { generation: 8, timer: 54 };

  assert.equal(
    cancelPendingAutosave(pending, 7, (timer) => cleared.push(timer)),
    false,
  );
  assert.deepEqual(cleared, []);
  assert.equal(
    cancelPendingAutosave(pending, 8, (timer) => cleared.push(timer)),
    true,
  );
  assert.deepEqual(cleared, [54]);
});

test("local recovery storage is atomic and scoped by community, identity, relay, and channel", async () => {
  const storage = memoryStorage();
  const store = new LocalAppDocumentStore(storage);
  const workspace = createInitialAppsWorkspace(CHANNEL_ID, "", "", FIXED_TIME);
  await store.save(SCOPE, workspace);

  assert.deepEqual(await store.load(SCOPE), workspace);
  assert.notEqual(
    appDocumentStorageKey(SCOPE),
    appDocumentStorageKey({ ...SCOPE, communityId: "community-b" }),
  );
  assert.notEqual(
    appDocumentStorageKey(SCOPE),
    appDocumentStorageKey({ ...SCOPE, expectedSignerPubkey: "cd".repeat(32) }),
  );
  assert.notEqual(
    appDocumentStorageKey(SCOPE),
    appDocumentStorageKey({
      ...SCOPE,
      expectedRelayUrl: "wss://relay-b.example",
    }),
  );
  assert.notEqual(
    appDocumentStorageKey(SCOPE),
    appDocumentStorageKey({ ...SCOPE, channelId: "other-channel" }),
  );
  assert.equal(
    await store.load({ ...SCOPE, expectedSignerPubkey: "cd".repeat(32) }),
    null,
  );

  storage.setItem(appDocumentStorageKey(SCOPE), "{broken json");
  await assert.rejects(() => store.load(SCOPE), /valid JSON/);
});

test("private Canvas envelope marker is exact to app and business channel", () => {
  const workspace = createInitialAppsWorkspace(CHANNEL_ID, "", "", FIXED_TIME);
  const content = serializeAppCanvasEnvelope(
    CHANNEL_ID,
    "slides",
    workspace.documents.slides,
  );
  const parsed = parseAppCanvasEnvelope(content, CHANNEL_ID, "slides");

  assert.equal(
    appCanvasMarker(CHANNEL_ID, "slides"),
    parsed.ok ? parsed.envelope.marker : "",
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok)
    assert.deepEqual(parsed.envelope.document, workspace.documents.slides);
  assert.equal(
    parseAppCanvasEnvelope(content, "other-channel", "slides").ok,
    false,
  );
  assert.equal(
    parseAppCanvasEnvelope(content, CHANNEL_ID, "calendar").ok,
    false,
  );
});

test("shared Rust app-schema fixture matches desktop normalization and limits", () => {
  assert.equal(
    APP_DOCUMENT_CONTRACT.limits.appCanvasBytes,
    MAX_APP_CANVAS_DOCUMENT_BYTES,
  );
  assert.equal(APP_DOCUMENT_CONTRACT.limits.slides, MAX_SLIDES);
  assert.equal(
    APP_DOCUMENT_CONTRACT.limits.calendarEvents,
    MAX_CALENDAR_EVENTS,
  );
  assert.equal(
    APP_DOCUMENT_CONTRACT.limits.eventDescription,
    MAX_EVENT_DESCRIPTION_LENGTH,
  );
  assert.equal(APP_DOCUMENT_CONTRACT.limits.designHtml, MAX_DESIGN_HTML_LENGTH);

  for (const appId of ["slides", "calendar", "design"]) {
    assert.deepEqual(
      parseAppDocument(appId, APP_DOCUMENT_CONTRACT.validDocuments[appId]),
      APP_DOCUMENT_CONTRACT.validDocuments[appId],
    );
  }
  assert.deepEqual(
    parseAppDocument("slides", APP_DOCUMENT_CONTRACT.normalization.input),
    APP_DOCUMENT_CONTRACT.normalization.expected,
  );

  const sample = APP_DOCUMENT_CONTRACT.unicode.sample;
  assert.equal(sample.length, APP_DOCUMENT_CONTRACT.unicode.utf16CodeUnits);
  assert.equal(
    new TextEncoder().encode(sample).byteLength,
    APP_DOCUMENT_CONTRACT.unicode.utf8Bytes,
  );
  const maxId = {
    ...APP_DOCUMENT_CONTRACT.validDocuments.slides,
    id: sample.repeat(80),
  };
  assert.notEqual(parseAppDocument("slides", maxId), null);
  assert.equal(
    parseAppDocument("slides", { ...maxId, id: sample.repeat(81) }),
    null,
  );
  const maxTitle = {
    ...APP_DOCUMENT_CONTRACT.validDocuments.slides,
    title: sample.repeat(100),
  };
  assert.notEqual(parseAppDocument("slides", maxTitle), null);
  assert.equal(
    parseAppDocument("slides", { ...maxTitle, title: sample.repeat(101) }),
    null,
  );

  const canonical = {
    ...APP_DOCUMENT_CONTRACT.validDocuments.slides,
    updatedAt: APP_DOCUMENT_CONTRACT.timestamps.canonical,
  };
  assert.notEqual(parseAppDocument("slides", canonical), null);
  assert.equal(
    parseAppDocument("slides", {
      ...canonical,
      updatedAt: APP_DOCUMENT_CONTRACT.timestamps.equivalentNoncanonicalOffset,
    }),
    null,
  );
  assert.equal(
    parseAppDocument("slides", { ...canonical, schemaVersion: 2 }),
    null,
  );
  assert.equal(
    parseAppDocument("slides", { ...canonical, kind: "calendar" }),
    null,
  );
});

test("app Canvas size limit counts serialized UTF-8 bytes", () => {
  const within = {
    ...APP_DOCUMENT_CONTRACT.validDocuments.design,
    html: "\0".repeat(APP_DOCUMENT_CONTRACT.byteBoundary.designHtmlNulsWithin),
  };
  const serializedWithin = serializeAppCanvasEnvelope(
    CHANNEL_ID,
    "design",
    within,
  );
  assert.ok(
    new TextEncoder().encode(serializedWithin).byteLength <=
      APP_DOCUMENT_CONTRACT.limits.appCanvasBytes,
  );

  const over = {
    ...APP_DOCUMENT_CONTRACT.validDocuments.design,
    html: "\0".repeat(APP_DOCUMENT_CONTRACT.byteBoundary.designHtmlNulsOver),
  };
  assert.throws(
    () => serializeAppCanvasEnvelope(CHANNEL_ID, "design", over),
    /240 KB Canvas limit/,
  );
});

test("sandboxed design preview removes scripts, navigation, forms, and remote asset requests", () => {
  const input = `<!doctype html><html><head>
    <meta http-equiv="refresh" content="0;url=https://outside.example">
    <style>.hero { background-image: url(https://outside.example/image.png); } @import url(https://outside.example/theme.css);</style>
  </head><body onload="fetch('https://outside.example')">
    <script>fetch('https://outside.example')</script>
    <img src="https://outside.example/image.png" onerror="alert(1)">
    <a href="https://outside.example">outside</a>
    <form action="https://outside.example"><input name="q"></form>
    <h1 class="hero">Preview title</h1>
  </body></html>`;
  const preview = createSandboxedPreviewDocument(input);

  assert.match(preview, /default-src 'none'/);
  assert.match(preview, /script-src 'none'/);
  assert.match(preview, /connect-src 'none'/);
  assert.doesNotMatch(preview, /<script\b/i);
  assert.doesNotMatch(preview, /https:\/\/outside\.example/i);
  assert.doesNotMatch(preview, /\son[a-z]+=/i);
  assert.doesNotMatch(preview, /<form\b|<input\b/i);
  assert.match(preview, /Preview title/);
});

test("HTML and calendar exports encode user content instead of treating it as markup", () => {
  const html = createSlidesExportHtml("<Deck>", [
    { title: "<Pitch>", body: "Line one\nLine two" },
  ]);
  assert.match(html, /&lt;Deck&gt;/);
  assert.match(html, /&lt;Pitch&gt;/);
  assert.doesNotMatch(html, /<h1><Pitch>/);

  const ics = createCalendarIcs([
    {
      id: "event-1",
      title: "Review, Q4; plan",
      description: "Bring notes\nnext steps",
      startsAt: "2026-09-24T09:00:00.000Z",
      endsAt: "2026-09-24T09:30:00.000Z",
    },
  ]);
  assert.match(ics, /SUMMARY:Review\\, Q4\\; plan/);
  assert.match(ics, /DTSTART:20260924T090000Z/);
});
