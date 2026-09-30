import type { WidgetState } from "../widgetConstants";
import type { IslandVisualState } from "./islandLayout";

export interface IslandNotice {
  message: string;
  tone: "error" | "info";
  actionLabel?: string | null;
  actionTab?: string | null;
}

export interface IslandStateInput {
  widgetState: WidgetState;
  callActive: boolean;
  notice: IslandNotice | null;
  done: boolean;
}

export function mapIslandState(input: IslandStateInput): IslandVisualState {
  if (input.notice) {
    return "notice";
  }
  if (input.widgetState === "recording") {
    return "recording";
  }
  if (input.widgetState === "processing") {
    return "processing";
  }
  if (input.callActive) {
    return "call";
  }
  if (input.done) {
    return "done";
  }
  return "idle";
}

export function islandNoticeIsInteractive(notice: IslandNotice | null): boolean {
  return Boolean(notice?.actionLabel);
}

/** How long the island keeps the copy button after processing finishes. */
export const ISLAND_COPY_VISIBLE_MS = 3000;

export function islandShowsCopyButton(state: IslandVisualState, text: string | null): boolean {
  return state === "done" && Boolean(text?.trim());
}
