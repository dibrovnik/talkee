/**
 * Deterministic STT hint list for one captured vocabulary snapshot.
 *
 * Rust (`stt_hints.rs`) is the final adapter gate. This module decides which
 * approved canonicals are offered, in a stable order, inside the same budgets,
 * so an over-long term is skipped whole instead of being cut into another word.
 */

import type { VocabularyProvenance, VocabularyState, VocabularyTerm } from "./vocabulary";
import { foldKey } from "./vocabularyNormalization";

export const HINT_LIMITS = {
  maxTerms: 32,
  whisperBytes: 200,
  gpt4oBytes: 640,
  gpt4oPromptBytes: 1024,
} as const;

const HINT_SEPARATOR = ", ";
const DEFAULT_TRANSCRIPTION_ENDPOINT = "https://api.openai.com";

export type HintAdapter = "whisper" | "gpt4o";

export interface VocabularyHintTerm {
  id: string;
  canonical: string;
  provenance: VocabularyProvenance;
}

export interface VocabularyHintSelection {
  adapter: HintAdapter | null;
  terms: string[];
  termIds: string[];
  omitted: number;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function hasControlChar(value: string): boolean {
  return /\p{Cc}/u.test(value);
}

function scopeKey(domain: string | undefined | null): string | null {
  return domain ? foldKey(domain).split(/\s+/).join(" ") : null;
}

function languageMatches(termLanguage: string, dictationLanguage: string): boolean {
  if (termLanguage === "any" || !dictationLanguage || dictationLanguage === "auto") return true;
  return termLanguage.split("-")[0] === dictationLanguage.split("-")[0];
}

function provenanceRank(provenance: VocabularyProvenance): number {
  return provenance === "manual" || provenance === "human-correction" ? 0 : 1;
}

function isGpt4oTranscribe(model: string): boolean {
  return (
    (model.startsWith("gpt-4o-transcribe") || model.startsWith("gpt-4o-mini-transcribe")) &&
    !model.includes("diarize")
  );
}

/** Managed local Whisper ports, matching `local_stt::runtime_kind_for_port`. */
function isManagedWhisperEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost") return false;
  if (!url.port) return false;
  const port = Number(url.port);
  return port === 8000 || port === 8001 || port === 8002 || (port >= 18000 && port <= 18149);
}

/** Batch adapter, or null when the endpoint must stay normalizer-only. */
export function hintAdapterForBatch(endpoint: string, model: string): HintAdapter | null {
  const resolved = endpoint.trim() || DEFAULT_TRANSCRIPTION_ENDPOINT;
  const normalizedModel = model.trim().toLowerCase();
  let url: URL;
  try {
    url = new URL(resolved);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "127.0.0.1" || host === "localhost") {
    return isManagedWhisperEndpoint(resolved) && normalizedModel.startsWith("whisper-")
      ? "whisper"
      : null;
  }
  if (host === "api.groq.com") {
    return normalizedModel.includes("whisper") ? "whisper" : null;
  }
  if (host === "api.openai.com" && normalizedModel === "whisper-1") return "whisper";
  if (host === "api.openai.com" && isGpt4oTranscribe(normalizedModel)) return "gpt4o";
  return null;
}

/** Realtime hints only for an OpenAI transcription session, never translation. */
export function hintAdapterForRealtime(
  provider: string,
  purpose: string,
  model: string,
): HintAdapter | null {
  return provider === "openai" && purpose === "stt" && isGpt4oTranscribe(model.trim().toLowerCase())
    ? "gpt4o"
    : null;
}

function termInScope(term: VocabularyTerm, activeDomain: string | null): boolean {
  const domain = scopeKey(term.scope.domain);
  if (domain === null) return true;
  return domain === scopeKey(activeDomain);
}

/** Approved, enabled, in-scope canonicals. Suggestions and inactive terms stay out. */
export function collectHintTerms(
  state: VocabularyState | null,
  dictationLanguage: string,
): VocabularyHintTerm[] {
  if (!state?.config.enabled) return [];
  const terms: VocabularyHintTerm[] = [];
  for (const term of state.terms) {
    const canonical = term.canonical.trim();
    if (!term.enabled || !term.useAsHint) continue;
    if (!canonical || hasControlChar(canonical)) continue;
    if (!languageMatches(term.language, dictationLanguage)) continue;
    if (!termInScope(term, state.config.activeDomain)) continue;
    terms.push({ id: term.id, canonical, provenance: term.provenance });
  }
  terms.sort(
    (a, b) =>
      provenanceRank(a.provenance) - provenanceRank(b.provenance) ||
      a.canonical.localeCompare(b.canonical) ||
      a.id.localeCompare(b.id),
  );
  return terms;
}

/** Fits the frozen list to the adapter budget. An unknown adapter sends nothing. */
export function selectVocabularyHints(
  terms: readonly VocabularyHintTerm[],
  adapter: HintAdapter | null,
): VocabularyHintSelection {
  if (!adapter) {
    return { adapter, terms: [], termIds: [], omitted: terms.length };
  }
  const budget = adapter === "whisper" ? HINT_LIMITS.whisperBytes : HINT_LIMITS.gpt4oBytes;
  const chosen: VocabularyHintTerm[] = [];
  for (const term of terms) {
    if (chosen.length >= HINT_LIMITS.maxTerms) break;
    const joined = [...chosen.map((item) => item.canonical), term.canonical].join(HINT_SEPARATOR);
    if (utf8Length(joined) > budget) continue;
    chosen.push(term);
  }
  return {
    adapter,
    terms: chosen.map((term) => term.canonical),
    termIds: chosen.map((term) => term.id),
    omitted: terms.length - chosen.length,
  };
}
