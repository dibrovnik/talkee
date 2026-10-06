import { describe, expect, test } from "bun:test";
import {
  compactHistoryEntryForStorage,
  type HistoryEntry,
  normalizeHistoryEntryFromStorage,
} from "./store";

const base: HistoryEntry = {
  id: "entry-1",
  timestamp: "2026-10-06T10:00:00.000Z",
  duration: 3,
  raw: "",
  cleaned: "",
  source: "voice",
  status: "completed",
};

const roundTrip = (entry: HistoryEntry): HistoryEntry =>
  normalizeHistoryEntryFromStorage(
    JSON.parse(JSON.stringify(compactHistoryEntryForStorage(entry))) as HistoryEntry,
  );

describe("vocabulary provenance in history", () => {
  test("raw stays the real STT after a vocabulary replacement", () => {
    const entry: HistoryEntry = {
      ...base,
      raw: "открой пим",
      cleaned: "открой PIM",
      cleanupApplied: false,
      personalization: {
        lexiconRevision: 4,
        activeDomain: "Разработка",
        hintMode: "none",
        hintTermIds: [],
        ruleIds: ["rule-pim"],
        termIds: ["term-pim"],
        replacements: 1,
        status: "applied",
      },
    };
    expect(roundTrip(entry)).toEqual(entry);
  });

  test("text before normalization survives compaction next to raw and result", () => {
    const entry: HistoryEntry = {
      ...base,
      raw: "открой пим",
      cleaned: "Открой PIM.",
      preVocabularyText: "Открой пим.",
      cleanupApplied: true,
    };
    expect(roundTrip(entry)).toEqual(entry);
  });

  test("an unchanged dictation still compacts raw and restores it on read", () => {
    const entry: HistoryEntry = { ...base, raw: "просто текст", cleaned: "просто текст" };
    expect(compactHistoryEntryForStorage(entry).raw).toBe("");
    expect(roundTrip(entry).raw).toBe("просто текст");
  });

  test("legacy compacted entries open without invented provenance", () => {
    const legacy = { ...base, raw: "", cleaned: "Старая запись" };
    const opened = normalizeHistoryEntryFromStorage(legacy);
    expect(opened.raw).toBe("Старая запись");
    expect(opened.personalization).toBeUndefined();
    expect(opened.cleanupApplied).toBeUndefined();
    expect(opened.preVocabularyText).toBeUndefined();
  });

  test("malformed provenance fields from storage are dropped instead of breaking the entry", () => {
    const broken = {
      ...base,
      raw: "пим",
      cleaned: "PIM",
      personalization: { status: "maybe" },
      preVocabularyText: 42,
    } as unknown as HistoryEntry;
    const opened = normalizeHistoryEntryFromStorage(broken);
    expect(opened.personalization).toBeUndefined();
    expect(opened.preVocabularyText).toBeUndefined();
    expect(opened.cleaned).toBe("PIM");
  });
});
