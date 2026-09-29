import { describe, expect, it } from "bun:test";

import { normalizeSavedSettings } from "./store";

describe("legacy cloud mode migration", () => {
  it("moves cloud user with an installed local model to Local mode", () => {
    const normalized = normalizeSavedSettings({
      useOwnKey: false,
      deviceToken: "device-jwt",
      hotkey: "Command+Shift+Space",
      language: "ru",
      localModels: {
        "whisper-large-v3-turbo": {
          status: "downloaded",
          downloadedAt: "2024-01-01T00:00:00.000Z",
        },
      },
      whisperEndpoint: "",
    });

    expect(normalized.whisperEndpoint).toBe("http://127.0.0.1:8000");
    expect(normalized.whisperModel).toBe("whisper-large-v3-turbo");
    expect(normalized.provider).toBe("custom");
    expect(normalized.whisperApiKey).toBe("");
    expect(normalized.hotkey).toBe("Shift+Command+Space");
    expect(normalized.language).toBe("ru");
  });

  it("moves cloud user without a local model to API mode", () => {
    const normalized = normalizeSavedSettings({
      useOwnKey: false,
      deviceToken: "device-jwt",
      apiKey: "",
      provider: "openai",
      whisperModel: "gpt-4o-transcribe",
    });

    expect(normalized.whisperEndpoint).toBe("");
    expect(normalized.provider).toBe("openai");
  });

  it("drops legacy cloud-only keys from normalized settings", () => {
    const normalized = normalizeSavedSettings({
      useOwnKey: false,
      deviceToken: "device-jwt",
    });

    expect(normalized).not.toHaveProperty("useOwnKey");
    expect(normalized).not.toHaveProperty("deviceToken");
  });

  it("keeps other settings intact during migration", () => {
    const normalized = normalizeSavedSettings({
      useOwnKey: false,
      deviceToken: "device-jwt",
      hotkey: "Alt+Shift+Space",
      selectedCleanupPromptId: "prompt-1",
      prompts: [{ id: "prompt-1", name: "P", kind: "cleanup", prompt: "x" }],
    });

    expect(normalized.hotkey).toBe("Alt+Shift+Space");
    expect(normalized.selectedCleanupPromptId).toBe("prompt-1");
    expect(normalized.prompts).toHaveLength(1);
  });

  it("does not touch local-endpoint users without legacy keys", () => {
    const normalized = normalizeSavedSettings({
      provider: "custom",
      whisperEndpoint: "http://127.0.0.1:8000",
      whisperModel: "whisper-small",
    });

    expect(normalized.whisperEndpoint).toBe("http://127.0.0.1:8000");
    expect(normalized.whisperModel).toBe("whisper-small");
    expect(normalized.provider).toBe("custom");
  });
});
