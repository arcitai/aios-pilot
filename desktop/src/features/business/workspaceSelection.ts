import type { Channel } from "@/shared/api/types";
import {
  BUSINESS_CONTEXT_RESOURCE,
  isBusinessContextChannel,
} from "@/shared/lib/appWorkspaceChannel";

/** Metadata is a discovery reference, never evidence of permission to read content. */
export function isBusinessChannel(channel: Channel) {
  return (
    channel.isMember &&
    channel.channelType === "stream" &&
    !channel.archivedAt &&
    isBusinessContextChannel(channel)
  );
}

/** Prefer the host's canonical context; retain old IDs for explicit recovery links. */
export function businessWorkspaces(channels: Channel[]): Channel[] {
  const candidates = channels.filter(isBusinessChannel);
  const registered = candidates.filter(
    (channel) => channel.resourceType === BUSINESS_CONTEXT_RESOURCE,
  );
  if (registered.length > 1) {
    throw new Error(
      "This host returned more than one business context. Ask the workspace owner to check its configuration.",
    );
  }
  return [
    ...registered,
    ...candidates.filter(
      (channel) => channel.resourceType !== BUSINESS_CONTEXT_RESOURCE,
    ),
  ];
}
