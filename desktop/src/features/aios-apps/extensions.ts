import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type AppsExtensionRenderContext = {
  /** Feed extension draft state into the host's combined dirty-state signal. */
  onDirtyChange?: (dirty: boolean) => void;
};

/** Optional app surface hosted in the existing Apps rail and workspace pane. */
export type AppsExtensionApp = {
  id: string;
  title: string;
  description: string;
  Icon?: LucideIcon;
  render: (context: AppsExtensionRenderContext) => ReactNode;
};
