import { squareEmojiAvatarDataUrl } from "@/features/profile/ui/ProfileAvatarEditor.utils";
import type { CanvasScope } from "@/shared/api/canvasTypes";

type BlobDescriptor = {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
};

export type UploadMediaBytes = (
  data: number[],
  filename?: string,
) => Promise<BlobDescriptor>;

export async function resolveManagedAgentAvatarUrl(
  avatarUrl: string | null | undefined,
  upload: UploadMediaBytes = defaultUploadMediaBytes,
  fallbackAvatarUrl?: string | null,
): Promise<string | undefined> {
  try {
    return await resolveAvatar(avatarUrl, upload);
  } catch {
    return safeFallbackAvatarUrl(fallbackAvatarUrl);
  }
}

/** Scope-bound setup must surface upload failure before creating an identity. */
export async function resolveScopedManagedAgentAvatarUrl(
  avatarUrl: string | null | undefined,
  scope: CanvasScope,
): Promise<string | undefined> {
  const captured = { ...scope };
  return resolveAvatar(avatarUrl, async (data, filename) => {
    const { invokeTauri } = await import("@/shared/api/tauri");
    return invokeTauri<BlobDescriptor>("upload_media_bytes_scoped", {
      data,
      filename,
      ...captured,
    });
  });
}

async function resolveAvatar(
  avatarUrl: string | null | undefined,
  upload: UploadMediaBytes,
): Promise<string | undefined> {
  const resolvedAvatarUrl = avatarUrl?.trim() || undefined;
  if (!resolvedAvatarUrl?.startsWith("data:image/")) {
    return resolvedAvatarUrl;
  }

  // Emoji avatars are stored as inline, percent-encoded SVG data URLs
  // (`data:image/svg+xml,%3C...`) — the same self-contained form profile
  // persists. They are not base64 and must not be run through `atob`/upload.
  // Normalize legacy rounded source artwork to a square while creating or
  // editing an agent so the consuming squircle owns the complete silhouette.
  if (!isBase64DataUri(resolvedAvatarUrl)) {
    return squareEmojiAvatarDataUrl(resolvedAvatarUrl);
  }

  const [, b64] = resolvedAvatarUrl.split(",", 2);
  if (!b64) {
    throw new Error("empty data URI payload");
  }
  const bytes = Array.from(atob(b64), (char) => char.charCodeAt(0));
  const blob = await upload(bytes);
  return blob.url;
}

async function defaultUploadMediaBytes(data: number[], filename?: string) {
  const { uploadMediaBytes } = await import("@/shared/api/tauri");
  return uploadMediaBytes(data, filename);
}

function isBase64DataUri(dataUri: string) {
  const header = dataUri.slice(0, dataUri.indexOf(","));
  return header.includes(";base64");
}

function safeFallbackAvatarUrl(avatarUrl: string | null | undefined) {
  const trimmed = avatarUrl?.trim() || undefined;
  return trimmed?.startsWith("data:image/") ? undefined : trimmed;
}
