import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  FOREGROUND_ACTIVITY_EVENT,
  type ForegroundActivity,
  observeForegroundActivity,
} from "../../../lib/foregroundActivity";
import {
  HISTORY_CLEARED_EVENT,
  HISTORY_DELETED_EVENT,
  HISTORY_UPDATED_EVENT,
  SETTINGS_UPDATED_EVENT,
} from "../../../lib/hotkeyEvents";
import { type AppSettings, getHistory, getSettings } from "../../../lib/store";
import { resolveSummaryBackend } from "../../../lib/summarize";
import {
  type AnalysisJobMode,
  type AnalysisJobStatus,
  type VocabularyState,
  type VocabularyView,
  vocabularyClient,
} from "../../../lib/vocabulary";
import {
  analysisSources,
  EXTRACTION_INSTRUCTION,
  parseAnalysisResponse,
  planAnalysis,
} from "../../../lib/vocabularyAnalysis";

export const ANALYSIS_REQUEST_EVENT = "vocabulary:analysis-request";
export const ANALYSIS_CANCEL_EVENT = "vocabulary:analysis-cancel";
export const ANALYSIS_PROGRESS_EVENT = "vocabulary:analysis-progress";
export interface AnalysisProgress {
  status: AnalysisJobStatus;
  requests: number;
  processed: number;
  remaining: number;
  error?: string;
}
export interface AnalysisIdentity {
  fingerprint: string;
  endpointLabel: string;
  model: string;
  remote: boolean;
  managed: boolean;
}
interface AnalysisLease {
  id: string;
  dataEpoch: number;
  fingerprint: string;
  periodic: boolean;
  expiresAt: number;
}
export const SCHEDULE_INTERVALS = { daily: 86400000, weekly: 7 * 86400000 } as const;

