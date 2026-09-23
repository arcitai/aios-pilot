import type { CanvasScope } from "@/shared/api/canvasTypes";
import type { SiteDocument } from "./document";

export type SitesWorkspaceProps = {
  businessChannelId: string;
  expectedRelayUrl: string;
  expectedSignerPubkey: string;
  companyName?: string;
  onDirtyChange?: (dirty: boolean) => void;
};

export type WorkspaceContext = {
  businessChannelId: string;
  scope: CanvasScope;
};

export type CanvasConflict = {
  document: SiteDocument;
  revision: string;
  updatedAt: number | null;
};
