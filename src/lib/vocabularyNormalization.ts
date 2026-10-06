/**
 * Deterministic personal-vocabulary normalizer for the final dictation text.
 *
 * A snapshot is compiled once per recording from approved, enabled rules of the
 * global scope plus the single active domain. Matching runs over the original
 * text: whole words only, longest-leftmost, one pass, protected technical spans
 * untouched, and the output is assembled once from untouched original slices.
 */
import type { VocabularyState } from "./vocabulary";

export const NORMALIZATION_LIMITS = {
  maxTextChars: 50_000,
  maxReplacements: 1000,
  budgetMs: 50,
  contextWindowTokens: 5,
} as const;

interface CompiledRule {
  readonly ruleId: string;
  readonly termId: string;
  readonly target: string;
  readonly keys: readonly string[];
  readonly exact: readonly string[];
  readonly caseSensitive: boolean;
  readonly context: ReadonlySet<string>;
}

export interface VocabularySnapshot {
  readonly enabled: boolean;
  readonly lexiconRevision: number;
  readonly activeDomain: string | null;
  readonly language: string;
  readonly ruleCount: number;
  /** First-token key → rules ordered by descending token count. */
  readonly index: ReadonlyMap<string, readonly CompiledRule[]>;
}

export type NormalizationStatus = "applied" | "unchanged" | "disabled" | "error";
export type NormalizationFailure = "text_too_long" | "too_many_matches" | "time_budget";

export interface NormalizationResult {
  text: string;
  status: NormalizationStatus;
  replacements: number;
  ruleIds: string[];
  termIds: string[];
  reason?: NormalizationFailure;
}

export interface NormalizeOptions {
  /** Injected for tests; defaults to `performance.now`. */
  now?: () => number;
}

const WORD = /[\p{L}\p{M}\p{N}_]+/gu;
const HORIZONTAL_SPACE = /^[ \t\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+$/;
const SENTENCE_BREAK = /[.!?…;\n\r\u2028\u2029]/;

export function foldKey(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

function wordsOf(value: string): string[] {
  return value.match(WORD) ?? [];
}

function scopeKey(domain: string | undefined | null): string | null {
  return domain ? foldKey(domain).split(/\s+/).join(" ") : null;
}

function languageMatches(termLanguage: string, dictationLanguage: string): boolean {
  if (termLanguage === "any" || !dictationLanguage || dictationLanguage === "auto") return true;
  return termLanguage.split("-")[0] === dictationLanguage.split("-")[0];
}

export const DISABLED_SNAPSHOT: VocabularySnapshot = Object.freeze({
  enabled: false,
  lexiconRevision: 0,
  activeDomain: null,
  language: "auto",
  ruleCount: 0,
  index: new Map(),
});

/** Builds an immutable snapshot; later store changes never affect it. */
export function compileVocabularySnapshot(
  state: VocabularyState | null,
  dictationLanguage: string,
): VocabularySnapshot {
  if (!state?.config.enabled) {
    return { ...DISABLED_SNAPSHOT, lexiconRevision: state?.lexiconRevision ?? 0 };
  }
  const active = scopeKey(state.config.activeDomain);
  const buckets = new Map<string, CompiledRule[]>();
  let ruleCount = 0;
  for (const term of state.terms) {
    if (!term.enabled || !languageMatches(term.language, dictationLanguage)) continue;
    const domain = scopeKey(term.scope.domain);
    if (domain !== null && domain !== active) continue;
    for (const variant of term.variants) {
      if (!variant.enabled) continue;
      const exact = wordsOf(variant.source.normalize("NFC"));
      if (exact.length === 0) continue;
      const rule: CompiledRule = Object.freeze({
        ruleId: variant.id,
        termId: term.id,
        target: term.canonical,
        keys: Object.freeze(exact.map(foldKey)),
        exact: Object.freeze(exact),
        caseSensitive: variant.caseSensitive,
        context: new Set(variant.contextWords.map(foldKey)),
      });
      const bucket = buckets.get(rule.keys[0]) ?? [];
      bucket.push(rule);
      buckets.set(rule.keys[0], bucket);
      ruleCount += 1;
    }
  }
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => b.keys.length - a.keys.length || a.ruleId.localeCompare(b.ruleId));
    Object.freeze(bucket);
  }
  return Object.freeze({
    enabled: true,
    lexiconRevision: state.lexiconRevision,
    activeDomain: state.config.activeDomain,
    language: dictationLanguage,
    ruleCount,
    index: buckets,
  });
}

interface Span {
  start: number;
  end: number;
}

