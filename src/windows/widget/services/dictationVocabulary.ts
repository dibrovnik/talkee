import type { DictationPersonalization } from "../../../lib/store";
import { type VocabularyClient, vocabularyClient } from "../../../lib/vocabulary";
import {
  compileVocabularySnapshot,
  DISABLED_SNAPSHOT,
  type NormalizeOptions,
  normalizeWithVocabulary,
  type VocabularySnapshot,
} from "../../../lib/vocabularyNormalization";

/** Immutable vocabulary state captured when a dictation attempt starts. */
export interface DictationVocabularyCapture {
  snapshot: VocabularySnapshot;
  /** Safe code when the vocabulary could not be read; dictation continues without it. */
  failure?: "corrupt" | "load_failed";
}

export const NO_VOCABULARY: DictationVocabularyCapture = { snapshot: DISABLED_SNAPSHOT };

/** Never rejects: a missing vocabulary must not fail an otherwise good dictation. */
export async function captureDictationVocabulary(
  dictationLanguage: string,
  client: Pick<VocabularyClient, "getView"> = vocabularyClient(),
): Promise<DictationVocabularyCapture> {
  try {
    const view = await client.getView();
    if (view.status === "corrupt") return { snapshot: DISABLED_SNAPSHOT, failure: "corrupt" };
    return { snapshot: compileVocabularySnapshot(view.state, dictationLanguage) };
  } catch {
    return { snapshot: DISABLED_SNAPSHOT, failure: "load_failed" };
  }
}

export interface VocabularyStageResult {
  text: string;
  replacements: number;
  personalization?: DictationPersonalization;
  /** Safe reason when normalization fell back to its input. */
  failure?: string;
}

/** The single final vocabulary pass, applied after cleanup and before translation. */
export function applyVocabularyStage(
  text: string,
  capture: DictationVocabularyCapture,
  options: NormalizeOptions = {},
): VocabularyStageResult {
  if (!capture.snapshot.enabled) {
    return { text, replacements: 0, failure: capture.failure };
  }
  const result = normalizeWithVocabulary(text, capture.snapshot, options);
  return {
    text: result.text,
    replacements: result.replacements,
    failure: result.reason,
    personalization: {
      lexiconRevision: capture.snapshot.lexiconRevision,
      activeDomain: capture.snapshot.activeDomain,
      hintMode: "none",
      hintTermIds: [],
      ruleIds: result.ruleIds,
      termIds: result.termIds,
      replacements: result.replacements,
      status:
        result.status === "error" ? "error" : result.status === "applied" ? "applied" : "unchanged",
    },
  };
}
