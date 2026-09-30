import { expect, test } from "bun:test";
import {
  applyDictationCleanupChoice,
  setPendingDictationCleanup,
  takePendingDictationCleanup,
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
  setPendingDictationCleanup(true);
  expect(takePendingDictationCleanup()).toBe(true);
  expect(takePendingDictationCleanup()).toBeNull();
});
