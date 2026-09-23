import type {
  BusinessConnectionImport,
  BusinessConnectionSource,
} from "@/shared/api/tauriBusinessConnections";

const MAX_SOURCE_UTF16_UNITS = 40_000;
const MAX_TITLE_LENGTH = 200;
const GITHUB_REPOSITORY_PART = /^[A-Za-z0-9_.-]+$/;
const NOTION_PAGE_ID =
  /^(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12})$/;
const NOTION_PAGE_ID_SUFFIX =
  /(?:^|-)([A-Fa-f0-9]{32}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12})$/;
const SLACK_CHANNEL_ID = /^[CG][A-Z0-9]{8,31}$/;

export type SanitizedConnectionImport = {
  source: BusinessConnectionSource;
  truncated: boolean;
};

function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) return false;
      const isControl =
        codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
      return (
        !isControl ||
        character === "\n" ||
        character === "\r" ||
        character === "\t"
      );
    })
    .join("");
}

function truncateUtf16(value: string, maxUnits: number): string {
  let result = "";
  let used = 0;
  for (const character of value) {
    const units = character.length;
    if (used + units > maxUnits) break;
    result += character;
    used += units;
  }
  return result;
}

function sourceUrl(
  url: string,
  provider: "github" | "notion" | "slack",
  expectedResourceId?: string,
): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(
      `${provider === "github" ? "GitHub" : provider === "notion" ? "Notion" : "Slack"} returned an invalid source link.`,
    );
  }
  const commonInvalid =
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== "" ||
    parsedUrl.port !== "" ||
    parsedUrl.search !== "" ||
    parsedUrl.hash !== "";
  if (provider === "github") {
    const repositoryPath = parsedUrl.pathname.split("/").filter(Boolean);
    if (
      commonInvalid ||
      parsedUrl.hostname !== "github.com" ||
      repositoryPath.length !== 2 ||
      repositoryPath.some((part) => !GITHUB_REPOSITORY_PART.test(part))
    ) {
      throw new Error("GitHub returned an invalid repository link.");
    }
  } else if (provider === "notion") {
    const pagePath = parsedUrl.pathname.split("/").filter(Boolean);
    const pageIdMatch = NOTION_PAGE_ID_SUFFIX.exec(pagePath.at(-1) ?? "");
    const actualPageId = pageIdMatch?.[1]?.replaceAll("-", "").toLowerCase();
    const expectedPageId = expectedResourceId
      ?.replaceAll("-", "")
      .toLowerCase();
    const hasValidExpectedPageId =
      expectedResourceId !== undefined &&
      NOTION_PAGE_ID.test(expectedResourceId);
    const isOfficialHost = [
      "app.notion.com",
      "www.notion.so",
      "notion.so",
    ].includes(parsedUrl.hostname);
    const isValidPath =
      (parsedUrl.hostname === "app.notion.com" &&
        pagePath.length === 2 &&
        pagePath[0] === "p") ||
      (parsedUrl.hostname !== "app.notion.com" &&
        pagePath.length >= 1 &&
        pagePath.length <= 8);
    if (
      commonInvalid ||
      !isOfficialHost ||
      !isValidPath ||
      !actualPageId ||
      !hasValidExpectedPageId ||
      (expectedPageId !== undefined && actualPageId !== expectedPageId)
    ) {
      throw new Error("Notion returned an invalid page link.");
    }
  } else {
    const channelPath = parsedUrl.pathname.split("/").filter(Boolean);
    if (
      commonInvalid ||
      parsedUrl.hostname !== "app.slack.com" ||
      channelPath.length !== 2 ||
      channelPath[0] !== "archives" ||
      !SLACK_CHANNEL_ID.test(channelPath[1]) ||
      expectedResourceId === undefined ||
      !SLACK_CHANNEL_ID.test(expectedResourceId) ||
      channelPath[1] !== expectedResourceId
    ) {
      throw new Error("Slack returned an invalid channel link.");
    }
  }
  return parsedUrl.toString().replace(/\/$/, "");
}

function sanitizeImport(
  input: unknown,
  provider: "github" | "notion" | "slack",
  expectedResourceId?: string,
): SanitizedConnectionImport {
  const providerName =
    provider === "github"
      ? "GitHub"
      : provider === "notion"
        ? "Notion"
        : "Slack";
  if (!input || typeof input !== "object") {
    throw new Error(`${providerName} returned an invalid source.`);
  }
  const candidate = input as Partial<BusinessConnectionImport>;
  const title =
    typeof candidate.title === "string"
      ? [...stripControlCharacters(candidate.title).trim()]
          .slice(0, MAX_TITLE_LENGTH)
          .join("")
      : "";
  const content =
    typeof candidate.content === "string"
      ? stripControlCharacters(candidate.content)
      : "";
  if (!title || !content.trim() || candidate.kind !== "url") {
    throw new Error(`${providerName} returned an incomplete source.`);
  }
  const url = sourceUrl(
    typeof candidate.url === "string" ? candidate.url : "",
    provider,
    expectedResourceId,
  );
  const nativeTruncated = candidate.truncated === true;
  let sanitizedContent = content;
  let truncated = nativeTruncated;
  const hasNativeMarker =
    content.includes(
      "[README truncated to fit Buzz's 40,000 UTF-16-unit source limit.]",
    ) ||
    content.includes("[Notion page partially imported by Buzz;") ||
    content.includes(
      "[Source text truncated by Buzz to 40,000 UTF-16 units.]",
    ) ||
    content.includes("[Source partially imported by Buzz;") ||
    content.includes("[Slack history partially imported by Buzz;");
  const exceedsLimit = content.length > MAX_SOURCE_UTF16_UNITS;
  if (exceedsLimit || (nativeTruncated && !hasNativeMarker)) {
    const notice = exceedsLimit
      ? "\n\n[Source text truncated by Buzz to 40,000 UTF-16 units.]"
      : "\n\n[Source partially imported by Buzz; the provider omitted content.]";
    sanitizedContent =
      truncateUtf16(content, MAX_SOURCE_UTF16_UNITS - notice.length) + notice;
    truncated = true;
  }
  const source: BusinessConnectionSource = {
    title,
    content: sanitizedContent,
    url,
    kind: "url",
  };
  return { source, truncated };
}

/** Validate GitHub native output before handing README text to the caller. */
export function sanitizeGitHubImport(
  input: unknown,
): SanitizedConnectionImport {
  return sanitizeImport(input, "github");
}

/** Validate Notion output against the selected page and allow only provenance links. */
export function sanitizeNotionImport(
  input: unknown,
  expectedPageId: string,
): SanitizedConnectionImport {
  return sanitizeImport(input, "notion", expectedPageId);
}

/** Validate Slack output against one selected channel's provenance link. */
export function sanitizeSlackImport(
  input: unknown,
  expectedChannelId: string,
): SanitizedConnectionImport {
  return sanitizeImport(input, "slack", expectedChannelId);
}

/** Compatibility helper for callers that only need the source contract. */
export function sanitizeGitHubSource(input: unknown): BusinessConnectionSource {
  return sanitizeGitHubImport(input).source;
}
