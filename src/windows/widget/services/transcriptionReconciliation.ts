import type { AppSettings } from "../../../lib/store";

export type LiveTranscriptionReconciliationMode = "openai";

export function shouldAcceptLiveTranscription(
  _settings: AppSettings,
  hasLiveTranscription: boolean,
): boolean {
  return hasLiveTranscription;
}

export function resolveLiveTranscriptionReconciliationMode(
  settings: AppSettings,
  hasLiveTranscription: boolean,
): LiveTranscriptionReconciliationMode | null {
  if (
    !shouldAcceptLiveTranscription(settings, hasLiveTranscription) ||
    settings.selectedApiAdapter !== "openai"
  ) {
    return null;
  }

  const configuredModel =
    settings.apiAdapters.openai?.model?.trim() || settings.whisperModel?.trim();
  return configuredModel === "gpt-realtime-whisper" ? "openai" : null;
}
