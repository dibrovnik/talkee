import { expect, test } from "bun:test";
import { normalizeSavedSettings, validateCleanupHotkey } from "./store";

test("cleanup settings migrate, allow disabling and reject alias conflicts", () => {
  expect(normalizeSavedSettings({}).cleanupEnabled).toBe(false);
  expect(normalizeSavedSettings({}).cleanupToggleHotkey).toBe("Control+Shift+C");
  expect(normalizeSavedSettings({ cleanupToggleHotkey: "" }).cleanupToggleHotkey).toBe("");
  const translation = { selectionHotkey: "Control+Shift+T" } as Parameters<
    typeof validateCleanupHotkey
  >[0]["translation"];
  expect(() =>
    validateCleanupHotkey({
      hotkey: "Ctrl+Shift+C",
      translation,
      cleanupToggleHotkey: "Control+Shift+C",
    }),
  ).toThrow();
  expect(() =>
    validateCleanupHotkey({
      hotkey: "Control+Shift+D",
      translation,
      cleanupToggleHotkey: "Ctrl+Shift+T",
    }),
  ).toThrow();
  expect(
    validateCleanupHotkey({ hotkey: "Control+Shift+D", translation, cleanupToggleHotkey: "" }),
  ).toBe("");
});
