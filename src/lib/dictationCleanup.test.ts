import { expect, test } from "bun:test";
import {
  applyDictationCleanupChoice,
  setPendingDictationCleanup,
  takePendingDictationCleanup,
  takePendingDictationTrigger,
} from "./dictationCleanup";
import type { AppSettings } from "./store";

const settings = { cleanupEnabled: false } as AppSettings;

test("a dictation hotkey overrides cleanup only for that take", () => {
  expect(applyDictationCleanupChoice(settings, null)).toBe(settings);
  expect(applyDictationCleanupChoice(settings, false)).toBe(settings);
  expect(applyDictationCleanupChoice(settings, true).cleanupEnabled).toBe(true);
  expect(
    applyDictationCleanupChoice({ ...settings, cleanupEnabled: true }, false).cleanupEnabled,
  ).toBe(false);
});

test("the pending cleanup choice is consumed once", () => {
  setPendingDictationCleanup(true, "widget");
  expect(takePendingDictationCleanup()).toBe(true);
  expect(takePendingDictationCleanup()).toBeNull();
  expect(takePendingDictationTrigger()).toBe("widget");
  expect(takePendingDictationTrigger()).toBe("main-hotkey");
});

test("force-on leaves global state unchanged and does not leak into the next take", () => {
  for (const cleanupEnabled of [false, true]) {
    const global = { cleanupEnabled } as AppSettings;
    expect(applyDictationCleanupChoice(global, null)).toBe(global);
    setPendingDictationCleanup(true);
    expect(applyDictationCleanupChoice(global, takePendingDictationCleanup()).cleanupEnabled).toBe(
      true,
    );
    expect(applyDictationCleanupChoice(global, takePendingDictationCleanup()).cleanupEnabled).toBe(
      cleanupEnabled,
    );
    expect(global.cleanupEnabled).toBe(cleanupEnabled);
  }
});
