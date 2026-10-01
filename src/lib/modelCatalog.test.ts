import { describe, expect, it } from "bun:test";

import {
  API_ADAPTERS,
  apiAdapterById,
  apiAdaptersForDisplay,
  CUSTOM_API_MODEL_VALUE,
  LEGACY_API_ADAPTERS,
  LEGACY_LOCAL_MODEL_OPTIONS,
  LOCAL_MODEL_OPTIONS,
  localModelOptionById,
  localModelOptionForModel,
  localSttOptionsForDisplay,
  TEXT_MODEL_OPTIONS,
  TEXT_MODEL_PRESETS,
} from "../windows/settings/tabs/settingsTabsTypes";

const CURATED_LOCAL_IDS = [
  "nemotron-35-asr-streaming-06b",
  "gigaam-v3-e2e-rnnt",
  "whisper-large-v3-turbo",
];

describe("curated local STT suggestions", () => {
  it("offers exactly the three Russian-capable models, in order", () => {
    expect(LOCAL_MODEL_OPTIONS.map((model) => model.id)).toEqual(CURATED_LOCAL_IDS);
    expect(LOCAL_MODEL_OPTIONS.map((model) => model.model)).toEqual([
      "nvidia/nemotron-3.5-asr-streaming-0.6b",
      "ai-sage/GigaAM-v3",
      "whisper-large-v3-turbo",
    ]);
  });

  it("marks Nemotron as the main scenario and streaming only where it is real", () => {
    const nemotron = LOCAL_MODEL_OPTIONS.find(
      (model) => model.id === "nemotron-35-asr-streaming-06b",
    );
    const gigaam = LOCAL_MODEL_OPTIONS.find((model) => model.id === "gigaam-v3-e2e-rnnt");
    const whisperTurbo = LOCAL_MODEL_OPTIONS.find((model) => model.id === "whisper-large-v3-turbo");

    expect(nemotron?.recommended).toBe(true);
    expect(nemotron?.supportsStreaming).toBe(true);
    // GigaAM and Whisper Turbo are batch models in the managed runtime; they must
    // not be advertised as native streaming suggestions.
    expect(gigaam?.supportsStreaming).toBeFalsy();
    expect(whisperTurbo?.supportsStreaming).toBeFalsy();
    for (const model of LOCAL_MODEL_OPTIONS) {
      expect(model.runtimeReady).toBe(true);
      expect(model.purpose).not.toBe("diarization");
    }
  });

  it("keeps the English-only and duplicate suggestions out of the visible list", () => {
    expect(LOCAL_MODEL_OPTIONS.filter((model) => /English/i.test(model.languageLabel))).toEqual([]);
    // They are still compiled in for compatibility — just not suggested anymore.
    expect(LEGACY_LOCAL_MODEL_OPTIONS.some((model) => /English/i.test(model.languageLabel))).toBe(
      true,
    );
    expect(LEGACY_LOCAL_MODEL_OPTIONS.map((model) => model.id).sort()).toEqual(
      [
        "moonshine-streaming-small",
        "moonshine-streaming-tiny",
        "nemotron-speech-streaming-en-06b",
        "parakeet-tdt-06b-v2",
        "parakeet-tdt-06b-v3",
        "qwen3-asr-06b",
        "whisper-base",
        "whisper-large-v3",
        "whisper-medium",
        "whisper-small",
        "whisper-tiny",
      ].sort(),
    );
  });
});

describe("curated API STT suggestions", () => {
  it("shows only [OI] and Groq", () => {
    expect(API_ADAPTERS.map((adapter) => adapter.id)).toEqual(["openai", "groq"]);
    expect(API_ADAPTERS[0]?.recommendedModel).toBe("gpt-4o-transcribe");
    expect(API_ADAPTERS[1]?.recommendedModel).toBe("whisper-large-v3-turbo");
    for (const adapter of API_ADAPTERS) {
      expect(adapter.models.length).toBeGreaterThan(0);
      expect(adapter.legacy).toBeFalsy();
    }
  });

  it("keeps a manual endpoint and model available next to the suggestions", () => {
    expect(CUSTOM_API_MODEL_VALUE).toBeTruthy();
    expect(TEXT_MODEL_OPTIONS.length).toBeGreaterThan(0);
    // Every visible adapter still accepts a user host/model, so a custom endpoint
    // stays reachable without being part of the recommendation list.
    for (const adapter of API_ADAPTERS) {
      expect(adapter).toHaveProperty("defaultEndpoint");
    }
  });
});

