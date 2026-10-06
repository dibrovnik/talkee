import { describe, expect, it } from "bun:test";

import {
  applyTranscriptionToStats,
  collectDailySeries,
  collectTotals,
  countWords,
  createEmptyStats,
  dayKeyOf,
  isUnknownStatModel,
  listStatsModels,
  measuredSeconds,
  monthKeyOf,
  normalizeStatModel,
  normalizeStats,
  STATS_VERSION,
  type StatInput,
  statsBucketOf,
  statsToView,
  type TranscriptionStats,
  UNKNOWN_MODEL_KEY,
  windowDayKeys,
} from "./statsCore";

function input(overrides: Partial<StatInput> = {}): StatInput {
  return {
    id: "id-1",
    text: "one two three",
    source: "voice",
    durationSec: 60,
    timestamp: "2026-06-21T10:00:00.000Z",
    status: "completed",
    ...overrides,
  };
}

describe("countWords", () => {
  it("counts whitespace-separated words for Latin and Cyrillic", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords("привет как дела")).toBe(3);
    expect(countWords("  spaced   out \n words ")).toBe(3);
  });

  it("returns 0 for empty or whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
  });

  it("counts CJK characters individually and mixes with words", () => {
    expect(countWords("你好")).toBe(2); // 你好
    expect(countWords("hello 你好 world")).toBe(4);
  });
});

describe("monthKeyOf", () => {
  it("formats YYYY-MM and falls back for invalid input", () => {
    expect(monthKeyOf("2026-06-21T10:00:00.000Z")).toBe("2026-06");
    expect(monthKeyOf("2026-01-02T00:00:00.000Z")).toBe("2026-01");
    expect(typeof monthKeyOf("not-a-date")).toBe("string");
  });
});

describe("dayKeyOf", () => {
  it("formats YYYY-MM-DD and falls back for invalid input", () => {
    expect(dayKeyOf("2026-06-21T10:00:00.000Z")).toBe("2026-06-21");
    expect(dayKeyOf("2026-01-02T12:00:00.000Z")).toBe("2026-01-02");
    expect(typeof dayKeyOf("not-a-date")).toBe("string");
  });
});

describe("applyTranscriptionToStats", () => {
  it("adds words to all-time, day, and month buckets", () => {
    const next = applyTranscriptionToStats(createEmptyStats(), input());
    expect(next.allTimeWords).toBe(3);
    expect(next.dailyWords["2026-06-21"]).toBe(3);
    expect(next.monthlyWords["2026-06"]).toBe(3);
    expect(next.countedIds).toContain("id-1");
  });

  it("de-duplicates the same id (retry / copy / paste)", () => {
    const first = applyTranscriptionToStats(createEmptyStats(), input());
    const second = applyTranscriptionToStats(first, input());
    expect(second).toBe(first); // same reference => no-op
    expect(second.allTimeWords).toBe(3);
  });

  it("ignores failed and empty transcriptions", () => {
    const empty = createEmptyStats();
    expect(applyTranscriptionToStats(empty, input({ status: "failed" }))).toBe(empty);
    expect(applyTranscriptionToStats(empty, input({ id: "x", text: "   " }))).toBe(empty);
  });

  it("ignores non-final statuses (processing / interrupted) even with text", () => {
    const empty = createEmptyStats();
    expect(applyTranscriptionToStats(empty, input({ status: "processing" }))).toBe(empty);
    expect(applyTranscriptionToStats(empty, input({ id: "y", status: "interrupted" }))).toBe(empty);
  });

  it("counts legacy entries that have no status", () => {
    const next = applyTranscriptionToStats(createEmptyStats(), input({ status: undefined }));
    expect(next.allTimeWords).toBe(3);
  });

  it("accumulates voice words/seconds for the speed metric", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(stats, input({ id: "a", text: "one two", durationSec: 60 }));
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "b", text: "three four", durationSec: 60 }),
    );
    expect(stats.voiceWords).toBe(4);
    expect(stats.voiceDurationSec).toBe(120);
  });

  it("excludes file/call sources from the speed metric but still counts words", () => {
    const stats = applyTranscriptionToStats(
      createEmptyStats(),
      input({ id: "f", source: "file", text: "a b c d", durationSec: 3600 }),
    );
    expect(stats.allTimeWords).toBe(4);
    expect(stats.voiceWords).toBe(0);
    expect(stats.voiceDurationSec).toBe(0);
  });

  it("buckets words by the month of the entry timestamp", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "m1", timestamp: "2026-05-30T23:00:00.000Z", text: "may words here" }),
    );
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "m2", timestamp: "2026-06-01T01:00:00.000Z", text: "june now" }),
    );
    expect(stats.monthlyWords["2026-05"]).toBe(3);
    expect(stats.monthlyWords["2026-06"]).toBe(2);
    expect(stats.allTimeWords).toBe(5);
  });

  it("buckets words by the day of the entry timestamp", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "d1", timestamp: "2026-06-20T10:00:00.000Z", text: "one two" }),
    );
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "d2", timestamp: "2026-06-21T10:00:00.000Z", text: "three four five" }),
    );
    expect(stats.dailyWords["2026-06-20"]).toBe(2);
    expect(stats.dailyWords["2026-06-21"]).toBe(3);
    expect(stats.monthlyWords["2026-06"]).toBe(5);
  });
});

