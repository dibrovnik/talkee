export type IslandVisualState = "idle" | "recording" | "processing" | "done" | "notice" | "call";

export type IslandLeftSlot = "recording" | "cleanup" | "call" | "empty";
export type IslandRightSlot = "level" | "spinner" | "check" | "call" | "empty";

export interface IslandLayoutInput {
  notchWidth: number;
  notchHeight: number;
}

export interface IslandLayoutOptions {
  cleanupEnabled: boolean;
  noticeText: string;
  /** One-line ticker under the notch. The separate text window stays hidden. */
  ticker?: boolean;
}

/** Height of the one-line ticker band under the notch. */
export const TICKER_BAND = 28;
export const TICKER_MIN_WIDTH = 360;

export interface IslandLayout {
  width: number;
  height: number;
  leftSlot: IslandLeftSlot;
  rightSlot: IslandRightSlot;
  expanded: boolean;
}

export const ISLAND_SPRING =
  "linear(0, 0.09, 0.22, 0.38, 0.54, 0.69, 0.82, 0.92, 0.99, 1.04, 1.07, 1.08, 1.07, 1.05, 1.03, 1.01, 1, 0.995, 1, 1)";

export function noticeExpansion(text: string): number {
  const lines = text.trim().length > 42 ? 2 : 1;
  return Math.min(88, 36 + lines * 26);
}

export function islandTransition(reduced: boolean): string {
  if (reduced) {
    return "opacity 120ms linear";
  }
  return `width 380ms ${ISLAND_SPRING}, height 380ms ${ISLAND_SPRING}, border-radius 380ms ${ISLAND_SPRING}`;
}

export function computeIslandLayout(
  state: IslandVisualState,
  anchor: IslandLayoutInput,
  options: IslandLayoutOptions,
): IslandLayout {
  return applyTickerBand(baseIslandLayout(state, anchor, options), options.ticker === true);
}

function applyTickerBand(layout: IslandLayout, ticker: boolean): IslandLayout {
  if (!ticker) {
    return layout;
  }
  return {
    ...layout,
    width: Math.max(layout.width, TICKER_MIN_WIDTH),
    height: layout.height + TICKER_BAND,
    expanded: true,
  };
}

function baseIslandLayout(
  state: IslandVisualState,
  anchor: IslandLayoutInput,
  options: IslandLayoutOptions,
): IslandLayout {
  const { notchWidth, notchHeight } = anchor;
  switch (state) {
    case "idle":
      return {
        width: notchWidth,
        height: notchHeight,
        leftSlot: "empty",
        rightSlot: "empty",
        expanded: false,
      };
    case "recording":
      return {
        width: notchWidth + 144,
        height: notchHeight,
        leftSlot: "recording",
        rightSlot: "level",
        expanded: false,
      };
    case "processing":
      return {
        width: notchWidth + 88,
        height: notchHeight,
        leftSlot: options.cleanupEnabled ? "cleanup" : "empty",
        rightSlot: "spinner",
        expanded: false,
      };
    case "done":
      return {
        width: notchWidth + 88,
        height: notchHeight,
        leftSlot: "empty",
        rightSlot: "check",
        expanded: false,
      };
    case "notice":
      return {
        width: Math.max(notchWidth + 220, 360),
        height: notchHeight + noticeExpansion(options.noticeText),
        leftSlot: "empty",
        rightSlot: "empty",
        expanded: true,
      };
    case "call":
      return {
        width: notchWidth + 144,
        height: notchHeight,
        leftSlot: "recording",
        rightSlot: "call",
        expanded: false,
      };
  }
}
