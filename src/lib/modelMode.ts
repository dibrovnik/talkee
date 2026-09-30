import type { AppSettings } from "./store";

export const DEFAULT_LOCAL_STT_ENDPOINT = "http://127.0.0.1:8000";
export const DEFAULT_LOCAL_STT_MODEL = "whisper-large-v3-turbo";

type ModelModeSettingsPatch = Partial<Omit<AppSettings, "translation">>;

interface ApiModelModeSelection {
  adapterId: string;
  apiKey?: string;
  endpoint?: string;
  model?: string;
}

interface LocalModelModeSelection {
  endpoint?: string;
  model?: string;
}

export type ProcessingMode = "api" | "local";

interface ProcessingModeSettings {
  whisperEndpoint?: string | null;
}

/** Resolve the active processing mode: local sidecar endpoints (localhost /
 *  127.0.0.1) mean "Локально", everything else (including empty) means "API". */
export function resolveProcessingMode(
  settings: ProcessingModeSettings,
): ProcessingMode {
  const endpoint = settings.whisperEndpoint || "";
  return /127\.0\.0\.1|localhost/i.test(endpoint) ? "local" : "api";
}

export function apiModelModeSettingsPatch(
  selection: ApiModelModeSelection,
  extra: ModelModeSettingsPatch = {},
): ModelModeSettingsPatch {
  return {
    ...extra,
    provider: "openai",
    selectedApiAdapter: selection.adapterId,
    apiKey: selection.apiKey?.trim() || "",
    whisperApiKey: "",
    whisperEndpoint: selection.endpoint?.trim() || "",
    whisperModel: selection.model?.trim() || "whisper-1",
  };
}

export function localModelModeSettingsPatch(
  selection: LocalModelModeSelection = {},
  extra: ModelModeSettingsPatch = {},
): ModelModeSettingsPatch {
  return {
    ...extra,
    provider: "custom",
    whisperApiKey: "",
    whisperEndpoint:
      selection.endpoint?.trim() || DEFAULT_LOCAL_STT_ENDPOINT,
    whisperModel: selection.model?.trim() || DEFAULT_LOCAL_STT_MODEL,
  };
}
