import { expect, test } from "bun:test";
import { normalizeSavedSettings } from "./store";

test("widget presentation defaults to the pill and keeps a valid island choice", () => {
  expect(normalizeSavedSettings({}).widgetPresentation).toBe("pill");
  expect(normalizeSavedSettings({}).islandFallback).toBe("island");
  expect(
    normalizeSavedSettings({ widgetPresentation: "island", islandFallback: "pill" })
      .widgetPresentation,
  ).toBe("island");
  expect(
    normalizeSavedSettings({ widgetPresentation: "island", islandFallback: "pill" }).islandFallback,
  ).toBe("pill");
  expect(normalizeSavedSettings({ widgetPresentation: "notch" }).widgetPresentation).toBe("pill");
  expect(normalizeSavedSettings({ islandFallback: "hidden" }).islandFallback).toBe("island");
  expect(normalizeSavedSettings({}).textDisplay).toBe("window");
  expect(normalizeSavedSettings({ textDisplay: "ticker" }).textDisplay).toBe("ticker");
  expect(normalizeSavedSettings({ textDisplay: "marquee" }).textDisplay).toBe("window");
});
