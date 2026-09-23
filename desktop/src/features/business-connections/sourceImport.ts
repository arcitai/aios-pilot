import type { BusinessConnectionSource } from "@/shared/api/tauriBusinessConnections";

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_TITLE_LENGTH = 200;
const GITHUB_REPOSITORY_PART = /^[A-Za-z0-9_.-]+$/;

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

/** Validate native GitHub output again before handing untrusted README text to the caller. */
export function sanitizeGitHubSource(input: unknown): BusinessConnectionSource {
  if (!input || typeof input !== "object") {
    throw new Error("GitHub returned an invalid README source.");
  }

  const candidate = input as Record<string, unknown>;
  const title =
    typeof candidate.title === "string"
      ? stripControlCharacters(candidate.title)
          .trim()
          .slice(0, MAX_TITLE_LENGTH)
      : "";
  const content =
    typeof candidate.content === "string"
      ? stripControlCharacters(candidate.content)
      : "";
  const url = typeof candidate.url === "string" ? candidate.url : "";

  if (!title || !content.trim() || candidate.kind !== "url") {
    throw new Error("GitHub returned an incomplete README source.");
  }
  if (new TextEncoder().encode(content).byteLength > MAX_SOURCE_BYTES) {
    throw new Error("This README is too large to import.");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("GitHub returned an invalid repository link.");
  }
  const repositoryPath = parsedUrl.pathname.split("/").filter(Boolean);
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "github.com" ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.port ||
    parsedUrl.search ||
    parsedUrl.hash ||
    repositoryPath.length !== 2 ||
    repositoryPath.some((part) => !GITHUB_REPOSITORY_PART.test(part))
  ) {
    throw new Error("GitHub returned an invalid repository link.");
  }

  return {
    title,
    content,
    url: parsedUrl.toString().replace(/\/$/, ""),
    kind: "url",
  };
}
