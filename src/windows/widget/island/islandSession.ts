import { invoke } from "@tauri-apps/api/core";
import { getSettings } from "../../../lib/store";

export interface IslandAnchor {
  screenId: number;
  centerX: number;
  topY: number;
  notchWidth: number;
  notchHeight: number;
  isRealNotch: boolean;
}

export interface WidgetPresentationApplied {
  mode: "pill" | "island";
  anchor: IslandAnchor | null;
}

export const ISLAND_ANCHOR_EVENT = "island-anchor-changed";
export const ISLAND_NOTICE_EVENT = "island-notice";

let islandActive = false;

export function setIslandPresentationActive(active: boolean): void {
  islandActive = active;
}

export function isIslandPresentationActive(): boolean {
  return islandActive;
}

export async function applyStoredWidgetPresentation(): Promise<WidgetPresentationApplied> {
  const settings = await getSettings();
  if (settings.widgetPresentation === "island") {
    setIslandPresentationActive(true);
  }
  try {
    const applied = await invoke<WidgetPresentationApplied>("set_widget_presentation", {
      mode: settings.widgetPresentation,
      fallback: settings.islandFallback,
    });
    const mode = applied.mode === "island" ? "island" : "pill";
    setIslandPresentationActive(mode === "island");
    return { mode, anchor: mode === "island" ? applied.anchor : null };
  } catch (error) {
    setIslandPresentationActive(false);
    throw error;
  }
}
