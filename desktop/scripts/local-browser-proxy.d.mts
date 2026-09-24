import type { Plugin } from "vite";
export function localBrowserProxy(): Plugin;
export function acceptsBrowserRequest(
  request: { method?: string; headers: Record<string, string | undefined> },
  origin: string,
): boolean;