const PROTECTED_PATTERNS: RegExp[] = [
  /```[\s\S]*?(?:```|$)/g,
  /`[^`\n]*`/g,
  /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"']+/giu,
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu,
  // Paths and anything slash-joined, e.g. `feature/dev`, `src/pim.ts`, `C:\dev`.
  /[^\s]*[/\\][^\s]*/gu,
  // Dotted/dashed/colon compounds with an ASCII part, e.g. `pim-service`, `app.prod`.
  /[\p{L}\p{N}_]*[A-Za-z0-9][\p{L}\p{N}_]*(?:[.:-][\p{L}\p{N}_]+)+|[\p{L}\p{N}_]+(?:[.:-][\p{L}\p{N}_]*[A-Za-z0-9][\p{L}\p{N}_]*)+/gu,
  // Single identifiers with underscores, letter/digit mixes or inner capitals.
  /[\p{L}\p{N}]*_[\p{L}\p{N}_]*|[\p{L}]+\d[\p{L}\p{N}]*|\d+[\p{L}][\p{L}\p{N}]*|\p{Ll}+\p{Lu}[\p{L}\p{N}]*/gu,
];

export function findProtectedSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const pattern of PROTECTED_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match[0].length > 0) {
        spans.push({ start: match.index, end: match.index + match[0].length });
      }
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

function overlapsAny(spans: Span[], start: number, end: number): boolean {
  for (const span of spans) {
    if (span.start >= end) return false;
    if (span.end > start) return true;
  }
  return false;
}

interface Token {
  start: number;
  end: number;
  key: string;
  exact: string;
  sentence: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let sentence = 0;
  let previousEnd = 0;
  for (const match of text.matchAll(WORD)) {
    if (SENTENCE_BREAK.test(text.slice(previousEnd, match.index))) sentence += 1;
    const exact = match[0].normalize("NFC");
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      key: exact.toLowerCase(),
      exact,
      sentence,
    });
    previousEnd = match.index + match[0].length;
  }
  return tokens;
}

function ruleMatchesAt(text: string, tokens: Token[], at: number, rule: CompiledRule): boolean {
  if (at + rule.keys.length > tokens.length) return false;
  for (let offset = 0; offset < rule.keys.length; offset += 1) {
    const token = tokens[at + offset];
    const same = rule.caseSensitive
      ? token.exact === rule.exact[offset]
      : token.key === rule.keys[offset];
    if (!same) return false;
    if (offset > 0) {
      const gap = text.slice(tokens[at + offset - 1].end, token.start);
      if (!HORIZONTAL_SPACE.test(gap)) return false;
    }
  }
  return true;
}

function contextSatisfied(
  tokens: Token[],
  at: number,
  length: number,
  rule: CompiledRule,
): boolean {
  if (rule.context.size === 0) return true;
  const sentence = tokens[at].sentence;
  const window = NORMALIZATION_LIMITS.contextWindowTokens;
  const from = Math.max(0, at - window);
  const to = Math.min(tokens.length, at + length + window);
  for (let i = from; i < to; i += 1) {
    if (i >= at && i < at + length) continue;
    if (tokens[i].sentence === sentence && rule.context.has(tokens[i].key)) return true;
  }
  return false;
}

function failed(text: string, reason: NormalizationFailure): NormalizationResult {
  return { text, status: "error", replacements: 0, ruleIds: [], termIds: [], reason };
}

/** Applies the snapshot once; on any safety limit the input is returned whole. */
export function normalizeWithVocabulary(
  text: string,
  snapshot: VocabularySnapshot,
  options: NormalizeOptions = {},
): NormalizationResult {
  if (!snapshot.enabled || snapshot.ruleCount === 0 || !text) {
    return {
      text,
      status: snapshot.enabled ? "unchanged" : "disabled",
      replacements: 0,
      ruleIds: [],
      termIds: [],
    };
  }
  if (text.length > NORMALIZATION_LIMITS.maxTextChars) return failed(text, "text_too_long");

  const now = options.now ?? (() => performance.now());
  const deadline = now() + NORMALIZATION_LIMITS.budgetMs;
  const spans = findProtectedSpans(text);
  if (now() > deadline) return failed(text, "time_budget");
  const tokens = tokenize(text);

  const pieces: string[] = [];
  const ruleIds = new Set<string>();
  const termIds = new Set<string>();
  let cursor = 0;
  let replacements = 0;
  let i = 0;
  while (i < tokens.length) {
    if (now() > deadline) return failed(text, "time_budget");
    const candidates = snapshot.index.get(tokens[i].key);
    let consumed = 1;
    if (candidates) {
      for (const rule of candidates) {
        if (!ruleMatchesAt(text, tokens, i, rule)) continue;
        const start = tokens[i].start;
        const end = tokens[i + rule.keys.length - 1].end;
        if (overlapsAny(spans, start, end)) continue;
        if (!contextSatisfied(tokens, i, rule.keys.length, rule)) continue;
        consumed = rule.keys.length;
        if (text.slice(start, end) !== rule.target) {
          replacements += 1;
          if (replacements > NORMALIZATION_LIMITS.maxReplacements) {
            return failed(text, "too_many_matches");
          }
          pieces.push(text.slice(cursor, start), rule.target);
          cursor = end;
          ruleIds.add(rule.ruleId);
          termIds.add(rule.termId);
        }
        break;
      }
    }
    i += consumed;
  }
  if (replacements === 0) {
    return { text, status: "unchanged", replacements: 0, ruleIds: [], termIds: [] };
  }
  pieces.push(text.slice(cursor));
  return {
    text: pieces.join(""),
    status: "applied",
    replacements,
    ruleIds: [...ruleIds],
    termIds: [...termIds],
  };
}
