import { describe, expect, test } from "bun:test";
import { createEmptyVocabularyState, type VocabularyTerm } from "../../../../lib/vocabulary";
import {
  compileVocabularySnapshot,
  normalizeWithVocabulary,
} from "../../../../lib/vocabularyNormalization";
import {
  draftFromTerm,
  draftToInput,
  filterTerms,
  listDomains,
  newVariantDraft,
  updateVariantDraft,
  validateDraft,
} from "./vocabularyView";

const pim: VocabularyTerm = {
  id: "term-pim",
  canonical: "PIM",
  language: "any",
  category: "service",
  scope: { domain: "Разработка" },
  enabled: true,
  useAsHint: true,
  provenance: "manual",
  variants: [
    {
      id: "v1",
      source: "пи ай эм",
      enabled: true,
      caseSensitive: false,
      contextWords: [],
      provenance: "manual",
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};

describe("vocabulary editor drafts", () => {
  test("a new term defaults to the active domain and no variants", () => {
    const draft = draftFromTerm(null, "Разработка");
    expect(draft).toMatchObject({ scopeKind: "domain", domain: "Разработка", variants: [] });
    expect(draftFromTerm(null, null).scopeKind).toBe("global");
  });

  test("a term-only PIM produces no replacement rules and leaves «пин» alone", () => {
    const draft = { ...draftFromTerm(null, "Разработка"), canonical: "PIM" };
    const input = draftToInput(draft);
    expect(input.variants).toEqual([]);
    const state = createEmptyVocabularyState();
    state.config = { ...state.config, enabled: true, activeDomain: "Разработка" };
    state.terms = [{ ...pim, ...input, id: "term-new", variants: [] } as VocabularyTerm];
    const result = normalizeWithVocabulary(
      "пин и ним в проде",
      compileVocabularySnapshot(state, "ru"),
    );
    expect(result.text).toBe("пин и ним в проде");
    expect(result.replacements).toBe(0);
  });

  test("an unapproved variant never reaches the normalizer", () => {
    const draft = { ...draftFromTerm(null, null), canonical: "PIM" };
    draft.variants = [{ ...newVariantDraft(), source: "пим" }];
    const input = draftToInput(draft);
    const state = createEmptyVocabularyState();
    state.config = { ...state.config, enabled: true };
    state.terms = [
      {
        ...pim,
        ...input,
        id: "term-new",
        scope: { global: true },
        variants: input.variants.map((v, i) => ({ ...v, id: `v${i}`, provenance: "manual" })),
      } as VocabularyTerm,
    ];
    expect(normalizeWithVocabulary("открой пим", compileVocabularySnapshot(state, "ru")).text).toBe(
      "открой пим",
    );
  });

  test("new variants stay disabled until explicitly approved", () => {
    const draft = { ...draftFromTerm(pim, null) };
    draft.variants = [...draft.variants, { ...newVariantDraft(), source: "пин" }];
    const input = draftToInput(draft);
    expect(input.variants.map((v) => [v.source, v.enabled])).toEqual([
      ["пи ай эм", true],
      ["пин", false],
    ]);
  });

  test("editing an approved rule revokes approval until restored or re-approved", () => {
    const [original] = draftFromTerm(pim, null).variants;
    const edited = updateVariantDraft(original, { contextText: "деплой" });
    expect(edited.approved).toBe(false);
    const restored = updateVariantDraft(edited, { contextText: "" });
    expect(restored.approved).toBe(true);
    const caseChanged = updateVariantDraft(original, { caseSensitive: true });
    expect(caseChanged.approved).toBe(false);
    expect(updateVariantDraft(caseChanged, { approved: true }).approved).toBe(true);
  });

  test("draft keeps ids so Rust preserves provenance", () => {
    const input = draftToInput(draftFromTerm(pim, null));
    expect(input.id).toBe("term-pim");
    expect(input.variants[0].id).toBe("v1");
    expect(input.scope).toEqual({ domain: "Разработка" });
  });

  test("local checks keep the typed text for correction", () => {
    expect(validateDraft(draftFromTerm(null, null))).toBe("canonical");
    expect(
      validateDraft({ ...draftFromTerm(null, null), canonical: "X", scopeKind: "domain" }),
    ).toBe("domain");
    const withEmpty = { ...draftFromTerm(pim, null) };
    withEmpty.variants = [...withEmpty.variants, newVariantDraft()];
    expect(validateDraft(withEmpty)).toBe("variantEmpty");
  });
});

describe("vocabulary list", () => {
  const dev: VocabularyTerm = {
    ...pim,
    id: "term-dev",
    canonical: "Dev",
    category: "environment",
    scope: { global: true },
    variants: [],
  };

  test("search covers spelling, variants and domain; category filters", () => {
    expect(filterTerms([pim, dev], "ай", "all").map((t) => t.id)).toEqual(["term-pim"]);
    expect(filterTerms([pim, dev], "разраб", "all").map((t) => t.id)).toEqual(["term-pim"]);
    expect(filterTerms([pim, dev], "", "environment").map((t) => t.id)).toEqual(["term-dev"]);
  });

  test("domains are unique by folded key", () => {
    expect(listDomains([pim, dev], ["разработка", "Медицина", null])).toEqual([
      "Медицина",
      "Разработка",
    ]);
  });
});
