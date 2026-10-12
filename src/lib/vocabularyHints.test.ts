import { describe, expect, test } from "bun:test";
import capabilities from "../../src-tauri/src/vocabulary/fixtures/stt-hint-capabilities.json";
import {
  createEmptyVocabularyState,
  type VocabularyState,
  type VocabularyTerm,
} from "./vocabulary";
import {
  collectHintTerms,
  HINT_LIMITS,
  hintAdapterForBatch,
  hintAdapterForRealtime,
  selectVocabularyHints,
  type VocabularyHintTerm,
} from "./vocabularyHints";

function term(
  extra: Partial<VocabularyTerm> & Pick<VocabularyTerm, "id" | "canonical">,
): VocabularyTerm {
  return {
    language: "any",
    category: "service",
    scope: { global: true },
    enabled: true,
    useAsHint: true,
    provenance: "manual",
    variants: [],
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function state(
  terms: VocabularyTerm[],
  extra: Partial<VocabularyState["config"]> = {},
): VocabularyState {
  const empty = createEmptyVocabularyState();
  return {
    ...empty,
    config: { ...empty.config, enabled: true, ...extra },
    terms,
  };
}

describe("hint adapter whitelist", () => {
  test("matches the shared capability fixture", () => {
    for (const entry of capabilities) {
      expect(entry.adapter).toBe(hintAdapterForBatch(entry.endpoint, entry.model));
    }
  });

  test("realtime hints stay on OpenAI transcription sessions", () => {
    expect(hintAdapterForRealtime("openai", "stt", "gpt-4o-mini-transcribe")).toBe("gpt4o");
    expect(hintAdapterForRealtime("openai", "translation", "gpt-4o-mini-transcribe")).toBeNull();
    expect(hintAdapterForRealtime("deepgram", "stt", "nova-3")).toBeNull();
  });
});

describe("hint selection", () => {
  test("keeps approved active canonicals and drops inactive or unapproved words", () => {
    const selected = collectHintTerms(
      state(
        [
          term({ id: "pim", canonical: "PIM" }),
          term({ id: "off", canonical: "Hidden", enabled: false }),
          term({ id: "no-hint", canonical: "Silent", useAsHint: false }),
          term({ id: "med", canonical: "Dose", scope: { domain: "Медицина" } }),
          term({
            id: "dev",
            canonical: "Dev",
            scope: { domain: "Разработка" },
            provenance: "starter",
          }),
          term({ id: "human", canonical: "Prod", provenance: "human-correction" }),
          term({ id: "en", canonical: "OnlyEnglish", language: "en" }),
          term({ id: "bad", canonical: "Bad\nword" }),
        ],
        { activeDomain: "Разработка" },
      ),
      "ru",
    );
    expect(selected.map((item) => item.canonical)).toEqual(["PIM", "Prod", "Dev"]);
    expect(selectVocabularyHints(selected, null)).toEqual({
      adapter: null,
      terms: [],
      termIds: [],
      omitted: 3,
    });
  });

  test("a disabled dictionary and a corrupt snapshot offer no hints", () => {
    const disabled = createEmptyVocabularyState();
    disabled.terms = [term({ id: "pim", canonical: "PIM" })];
    expect(collectHintTerms(disabled, "ru")).toEqual([]);
    expect(collectHintTerms(null, "ru")).toEqual([]);
  });

  test("skips a term that does not fit instead of cutting it", () => {
    const long = "Я".repeat(120);
    const terms: VocabularyHintTerm[] = [
      { id: "long", canonical: long, provenance: "manual" },
      { id: "short", canonical: "PIM", provenance: "starter" },
    ];
    const whisper = selectVocabularyHints(terms, "whisper");
    expect(whisper.terms).toEqual(["PIM"]);
    expect(whisper.termIds).toEqual(["short"]);
    expect(whisper.omitted).toBe(1);
    expect(new TextEncoder().encode(whisper.terms.join(", ")).length).toBeLessThanOrEqual(
      HINT_LIMITS.whisperBytes,
    );

    const many = Array.from({ length: 40 }, (_, index) => ({
      id: `t${index}`,
      canonical: `T${index}`,
      provenance: "manual" as const,
    }));
    const capped = selectVocabularyHints(many, "gpt4o");
    expect(capped.terms).toHaveLength(HINT_LIMITS.maxTerms);
    expect(capped.omitted).toBe(8);
  });
});
