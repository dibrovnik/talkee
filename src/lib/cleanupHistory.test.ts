import { expect, test } from "bun:test";
import {
  cleanupHistoryText,
  hasOriginalCleanupText,
  historyChangeSummary,
  historyTextVariants,
  historyVariantText,
} from "./cleanupHistory";
import type { DictationPersonalization } from "./store";

test("history keeps legacy entries unchanged and exposes original text only when different", () => {
  expect(cleanupHistoryText({ cleaned: "Legacy" }, true)).toBe("Legacy");
  expect(hasOriginalCleanupText({ cleaned: "Legacy" })).toBe(false);
  expect(hasOriginalCleanupText({ raw: "Same", cleaned: "Same" })).toBe(false);
  expect(hasOriginalCleanupText({ raw: "Raw", cleaned: "Cleaned" })).toBe(true);
  expect(cleanupHistoryText({ raw: "Raw", cleaned: "Cleaned" }, true)).toBe("Raw");
  expect(cleanupHistoryText({ raw: "Raw", cleaned: "Cleaned" }, false)).toBe("Cleaned");
});

const applied = (replacements: number): DictationPersonalization => ({
  lexiconRevision: 1,
  activeDomain: null,
  hintMode: "none",
  hintTermIds: [],
  ruleIds: ["rule"],
  termIds: ["term"],
  replacements,
  status: "applied",
});

test("vocabulary-only change is not reported as AI cleanup and the original is the real STT", () => {
  const entry = {
    raw: "открой пим",
    cleaned: "открой PIM",
    cleanupApplied: false,
    personalization: applied(1),
  };
  expect(historyChangeSummary(entry)).toEqual({ cleanup: false, vocabularyReplacements: 1 });
  expect(historyTextVariants(entry)).toEqual(["cleaned", "raw"]);
  expect(historyVariantText(entry, "raw")).toBe("открой пим");
});

test("cleanup failure without replacements and with a PIM replacement read differently", () => {
  const failedPlain = {
    raw: "открой файл",
    cleaned: "открой файл",
    cleanupApplied: false,
    personalization: { ...applied(0), status: "unchanged" as const },
  };
  const failedWithPim = {
    raw: "открой пим",
    cleaned: "открой PIM",
    cleanupApplied: false,
    personalization: applied(1),
  };
  expect(historyChangeSummary(failedPlain)).toEqual({ cleanup: false, vocabularyReplacements: 0 });
  expect(historyTextVariants(failedPlain)).toEqual([]);
  expect(historyChangeSummary(failedWithPim).vocabularyReplacements).toBe(1);
});

test("cleanup plus vocabulary exposes the text before the vocabulary", () => {
  const entry = {
    raw: "открой пим",
    cleaned: "Открой PIM.",
    preVocabularyText: "Открой пим.",
    cleanupApplied: true,
    personalization: applied(1),
  };
  expect(historyTextVariants(entry)).toEqual(["cleaned", "preVocabulary", "raw"]);
  expect(historyVariantText(entry, "preVocabulary")).toBe("Открой пим.");
  expect(historyVariantText(entry, "cleaned")).toBe("Открой PIM.");
  expect(historyChangeSummary(entry)).toEqual({ cleanup: true, vocabularyReplacements: 1 });
});

test("legacy cleaned entries are still attributed to cleanup", () => {
  expect(historyChangeSummary({ raw: "raw", cleaned: "Raw." })).toEqual({
    cleanup: true,
    vocabularyReplacements: 0,
  });
});
