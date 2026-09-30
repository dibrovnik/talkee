import { invoke } from "@tauri-apps/api/core";
import { guardTranscriptionResult } from "../windows/widget/services/transcriptionGuard";
import { type AppSettings, findPrompt } from "./store";
import { type ResolvedSummaryBackend, resolveSummaryBackend } from "./summarize";

export const CLEANUP_TIMEOUT_API_MS = 8000;
export const CLEANUP_TIMEOUT_LOCAL_MS = 12000;
export interface CleanupOutcome {
  text: string;
  applied: boolean;
  reason?: "disabled" | "no-backend" | "timeout" | "error" | "rejected";
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
  deps: { run?: ResolvedSummaryBackend["run"]; now?: () => number } = {},
): Promise<CleanupOutcome> {
  const now = deps.now ?? Date.now;
  const start = now();
  const fallback = (reason?: CleanupOutcome["reason"]): CleanupOutcome => ({
    text: raw,
    applied: false,
    reason,
    durationMs: now() - start,
  });
  if (!settings.cleanupEnabled) return fallback("disabled");
  if (!raw.trim()) return fallback();
  const backend = resolveSummaryBackend(settings);
  if (!backend || !isCleanupAvailable(settings)) return fallback("no-backend");
  const controller = new AbortController();
  const timeout = backend.kind === "local" ? CLEANUP_TIMEOUT_LOCAL_MS : CLEANUP_TIMEOUT_API_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async (): Promise<string> => {
      const preset = findPrompt(settings, settings.selectedCleanupPromptId);
      const prompt =
        preset && !preset.builtin
          ? preset
          : await invoke<{ prompt: string; temperature?: number }>("get_cleanup_prompt", {
              language: settings.language,
              style: settings.style,
            });
      controller.signal.throwIfAborted();
      return (deps.run ?? backend.run)({
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
    return { text: guarded.transcription.cleaned, applied: true, durationMs: now() - start };
  } catch {
    return fallback(controller.signal.aborted || now() - start >= timeout ? "timeout" : "error");
  } finally {
    if (timer) clearTimeout(timer);
  }
}
