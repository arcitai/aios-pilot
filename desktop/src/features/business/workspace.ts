import {
  createChannel,
  getCanvas,
  getChannels,
  setCanvas,
} from "@/shared/api/tauri";
import type { CanvasScope } from "@/shared/api/canvasTypes";
import { businessWorkspaces } from "./workspaceSelection";
export { isBusinessChannel } from "./workspaceSelection";
import {
  BUSINESS_CHANNEL_DESCRIPTION,
  newBusinessDocument,
  parseBusinessDocument,
  serializeBusinessDocument,
} from "./document";

/** A marker identifies a candidate; the canvas schema is verified before it is edited. */
export async function findBusinessWorkspaces() {
  const result = await getChannels(null);
  return businessWorkspaces(result.channels ?? []);
}

export async function loadBusinessWorkspace(
  channelId: string,
  scope: CanvasScope,
) {
  const channels = await findBusinessWorkspaces();
  if (!channels.some((channel) => channel.id === channelId)) {
    throw new Error(
      "This private workspace is no longer available to your account.",
    );
  }
  const canvas = await getCanvas(channelId, scope);
  return {
    document: canvas.content ? parseBusinessDocument(canvas.content) : null,
    revision: canvas.eventId ?? "none",
  };
}

/** Recover a previously created empty workspace after a failed initial write. */
export async function initializeBusinessWorkspace(
  name: string,
  scope: CanvasScope,
  existingId?: string,
) {
  const channel = existingId
    ? (await findBusinessWorkspaces()).find((item) => item.id === existingId)
    : await createChannel({
        ...scope,
        name: name.trim() || "My business",
        channelType: "stream",
        visibility: "private",
        description: BUSINESS_CHANNEL_DESCRIPTION,
      });
  if (!channel)
    throw new Error("Workspace unavailable. Refresh and try again.");
  const canvas = await getCanvas(channel.id, scope);
  if (canvas.content) {
    parseBusinessDocument(canvas.content);
    return channel;
  }
  await setCanvas({
    ...scope,
    channelId: channel.id,
    content: serializeBusinessDocument(newBusinessDocument(name.trim())),
    expectedRevision: canvas.eventId ?? "none",
  });
  return channel;
}
