// Pure view helpers for the statistics tab. Kept out of the component so the
// empty/legacy/model-label behaviour can be tested without a Tauri runtime.

import type { MsgKey, TFunc } from "../../../lib/i18n";
import { statModelLabelKey } from "../../../lib/stats";
import { type StatSourceKey, UNKNOWN_MODEL_KEY } from "../../../lib/statsCore";
import { formatDurationMs } from "../../../lib/utils";

export type StatsPeriodValue = "7" | "30" | "90" | "all";

/** `all` has no window, which the selectors read as "all time". */
export const STATS_PERIOD_DAYS: Record<StatsPeriodValue, number | undefined> = {
  "7": 7,
  "30": 30,
  "90": 90,
  all: undefined,
};

export const STATS_SOURCE_KEYS: readonly StatSourceKey[] = [
  "voice",
  "file",
  "call",
  "liveTranslation",
];

/** A missing source means ordinary dictation in the stored aggregates. */
export function sourceLabelKey(source: StatSourceKey | undefined): MsgKey {
  if (source === "file") return "mainTab.source.file";
  if (source === "call") return "mainTab.source.call";
  if (source === "liveTranslation") return "mainTab.source.liveTranslation";
  return "mainTab.source.voice";
}

/**
 * Unknown models are shown through i18n rather than by printing the internal
 * `unknown` sentinel; a known model keeps its own identifier, because the user
 * picked it by that name.
 */
export function statModelLabel(model: string, t: TFunc): string {
  if (model === UNKNOWN_MODEL_KEY) {
    return t("stats.model.unknown");
  }
  const key = statModelLabelKey(model);
  return key ? t(key) : model;
}

/** Seconds rendered with the shared duration formatter (never negative). */
export function formatStatsSeconds(seconds: number, lang: "ru" | "en" = "ru"): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return formatDurationMs(Math.round(safe * 1000), lang);
}

/**
 * Largest value a chart has to scale against. Zero means "nothing to draw", so
 * an empty period renders a flat baseline instead of a broken axis.
 */
export function chartMaximum(values: readonly number[]): number {
  return values.reduce((highest, value) => {
    if (!Number.isFinite(value) || value <= 0) return highest;
    return Math.max(highest, value);
  }, 0);
}

/** Stable slot geometry so bars keep their position when the window resizes. */
export function chartSlotWidth(pointCount: number, width: number): number {
  if (!Number.isFinite(pointCount) || pointCount <= 0) return width;
  return width / pointCount;
}
