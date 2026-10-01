// Pure, dependency-free statistics logic for transcribed-words tracking.
//
// Kept free of Tauri / store imports so it can be unit-tested in isolation and
// reused from any window. Persistence and event emission live in `stats.ts`.
//
// Schema history:
//   v2 — all-time / day / month / voice totals plus a bounded ring of counted ids.
//   v3 — adds day × source × STT-model buckets (words, completed count, audio and
//        processing seconds) and the voice-dictation cost totals used to estimate
//        the time saved versus typing. v2 data is migrated by keeping the old
//        totals untouched: the new breakdowns start empty and are never
//        back-filled from history, so nothing is counted twice.

export const STATS_VERSION = 3 as const;

/** How many recent transcription ids we remember to de-duplicate re-counts. */
export const COUNTED_IDS_LIMIT = 600;

/** Bucket key used when the STT model was not captured at completion time. */
export const UNKNOWN_MODEL_KEY = "unknown";

export type StatSource = "voice" | "file" | "call" | "liveTranslation" | undefined;
export type StatStatus =
  | "recording"
  | "processing"
  | "completed"
  | "failed"
  | "interrupted"
  | undefined;

/** Concrete (never-undefined) source key used inside the breakdown maps. */
export type StatSourceKey = "voice" | "file" | "call" | "liveTranslation";

export const STAT_SOURCE_KEYS: readonly StatSourceKey[] = [
  "voice",
  "file",
  "call",
  "liveTranslation",
];

/**
 * One day × source × STT-model cell.
 *
 * A measurement that was never taken stays missing: `audioSamples` and
 * `processingSamples` count how many of the completed rows actually carried a
 * value, so `processingSec === 0` with `processingSamples === 0` means
 * "unknown", never "instant".
 */
export interface StatsBucket {
  words: number;
  completedCount: number;
  /** Audio seconds summed over rows that had a duration measurement. */
  audioSec: number;
  /** Processing seconds summed over rows that had a processing measurement. */
  processingSec: number;
  /** Completed rows that carried an audio-duration measurement. */
  audioSamples: number;
  /** Completed rows that carried a processing-time measurement. */
  processingSamples: number;
}

export type StatsModelBuckets = Record<string, StatsBucket>;
export type StatsSourceBuckets = Partial<Record<StatSourceKey, StatsModelBuckets>>;
export type StatsDayBuckets = Record<string, StatsSourceBuckets>;

/**
 * Voice-dictation totals that carry COMPLETE measurements (audio duration and
 * processing time both known). This is the only basis of the typing-savings
 * estimate: files, calls and live translation never contribute to it.
 */
export interface VoiceCostTotals {
  voiceWords: number;
  voiceAudioSec: number;
  voiceProcessingSec: number;
  /** Voice rows behind the cost estimate (all measurements present). */
  voiceCompletedCount: number;
  /** Voice rows counted into the word totals but left out of the estimate. */
  voiceIncompleteCount: number;
}

export interface TranscriptionStats {
  version: number;
  /** Words across every successful transcription, never pruned. */
  allTimeWords: number;
  /** Words bucketed by calendar day, key format `YYYY-MM-DD`. */
  dailyWords: Record<string, number>;
  /** Words bucketed by calendar month, key format `YYYY-MM`. */
  monthlyWords: Record<string, number>;
  /** Words spoken via voice dictation only — basis for the speed metric. */
  voiceWords: number;
  /** Voice dictation seconds accumulated — basis for the speed metric. */
  voiceDurationSec: number;
  /** Bounded ring of already-counted ids, guards against double counting. */
  countedIds: string[];
  /** v3: day → source → STT model → aggregate bucket. */
  breakdown: StatsDayBuckets;
  /** v3: voice dictation rows with complete measurements. */
  voiceCost: VoiceCostTotals;
  updatedAt: string;
}

export interface StatInput {
  id: string;
  text: string;
  source: StatSource;
  durationSec: number;
  timestamp: string;
  status?: StatStatus;
  /** STT model captured at completion time; empty/missing → unknown model. */
  model?: string;
  /** Measured processing time in seconds; `undefined` = never measured. */
  processingSec?: number;
}