describe("statsToView", () => {
  it("computes average WPM from voice totals", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "a", text: "one two three four", durationSec: 60 }),
    );
    const view = statsToView(stats, new Date("2026-06-21T12:00:00.000Z"));
    expect(view.hasSpeed).toBe(true);
    expect(view.averageWpm).toBe(4); // 4 words / 1 minute
    expect(view.todayWords).toBe(4);
    expect(view.monthWords).toBe(4);
    expect(view.allTimeWords).toBe(4);
  });

  it("reports no speed when there is no voice data", () => {
    const view = statsToView(createEmptyStats(), new Date("2026-06-21T12:00:00.000Z"));
    expect(view.hasSpeed).toBe(false);
    expect(view.averageWpm).toBe(0);
  });

  it("shows only today's and the current month's words", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "may", timestamp: "2026-05-10T10:00:00.000Z", text: "a b" }),
    );
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "jun-old", timestamp: "2026-06-10T10:00:00.000Z", text: "c d e" }),
    );
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "jun-today", timestamp: "2026-06-21T10:00:00.000Z", text: "f g h i" }),
    );
    const view = statsToView(stats, new Date("2026-06-21T12:00:00.000Z"));
    expect(view.todayWords).toBe(4);
    expect(view.monthWords).toBe(7);
    expect(view.allTimeWords).toBe(9);
  });
});

describe("normalizeStats", () => {
  it("repairs missing/garbage fields", () => {
    expect(normalizeStats(null)).toEqual(createEmptyStats());
    const repaired = normalizeStats({ allTimeWords: 10 } as never);
    expect(repaired.allTimeWords).toBe(10);
    expect(repaired.dailyWords).toEqual({});
    expect(repaired.monthlyWords).toEqual({});
    expect(repaired.countedIds).toEqual([]);
    expect(repaired.breakdown).toEqual({});
    expect(repaired.voiceCost.voiceWords).toBe(0);
  });

  it("migrates legacy v2 totals without back-filling the v3 breakdowns", () => {
    const legacy = {
      version: 2,
      allTimeWords: 1000,
      dailyWords: { "2026-06-20": 40, "2026-06-21": 25 },
      monthlyWords: { "2026-06": 65 },
      voiceWords: 50,
      voiceDurationSec: 120,
      countedIds: ["old-1", "old-2"],
      updatedAt: "2026-06-21T10:00:00.000Z",
    } as Partial<TranscriptionStats>;

    const migrated = normalizeStats(legacy);

    expect(migrated.version).toBe(STATS_VERSION);
    // Old totals survive untouched ...
    expect(migrated.allTimeWords).toBe(1000);
    expect(migrated.dailyWords["2026-06-21"]).toBe(25);
    expect(migrated.monthlyWords["2026-06"]).toBe(65);
    expect(migrated.voiceWords).toBe(50);
    expect(migrated.voiceDurationSec).toBe(120);
    expect(migrated.countedIds).toEqual(["old-1", "old-2"]);
    // ... and the new breakdowns start empty instead of being guessed from them.
    expect(migrated.breakdown).toEqual({});
    expect(migrated.voiceCost.voiceWords).toBe(0);
    expect(migrated.voiceCost.voiceIncompleteCount).toBe(0);
  });

  it("does not add legacy totals on top of already accumulated v3 aggregates", () => {
    const stored = {
      version: 2,
      allTimeWords: 100,
      dailyWords: { "2026-06-21": 100 },
      monthlyWords: { "2026-06": 100 },
      voiceWords: 100,
      voiceDurationSec: 60,
      countedIds: ["legacy"],
      breakdown: {
        "2026-06-21": {
          voice: {
            "whisper-1": {
              words: 100,
              completedCount: 1,
              audioSec: 60,
              processingSec: 10,
              audioSamples: 1,
              processingSamples: 1,
            },
          },
        },
      },
      voiceCost: {
        voiceWords: 100,
        voiceAudioSec: 60,
        voiceProcessingSec: 10,
        voiceCompletedCount: 1,
        voiceIncompleteCount: 0,
      },
    } as unknown as Partial<TranscriptionStats>;

    const normalized = normalizeStats(stored);
    expect(normalized.allTimeWords).toBe(100);
    expect(normalized.breakdown["2026-06-21"]?.voice?.["whisper-1"]?.words).toBe(100);

    // A migrated v2 blob without a breakdown must stay empty after re-reading.
    const migratedAgain = normalizeStats(normalizeStats({ version: 2, allTimeWords: 100 }));
    expect(migratedAgain.allTimeWords).toBe(100);
    expect(migratedAgain.breakdown).toEqual({});
  });
});

