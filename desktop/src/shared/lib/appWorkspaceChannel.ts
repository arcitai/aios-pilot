export const BUSINESS_CHANNEL_DESCRIPTION =
  "AIOS business workspace · private company context and main-agent conversation. [aios.business-workspace:v1]";

export const APP_WORKSPACE_MARKER_PREFIX = "aios.app-document:v1:";
export const SITE_WORKSPACE_MARKER = "[aios.site-channel:v1]";

/** App storage remains reachable through Apps and direct links, outside chat navigation. */
export function isAppWorkspaceChannel(channel: {
  description: string;
  visibility: string;
}): boolean {
  if (channel.visibility !== "private") return false;
  const app = channel.description.match(
    /^aios\.app-document:v1:([^:]+):(slides|calendar|design)$/,
  );
  if (app) {
    try {
      return encodeURIComponent(decodeURIComponent(app[1])) === app[1];
    } catch {
      return false;
    }
  }
  return /^AIOS private site workspace for business channel [a-zA-Z0-9_-]{1,128} \[aios\.site-channel:v1\]$/.test(
    channel.description,
  );
}

/** Legacy knowledge storage is reached from Business, not the conversation list. */
export function isBusinessContextChannel(channel: {
  description: string;
  visibility: string;
}): boolean {
  return (
    channel.visibility === "private" &&
    channel.description === BUSINESS_CHANNEL_DESCRIPTION
  );
}
