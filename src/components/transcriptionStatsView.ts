import { statsToView, type TranscriptionStats, windowDayKeys } from "../lib/statsCore";
import { computeTypingSavings } from "../lib/typingSpeed";

/** Home summary shares the Statistics tab's measured, voice-only comparison. */
export function transcriptionStatsView(
  stats: TranscriptionStats,
  typingWpm: unknown,
  now: Date = new Date(),
) {
  const savings = computeTypingSavings(stats, typingWpm);
  const hasComparison = savings.status === "ok" || savings.status === "incomplete";
  return {
    ...statsToView(stats, now),
    savings,
    speedRatio:
      hasComparison && savings.costSeconds > 0
        ? savings.manualSeconds / savings.costSeconds
        : undefined,
    activeDays: windowDayKeys(7, now).filter((day) => (stats.dailyWords[day] ?? 0) > 0).length,
  };
}
