import { expect, test } from "bun:test";
import {
  computeIslandLayout,
  type IslandVisualState,
  islandTransition,
  noticeExpansion,
  TICKER_BAND,
  TICKER_MIN_WIDTH,
} from "./islandLayout";

const options = { cleanupEnabled: true, noticeText: "Коротко" };

test("island layout matches each state for two notch widths", () => {
  const states: IslandVisualState[] = ["idle", "recording", "processing", "done", "notice", "call"];
  for (const notchWidth of [180, 200]) {
    for (const state of states) {
      const layout = computeIslandLayout(state, { notchWidth, notchHeight: 32 }, options);
      if (state === "idle") {
        expect(layout.width).toBe(notchWidth);
        expect(layout.height).toBe(32);
      }
      if (state === "recording" || state === "call") {
        expect(layout.width).toBe(notchWidth + 144);
        expect(layout.height).toBe(32);
      }
      if (state === "processing" || state === "done") {
        expect(layout.width).toBe(notchWidth + 88);
      }
      if (state === "notice") {
        expect(layout.width).toBe(Math.max(notchWidth + 220, 360));
        expect(layout.expanded).toBe(true);
        expect(layout.height).toBe(32 + noticeExpansion(options.noticeText));
      }
    }
  }
});

test("a ticker adds one line under the notch and widens a narrow island", () => {
  const idle = computeIslandLayout(
    "idle",
    { notchWidth: 180, notchHeight: 32 },
    { ...options, ticker: true },
  );
  expect(idle.width).toBe(TICKER_MIN_WIDTH);
  expect(idle.height).toBe(32 + TICKER_BAND);
  expect(idle.expanded).toBe(true);

  const recording = computeIslandLayout(
    "recording",
    { notchWidth: 180, notchHeight: 32 },
    { ...options, ticker: true },
  );
  expect(recording.width).toBe(TICKER_MIN_WIDTH);
  expect(recording.height).toBe(32 + TICKER_BAND);
  expect(recording.leftSlot).toBe("recording");
});

test("processing hides the cleanup slot when cleanup is off", () => {
  const layout = computeIslandLayout(
    "processing",
    { notchWidth: 180, notchHeight: 32 },
    { cleanupEnabled: false, noticeText: "" },
  );
  expect(layout.leftSlot).toBe("empty");
  expect(layout.rightSlot).toBe("spinner");
});

test("notice expansion stays within two lines", () => {
  expect(noticeExpansion("Коротко")).toBe(62);
  expect(noticeExpansion("а".repeat(80))).toBe(88);
});

test("reduced motion fades instead of springing the size", () => {
  expect(islandTransition(true)).toBe("opacity 120ms linear");
  expect(islandTransition(false)).toContain("width 380ms");
  expect(islandTransition(false)).not.toContain("opacity");
});
