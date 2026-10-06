import { describe, expect, it } from "bun:test";

import { translate } from "../../../lib/i18n";
import { createEmptyStats, UNKNOWN_MODEL_KEY } from "../../../lib/statsCore";
import {
  chartMaximum,
  chartSlotWidth,
  formatStatsSeconds,
  STATS_PERIOD_DAYS,
  STATS_SOURCE_KEYS,
  sourceLabelKey,
  statModelLabel,
} from "./statsTabView";

const t = (key: Parameters<typeof translate>[1]): string => translate("ru", key);

describe("stats tab view helpers", () => {
  it("maps periods onto look-back windows, with 'all' as no window", () => {
    expect(STATS_PERIOD_DAYS["7"]).toBe(7);
    expect(STATS_PERIOD_DAYS["30"]).toBe(30);
    expect(STATS_PERIOD_DAYS["90"]).toBe(90);
    expect(STATS_PERIOD_DAYS.all).toBeUndefined();
  });

  it("covers exactly the four known sources", () => {
    expect([...STATS_SOURCE_KEYS]).toEqual(["voice", "file", "call", "liveTranslation"]);
    expect(sourceLabelKey("file")).toBe("mainTab.source.file");
    expect(sourceLabelKey("liveTranslation")).toBe("mainTab.source.liveTranslation");
    expect(sourceLabelKey(undefined)).toBe("mainTab.source.voice");
  });

  it("labels the unknown model through i18n instead of the sentinel", () => {
    expect(statModelLabel(UNKNOWN_MODEL_KEY, t)).toBe("Неизвестно");
    expect(statModelLabel(UNKNOWN_MODEL_KEY, t)).not.toContain(UNKNOWN_MODEL_KEY);
    // A real model keeps its own name.
    expect(statModelLabel("whisper-large-v3-turbo", t)).toBe("whisper-large-v3-turbo");
  });

  it("renders missing or negative durations as zero, never as a negative value", () => {
    expect(formatStatsSeconds(0)).toBe("0 с");
    expect(formatStatsSeconds(-5)).toBe("0 с");
    expect(formatStatsSeconds(Number.NaN)).toBe("0 с");
    expect(formatStatsSeconds(3661)).toBe("1 час 1 мин 1 с");
  });

  it("scales charts against the largest positive value", () => {
    expect(chartMaximum([0, 0, 0])).toBe(0);
    expect(chartMaximum([])).toBe(0);
    expect(chartMaximum([3, Number.NaN, -8, 12])).toBe(12);
  });

  it("keeps bar geometry stable for an empty series", () => {
    expect(chartSlotWidth(0, 100)).toBe(100);
    expect(chartSlotWidth(4, 100)).toBe(25);
    expect(chartSlotWidth(Number.NaN, 100)).toBe(100);
  });

  it("works on a freshly migrated stats object without any breakdown", () => {
    const stats = createEmptyStats();
    expect(stats.breakdown).toEqual({});
    expect(stats.voiceCost.voiceCompletedCount).toBe(0);
  });
});
