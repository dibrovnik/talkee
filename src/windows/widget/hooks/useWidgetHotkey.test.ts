import { describe, expect, test } from "bun:test";

import {
  resolveHandyHotkeyIntent,
  resolveRecordingHotkeyCleanup,
  resolveSelectionHotkeyAction,
} from "./useWidgetHotkey";

describe("resolveHandyHotkeyIntent", () => {
  test("voice hotkey wins when selection hotkey accidentally matches it", () => {
    expect(
      resolveHandyHotkeyIntent({
        eventHotkey: "Shift+Command+V",
        voiceHotkey: "Shift+Command+V",
        selectionHotkey: "Shift+Command+V",
        selectionEnabled: true,
      }),
    ).toBe("voice");
  });

  test("the cleanup recording hotkey is a separate voice take", () => {
    expect(
      resolveHandyHotkeyIntent({
        eventHotkey: "Alt+Command+Space",
        voiceHotkey: "Shift+Command+Space",
        selectionHotkey: "Control+Shift+Y",
        selectionEnabled: true,
        cleanupRecordingHotkey: "Alt+Command+Space",
      }),
    ).toBe("voice-cleanup");
  });

  test("disabled selection hotkey falls back to voice", () => {
    expect(
      resolveHandyHotkeyIntent({
        eventHotkey: "Shift+Command+V",
        voiceHotkey: "Shift+Command+V",
        selectionHotkey: "Shift+Command+V",
        selectionEnabled: false,
      }),
    ).toBe("voice");
  });
});

describe("resolveSelectionHotkeyAction", () => {
  test("arms on press and triggers on release", () => {
    expect(resolveSelectionHotkeyAction("Pressed", false)).toBe("arm");
    expect(resolveSelectionHotkeyAction("Released", true)).toBe("trigger");
  });

  test("release without prior press is consumed", () => {
    expect(resolveSelectionHotkeyAction("Released", false)).toBe("consume");
  });
});

test("ordinary hotkey follows the toggle; cleanup hotkey forces on", () => {
  expect(resolveRecordingHotkeyCleanup("voice")).toBeNull();
  expect(resolveRecordingHotkeyCleanup("voice-cleanup")).toBe(true);
});

test("cleanup indicator captures the per-take choice and returns to global on idle", async () => {
  const { resolveCleanupIndicator } = await import("./useWidgetController");
  for (const global of [true, false])
    for (const effective of [true, false]) {
      expect(resolveCleanupIndicator("idle", global, effective)).toBe(global);
      expect(resolveCleanupIndicator("recording", global, effective)).toBe(effective);
      expect(resolveCleanupIndicator("processing", global, effective)).toBe(effective);
    }
});
