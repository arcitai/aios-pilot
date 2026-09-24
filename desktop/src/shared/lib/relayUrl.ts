/**
 * Canonicalize a relay URL the way the backend keys runtime pairs, so a
 * stored community URL (e.g. `ws://localhost:3000`) matches backend rows
 * (`ws://127.0.0.1:3000`). Mirrors buzz-core's `normalize_relay_url`
 * (`crates/buzz-core/src/relay.rs`): lowercase host, loopback hosts folded
 * to 127.0.0.1, default ports and root-path trailing slash stripped.
 * Returns null when the URL cannot be parsed as ws/wss.
 */
export function canonicalRelayUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
  let host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "[::1]" || host.startsWith("127.")) {
    host = "127.0.0.1";
  }
  const defaultPort = url.protocol === "ws:" ? "80" : "443";
  const port = url.port && url.port !== defaultPort ? `:${url.port}` : "";
  const path = url.pathname === "/" ? "" : url.pathname;
  // The backend trims trailing slashes from the final rendered URL.
  return `${url.protocol}//${host}${port}${path}${url.search}`.replace(
    /\/+$/,
    "",
  );
}
