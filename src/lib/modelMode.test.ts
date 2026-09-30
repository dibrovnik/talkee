import { describe, expect, it } from "bun:test";

import {
  apiModelModeSettingsPatch,
  localModelModeSettingsPatch,
  resolveProcessingMode,
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
