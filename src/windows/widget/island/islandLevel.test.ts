import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IslandPresentation } from "./IslandPresentation";
import { islandBarScale, islandVoiceLevel } from "./islandLevel";

test("island levels retain microphone gain and stay finite and bounded", () => {
  expect(islandVoiceLevel(0, 0)).toBe(0);
  expect(islandVoiceLevel(0.02, 0.01)).toBeCloseTo(0.3);
  expect(islandVoiceLevel(0.01, 0.05)).toBeCloseTo(0.45);
  expect(islandVoiceLevel(1, 1)).toBe(1);
  expect(islandVoiceLevel(-1, -1)).toBe(0);
  expect(islandVoiceLevel(Number.NaN, 0.05)).toBeCloseTo(0.45);
  expect(islandVoiceLevel(Number.NaN, Number.POSITIVE_INFINITY)).toBe(0);
  for (const level of [0, 0.3, 0.6, 1]) {
    for (let index = 0; index < 5; index += 1) {
      const scale = islandBarScale(level, index);
      expect(scale).toBeGreaterThanOrEqual(4 / 14);
      expect(scale).toBeLessThanOrEqual(1);
    }
  }
  expect(islandBarScale(1, 3)).toBeCloseTo(11.2 / 14);
  expect(islandBarScale(1, 4)).toBeCloseTo(7.6 / 14);
});

test("island presentation uses transform bars and a still reduced-motion spinner", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const props = {
    anchor: { notchWidth: 180, notchHeight: 32 },
    notice: null,
    cleanupEnabled: true,
    elapsedMs: 12000,
    tickerText: "",
    tickerLive: false,
    copyText: null,
  };
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { matchMedia: () => ({ matches: true }) },
    });
    const recording = renderToStaticMarkup(
      createElement(IslandPresentation, { ...props, state: "recording" }),
    );
    expect(recording.match(/class="island-level-bar"/g)).toHaveLength(5);
    expect(recording).toContain("transform:scaleY(");
    expect(recording).toContain("0:12");
    const processing = renderToStaticMarkup(
      createElement(IslandPresentation, { ...props, state: "processing" }),
    );
    expect(processing).toContain("animation:none");
    expect(processing).not.toContain("spin 0.8s");
    expect(processing).not.toContain("width 380ms");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
