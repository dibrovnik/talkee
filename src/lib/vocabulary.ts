/**
 * Personal vocabulary contract v1, mirrored from `src-tauri/src/vocabulary/model.rs`.
 * Rust owns every durable mutation; this module only reads snapshots and sends
 * typed compare-and-swap commands.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const VOCABULARY_SCHEMA_VERSION = 1;
export const VOCABULARY_UPDATED_EVENT = "vocabulary:updated";

export const VOCABULARY_LIMITS = {
  terms: 1000,
  variantsPerTerm: 20,
  suggestions: 500,
  evidence: 1000,
  dismissals: 2000,
  quoteChars: 300,
  contextWords: 5,
  textChars: 64,
  minVariantChars: 2,
  stateBytes: 5 * 1024 * 1024,
} as const;

export type TermCategory =
  | "acronym"
  | "service"
  | "environment"
  | "tool"
  | "product"
  | "person"
  | "other";
export type VocabularyProvenance =
  | "manual"
  | "starter"
  | "import"
  | "human-correction"
  | "history-analysis";
export type EvidenceOrigin = "human-correction" | "cleanup-diff" | "stt-hypothesis";
export type SuggestionStatus = "collecting" | "ready" | "approved" | "rejected";
export type AnalysisSchedule = "off" | "daily" | "weekly";
export type AnalysisJobMode = "full" | "new" | "resume" | "periodic";
export type AnalysisJobStatus =
  | "idle"
  | "preparing"
  | "running"
  | "completed"
  | "paused"
  | "cancelled"
  | "failed"
  | "needs-attention";

/** Exactly one of `{ global: true }` or `{ domain }`. */
export interface TermScope {
  global?: true;
  domain?: string;
}

export interface VocabularyVariant {
  id: string;
  source: string;
  enabled: boolean;
  caseSensitive: boolean;
  contextWords: string[];
  provenance: VocabularyProvenance;
}

export interface VocabularyTerm {
  id: string;
  canonical: string;
  language: string;
  category: TermCategory;
  scope: TermScope;
  enabled: boolean;
  useAsHint: boolean;
  provenance: VocabularyProvenance;
  variants: VocabularyVariant[];
  createdAt: number;
  updatedAt: number;
}

export interface SuggestionVariant {
  source: string;
  caseSensitive: boolean;
  contextWords: string[];
  selected: boolean;
}