export interface TranscriptionStatsView {
  todayWords: number;
  monthWords: number;
  allTimeWords: number;
  /** Average words per minute of voice dictation. */
  averageWpm: number;
  /** Whether enough voice data exists to show a meaningful speed. */
  hasSpeed: boolean;
}

/** Look-back window and dimension filters for the aggregate selectors. */
export interface StatsFilter {
  /** Window in days including today; `undefined` or `<= 0` means all time. */
  days?: number;
  source?: StatSourceKey;
  model?: string;
}

export interface StatsTotals {
  words: number;
  completedCount: number;
  audioSec: number;
  processingSec: number;
  /** Completed rows in scope whose audio duration was never measured. */
  missingAudioCount: number;
  /** Completed rows in scope whose processing time was never measured. */
  missingProcessingCount: number;
}

export interface StatsDailyPoint extends StatsTotals {
  /** Local day key, `YYYY-MM-DD`. */
  day: string;
}

export function createEmptyBucket(): StatsBucket {
  return {
    words: 0,
    completedCount: 0,
    audioSec: 0,
    processingSec: 0,
    audioSamples: 0,
    processingSamples: 0,
  };
}

export function createEmptyVoiceCost(): VoiceCostTotals {
  return {
    voiceWords: 0,
    voiceAudioSec: 0,
    voiceProcessingSec: 0,
    voiceCompletedCount: 0,
    voiceIncompleteCount: 0,
  };
}

export function createEmptyStats(): TranscriptionStats {
  return {
    version: STATS_VERSION,
    allTimeWords: 0,
    dailyWords: {},
    monthlyWords: {},
    voiceWords: 0,
    voiceDurationSec: 0,
    countedIds: [],
    breakdown: {},
    voiceCost: createEmptyVoiceCost(),
    updatedAt: "",
  };
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Keep only entries with a usable finite number value. */
function numberRecord(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = value;
    }
  }
  return result;
}

function normalizeBucket(raw: unknown): StatsBucket {
  const bucket = createEmptyBucket();
  if (!raw || typeof raw !== "object") {
    return bucket;
  }

  const item = raw as Record<string, unknown>;
  return {
    words: finiteOr(item.words, 0),
    completedCount: finiteOr(item.completedCount, 0),
    audioSec: finiteOr(item.audioSec, 0),
    processingSec: finiteOr(item.processingSec, 0),
    audioSamples: finiteOr(item.audioSamples, 0),
    processingSamples: finiteOr(item.processingSamples, 0),
  };
}

function normalizeBreakdown(raw: unknown): StatsDayBuckets {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const breakdown: StatsDayBuckets = {};
  for (const [day, dayValue] of Object.entries(raw as Record<string, unknown>)) {
    if (!dayValue || typeof dayValue !== "object") {
      continue;
    }

    const sources: StatsSourceBuckets = {};
    for (const source of STAT_SOURCE_KEYS) {
      const modelsValue = (dayValue as Record<string, unknown>)[source];
      if (!modelsValue || typeof modelsValue !== "object") {
        continue;
      }

      const models: StatsModelBuckets = {};
      for (const [model, bucketValue] of Object.entries(modelsValue as Record<string, unknown>)) {
        models[model] = normalizeBucket(bucketValue);
      }
      if (Object.keys(models).length > 0) {
        sources[source] = models;
      }
    }

    if (Object.keys(sources).length > 0) {
      breakdown[day] = sources;
    }
  }

  return breakdown;
}

function normalizeVoiceCost(raw: unknown): VoiceCostTotals {
  if (!raw || typeof raw !== "object") {
    return createEmptyVoiceCost();
  }

  const item = raw as Record<string, unknown>;
  return {
    voiceWords: finiteOr(item.voiceWords, 0),
    voiceAudioSec: finiteOr(item.voiceAudioSec, 0),
    voiceProcessingSec: finiteOr(item.voiceProcessingSec, 0),
    voiceCompletedCount: finiteOr(item.voiceCompletedCount, 0),
    voiceIncompleteCount: finiteOr(item.voiceIncompleteCount, 0),
  };
}