export async function analysisIdentity(settings: AppSettings): Promise<AnalysisIdentity> {
  const endpoint = (settings.llmEndpoint || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  const url = new URL(endpoint);
  const remote = !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const managed = !remote && !!settings.llmLocalModelId && settings.llmLocalModelId !== "none";
  // Remove credentials and query before labeling/hashing. API keys never identify consent.
  const endpointLabel = url.origin + url.pathname.replace(/\/+$/, "");
  const model = settings.llmModel?.trim() || "";
  const data = JSON.stringify([
    remote ? "api" : managed ? "managed-local" : "custom-local",
    endpointLabel,
    model,
  ]);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return {
    fingerprint: Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
    endpointLabel,
    model,
    remote,
    managed,
  };
}
export function nextAnalysisDue(
  state: VocabularyState,
  now: number,
  idleSince: number,
  notBefore = 0,
): number | null {
  if (state.config.analysisSchedule === "off") return null;
  const interval = SCHEDULE_INTERVALS[state.config.analysisSchedule];
  return Math.max(
    now,
    (state.config.lastScheduledAttemptAt ?? now - interval) + interval,
    idleSince + 30000,
    notBefore,
  );
}

export function createVocabularyAnalysisCoordinator(
  deps = {
    invoke,
    emit,
    getHistory,
    getSettings,
    client: vocabularyClient(),
    now: Date.now,
    resolveBackend: resolveSummaryBackend,
    timer: (callback: () => void, delay: number) => setTimeout(callback, delay),
    clearTimer: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  },
) {
  let controller: AbortController | null = null;
  let lease: AnalysisLease | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idleSince = deps.now();
  let notBefore = 0;
  let stopped = false;
  let scheduleGeneration = 0;
  let interval = 86400000;
  let cancelReason = "cancelled";
  let observedRevision = -1;
  let runFingerprint: string | null = null;
  const busy = new Set<string>();
  const publish = (progress: AnalysisProgress): void => {
    void deps.emit(ANALYSIS_PROGRESS_EVENT, progress).catch(() => {});
  };
  const cancel = (reason = "cancelled"): void => {
    cancelReason = reason;
    controller?.abort();
    if (lease)
      void deps
        .invoke("vocabulary_analysis_finish", { leaseId: lease.id, status: "cancelled", reason })
        .catch(() => {});
    if (controller) notBefore = deps.now() + interval;
    if (timer) {
      deps.clearTimer(timer);
      timer = null;
    }
  };
  const foreground = ({ id, active }: ForegroundActivity): void => {
    if (active) {
      busy.add(id);
      cancel("preempted");
    } else {
      busy.delete(id);
      if (!busy.size) {
        idleSince = deps.now();
        void schedule();
      }
    }
  };
  async function run(mode: AnalysisJobMode): Promise<void> {
    if (controller || stopped || busy.size) return;
    if (timer) {
      deps.clearTimer(timer);
      timer = null;
    }
    const abort = new AbortController();
    controller = abort;
    cancelReason = "cancelled";
    if (mode === "periodic") notBefore = deps.now() + interval;
    let status: AnalysisJobStatus = "completed";
    let reason: string | null = null;
    let requests = 0;
    let processed = 0;
    let remaining = 0;
    try {
      const settings = await deps.getSettings({ reload: true });
      const identity = await analysisIdentity(settings);
      runFingerprint = identity.fingerprint;
      const backend = deps.resolveBackend(settings);
      if (!backend) throw new Error("Текстовая модель не выбрана. Ручной словарь доступен.");
      if (mode === "periodic" && !identity.remote && !identity.managed)
        throw new Error("Этот локальный сервер не поддерживает адресную отмену фонового анализа");
      let view = await deps.client.getView({ refresh: true });
      if (view.status !== "ready") throw new Error("Словарь недоступен");
      const consent =
        mode === "periodic"
          ? view.state.config.periodicApiConsent
          : view.state.config.manualApiConsent;
      if (identity.remote && consent?.fingerprint !== identity.fingerprint)
        throw new Error("Разрешите передачу истории выбранному API отдельно для этого режима");
      const sources = await analysisSources(await deps.getHistory());
      const batches = planAnalysis(sources, view.state, mode, !identity.remote);
      if (mode === "periodic") {
        const state = view.state;
        const newSources = sources.filter(
          (source) =>
            !state.coverage.some(
              (c) => c.sourceId === source.id && c.fingerprint === source.fingerprint,
            ) &&
            (!state.config.learningClearedAt || source.createdAt > state.config.learningClearedAt),
        ).length;
        const backlog =
          ["paused", "needs-attention"].includes(state.lastJob?.status ?? "") && batches.length > 0;
        if (newSources < 10 && !backlog) return;
      }
      if (!batches.length) {
        publish({ status: "completed", requests: 0, processed: 0, remaining: 0 });
        return;
      }
      abort.signal.throwIfAborted();
      if (identity.managed) {
        const endpoint = await deps.invoke<string>("start_local_llm", {
          modelId: settings.llmLocalModelId,
        });
        abort.signal.throwIfAborted();
        if (!(await deps.invoke<boolean>("local_llm_analysis_capability", { endpoint })))
          throw new Error("Обновите локальный runtime: требуется адресная отмена и контекст 4096");
      }
      abort.signal.throwIfAborted();
      lease = await deps.invoke<AnalysisLease>("vocabulary_analysis_start", {
        expectedRevision: view.state.revision,
        request: { mode, fingerprint: identity.fingerprint, remote: identity.remote },
      });
      const started = deps.now();
      const maxRequests = mode === "periodic" ? 3 : 20;
      const maxDuration = mode === "periodic" ? 180000 : 900000;
      const limit = Math.min(batches.length, maxRequests);
      for (let index = 0; index < limit; index++) {
        abort.signal.throwIfAborted();
        if (deps.now() - started >= maxDuration) {
          status = "paused";
          reason = "limits";
          break;
        }
        const latest = await deps.getSettings({ reload: true });
        if ((await analysisIdentity(latest)).fingerprint !== identity.fingerprint)
          throw new Error("backend-changed");
        view = await deps.client.getView({ refresh: true });
        if (view.status !== "ready" || view.state.dataEpoch !== lease.dataEpoch)
          throw new Error("Источники или разрешения изменились");
        const fragments = batches[index];
        remaining = batches.length - index;
        publish({ status: "running", requests, processed, remaining });
        const text = await backend.run({
          text: JSON.stringify({ fragments }),
          prompt: EXTRACTION_INSTRUCTION,
          temperature: 0,
          maxTokens: 1024,
          operation: "vocabulary-analysis",
          requestId: crypto.randomUUID(),
          signal: abort.signal,
          deadlineMs: Math.min(
            started + maxDuration,
            deps.now() + (identity.remote ? 30000 : 60000),
          ),
        });
        abort.signal.throwIfAborted();
        const candidates = parseAnalysisResponse(text, fragments);
        // CAS conflicts retry the local commit only. Never repeat an API request.
        for (let attempt = 0; ; attempt++) {
          const fresh = await deps.client.getView({ refresh: true });
          if (fresh.status !== "ready" || fresh.state.dataEpoch !== lease.dataEpoch)
            throw new Error("Источники изменились");
          abort.signal.throwIfAborted();
          try {
            await deps.invoke<VocabularyView>("vocabulary_analysis_commit", {
              expectedRevision: fresh.state.revision,
              leaseId: lease.id,
              batch: { fragments, candidates },
              remainingSources: batches.length - index - 1,
            });
            break;
          } catch (error) {
            if (attempt >= 2 || !String(error).startsWith("[vocabulary:conflict]")) throw error;
          }
        }
        requests++;
        processed += new Set(fragments.map((fragment) => fragment.sourceId)).size;
        remaining = batches.length - index - 1;
      }
      if (remaining > 0) {
        status = "paused";
        reason = "limits";
      }
    } catch (error) {
      status = abort.signal.aborted ? "cancelled" : "failed";
      reason = abort.signal.aborted ? cancelReason : "failed";
      publish({
        status,
        requests,
        processed,
        remaining,
        error: abort.signal.aborted
          ? undefined
          : String(error).includes("[text:")
            ? "Текстовая модель не завершила анализ. Сохранённые пакеты доступны для продолжения."
            : String(error),
      });
    } finally {
      if (lease)
        await deps
          .invoke("vocabulary_analysis_finish", { leaseId: lease.id, status, reason })
          .catch(() => {});
      lease = null;
      controller = null;
      runFingerprint = null;
      publish({ status, requests, processed, remaining });
      if (status === "failed" || status === "cancelled") notBefore = deps.now() + interval;
      void schedule();
    }
  }
  async function schedule(): Promise<void> {
    const generation = ++scheduleGeneration;
    if (timer) {
      deps.clearTimer(timer);
      timer = null;
    }
    if (stopped || controller || busy.size) return;
    const view = await deps.client.getView({ refresh: true }).catch(() => null);
    if (
      !view ||
      view.status !== "ready" ||
      stopped ||
      controller ||
      busy.size ||
      generation !== scheduleGeneration
    )
      return;
    interval =
      view.state.config.analysisSchedule === "weekly"
        ? SCHEDULE_INTERVALS.weekly
        : SCHEDULE_INTERVALS.daily;
    const due = nextAnalysisDue(view.state, deps.now(), idleSince, notBefore);
    if (due === null) return;
    // One due check per period; a small history waits for a new history event.
    timer = deps.timer(
      () => {
        timer = null;
        void run("periodic");
      },
      Math.max(0, due - deps.now()),
    );
  }
  const subscribe = deps.client.subscribe((view) => {
    if (lease?.periodic && view.status === "ready" && view.state.config.analysisSchedule === "off")
      cancel();
    if (
      controller &&
      lease &&
      (view.status !== "ready" || view.state.dataEpoch !== lease.dataEpoch)
    )
      cancel("backend-changed");
    const revision = view.status === "ready" ? view.state.revision : -1;
    if (!controller && revision !== observedRevision) void schedule();
    observedRevision = revision;
  });
  return {
    run,
    cancel,
    foreground,
    schedule,
    async settingsChanged(): Promise<void> {
      const identity = await analysisIdentity(await deps.getSettings({ reload: true }));
      if (controller && runFingerprint && identity.fingerprint !== runFingerprint)
        cancel("backend-changed");
      void schedule();
    },
    stop(): void {
      stopped = true;
      cancel();
      subscribe();
    },
  };
}

let coordinator: ReturnType<typeof createVocabularyAnalysisCoordinator> | null = null;
export function setVocabularyForeground(active: boolean): void {
  coordinator?.foreground({ id: "widget", active });
}
export function installVocabularyAnalysisCoordinator(): () => void {
  const current = createVocabularyAnalysisCoordinator();
  coordinator = current;
  const handlers = [
    listen<{ mode: AnalysisJobMode }>(ANALYSIS_REQUEST_EVENT, ({ payload }) => {
      if (["full", "new", "resume"].includes(payload.mode)) void current.run(payload.mode);
    }),
    listen(ANALYSIS_CANCEL_EVENT, () => current.cancel()),
    listen<ForegroundActivity>(FOREGROUND_ACTIVITY_EVENT, ({ payload }) =>
      current.foreground(payload),
    ),
    ...[HISTORY_UPDATED_EVENT, HISTORY_DELETED_EVENT, HISTORY_CLEARED_EVENT].map((event) =>
      listen(event, () => {
        void current.schedule();
      }),
    ),
    listen(SETTINGS_UPDATED_EVENT, () => {
      void current.settingsChanged();
    }),
  ];
  const stopObserver = observeForegroundActivity(current.foreground);
  void current.schedule();
  return () => {
    current.stop();
    stopObserver();
    coordinator = null;
    for (const handler of handlers) void handler.then((stop) => stop());
  };
}
