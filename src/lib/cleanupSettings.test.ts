import { expect, test } from "bun:test";
import {
  normalizeSavedSettings,
  validateCleanupHotkey,
  validateCleanupRecordingHotkey,
} from "./store";

test("cleanup settings migrate, allow disabling and reject alias conflicts", () => {
  expect(normalizeSavedSettings({}).cleanupEnabled).toBe(false);
  expect(normalizeSavedSettings({}).cleanupToggleHotkey).toBe("Control+Shift+C");
  expect(normalizeSavedSettings({ cleanupToggleHotkey: "" }).cleanupToggleHotkey).toBe("");
  expect(normalizeSavedSettings({}).cleanupRecordingHotkey).toBe("Alt+Command+Space");
  expect(normalizeSavedSettings({}).recordingHotkeyMode).toBe("hold");
  expect(normalizeSavedSettings({ recordingHotkeyMode: "toggle" }).recordingHotkeyMode).toBe(
    "toggle",
  );
  expect(normalizeSavedSettings({ cleanupRecordingHotkey: "" }).cleanupRecordingHotkey).toBe("");
  expect(
    normalizeSavedSettings({
      hotkey: "Alt+Command+Space",
      cleanupRecordingHotkey: "Command+Option+Space",
    }).cleanupRecordingHotkey,
  ).toBe("");
  const translation = { selectionHotkey: "Control+Shift+T" } as Parameters<
    typeof validateCleanupHotkey
  >[0]["translation"];
  expect(() =>
    validateCleanupHotkey({
      hotkey: "Ctrl+Shift+C",
      translation,
      cleanupToggleHotkey: "Control+Shift+C",
      cleanupRecordingHotkey: "",
    }),
  ).toThrow();
  expect(() =>
    validateCleanupHotkey({
      hotkey: "Control+Shift+D",
      translation,
      cleanupToggleHotkey: "Ctrl+Shift+T",
      cleanupRecordingHotkey: "",
    }),
  ).toThrow();
  expect(
    validateCleanupHotkey({
      hotkey: "Control+Shift+D",
      translation,
      cleanupToggleHotkey: "",
      cleanupRecordingHotkey: "",
    }),
  ).toBe("");
  expect(
    validateCleanupRecordingHotkey({
      hotkey: "Shift+Command+Space",
      translation,
      cleanupToggleHotkey: "Control+Shift+C",
      cleanupRecordingHotkey: "Alt+Command+Space",
    }),
  ).toBe("Alt+Command+Space");
  expect(() =>
    validateCleanupRecordingHotkey({
      hotkey: "Shift+Command+Space",
      translation,
      cleanupToggleHotkey: "Control+Shift+C",
      cleanupRecordingHotkey: "Control+Shift+C",
    }),
  ).toThrow();
});