/**
 * Repair a value loaded from disk so every field has a usable default.
 *
 * Migrating v2 → v3 keeps all-time / day / month / voice totals as they are and
 * starts the v3 breakdowns empty: old history is never back-filled and old
 * totals are never added on top of already accumulated aggregates.
 */
export function normalizeStats(
  raw: Partial<TranscriptionStats> | null | undefined,
): TranscriptionStats {
  const base = createEmptyStats();
  if (!raw || typeof raw !== "object") {
    return base;
  }

  return {
    version: STATS_VERSION,
    allTimeWords: finiteOr(raw.allTimeWords, 0),
    dailyWords: numberRecord(raw.dailyWords),
    monthlyWords: numberRecord(raw.monthlyWords),
    voiceWords: finiteOr(raw.voiceWords, 0),
    voiceDurationSec: finiteOr(raw.voiceDurationSec, 0),
    countedIds: Array.isArray(raw.countedIds)
      ? raw.countedIds.filter((id) => typeof id === "string")
      : [],
    breakdown: normalizeBreakdown(raw.breakdown),
    voiceCost: normalizeVoiceCost(raw.voiceCost),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
  };
}

// Hiragana/Katakana + CJK Unified (ext A + base) + compatibility ideographs.
const CJK_REGEX = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/g;

/**
 * Count words in a language-robust way: whitespace tokens for alphabetic
 * scripts (Russian, English, ...) plus one word per CJK character, since those
 * scripts are not whitespace-delimited.
 */
export function countWords(text: string): number {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return 0;
  }

  const cjk = (trimmed.match(CJK_REGEX) || []).length;
  const rest = trimmed.replace(CJK_REGEX, " ").trim();
  const restWords = rest ? rest.split(/\s+/).length : 0;
  return cjk + restWords;
}

export function monthKeyOf(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${safe.getFullYear()}-${String(safe.getMonth() + 1).padStart(2, "0")}`;
}

export function dayKeyOf(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${safe.getFullYear()}-${String(safe.getMonth() + 1).padStart(2, "0")}-${String(
    safe.getDate(),
  ).padStart(2, "0")}`;
}

function normalizeSource(source: StatSource): StatSourceKey {
  return source === "file" || source === "call" || source === "liveTranslation" ? source : "voice";
}

/** Empty / missing model names collapse into the explicit unknown sentinel. */
export function normalizeStatModel(model: string | undefined | null): string {
  const trimmed = typeof model === "string" ? model.trim() : "";
  return trimmed ? trimmed : UNKNOWN_MODEL_KEY;
}

export function isUnknownStatModel(model: string): boolean {
  return model === UNKNOWN_MODEL_KEY;
}

/**
 * A measurement counts only when it is a finite positive number. Anything else
 * (missing, zero, NaN, negative) stays "not measured" — never a fake zero.
 */
export function measuredSeconds(value: number | undefined | null): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function statsBucketOf(
  stats: TranscriptionStats,
  day: string,
  source: StatSourceKey,
  model: string,
): StatsBucket | undefined {
  return stats.breakdown[day]?.[source]?.[model];
}

function withBucket(
  breakdown: StatsDayBuckets,
  day: string,
  source: StatSourceKey,
  model: string,
  bucket: StatsBucket,
): StatsDayBuckets {
  const dayBuckets = breakdown[day] ?? {};
  const sourceBuckets = dayBuckets[source] ?? {};
  return {
    ...breakdown,
    [day]: {
      ...dayBuckets,
      [source]: {
        ...sourceBuckets,
        [model]: bucket,
      },
    },
  };
}

/**
 * Fold one transcription into the accumulator. Pure: returns the SAME reference
 * when nothing should change (failed, empty, or already counted) so callers can
 * cheaply detect no-ops with `next === prev`.
 */
