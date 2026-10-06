import type { HistoryEntry } from "./store";

type HistoryTextFields = Pick<HistoryEntry, "cleaned"> &
  Partial<Pick<HistoryEntry, "raw" | "preVocabularyText" | "cleanupApplied" | "personalization">>;

/** `cleaned` is the final result, `raw` the real STT, `preVocabulary` the cleanup output. */
export type HistoryTextVariant = "cleaned" | "raw" | "preVocabulary";

export function hasOriginalCleanupText(
  entry: Pick<HistoryEntry, "cleaned"> & Partial<Pick<HistoryEntry, "raw">>,
): boolean {
  return !!entry.raw && entry.raw !== entry.cleaned;
}

export function cleanupHistoryText(
  entry: Pick<HistoryEntry, "cleaned"> & Partial<Pick<HistoryEntry, "raw">>,
  original: boolean,
): string {
  return original && entry.raw ? entry.raw : entry.cleaned;
}

export function historyTextVariants(entry: HistoryTextFields): HistoryTextVariant[] {
  if (!hasOriginalCleanupText(entry)) return [];
  return entry.preVocabularyText ? ["cleaned", "preVocabulary", "raw"] : ["cleaned", "raw"];
}

export function historyVariantText(entry: HistoryTextFields, variant: HistoryTextVariant): string {
  if (variant === "preVocabulary" && entry.preVocabularyText) return entry.preVocabularyText;
  return cleanupHistoryText(entry, variant === "raw");
}

export interface HistoryChangeSummary {
  cleanup: boolean;
  vocabularyReplacements: number;
}

/** Legacy entries without provenance: any raw/result difference came from cleanup. */
export function historyChangeSummary(entry: HistoryTextFields): HistoryChangeSummary {
  const vocabularyReplacements =
    entry.personalization?.status === "applied" ? entry.personalization.replacements : 0;
  const cleanup = entry.cleanupApplied ?? (!entry.personalization && hasOriginalCleanupText(entry));
  return { cleanup, vocabularyReplacements };
}
