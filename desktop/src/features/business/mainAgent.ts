import { addChannelMembers, sendChannelMessage } from "@/shared/api/tauri";
import { startManagedAgent } from "@/shared/api/tauriManagedAgents";
import { ensureBusinessMainAgent } from "./provisionMainAgent";

// Retain an acknowledged kickoff if launching the runtime fails. Retrying in
// this session starts that same request instead of publishing a second one.
const kickoffs = new Map<string, number>();

/** Reuse the configured main agent; never silently switch its model or credentials. */
export async function inviteMainAgent(
  channelId: string,
  relayUrl: string,
  pubkey: string,
) {
  const agent = await ensureBusinessMainAgent({
    expectedRelayUrl: relayUrl,
    expectedSignerPubkey: pubkey,
  });
  const result = await addChannelMembers({
    channelId,
    pubkeys: [agent.pubkey],
    role: "bot",
    expectedRelayUrl: relayUrl,
    expectedSignerPubkey: pubkey,
  });
  const failure = result.errors.find(
    (item) => !item.error.toLowerCase().includes("already"),
  );
  if (failure) throw new Error(failure.error);
  return agent;
}

export async function startBusinessConversation(
  channelId: string,
  relayUrl: string,
  pubkey: string,
) {
  const agent = await inviteMainAgent(channelId, relayUrl, pubkey);
  const key = JSON.stringify([relayUrl, pubkey, channelId, agent.pubkey]);
  let replayFloorUnix = kickoffs.get(key);
  if (replayFloorUnix === undefined) {
    const message = await sendChannelMessage(
      channelId,
      `${agent.name}, help me get my business ready in this workspace. Let's start with what we do, who we help and our current priorities. Read the company context we already have and ask me one useful question at a time.`,
      null,
      undefined,
      [agent.pubkey],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      relayUrl,
      pubkey,
    );
    replayFloorUnix = message.createdAt;
    if (kickoffs.size >= 100) {
      const oldestKey = kickoffs.keys().next().value;
      if (oldestKey !== undefined) kickoffs.delete(oldestKey);
    }
    kickoffs.set(key, replayFloorUnix);
  }
  if (agent.status !== "running") {
    await startManagedAgent(agent.pubkey, {
      expectedRelayUrl: relayUrl,
      expectedSignerPubkey: pubkey,
      replayFloorUnix,
    });
  }
  return agent;
}