export function applyTranscriptionToStats(
  stats: TranscriptionStats,
  input: StatInput,
): TranscriptionStats {
  // Count only finished, successful transcriptions (or legacy entries with no
  // status). Skip processing / failed / interrupted.
  if (input.status && input.status !== "completed") {
    return stats;
  }

  const text = (input.text || "").trim();
  if (!text) {
    return stats;
  }

  if (stats.countedIds.includes(input.id)) {
    return stats;
  }

  const words = countWords(text);
  if (words <= 0) {
    return stats;
  }

  const month = monthKeyOf(input.timestamp);
  const day = dayKeyOf(input.timestamp);
  const source = normalizeSource(input.source);
  const model = normalizeStatModel(input.model);
  const durationSec = measuredSeconds(input.durationSec);
  const processingSec = measuredSeconds(input.processingSec);
  const hasAudio = durationSec !== undefined;
  const hasProcessing = processingSec !== undefined;
  const isVoiceSpeed = source === "voice" && hasAudio;
  const isCompleteVoiceCost = source === "voice" && hasAudio && hasProcessing;

  const countedIds = [...stats.countedIds, input.id];
  if (countedIds.length > COUNTED_IDS_LIMIT) {
    countedIds.splice(0, countedIds.length - COUNTED_IDS_LIMIT);
  }

  const previousBucket = statsBucketOf(stats, day, source, model) ?? createEmptyBucket();
  const nextBucket: StatsBucket = {
    words: previousBucket.words + words,
    completedCount: previousBucket.completedCount + 1,
    audioSec: previousBucket.audioSec + (durationSec ?? 0),
    processingSec: previousBucket.processingSec + (processingSec ?? 0),
    audioSamples: previousBucket.audioSamples + (hasAudio ? 1 : 0),
    processingSamples: previousBucket.processingSamples + (hasProcessing ? 1 : 0),
  };

  const previousCost = stats.voiceCost ?? createEmptyVoiceCost();
  const nextCost: VoiceCostTotals = isCompleteVoiceCost
    ? {
        voiceWords: previousCost.voiceWords + words,
        voiceAudioSec: previousCost.voiceAudioSec + (durationSec as number),
        voiceProcessingSec: previousCost.voiceProcessingSec + (processingSec as number),
        voiceCompletedCount: previousCost.voiceCompletedCount + 1,
        voiceIncompleteCount: previousCost.voiceIncompleteCount,
      }
    : source === "voice"
      ? {
          ...previousCost,
          voiceIncompleteCount: previousCost.voiceIncompleteCount + 1,
        }
      : previousCost;

  return {
    ...stats,
    version: STATS_VERSION,
    allTimeWords: stats.allTimeWords + words,
    dailyWords: {
      ...stats.dailyWords,
      [day]: (stats.dailyWords[day] || 0) + words,
    },
    monthlyWords: {
      ...stats.monthlyWords,
      [month]: (stats.monthlyWords[month] || 0) + words,
    },
    voiceWords: stats.voiceWords + (isVoiceSpeed ? words : 0),
    voiceDurationSec: stats.voiceDurationSec + (isVoiceSpeed ? (durationSec as number) : 0),
    countedIds,
    breakdown: withBucket(stats.breakdown ?? {}, day, source, model, nextBucket),
    voiceCost: nextCost,
    updatedAt: new Date().toISOString(),
  };
}

/** Zeroed view for first render before persisted stats have loaded. */
export function getEmptyView(): TranscriptionStatsView {
  return { todayWords: 0, monthWords: 0, allTimeWords: 0, averageWpm: 0, hasSpeed: false };
}

export function statsToView(
  stats: TranscriptionStats,
  now: Date = new Date(),
): TranscriptionStatsView {
  const month = monthKeyOf(now);
  const day = dayKeyOf(now);
  const hasSpeed = stats.voiceDurationSec > 0 && stats.voiceWords > 0;
  const averageWpm = hasSpeed ? Math.round(stats.voiceWords / (stats.voiceDurationSec / 60)) : 0;

  return {
    todayWords: stats.dailyWords[day] || 0,
    monthWords: stats.monthlyWords[month] || 0,
    allTimeWords: stats.allTimeWords,
    averageWpm,
    hasSpeed,
  };
}

