export const APPS_WORKSPACE_KIND = "aios.apps-workspace" as const;
export const APPS_WORKSPACE_VERSION = 1 as const;
export const MAX_APP_CANVAS_DOCUMENT_BYTES = 240_000;
export const MAX_APP_WORKSPACE_BYTES = 520_000;
export const MAX_SLIDES = 20;
export const MAX_CALENDAR_EVENTS = 100;
export const MAX_EVENT_DESCRIPTION_LENGTH = 1_000;
export const MAX_DESIGN_HTML_LENGTH = 100_000;

export type AppId = "slides" | "calendar" | "design";

export type Slide = {
  id: string;
  title: string;
  body: string;
};

export type SlidesDocument = {
  kind: "slides";
  schemaVersion: 1;
  id: string;
  updatedAt: string;
  title: string;
  slides: Slide[];
};

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
};

export type CalendarDocument = {
  kind: "calendar";
  schemaVersion: 1;
  id: string;
  updatedAt: string;
  events: CalendarEvent[];
  googleCalendarStatus: "not_connected";
};

export type DesignDocument = {
  kind: "design";
  schemaVersion: 1;
  id: string;
  updatedAt: string;
  title: string;
  html: string;
};

export type AppDocument = SlidesDocument | CalendarDocument | DesignDocument;

export type AppsWorkspaceDocument = {
  kind: typeof APPS_WORKSPACE_KIND;
  schemaVersion: typeof APPS_WORKSPACE_VERSION;
  channelId: string;
  updatedAt: string;
  documents: {
    slides: SlidesDocument;
    calendar: CalendarDocument;
    design: DesignDocument;
  };
};

export type WorkspaceParseResult =
  | { ok: true; document: AppsWorkspaceDocument }
  | { ok: false; reason: string };

export function createDocumentId(prefix: string): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `${prefix}-${randomUuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createDesignStarterHtml(
  companyName: string,
  companySummary: string,
): string {
  const name = escapeHtml(companyName.trim() || "Your business");
  const summary = escapeHtml(
    companySummary.trim() || "A clear, welcoming introduction starts here.",
  );

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${name}</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; background: #f6f6f3; color: #23251f; font: 16px/1.6 Inter, system-ui, sans-serif; }
      main { width: min(100% - 40px, 880px); margin: 64px auto; }
      .eyebrow { color: #60675a; font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
      h1 { max-width: 720px; margin: 20px 0; font-size: clamp(38px, 8vw, 72px); line-height: 1.02; letter-spacing: -.055em; }
      p { max-width: 620px; color: #5a5e54; font-size: 18px; }
      .card { margin-top: 44px; padding: 24px; border: 1px solid #dedfd8; border-radius: 18px; background: #fff; }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">A first draft</div>
      <h1>${name}</h1>
      <p>${summary}</p>
      <section class="card"><strong>Make this page yours.</strong><br>Change the HTML in the editor and see the preview update here.</section>
    </main>
  </body>
</html>`;
}

export function createInitialAppsWorkspace(
  channelId: string,
  companyName = "",
  companySummary = "",
  now = new Date().toISOString(),
): AppsWorkspaceDocument {
  const businessName = companyName.trim();
  const slidesTitle = businessName
    ? `${businessName} — introduction`
    : "A short introduction";

  return {
    kind: APPS_WORKSPACE_KIND,
    schemaVersion: APPS_WORKSPACE_VERSION,
    channelId,
    updatedAt: now,
    documents: {
      slides: {
        kind: "slides",
        schemaVersion: 1,
        id: "slides-default",
        updatedAt: now,
        title: slidesTitle,
        slides: [
          {
            id: "slide-cover",
            title: businessName || "A clearer story for your business",
            body:
              companySummary.trim() ||
              "Introduce what you do, who you help, and why it matters.",
          },
          {
            id: "slide-offer",
            title: "The offer",
            body: "Describe the useful change your customers can expect.",
          },
          {
            id: "slide-next-step",
            title: "What happens next",
            body: "Invite the reader to take one clear next step.",
          },
        ],
      },
      calendar: {
        kind: "calendar",
        schemaVersion: 1,
        id: "calendar-default",
        updatedAt: now,
        events: [],
        googleCalendarStatus: "not_connected",
      },
      design: {
        kind: "design",
        schemaVersion: 1,
        id: "design-default",
        updatedAt: now,
        title: businessName ? `${businessName} — first page` : "First page",
        html: createDesignStarterHtml(companyName, companySummary),
      },
    },
  };
}

