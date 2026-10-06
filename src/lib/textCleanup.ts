import { invoke } from "@tauri-apps/api/core";
import { guardTranscriptionResult } from "../windows/widget/services/transcriptionGuard";
import { diagnosticId, logInfo, processingErrorCode, safeEndpoint } from "./logger";
import { type AppSettings, getSelectedCleanupPrompt } from "./store";
import { type ResolvedSummaryBackend, resolveSummaryBackend } from "./summarize";

interface CleanupPrompt {
  prompt: string;
  temperature?: number;
  version?: number;
}
const builtinPrompts = new Map<string, CleanupPrompt>();
const loadBuiltinPrompt = (language: string, style: string): Promise<CleanupPrompt> =>
  invoke("get_cleanup_prompt", { language, style });

export const CLEANUP_TIMEOUT_API_MS = 8000;
export const CLEANUP_TIMEOUT_LOCAL_MS = 12000;
export interface DictationCleanupContext {
  requestId: string;
  entryId?: string;
  trigger: "main-hotkey" | "cleanup-hotkey" | "widget" | "retry" | "pipeline";
  globalEnabled: boolean;
  override: boolean | null;
}
export interface CleanupOutcome {
  requestId: string;
  prepMs: number;
  errorCode?: string;
  text: string;
  applied: boolean;
  reason?: "empty-input" | "disabled" | "no-backend" | "timeout" | "error" | "rejected";
  durationMs: number;
}
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
export function isCleanupAvailable(settings: AppSettings): boolean {
  const backend = resolveSummaryBackend(settings);
  if (!backend) return false;
  if (backend.kind === "custom" && !(settings.llmApiKey.trim() || settings.apiKey.trim()))
    return false;
  return true;
}
export async function cleanupDictation(
  raw: string,
  settings: AppSettings,
  deps: {
    run?: ResolvedSummaryBackend["run"];
    now?: () => number;
    loadPrompt?: typeof loadBuiltinPrompt;
    context?: DictationCleanupContext;
    log?: (message: string) => void;
  } = {},
): Promise<CleanupOutcome> {
  const now = deps.now ?? Date.now;
  const start = now();
  const context = deps.context;
  const requestId = diagnosticId(context?.requestId ?? crypto.randomUUID());
  const entryId = diagnosticId(context?.entryId ?? requestId);
  const log =
    deps.log ??
    ((message: string): void => {
      void logInfo("CLEANUP", message);
    });
  const backend = resolveSummaryBackend(settings);
  const preset = getSelectedCleanupPrompt(settings);
  let prepMs = 0;
  log(
    `event=decision request_id=${requestId} entry_id=${entryId} trigger=${context?.trigger ?? "pipeline"} global_enabled=${context?.globalEnabled ?? settings.cleanupEnabled} effective_enabled=${settings.cleanupEnabled} override=${context?.override ?? "global"} backend=${backend?.kind ?? "none"} endpoint=${safeEndpoint(settings.llmEndpoint || "https://api.openai.com/v1")} model=${diagnosticId(settings.llmModel)} preset=${diagnosticId(preset.id)} input_chars=${raw.length}`,
  );
  const finish = (outcome: CleanupOutcome): CleanupOutcome => {
    log(
      `event=end request_id=${requestId} entry_id=${entryId} cleanup_ms=${outcome.durationMs} prep_ms=${outcome.prepMs} cleanup_applied=${outcome.applied} cleanup_reason=${outcome.reason ?? "success"} error_code=${outcome.errorCode ?? "none"} output_chars=${outcome.text.length}`,
    );
    return outcome;
  };
  const fallback = (reason?: CleanupOutcome["reason"], errorCode?: string): CleanupOutcome =>
    finish({
      requestId,
      prepMs,
      errorCode,
      text: raw,
      applied: false,
      reason,
      durationMs: now() - start,
    });
  if (!settings.cleanupEnabled) return fallback("disabled");
  if (!raw.trim()) return fallback("empty-input");
  if (!backend || !isCleanupAvailable(settings)) {
    const model = settings.llmModel?.trim();
    return fallback(
      "no-backend",
      !model || model === "none" ? "missing_model" : backend ? "missing_key" : "missing_backend",
    );
  }
  const controller = new AbortController();
  const timeout = backend.kind === "local" ? CLEANUP_TIMEOUT_LOCAL_MS : CLEANUP_TIMEOUT_API_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async (): Promise<string> => {
      let prompt: CleanupPrompt = preset;
      if (preset.builtin) {
        const key = `${settings.language}:${preset.id}`;
        prompt =
          builtinPrompts.get(key) ??
          (await (deps.loadPrompt ?? loadBuiltinPrompt)(settings.language, preset.id));
        controller.signal.throwIfAborted();
        builtinPrompts.set(key, prompt);
      }
      controller.signal.throwIfAborted();
      prepMs = now() - start;
      log(
        `event=request request_id=${requestId} entry_id=${entryId} budget_ms=${timeout} prep_ms=${prepMs} prompt_version=${prompt.version ?? "custom"}`,
      );
      return (deps.run ?? backend.run)({
        requestId,
        entryId,
        operation: "cleanup",
        text: raw,
        prompt: `${prompt.prompt}\nВерни только исправленный текст без пояснений.`,
        temperature: prompt.temperature,
        signal: controller.signal,
        deadlineMs: Date.now() + Math.max(0, timeout - (now() - start)),
      });
    };
    const text = stripThinking(
      await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Cleanup timeout"));
          }, timeout);
        }),
      ]),
    );
    const guarded = guardTranscriptionResult({ raw, cleaned: text }, settings.language);
    if (
      !guarded.transcription ||
      guarded.cleanedFallbackReason ||
      /<\/?think>/i.test(text) ||
      /^(?:вот (?:исправленный|очищенный) текст|исправленный текст:|here is (?:the|your) (?:corrected|cleaned) text)/i.test(
        text,
      )
    )
      return fallback("rejected");
    return finish({
      requestId,
      prepMs,
      text: guarded.transcription.cleaned,
      applied: true,
      durationMs: now() - start,
    });
  } catch (error) {
    const code = processingErrorCode(error);
    return fallback(
      controller.signal.aborted || now() - start >= timeout || code === "timeout"
        ? "timeout"
        : "error",
      code,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