/** Day keys of the look-back window, oldest first, including today. */
export function windowDayKeys(days: number, now: Date = new Date()): string[] {
  const keys: string[] = [];
  const total = Math.max(1, Math.floor(days));
  for (let offset = total - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    date.setDate(date.getDate() - offset);
    keys.push(dayKeyOf(date));
  }
  return keys;
}

function daysInScope(filter: StatsFilter, now: Date): string[] | null {
  const days = filter.days;
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
    return null;
  }
  return windowDayKeys(days, now);
}

function matchesFilter(source: StatSourceKey, model: string, filter: StatsFilter): boolean {
  if (filter.source && filter.source !== source) {
    return false;
  }
  if (filter.model !== undefined && filter.model !== model) {
    return false;
  }
  return true;
}

function emptyTotals(): StatsTotals {
  return {
    words: 0,
    completedCount: 0,
    audioSec: 0,
    processingSec: 0,
    missingAudioCount: 0,
    missingProcessingCount: 0,
  };
}

function addBucket(totals: StatsTotals, bucket: StatsBucket): void {
  totals.words += bucket.words;
  totals.completedCount += bucket.completedCount;
  totals.audioSec += bucket.audioSec;
  totals.processingSec += bucket.processingSec;
  totals.missingAudioCount += Math.max(0, bucket.completedCount - bucket.audioSamples);
  totals.missingProcessingCount += Math.max(0, bucket.completedCount - bucket.processingSamples);
}

/** Totals for one day, or for the whole window when `day` is omitted. */
export function collectTotals(
  stats: TranscriptionStats,
  filter: StatsFilter = {},
  now: Date = new Date(),
): StatsTotals {
  const totals = emptyTotals();
  const scopedDays = daysInScope(filter, now);
  const scope = scopedDays ? new Set(scopedDays) : null;
  const breakdown = stats.breakdown ?? {};

  for (const [day, sources] of Object.entries(breakdown)) {
    if (scope && !scope.has(day)) {
      continue;
    }

    for (const source of STAT_SOURCE_KEYS) {
      const models = sources?.[source];
      if (!models) {
        continue;
      }

      for (const [model, bucket] of Object.entries(models)) {
        if (!matchesFilter(source, model, filter)) {
          continue;
        }
        addBucket(totals, bucket);
      }
    }
  }

  return totals;
}

/**
 * One point per day of the window (oldest first). Days without data are zeroed
 * rather than skipped, so charts can render empty periods without errors.
 */
export function collectDailySeries(
  stats: TranscriptionStats,
  filter: StatsFilter = {},
  now: Date = new Date(),
): StatsDailyPoint[] {
  const scopedDays = daysInScope(filter, now);
  const days = scopedDays ?? Object.keys(stats.breakdown ?? {}).sort();
  const breakdown = stats.breakdown ?? {};

  return days.map((day) => {
    const totals = emptyTotals();
    const sources = breakdown[day];

    for (const source of STAT_SOURCE_KEYS) {
      const models = sources?.[source];
      if (!models) {
        continue;
      }

      for (const [model, bucket] of Object.entries(models)) {
        if (!matchesFilter(source, model, filter)) {
          continue;
        }
        addBucket(totals, bucket);
      }
    }

    return { day, ...totals };
  });
}

/** Every STT model key present in the breakdown, unknown sentinel included. */
export function listStatsModels(stats: TranscriptionStats): string[] {
  const models = new Set<string>();
  for (const sources of Object.values(stats.breakdown ?? {})) {
    for (const source of STAT_SOURCE_KEYS) {
      const buckets = sources?.[source];
      if (!buckets) {
        continue;
      }
      for (const model of Object.keys(buckets)) {
        models.add(model);
      }
    }
  }
  return [...models].sort();
}