describe("text-processing presets", () => {
  it("offers DeepSeek as the main API preset with non-thinking cleanup", () => {
    const deepseek = TEXT_MODEL_PRESETS.find((preset) => preset.id === "deepseek");

    expect(deepseek).toBeDefined();
    expect(deepseek?.recommended).toBe(true);
    expect(deepseek?.endpoint).toBe("https://api.deepseek.com");
    expect(deepseek?.model).toBe("deepseek-flash");
    expect(deepseek?.nonThinking).toBe(true);
    // The preset model stays selectable in the manual model list.
    expect(TEXT_MODEL_OPTIONS).toContain("deepseek-flash");
  });

  it("never carries credentials: the user's key stays untouched by a preset", () => {
    for (const preset of TEXT_MODEL_PRESETS) {
      expect(Object.keys(preset)).not.toContain("apiKey");
      expect(Object.keys(preset)).not.toContain("llmApiKey");
    }
    expect(TEXT_MODEL_OPTIONS).toContain("gpt-4o-mini");
  });
});

describe("previously configured models survive the trimmed catalog", () => {
  it("resolves old local model ids and runtime ids", () => {
    expect(localModelOptionById("whisper-small")?.legacy).toBe(true);
    expect(localModelOptionForModel("whisper-small")?.legacy).toBe(true);
    expect(localModelOptionForModel("ai-sage/GigaAM-v3")?.id).toBe("gigaam-v3-e2e-rnnt");
    expect(localModelOptionForModel("Qwen/Qwen3-ASR-0.6B")?.id).toBe("qwen3-asr-06b");
    expect(localModelOptionForModel("moonshine-streaming-tiny")?.legacy).toBe(true);
    expect(localModelOptionById("nvidia/nemotron-3.5-asr-streaming-0.6b")).toBeUndefined();
    expect(localModelOptionById("nemotron-35-asr-streaming-06b")?.recommended).toBe(true);
    expect(localModelOptionForModel("gpt-4o-transcribe")).toBeUndefined();
  });

  it("resolves previously configured API adapters", () => {
    expect(apiAdapterById("deepgram")?.name).toBe("Deepgram API");
    expect(apiAdapterById("xai")?.legacy).toBe(true);
    expect(apiAdapterById("not-a-provider")).toBeUndefined();
    expect(LEGACY_API_ADAPTERS.length).toBeGreaterThan(0);
  });

  it("keeps a saved adapter visible without promoting it to a suggestion", () => {
    expect(apiAdaptersForDisplay("deepgram").map((adapter) => adapter.id)).toEqual([
      "openai",
      "groq",
      "deepgram",
    ]);
    expect(apiAdaptersForDisplay("deepgram")[2]?.legacy).toBe(true);
    expect(apiAdaptersForDisplay("openai").map((adapter) => adapter.id)).toEqual([
      "openai",
      "groq",
    ]);
    expect(apiAdaptersForDisplay("").map((adapter) => adapter.id)).toEqual(["openai", "groq"]);
    expect(apiAdaptersForDisplay("not-a-provider").map((adapter) => adapter.id)).toEqual([
      "openai",
      "groq",
    ]);
  });

  it("shows an installed or selected legacy model next to the curated three", () => {
    expect(localSttOptionsForDisplay().map((model) => model.id)).toEqual(CURATED_LOCAL_IDS);
    expect(
      localSttOptionsForDisplay({ selectedModel: "whisper-small" }).map((model) => model.id),
    ).toEqual([...CURATED_LOCAL_IDS, "whisper-small"]);
    expect(
      localSttOptionsForDisplay({ installedModelIds: ["whisper-small"] }).map((model) => model.id),
    ).toEqual([...CURATED_LOCAL_IDS, "whisper-small"]);
    expect(localSttOptionsForDisplay({ downloadedModelIds: ["whisper-tiny"] })[3]?.legacy).toBe(
      true,
    );
    // A curated model is never duplicated, and an API model never leaks in here.
    expect(
      localSttOptionsForDisplay({
        installedModelIds: ["nvidia/nemotron-3.5-asr-streaming-0.6b", "gpt-4o-transcribe"],
      }).map((model) => model.id),
    ).toEqual(CURATED_LOCAL_IDS);
  });
});
