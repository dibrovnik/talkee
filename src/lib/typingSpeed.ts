// Pure typing-speed helpers: validate the configured words-per-minute value and
// turn the voice-dictation aggregates into a time-saved estimate.
//
// No Tauri / store imports here: the settings layer and the UI both use these
// functions, and they must stay trivially testable.

import { createEmptyVoiceCost, type TranscriptionStats, type VoiceCostTotals } from "./statsCore";

/** Accepted typing speed range, in words per minute. */
export const MIN_TYPING_WPM = 5;
export const MAX_TYPING_WPM = 250;

/** Value offered in the test UI when the user has not measured a speed yet. */
export const SUGGESTED_TYPING_WPM = 45;

/**
 * Validate a candidate typing speed. Only a positive finite number inside
 * {@link MIN_TYPING_WPM}–{@link MAX_TYPING_WPM} is accepted; NaN, Infinity,
 * zero, negatives, strings and out-of-range values are rejected (undefined),
 * which the settings layer treats as "not stored".
 */
export function normalizeTypingWpm(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  if (value < MIN_TYPING_WPM || value > MAX_TYPING_WPM) {
    return undefined;
  }
  return value;
}

export function isValidTypingWpm(value: unknown): boolean {
  return normalizeTypingWpm(value) !== undefined;
}

/** Finite states of the savings estimate, so the UI never shows a fake number. */
export type TypingSavingsStatus =
  /** Trustworthy estimate over fully measured voice dictation. */
  | "ok"
  /** Estimate exists, but some voice rows lack measurements. */
  | "incomplete"
  /** No typing speed configured — the UI should offer to set one. */
  | "no-speed"
  /** Typing speed configured, but no fully measured voice dictation yet. */
  | "no-data";

export interface TypingSavings {
  status: TypingSavingsStatus;
  /** True only when the number may be shown as a trustworthy saving. */
  trustworthy: boolean;
  /** Seconds saved versus typing, never negative. */
  savingsSec: number;
  /** Seconds the same words would take to type at the configured speed. */
  manualSeconds: number;
  /** Seconds actually spent: recording + measured processing. */
  costSeconds: number;
  /** Words behind the estimate (fully measured voice dictation only). */
  words: number;
  audioSec: number;
  processingSec: number;
  /** Validated typing speed used for the estimate, if any. */
  typingWpm: number | undefined;
  /** Voice dictation rows counted but left out of the estimate. */
  incompleteCount: number;
  /** Voice dictation rows considered in total (complete + incomplete). */
  voiceRows: number;
  /** Share of voice rows lacking at least one measurement, 0–1. */
  incompleteShare: number;
}

/**
 * Estimate the time saved by dictating instead of typing.
 *
 * `manualSeconds = words / typingWpm * 60`, `cost = audioSec + processingSec`
 * and `savings = max(0, manualSeconds - cost)`. Only the complete voice-only
 * aggregates are used, so files, calls and live translation can never change
 * the result.
 */
export function computeTypingSavings(
  stats: TranscriptionStats | null | undefined,
  typingWpm: unknown,
): TypingSavings {
  const cost: VoiceCostTotals = stats?.voiceCost ?? createEmptyVoiceCost();
  const wpm = normalizeTypingWpm(typingWpm);
  const voiceRows = cost.voiceCompletedCount + cost.voiceIncompleteCount;
  const incompleteShare = voiceRows > 0 ? cost.voiceIncompleteCount / voiceRows : 0;
  const measuredCost = cost.voiceAudioSec + cost.voiceProcessingSec;

  const base = {
    savingsSec: 0,
    manualSeconds: 0,
    costSeconds: measuredCost,
    words: cost.voiceWords,
    audioSec: cost.voiceAudioSec,
    processingSec: cost.voiceProcessingSec,
    typingWpm: wpm,
    incompleteCount: cost.voiceIncompleteCount,
    voiceRows,
    incompleteShare,
  };

  if (wpm === undefined) {
    return { ...base, status: "no-speed", trustworthy: false };
  }

  if (cost.voiceCompletedCount <= 0) {
    return { ...base, status: "no-data", trustworthy: false, costSeconds: 0 };
  }

  const manualSeconds = (cost.voiceWords / wpm) * 60;
  const savingsSec = Math.max(0, manualSeconds - measuredCost);

  return {
    ...base,
    status: cost.voiceIncompleteCount > 0 ? "incomplete" : "ok",
    trustworthy: cost.voiceIncompleteCount === 0,
    savingsSec,
    manualSeconds,
  };
}

/** Round a seconds value for display, one decimal is plenty at this scale. */
export function roundSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return 0;
  }
  return Math.round(seconds * 10) / 10;
}
