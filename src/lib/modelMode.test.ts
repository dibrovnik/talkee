import { describe, expect, it } from "bun:test";

import {
  apiModelModeSettingsPatch,
  apiTextModelSettingsPatch,
  DEFAULT_API_TEXT_MODEL,
  localModelModeSettingsPatch,
  resolveProcessingMode,
  resolveTextProcessingMode,
} from "./modelMode";
import { normalizeSavedSettings } from "./store";

describe("resolveProcessingMode", () => {
  it("detects localhost endpoint as local mode", () => {
    expect(resolveProcessingMode({ whisperEndpoint: "http://localhost:8000" })).toBe("local");
  });

  it("detects 127.0.0.1 endpoint as local mode", () => {
    expect(resolveProcessingMode({ whisperEndpoint: "http://127.0.0.1:8000" })).toBe("local");
  });

  it("detects remote URL as api mode", () => {
    expect(resolveProcessingMode({ whisperEndpoint: "https://api.openai.com" })).toBe("api");
  });

  it("treats empty endpoint as api mode", () => {
    expect(resolveProcessingMode({ whisperEndpoint: "" })).toBe("api");
    expect(resolveProcessingMode({})).toBe("api");
    expect(resolveProcessingMode({ whisperEndpoint: null })).toBe("api");
  });
});

describe("resolveTextProcessingMode", () => {
  it("follows the text endpoint, not the recognition endpoint", () => {
    const mixed = {
      whisperEndpoint: "http://127.0.0.1:8000",
      llmEndpoint: "https://api.deepseek.com",
    };

    expect(resolveProcessingMode(mixed)).toBe("local");
    expect(resolveTextProcessingMode(mixed)).toBe("api");
  });

  it("reports local for a loopback text endpoint and api for empty/remote", () => {
    expect(resolveTextProcessingMode({ llmEndpoint: "http://127.0.0.1:8011/v1" })).toBe("local");
    expect(resolveTextProcessingMode({ llmEndpoint: "http://localhost:2455/v1" })).toBe("local");
    expect(resolveTextProcessingMode({ llmEndpoint: "" })).toBe("api");
    expect(resolveTextProcessingMode({})).toBe("api");
    expect(resolveTextProcessingMode({ llmEndpoint: null })).toBe("api");
    expect(resolveTextProcessingMode({ llmEndpoint: "https://api.deepseek.com" })).toBe("api");
  });

  it("keeps a local text model with an API recognition key (reverse mix)", () => {
    const mixed = {
      whisperEndpoint: "https://api.openai.com",
      llmEndpoint: "http://127.0.0.1:8011/v1",
    };

    expect(resolveProcessingMode(mixed)).toBe("api");
    expect(resolveTextProcessingMode(mixed)).toBe("local");
  });
});

describe("model mode settings", () => {
  it("commits Local mode with a managed endpoint and local model", () => {
    const patch = localModelModeSettingsPatch(
      {
        endpoint: "http://127.0.0.1:8000",
        model: "whisper-small",
      },
      {
        whisperEndpoint: "",
        whisperModel: "gpt-4o-transcribe",
      },
    );

    expect(patch).toMatchObject({
      provider: "custom",
      whisperApiKey: "",
      whisperEndpoint: "http://127.0.0.1:8000",
      whisperModel: "whisper-small",
    });

    const normalized = normalizeSavedSettings(patch);
    expect(normalized.provider).toBe("custom");
    expect(normalized.whisperEndpoint).toBe("http://127.0.0.1:8000");
  });

  it("replaces stale Local STT fields when API mode is selected", () => {
    const patch = apiModelModeSettingsPatch(
      {
        adapterId: "openai",
        apiKey: "api-key",
        endpoint: "",
        model: "gpt-4o-mini-transcribe",
      },
      {
        whisperEndpoint: "http://127.0.0.1:8000",
        whisperModel: "whisper-small",
      },
    );

    expect(patch).toMatchObject({
      provider: "openai",
      selectedApiAdapter: "openai",
      apiKey: "api-key",
      whisperApiKey: "",
      whisperEndpoint: "",
      whisperModel: "gpt-4o-mini-transcribe",
    });
  });
});

describe("recognition and text settings stay independent", () => {
  it("never writes text (LLM) fields when committing a recognition mode", () => {
    const apiPatch = apiModelModeSettingsPatch({
      adapterId: "openai",
      endpoint: "",
      model: "gpt-4o-transcribe",
    });
    const localPatch = localModelModeSettingsPatch({
      endpoint: "http://127.0.0.1:8000",
      model: "nvidia/nemotron-3.5-asr-streaming-0.6b",
    });

    for (const patch of [apiPatch, localPatch]) {
      expect(Object.keys(patch)).not.toContain("llmEndpoint");
      expect(Object.keys(patch)).not.toContain("llmModel");
      expect(Object.keys(patch)).not.toContain("llmLocalModelId");
      expect(Object.keys(patch)).not.toContain("llmApiKey");
    }
  });

  it("commits an API text model while keeping the recognition settings and the key", () => {
    const patch = apiTextModelSettingsPatch({
      endpoint: "https://api.deepseek.com",
      model: "deepseek-flash",
    });

    expect(patch).toEqual({
      llmEndpoint: "https://api.deepseek.com",
      llmModel: "deepseek-flash",
      llmLocalModelId: "",
    });
    expect(Object.keys(patch)).not.toContain("whisperEndpoint");
    expect(Object.keys(patch)).not.toContain("whisperModel");
    expect(Object.keys(patch)).not.toContain("llmApiKey");
  });

  it("drops a leftover local text model when switching text processing to API", () => {
    const patch = apiTextModelSettingsPatch({
      endpoint: "http://127.0.0.1:8011",
      model: "qwen3-1.7b-instruct-q4",
    });

    expect(patch.llmEndpoint).toBe("");
    expect(patch.llmModel).toBe(DEFAULT_API_TEXT_MODEL);
    // The bundled-runtime marker must be cleared so cleanup cannot warm the sidecar.
    expect(patch.llmLocalModelId).toBe("");
  });

  it("falls back to the API default when no text model is set", () => {
    expect(apiTextModelSettingsPatch().llmModel).toBe(DEFAULT_API_TEXT_MODEL);
    expect(
      apiTextModelSettingsPatch({ endpoint: "https://api.deepseek.com", model: "none" }).llmModel,
    ).toBe(DEFAULT_API_TEXT_MODEL);
  });

  it("keeps a configured local recognition model while the text API is committed", () => {
    const localStt = {
      whisperEndpoint: "http://127.0.0.1:8000",
      whisperModel: "nvidia/nemotron-3.5-asr-streaming-0.6b",
    };
    const patch = apiTextModelSettingsPatch({ endpoint: "https://api.deepseek.com" });
    const merged = normalizeSavedSettings({ ...localStt, ...patch });

    expect(merged.whisperEndpoint).toBe("http://127.0.0.1:8000");
    expect(merged.whisperModel).toBe("nvidia/nemotron-3.5-asr-streaming-0.6b");
    expect(resolveProcessingMode(merged)).toBe("local");
    expect(resolveTextProcessingMode(merged)).toBe("api");
  });
});