describe("v3 breakdown aggregates", () => {
  it("buckets words, completed count, audio and processing by day × source × model", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(
      stats,
      input({
        id: "v1",
        text: "one two three",
        durationSec: 30,
        processingSec: 5,
        model: "whisper-1",
      }),
    );

    const bucket = statsBucketOf(stats, "2026-06-21", "voice", "whisper-1");
    expect(bucket).toEqual({
      words: 3,
      completedCount: 1,
      audioSec: 30,
      processingSec: 5,
      audioSamples: 1,
      processingSamples: 1,
    });
  });

  it("keeps separate buckets per source and per model", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "voice", text: "a b", source: "voice", model: "whisper-1" }),
    );
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "file", text: "c d e", source: "file", model: "whisper-large-v3" }),
    );
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "call", text: "f", source: "call", model: "whisper-1" }),
    );

    expect(statsBucketOf(stats, "2026-06-21", "voice", "whisper-1")?.words).toBe(2);
    expect(statsBucketOf(stats, "2026-06-21", "file", "whisper-large-v3")?.words).toBe(3);
    expect(statsBucketOf(stats, "2026-06-21", "call", "whisper-1")?.words).toBe(1);
    expect(listStatsModels(stats)).toEqual(["whisper-1", "whisper-large-v3"]);
  });

  it("stores an unknown model under the sentinel key and keeps the global counter", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "no-model", text: "one two three four", model: undefined }),
    );

    expect(normalizeStatModel(undefined)).toBe(UNKNOWN_MODEL_KEY);
    expect(normalizeStatModel("   ")).toBe(UNKNOWN_MODEL_KEY);
    expect(isUnknownStatModel(UNKNOWN_MODEL_KEY)).toBe(true);
    expect(listStatsModels(stats)).toEqual([UNKNOWN_MODEL_KEY]);
    expect(statsBucketOf(stats, "2026-06-21", "voice", UNKNOWN_MODEL_KEY)?.words).toBe(4);
    // The existing global word counter is preserved next to the breakdown.
    expect(stats.allTimeWords).toBe(4);
    expect(stats.dailyWords["2026-06-21"]).toBe(4);
  });

  it("never invents measurements for rows without them", () => {
    let stats = createEmptyStats();
    // Audio measured, processing time missing.
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "no-processing", text: "one two", durationSec: 30, model: "whisper-1" }),
    );
    // Nothing measured at all.
    stats = applyTranscriptionToStats(
      stats,
      input({ id: "no-measurements", text: "three", durationSec: 0, model: "whisper-1" }),
    );

    const bucket = statsBucketOf(stats, "2026-06-21", "voice", "whisper-1");
    expect(bucket?.completedCount).toBe(2);
    expect(bucket?.words).toBe(3);
    expect(bucket?.audioSec).toBe(30);
    expect(bucket?.audioSamples).toBe(1);
    expect(bucket?.processingSec).toBe(0);
    expect(bucket?.processingSamples).toBe(0);
    expect(stats.voiceCost.voiceCompletedCount).toBe(0);
    expect(stats.voiceCost.voiceIncompleteCount).toBe(2);
    expect(stats.voiceCost.voiceWords).toBe(0);
    expect(measuredSeconds(0)).toBeUndefined();
    expect(measuredSeconds(Number.NaN)).toBeUndefined();
    expect(measuredSeconds(2.5)).toBe(2.5);
  });

  it("only accumulates the voice cost for rows with complete measurements", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(
      stats,
      input({
        id: "complete",
        text: "one two three four",
        durationSec: 30,
        processingSec: 5,
        model: "whisper-1",
      }),
    );
    stats = applyTranscriptionToStats(
      stats,
      input({
        id: "call",
        text: "five six",
        source: "call",
        durationSec: 600,
        processingSec: 60,
        model: "whisper-1",
      }),
    );

    expect(stats.voiceCost).toEqual({
      voiceWords: 4,
      voiceAudioSec: 30,
      voiceProcessingSec: 5,
      voiceCompletedCount: 1,
      voiceIncompleteCount: 0,
    });
    // v2 speed fields stay on the audio-measured voice rows.
    expect(stats.voiceWords).toBe(4);
    expect(stats.voiceDurationSec).toBe(30);
  });

  it("does not double count a repeated result", () => {
    const first = applyTranscriptionToStats(createEmptyStats(), input({ id: "same" }));
    const second = applyTranscriptionToStats(first, input({ id: "same" }));
    expect(second).toBe(first);
    expect(statsBucketOf(second, "2026-06-21", "voice", UNKNOWN_MODEL_KEY)?.completedCount).toBe(1);
  });

  it("keeps failed and intermediate results out of the successful metrics", () => {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(stats, input({ id: "failed", status: "failed" }));
    stats = applyTranscriptionToStats(stats, input({ id: "processing", status: "processing" }));
    stats = applyTranscriptionToStats(stats, input({ id: "interrupted", status: "interrupted" }));

    expect(stats.breakdown).toEqual({});
    expect(stats.allTimeWords).toBe(0);
    expect(collectTotals(stats).completedCount).toBe(0);
  });
});

