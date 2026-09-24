import { invokeTauri } from "./tauri";
import type { CanvasScope } from "./canvasTypes";

/** Remove a member using the relay and identity captured by the caller. */
export async function removeChannelMember(
  channelId: string,
  pubkey: string,
  scope?: CanvasScope,
): Promise<void> {
  await invokeTauri("remove_channel_member", { channelId, pubkey, ...scope });
}
