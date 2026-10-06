import type {
  TermCategory,
  TermInput,
  VocabularyState,
  VocabularyTerm,
  VocabularyVariant,
} from "../../../../lib/vocabulary";
import { foldKey } from "../../../../lib/vocabularyNormalization";

export const TERM_CATEGORIES: TermCategory[] = [
  "acronym",
  "service",
  "environment",
  "tool",
  "product",
  "person",
  "other",
];

export interface VariantDraft {
  /** Stable React key for the row. */
  key: string;
  id?: string;
  source: string;
  caseSensitive: boolean;
  contextText: string;
  /** Explicit permission to replace; reset whenever the rule itself changes. */
  approved: boolean;
  original?: Pick<VocabularyVariant, "source" | "caseSensitive" | "contextWords" | "enabled">;
}

export interface TermDraft {
  id?: string;
  canonical: string;
  language: string;
  category: TermCategory;
  scopeKind: "global" | "domain";
  domain: string;
  enabled: boolean;
  useAsHint: boolean;
  variants: VariantDraft[];
}

let draftKeyCounter = 0;
function nextDraftKey(): string {
  draftKeyCounter += 1;
  return `draft-${draftKeyCounter}`;
}

export function parseContextWords(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

export function newVariantDraft(source = ""): VariantDraft {
  return {
    key: nextDraftKey(),
    source,
    caseSensitive: false,
    contextText: "",
    approved: false,
  };
}

export function draftFromTerm(term: VocabularyTerm | null, activeDomain: string | null): TermDraft {
  if (!term) {
    return {
      canonical: "",
      language: "any",
      category: "other",
      scopeKind: activeDomain ? "domain" : "global",
      domain: activeDomain ?? "",
      enabled: true,
      useAsHint: true,
      variants: [],
    };
  }
  return {
    id: term.id,
    canonical: term.canonical,
    language: term.language,
    category: term.category,
    scopeKind: term.scope.domain ? "domain" : "global",
    domain: term.scope.domain ?? "",
    enabled: term.enabled,
    useAsHint: term.useAsHint,
    variants: term.variants.map((variant) => ({
      key: nextDraftKey(),
      id: variant.id,
      source: variant.source,
      caseSensitive: variant.caseSensitive,
      contextText: variant.contextWords.join(", "),
      approved: variant.enabled,
      original: {
        source: variant.source,
        caseSensitive: variant.caseSensitive,
        contextWords: variant.contextWords,
        enabled: variant.enabled,
      },
    })),
  };
}

/** A rule edit (source, case or context) revokes the earlier approval. */
export function variantRuleChanged(variant: VariantDraft): boolean {
  if (!variant.original) return true;
  const context = parseContextWords(variant.contextText);
  return (
    variant.source.trim() !== variant.original.source ||
    variant.caseSensitive !== variant.original.caseSensitive ||
    context.join("\u0000") !== variant.original.contextWords.join("\u0000")
  );
}

export function updateVariantDraft(
  variant: VariantDraft,
  patch: Partial<Pick<VariantDraft, "source" | "caseSensitive" | "contextText" | "approved">>,
): VariantDraft {
  const next = { ...variant, ...patch };
  const ruleEdit =
    patch.source !== undefined ||
    patch.caseSensitive !== undefined ||
    patch.contextText !== undefined;
  if (ruleEdit && patch.approved === undefined) {
    next.approved = !variantRuleChanged(next) && Boolean(next.original?.enabled);
  }
  return next;
}

export type DraftProblem = "canonical" | "domain" | "variantEmpty";

export function validateDraft(draft: TermDraft): DraftProblem | null {
  if (!draft.canonical.trim()) return "canonical";
  if (draft.scopeKind === "domain" && !draft.domain.trim()) return "domain";
  if (draft.variants.some((variant) => !variant.source.trim())) return "variantEmpty";
  return null;
}

export function draftToInput(draft: TermDraft): TermInput {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    canonical: draft.canonical.trim(),
    language: draft.language,
    category: draft.category,
    scope: draft.scopeKind === "domain" ? { domain: draft.domain.trim() } : { global: true },
    enabled: draft.enabled,
    useAsHint: draft.useAsHint,
    variants: draft.variants.map((variant) => ({
      ...(variant.id ? { id: variant.id } : {}),
      source: variant.source.trim(),
      enabled: variant.approved,
      caseSensitive: variant.caseSensitive,
      contextWords: parseContextWords(variant.contextText),
    })),
  };
}

/** Distinct domain names by folded key, keeping the first spelling. */
export function listDomains(terms: VocabularyTerm[], extra: Array<string | null> = []): string[] {
  const seen = new Map<string, string>();
  for (const name of [...terms.map((term) => term.scope.domain), ...extra]) {
    if (name && !seen.has(foldKey(name))) seen.set(foldKey(name), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"));
}

export function filterTerms(
  terms: VocabularyTerm[],
  query: string,
  category: TermCategory | "all",
): VocabularyTerm[] {
  const needle = foldKey(query.trim());
  return terms
    .filter((term) => category === "all" || term.category === category)
    .filter(
      (term) =>
        !needle ||
        [term.canonical, term.scope.domain ?? "", ...term.variants.map((v) => v.source)].some(
          (value) => foldKey(value).includes(needle),
        ),
    )
    .sort((a, b) => a.canonical.localeCompare(b.canonical, "ru"));
}

export function activeRuleCount(term: VocabularyTerm): number {
  return term.variants.filter((variant) => variant.enabled).length;
}

export function readySuggestionCount(state: VocabularyState): number {
  return state.suggestions.filter((suggestion) => suggestion.status === "ready").length;
}