export function createInitialAppDocument(
  appId: AppId,
  companyName = "",
  companySummary = "",
  now = new Date().toISOString(),
): AppDocument {
  const workspace = createInitialAppsWorkspace(
    "app-document",
    companyName,
    companySummary,
    now,
  );
  return workspace.documents[appId];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isNonEmptyId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function parseSlidesDocument(value: unknown): SlidesDocument | null {
  if (!isRecord(value)) return null;
  if (
    value.kind !== "slides" ||
    value.schemaVersion !== 1 ||
    !isNonEmptyId(value.id) ||
    !isIsoTimestamp(value.updatedAt) ||
    !isBoundedString(value.title, 200) ||
    !Array.isArray(value.slides) ||
    value.slides.length < 1 ||
    value.slides.length > MAX_SLIDES
  ) {
    return null;
  }

  const slides: Slide[] = [];
  for (const candidate of value.slides) {
    if (
      !isRecord(candidate) ||
      !isNonEmptyId(candidate.id) ||
      !isBoundedString(candidate.title, 500) ||
      !isBoundedString(candidate.body, 8_000)
    ) {
      return null;
    }
    slides.push({
      id: candidate.id,
      title: candidate.title,
      body: candidate.body,
    });
  }

  return {
    kind: "slides",
    schemaVersion: 1,
    id: value.id,
    updatedAt: value.updatedAt,
    title: value.title,
    slides,
  };
}

function parseCalendarDocument(value: unknown): CalendarDocument | null {
  if (!isRecord(value)) return null;
  if (
    value.kind !== "calendar" ||
    value.schemaVersion !== 1 ||
    !isNonEmptyId(value.id) ||
    !isIsoTimestamp(value.updatedAt) ||
    value.googleCalendarStatus !== "not_connected" ||
    !Array.isArray(value.events) ||
    value.events.length > MAX_CALENDAR_EVENTS
  ) {
    return null;
  }

  const events: CalendarEvent[] = [];
  for (const candidate of value.events) {
    if (
      !isRecord(candidate) ||
      !isNonEmptyId(candidate.id) ||
      typeof candidate.title !== "string" ||
      candidate.title.trim().length === 0 ||
      candidate.title.length > 200 ||
      !isBoundedString(candidate.description, MAX_EVENT_DESCRIPTION_LENGTH) ||
      !isIsoTimestamp(candidate.startsAt) ||
      !isIsoTimestamp(candidate.endsAt) ||
      Date.parse(candidate.endsAt) <= Date.parse(candidate.startsAt)
    ) {
      return null;
    }
    events.push({
      id: candidate.id,
      title: candidate.title,
      description: candidate.description,
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
    });
  }

  return {
    kind: "calendar",
    schemaVersion: 1,
    id: value.id,
    updatedAt: value.updatedAt,
    events,
    googleCalendarStatus: "not_connected",
  };
}

function parseDesignDocument(value: unknown): DesignDocument | null {
  if (
    !isRecord(value) ||
    value.kind !== "design" ||
    value.schemaVersion !== 1 ||
    !isNonEmptyId(value.id) ||
    !isIsoTimestamp(value.updatedAt) ||
    !isBoundedString(value.title, 200) ||
    !isBoundedString(value.html, MAX_DESIGN_HTML_LENGTH)
  ) {
    return null;
  }
  return {
    kind: "design",
    schemaVersion: 1,
    id: value.id,
    updatedAt: value.updatedAt,
    title: value.title,
    html: value.html,
  };
}

export function parseAppDocument(
  appId: "slides",
  value: unknown,
): SlidesDocument | null;
export function parseAppDocument(
  appId: "calendar",
  value: unknown,
): CalendarDocument | null;
export function parseAppDocument(
  appId: "design",
  value: unknown,
): DesignDocument | null;
export function parseAppDocument(
  appId: AppId,
  value: unknown,
): AppDocument | null;
export function parseAppDocument(
  appId: AppId,
  value: unknown,
): AppDocument | null {
  switch (appId) {
    case "slides":
      return parseSlidesDocument(value);
    case "calendar":
      return parseCalendarDocument(value);
    case "design":
      return parseDesignDocument(value);
  }
}

export function parseAppsWorkspaceDocument(
  value: unknown,
  expectedChannelId: string,
): WorkspaceParseResult {
  if (!isRecord(value)) {
    return { ok: false, reason: "The saved app workspace is not an object." };
  }
  if (value.kind !== APPS_WORKSPACE_KIND) {
    return {
      ok: false,
      reason: "The saved file is not an AIOS app workspace.",
    };
  }
  if (value.schemaVersion !== APPS_WORKSPACE_VERSION) {
    return {
      ok: false,
      reason: `App workspace version ${String(value.schemaVersion)} is not supported.`,
    };
  }
  if (value.channelId !== expectedChannelId) {
    return {
      ok: false,
      reason: "The saved app workspace belongs to a different channel.",
    };
  }
  if (!isIsoTimestamp(value.updatedAt) || !isRecord(value.documents)) {
    return { ok: false, reason: "The saved app workspace is incomplete." };
  }

  const slides = parseAppDocument("slides", value.documents.slides);
  const calendar = parseAppDocument("calendar", value.documents.calendar);
  const design = parseAppDocument("design", value.documents.design);
  if (!slides || !calendar || !design) {
    return {
      ok: false,
      reason:
        "One or more app documents are malformed or exceed their size limits.",
    };
  }

  return {
    ok: true,
    document: {
      kind: APPS_WORKSPACE_KIND,
      schemaVersion: APPS_WORKSPACE_VERSION,
      channelId: expectedChannelId,
      updatedAt: value.updatedAt,
      documents: { slides, calendar, design },
    },
  };
}

export function serializeAppsWorkspaceDocument(
  document: AppsWorkspaceDocument,
): string {
  const parsed = parseAppsWorkspaceDocument(document, document.channelId);
  if (!parsed.ok) throw new Error(parsed.reason);
  const serialized = JSON.stringify(parsed.document);
  if (
    new TextEncoder().encode(serialized).byteLength > MAX_APP_WORKSPACE_BYTES
  ) {
    throw new Error("The app workspace exceeds its 520 KB storage limit.");
  }
  return serialized;
}

export function deserializeAppsWorkspaceDocument(
  serialized: string,
  expectedChannelId: string,
): WorkspaceParseResult {
  if (
    new TextEncoder().encode(serialized).byteLength > MAX_APP_WORKSPACE_BYTES
  ) {
    return { ok: false, reason: "The saved app workspace exceeds 520 KB." };
  }
  try {
    return parseAppsWorkspaceDocument(
      JSON.parse(serialized) as unknown,
      expectedChannelId,
    );
  } catch {
    return { ok: false, reason: "The saved app workspace is not valid JSON." };
  }
}

export function sortCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort(
    (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt),
  );
}

export type CalendarEventDraft = {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
};

export type CalendarEventCreateResult =
  | { ok: true; event: CalendarEvent }
  | { ok: false; reason: string };

export function createCalendarEvent(
  draft: CalendarEventDraft,
  id = createDocumentId("event"),
): CalendarEventCreateResult {
  const title = draft.title.trim();
  const start = new Date(draft.startsAt);
  const end = new Date(draft.endsAt);
  if (!title) return { ok: false, reason: "Add a title for this event." };
  if (title.length > 200) {
    return { ok: false, reason: "Event titles can be up to 200 characters." };
  }
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return { ok: false, reason: "Choose a valid start and end time." };
  }
  if (end.getTime() <= start.getTime()) {
    return { ok: false, reason: "The end time must be after the start time." };
  }
  if (draft.description.length > MAX_EVENT_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      reason: `Event notes can be up to ${MAX_EVENT_DESCRIPTION_LENGTH.toLocaleString()} characters.`,
    };
  }

  return {
    ok: true,
    event: {
      id,
      title,
      description: draft.description.trim(),
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    },
  };
}
