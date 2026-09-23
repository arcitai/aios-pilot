import type { SlackChannel } from "@/shared/api/tauriBusinessConnections";

export const MAX_SLACK_CHANNEL_RESULTS = 200;

/** Keep channel paging bounded and collapse overlapping provider pages by ID. */
export function mergeSlackChannelResults(
  existing: readonly SlackChannel[],
  incoming: readonly SlackChannel[],
): SlackChannel[] {
  const channelsById = new Map<string, SlackChannel>();
  for (const channel of [...existing, ...incoming]) {
    channelsById.set(channel.id, channel);
  }
  return [...channelsById.values()].slice(0, MAX_SLACK_CHANNEL_RESULTS);
}
