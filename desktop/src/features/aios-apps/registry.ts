import { CalendarDays, PanelsTopLeft, Presentation } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { AppId } from "./types";

export type AppRegistryEntry = {
  id: AppId;
  title: string;
  summary: string;
  documentVersion: 1;
  capabilities: readonly string[];
  Icon: LucideIcon;
};

export const AIOS_APP_REGISTRY = [
  {
    id: "slides",
    title: "Slides",
    summary: "Shape a short story and export it as a presentation.",
    documentVersion: 1,
    capabilities: ["Edit slides", "Export HTML"],
    Icon: Presentation,
  },
  {
    id: "calendar",
    title: "Calendar",
    summary: "Plan and keep local events for this workspace.",
    documentVersion: 1,
    capabilities: ["Add and remove events", "Export .ics"],
    Icon: CalendarDays,
  },
  {
    id: "design",
    title: "Design",
    summary: "Edit a small HTML prototype and preview it safely.",
    documentVersion: 1,
    capabilities: ["Edit HTML", "Sandboxed preview", "Export HTML"],
    Icon: PanelsTopLeft,
  },
] as const satisfies readonly AppRegistryEntry[];

export function getAppRegistryEntry(id: AppId): AppRegistryEntry {
  const entry = AIOS_APP_REGISTRY.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown AIOS app: ${id}`);
  return entry;
}
