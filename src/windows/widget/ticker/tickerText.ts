import {
  IDLE_WIDGET_WIDTH,
  type WidgetTextOverlayState,
  type WidgetTextOverlayStatus,
} from "../widgetConstants";

/** Wide pill that replaces the waveform while a ticker line is showing. */
export const TICKER_PILL_WIDTH = 320;

const TAIL_STATUSES: ReadonlySet<WidgetTextOverlayStatus> = new Set([
  "dictating",
  "translating",
  "liveTranslation",
]);

export function tickerLine(state: WidgetTextOverlayState | null): string {
  if (!state) {
    return "";
  }
  const live = (state.liveSegments ?? [])
    .map((segment) => segment.translated.trim())
    .filter((segment) => segment.length > 0)
    .join(" ");
  const translated = state.translatedText.trim();
  const message = state.message?.trim() ?? "";
  const fallback = state.status === "liveTranslation" || state.status === "error" ? message : "";
  return (live || translated || fallback).replace(/\s+/g, " ").trim();
}

/** Live speech keeps the newest words in view. A finished line loops from the start. */
export function tickerFollowsTail(status: WidgetTextOverlayStatus): boolean {
  return TAIL_STATUSES.has(status);
}

export function stackWidthWithTicker(baseWidth: number, ticker: boolean): number {
  if (!ticker) {
    return baseWidth;
  }
  return baseWidth + Math.max(0, TICKER_PILL_WIDTH - IDLE_WIDGET_WIDTH);
}
