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

/** Loopback endpoints (localhost / 127.0.0.1) mean "Локально". */
function isLocalEndpoint(endpoint?: string | null): boolean {
  return /127\.0\.0\.1|localhost/i.test(endpoint || "");
}

/** Resolve the recognition mode: only the STT endpoint decides, so it stays
 *  independent of the text (LLM) endpoint. */
export function resolveProcessingMode(settings: ProcessingModeSettings): ProcessingMode {
  return isLocalEndpoint(settings.whisperEndpoint) ? "local" : "api";
}

interface TextEndpointSettings {
  llmEndpoint?: string | null;
}

/** Resolve the text-processing mode: only the text (LLM) endpoint decides, so a
 *  local STT model can run together with a remote text API and vice versa. */
export function resolveTextProcessingMode(settings: TextEndpointSettings): ProcessingMode {
  return isLocalEndpoint(settings.llmEndpoint) ? "local" : "api";
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
    whisperEndpoint: selection.endpoint?.trim() || DEFAULT_LOCAL_STT_ENDPOINT,
    whisperModel: selection.model?.trim() || DEFAULT_LOCAL_STT_MODEL,
  };
}

export const DEFAULT_API_TEXT_MODEL = "gpt-4o-mini";

interface ApiTextModelSelection {
  endpoint?: string;
  model?: string;
}

/**
 * Commit the API text-processing configuration without touching the recognition
 * settings. A leftover local endpoint/model is dropped together with the
 * bundled-runtime marker (so cleanup cannot warm the local sidecar), while the
 * user's own API endpoint, model and key are preserved.
 */
export function apiTextModelSettingsPatch(
  selection: ApiTextModelSelection = {},
): ModelModeSettingsPatch {
  const endpoint = (selection.endpoint || "").trim();
  const model = (selection.model || "").trim();
  const localLeftover = isLocalEndpoint(endpoint);
  return {
    llmEndpoint: localLeftover ? "" : endpoint,
    llmModel:
      localLeftover || !model || model.toLowerCase() === "none" ? DEFAULT_API_TEXT_MODEL : model,
    llmLocalModelId: "",
  };
}