describe("aggregate selectors", () => {
  const now = new Date("2026-06-21T12:00:00.000Z");

  function seeded(): TranscriptionStats {
    let stats = createEmptyStats();
    stats = applyTranscriptionToStats(
      stats,
      input({
        id: "today-voice",
        timestamp: "2026-06-21T10:00:00.000Z",
        text: "one two three",
        durationSec: 30,
        processingSec: 5,
        model: "whisper-1",
      }),
    );
    stats = applyTranscriptionToStats(
      stats,
      input({
        id: "old-file",
        timestamp: "2026-05-01T10:00:00.000Z",
        text: "a b c d e",
        source: "file",
        durationSec: 300,
        processingSec: 60,
        model: "whisper-large-v3",
      }),
    );
    return stats;
  }

  it("returns zeros for an empty period without errors", () => {
    const empty = createEmptyStats();
    expect(collectTotals(empty, { days: 30 }, now)).toEqual({
      words: 0,
      completedCount: 0,
      audioSec: 0,
      processingSec: 0,
      missingAudioCount: 0,
      missingProcessingCount: 0,
    });
    const series = collectDailySeries(empty, { days: 3 }, now);
    expect(series.map((point) => point.day)).toEqual(["2026-06-19", "2026-06-20", "2026-06-21"]);
    expect(series.every((point) => point.words === 0 && point.completedCount === 0)).toBe(true);
    expect(collectDailySeries(empty)).toEqual([]);
  });

  it("scopes totals to the requested window", () => {
    const stats = seeded();
    expect(collectTotals(stats, {}, now).words).toBe(8);
    expect(collectTotals(stats, { days: 30 }, now).words).toBe(3);
    expect(collectTotals(stats).words).toBe(8);
  });

  it("filters by source and by model", () => {
    const stats = seeded();
    expect(collectTotals(stats, { source: "file" }, now)).toEqual({
      words: 5,
      completedCount: 1,
      audioSec: 300,
      processingSec: 60,
      missingAudioCount: 0,
      missingProcessingCount: 0,
    });
    expect(collectTotals(stats, { model: "whisper-1" }, now).words).toBe(3);
    expect(collectTotals(stats, { model: UNKNOWN_MODEL_KEY }, now).words).toBe(0);
  });

  it("counts rows that lack measurements", () => {
    const stats = applyTranscriptionToStats(
      createEmptyStats(),
      input({ id: "partial", text: "one two", durationSec: 10, processingSec: undefined }),
    );
    expect(collectTotals(stats).missingProcessingCount).toBe(1);
    expect(collectTotals(stats).missingAudioCount).toBe(0);
  });

  it("builds a zero-filled daily series across the window", () => {
    const series = collectDailySeries(seeded(), { days: 3 }, now);
    expect(series.map((point) => [point.day, point.words])).toEqual([
      ["2026-06-19", 0],
      ["2026-06-20", 0],
      ["2026-06-21", 3],
    ]);
    expect(windowDayKeys(2, now)).toEqual(["2026-06-20", "2026-06-21"]);
  });
});
