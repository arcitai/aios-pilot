import type { GoogleDriveFile } from "@/shared/api/tauriBusinessConnections";

export const MAX_GOOGLE_DRIVE_RESULTS = 100;

/** Merge overlapping Drive pages by file ID and keep the UI list bounded. */
export function mergeGoogleDriveResults(
  existing: readonly GoogleDriveFile[],
  incoming: readonly GoogleDriveFile[],
): GoogleDriveFile[] {
  const filesById = new Map<string, GoogleDriveFile>();
  for (const file of [...existing, ...incoming]) {
    filesById.set(file.id, file);
  }
  return [...filesById.values()].slice(0, MAX_GOOGLE_DRIVE_RESULTS);
}
