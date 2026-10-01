import { describe, expect, it } from "bun:test";

import { applyTranscriptionToStats, createEmptyStats, type TranscriptionStats } from "./statsCore";
import { normalizeSavedSettings } from "./store";
import {
  computeTypingSavings,
  isValidTypingWpm,
  MAX_TYPING_WPM,
  MIN_TYPING_WPM,
  normalizeTypingWpm,
  roundSeconds,
} from "./typingSpeed";

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
}

interface RowOptions {
  id: string;
  wordCount: number;
  source?: "voice" | "file" | "call" | "liveTranslation";
  durationSec?: number;
  processingSec?: number;
}

function statsWith(rows: RowOptions[]): TranscriptionStats {
  let stats = createEmptyStats();
  for (const row of rows) {
    stats = applyTranscriptionToStats(stats, {
      id: row.id,
      text: words(row.wordCount),
      source: row.source ?? "voice",
      durationSec: row.durationSec ?? 0,
      processingSec: row.processingSec,
      timestamp: "2026-06-21T10:00:00.000Z",
      status: "completed",
    });
  }
  return stats;
}

describe("normalizeTypingWpm", () => {
  it("accepts a positive finite speed inside 5–250", () => {
    expect(normalizeTypingWpm(MIN_TYPING_WPM)).toBe(5);
    expect(normalizeTypingWpm(MAX_TYPING_WPM)).toBe(250);
    expect(normalizeTypingWpm(45)).toBe(45);
    expect(normalizeTypingWpm(62.5)).toBe(62.5);
  });

  it("rejects NaN, zero, negative, out-of-range and non-numbers", () => {
    const rejected = [
      Number.NaN,
      0,
      -10,
      4.9,
      250.1,
      Number.POSITIVE_INFINITY,
      "50",
      null,
      undefined,
    ];
    for (const value of rejected) {
      expect(normalizeTypingWpm(value)).toBeUndefined();
      expect(isValidTypingWpm(value)).toBe(false);
    }
  });
});

describe("computeTypingSavings", () => {
  it("computes 85 seconds for 100 words at 50 WPM with 30 s + 5 s", () => {
    const stats = statsWith([
      { id: "dictation", wordCount: 100, durationSec: 30, processingSec: 5 },
    ]);

    const savings = computeTypingSavings(stats, 50);

    expect(savings.status).toBe("ok");
    expect(savings.trustworthy).toBe(true);
    expect(savings.manualSeconds).toBe(120);
    expect(savings.costSeconds).toBe(35);
    expect(savings.savingsSec).toBe(85);
    expect(savings.words).toBe(100);
    expect(savings.incompleteCount).toBe(0);
    expect(savings.voiceRows).toBe(1);
    expect(savings.incompleteShare).toBe(0);
  });

  it("ignores files, calls and live translation", () => {
    const voiceOnly = statsWith([
      { id: "dictation", wordCount: 100, durationSec: 30, processingSec: 5 },
    ]);
    const withOtherSources = statsWith([
      { id: "dictation", wordCount: 100, durationSec: 30, processingSec: 5 },
      { id: "call", wordCount: 5000, source: "call", durationSec: 3600, processingSec: 10 },
      { id: "file", wordCount: 900, source: "file", durationSec: 1800, processingSec: 20 },
      {
        id: "live",
        wordCount: 300,
        source: "liveTranslation",
        durationSec: 600,
        processingSec: 3,
      },
    ]);

    expect(computeTypingSavings(withOtherSources, 50).savingsSec).toBe(85);
    expect(computeTypingSavings(withOtherSources, 50)).toEqual(computeTypingSavings(voiceOnly, 50));
  });

  it("never returns a negative saving", () => {
    const stats = statsWith([{ id: "slow", wordCount: 10, durationSec: 30, processingSec: 5 }]);

    const savings = computeTypingSavings(stats, 50);

    expect(savings.manualSeconds).toBe(12);
    expect(savings.costSeconds).toBe(35);
    expect(savings.savingsSec).toBe(0);
  });

  it("asks for a typing speed instead of showing a number when none is set", () => {
    const stats = statsWith([
      { id: "dictation", wordCount: 100, durationSec: 30, processingSec: 5 },
    ]);

    for (const value of [undefined, Number.NaN, 0, 300]) {
      const savings = computeTypingSavings(stats, value);
      expect(savings.status).toBe("no-speed");
      expect(savings.trustworthy).toBe(false);
      expect(savings.savingsSec).toBe(0);
    }
  });

  it("flags an incomplete estimate when voice rows lack measurements", () => {
    const stats = statsWith([
      { id: "measured", wordCount: 100, durationSec: 30, processingSec: 5 },
      { id: "unmeasured", wordCount: 50, durationSec: 20 },
    ]);

    const savings = computeTypingSavings(stats, 50);

    expect(savings.status).toBe("incomplete");
    expect(savings.trustworthy).toBe(false);
    // Only the fully measured row is used: 100 / 50 * 60 - (30 + 5).
    expect(savings.savingsSec).toBe(85);
    expect(savings.incompleteCount).toBe(1);
    expect(savings.voiceRows).toBe(2);
    expect(savings.incompleteShare).toBe(0.5);
  });

  it("reports no data when nothing was measured yet", () => {
    const savings = computeTypingSavings(createEmptyStats(), 50);

    expect(savings.status).toBe("no-data");
    expect(savings.trustworthy).toBe(false);
    expect(savings.savingsSec).toBe(0);
    expect(savings.costSeconds).toBe(0);
    expect(savings.voiceRows).toBe(0);
  });

  it("recomputes from the voice aggregates when the speed changes", () => {
    const stats = statsWith([
      { id: "dictation", wordCount: 100, durationSec: 30, processingSec: 5 },
    ]);

    expect(computeTypingSavings(stats, 50).savingsSec).toBe(85);
    expect(computeTypingSavings(stats, 100).savingsSec).toBe(25);
    expect(computeTypingSavings(stats, MIN_TYPING_WPM).savingsSec).toBe(1165);
  });
});

describe("roundSeconds", () => {
  it("rounds to one decimal and guards non-finite input", () => {
    expect(roundSeconds(84.96)).toBe(85);
    expect(roundSeconds(84.94)).toBe(84.9);
    expect(roundSeconds(Number.NaN)).toBe(0);
  });
});

describe("typing speed settings", () => {
  it("persists only a valid speed and drops the rest", () => {
    expect(normalizeSavedSettings({ typingWpm: 45 }).typingWpm).toBe(45);
    expect(normalizeSavedSettings({ typingWpm: MIN_TYPING_WPM }).typingWpm).toBe(MIN_TYPING_WPM);
    expect(normalizeSavedSettings({ typingWpm: MAX_TYPING_WPM }).typingWpm).toBe(MAX_TYPING_WPM);
    expect(normalizeSavedSettings({ typingWpm: 300 }).typingWpm).toBeUndefined();
    expect(normalizeSavedSettings({ typingWpm: 0 }).typingWpm).toBeUndefined();
    expect(normalizeSavedSettings({ typingWpm: Number.NaN }).typingWpm).toBeUndefined();
    expect(normalizeSavedSettings({ typingWpm: "45" }).typingWpm).toBeUndefined();
    expect(normalizeSavedSettings({}).typingWpm).toBeUndefined();
  });
});