export interface VocabularySuggestion {
  id: string;
  canonical: string;
  language: string;
  category: TermCategory;
  scope: TermScope;
  variants: SuggestionVariant[];
  status: SuggestionStatus;
  origin: EvidenceOrigin;
  sourceCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface VocabularyEvidence {
  id: string;
  suggestionId: string;
  origin: EvidenceOrigin;
  sourceId: string;
  sourceFingerprint: string;
  quote: string;
  sourceVariant: string;
  rangeStart: number;
  rangeEnd: number;
  createdAt: number;
}

export interface VocabularyDismissal {
  key: string;
  createdAt: number;
}

export interface VocabularyCoverage {
  sourceId: string;
  fingerprint: string;
  ranges: Array<[number, number]>;
}

export interface AnalysisJobRecord {
  mode: AnalysisJobMode;
  status: AnalysisJobStatus;
  backendFingerprint: string | null;
  requests: number;
  processedSources: number;
  remainingSources: number;
  startedAt: number;
  finishedAt: number | null;
  reason: string | null;
}

export interface ApiConsent {
  fingerprint: string;
  endpointLabel: string;
  model: string;
  grantedAt: number;
}

export interface VocabularyConfig {
  enabled: boolean;
  activeDomain: string | null;
  analysisSchedule: AnalysisSchedule;
  lastScheduledAttemptAt: number | null;
  learningClearedAt: number | null;
  manualApiConsent: ApiConsent | null;
  periodicApiConsent: ApiConsent | null;
}

export interface VocabularyState {
  schemaVersion: number;
  revision: number;
  lexiconRevision: number;
  dataEpoch: number;
  config: VocabularyConfig;
  terms: VocabularyTerm[];
  suggestions: VocabularySuggestion[];
  evidence: VocabularyEvidence[];
  dismissals: VocabularyDismissal[];
  coverage: VocabularyCoverage[];
  lastJob: AnalysisJobRecord | null;
}

export type VocabularyView =
  | { status: "ready"; state: VocabularyState }
  | { status: "corrupt"; reason: string };

export interface VocabularyUpdated {
  revision: number;
  lexiconRevision: number;
}

export interface VariantInput {
  id?: string;
  source: string;
  enabled: boolean;
  caseSensitive: boolean;
  contextWords: string[];
}

export interface TermInput {
  id?: string;
  canonical: string;
  language: string;
  category: TermCategory;
  scope: TermScope;
  enabled: boolean;
  useAsHint: boolean;
  provenance?: VocabularyProvenance;
  variants: VariantInput[];
}

export interface VocabularyConfigPatch {
  enabled?: boolean;
  /** `null` selects "global only". */
  activeDomain?: string | null;
  analysisSchedule?: AnalysisSchedule;
}

export const DEFAULT_VOCABULARY_CONFIG: VocabularyConfig = {
  enabled: false,
  activeDomain: null,
  analysisSchedule: "off",
  lastScheduledAttemptAt: null,
  learningClearedAt: null,
  manualApiConsent: null,
  periodicApiConsent: null,
};

export function createEmptyVocabularyState(): VocabularyState {
  return {
    schemaVersion: VOCABULARY_SCHEMA_VERSION,
    revision: 0,
    lexiconRevision: 0,
    dataEpoch: 0,
    config: { ...DEFAULT_VOCABULARY_CONFIG },
    terms: [],
    suggestions: [],
    evidence: [],
    dismissals: [],
    coverage: [],
    lastJob: null,
  };
}

export type VocabularyErrorCode =
  | "conflict"
  | "validation"
  | "corrupt"
  | "not_found"
  | "save_failed"
  | "unknown";

/** Splits a Rust `[vocabulary:code] message` error into code and user text. */
export function parseVocabularyError(error: unknown): {
  code: VocabularyErrorCode;
  message: string;
} {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const match = raw.match(/^\[vocabulary:([a-z_]+)\]\s*(.*)$/s);
  const known: VocabularyErrorCode[] = [
    "conflict",
    "validation",
    "corrupt",
    "not_found",
    "save_failed",
  ];
  if (match && known.includes(match[1] as VocabularyErrorCode)) {
    return { code: match[1] as VocabularyErrorCode, message: match[2] };
  }
  return { code: "unknown", message: raw || "Неизвестная ошибка словаря" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shallow structural check of a native snapshot; Rust already validated it. */
export function parseVocabularyView(value: unknown): VocabularyView {
  if (!isRecord(value)) throw new Error("Некорректный ответ словаря");
  if (value.status === "corrupt") {
    return { status: "corrupt", reason: typeof value.reason === "string" ? value.reason : "" };
  }
  const state = value.state;
  if (
    value.status !== "ready" ||
    !isRecord(state) ||
    state.schemaVersion !== VOCABULARY_SCHEMA_VERSION ||
    typeof state.revision !== "number" ||
    typeof state.lexiconRevision !== "number" ||
    !isRecord(state.config) ||
    !Array.isArray(state.terms)
  ) {
    throw new Error("Некорректный ответ словаря");
  }
  return { status: "ready", state: state as unknown as VocabularyState };
}

export interface VocabularyClientDeps {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(event: string, handler: (event: { payload: T }) => void) => Promise<UnlistenFn>;
}

export interface VocabularyClient {
  /** Warm cached snapshot; refreshed when another window reports a newer revision. */
  getView(options?: { refresh?: boolean }): Promise<VocabularyView>;
  saveTerm(expectedRevision: number, term: TermInput): Promise<VocabularyView>;
  deleteTerm(expectedRevision: number, termId: string): Promise<VocabularyView>;
  updateConfig(expectedRevision: number, patch: VocabularyConfigPatch): Promise<VocabularyView>;
  subscribe(listener: (view: VocabularyView) => void): () => void;
}

function revisionOf(view: VocabularyView | null): number {
  return view?.status === "ready" ? view.state.revision : -1;
}

export function createVocabularyClient(deps: VocabularyClientDeps): VocabularyClient {
  let cached: VocabularyView | null = null;
  let inflight: Promise<VocabularyView> | null = null;
  let listening = false;
  const listeners = new Set<(view: VocabularyView) => void>();

  const publish = (view: VocabularyView): VocabularyView => {
    // A slower response must not replace a newer snapshot already in the cache.
    if (cached && view.status === "ready" && revisionOf(cached) > view.state.revision) {
      return cached;
    }
    cached = view;
    for (const listener of listeners) listener(view);
    return view;
  };

  const fetchView = (): Promise<VocabularyView> => {
    inflight ??= deps
      .invoke<unknown>("vocabulary_get_state")
      .then((raw) => publish(parseVocabularyView(raw)))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  const ensureListening = (): void => {
    if (listening) return;
    listening = true;
    void deps
      .listen<VocabularyUpdated>(VOCABULARY_UPDATED_EVENT, (event) => {
        if (event.payload.revision > revisionOf(cached)) void fetchView().catch(() => {});
      })
      .catch(() => {
        listening = false;
      });
  };

  const mutate = async (
    command: string,
    args: Record<string, unknown>,
  ): Promise<VocabularyView> => {
    ensureListening();
    const raw = await deps.invoke<unknown>(command, args);
    return publish(parseVocabularyView(raw));
  };

  return {
    async getView(options = {}) {
      ensureListening();
      if (cached && !options.refresh) return cached;
      return fetchView();
    },
    saveTerm: (expectedRevision, term) =>
      mutate("vocabulary_save_term", { expectedRevision, term }),
    deleteTerm: (expectedRevision, termId) =>
      mutate("vocabulary_delete_term", { expectedRevision, termId }),
    updateConfig: (expectedRevision, patch) =>
      mutate("vocabulary_update_config", { expectedRevision, patch }),
    subscribe(listener) {
      ensureListening();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let defaultClient: VocabularyClient | null = null;

/** Shared per-WebView client. */
export function vocabularyClient(): VocabularyClient {
  defaultClient ??= createVocabularyClient({
    invoke: (command, args) => invoke(command, args),
    listen: (event, handler) => listen(event, handler),
  });
  return defaultClient;
}
