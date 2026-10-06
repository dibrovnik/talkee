import { describe, expect, it } from "bun:test";

import { TEXT_MODEL_PRESETS } from "../windows/settings/tabs/settingsTabsTypes";
import { type AppSettings, normalizeSavedSettings } from "./store";
import {
  isSummaryAvailable,
  LOCAL_TEXT_PROCESSING_LIMITS,
  resolveSummaryBackend,
  runTextMapReduce,
} from "./summarize";

function settings(overrides: Partial<AppSettings>): AppSettings {
  return {
    apiKey: "",
    llmApiKey: "",
    llmEndpoint: "",
    llmModel: "gpt-4o-mini",
    llmLocalModelId: "",
    ...overrides,
  } as AppSettings;
}

describe("resolveSummaryBackend local LLM behavior", () => {
  it("treats the persisted none sentinel as no selected text model", () => {
    const backend = resolveSummaryBackend(
      settings({ apiKey: "transcription-key", llmModel: "none" }),
    );
    expect(backend).toBeNull();
    expect(isSummaryAvailable(settings({ apiKey: "transcription-key", llmModel: "none" }))).toBe(
      false,
    );
  });

  it("requires a text model even when a custom endpoint is configured", () => {
    expect(
      resolveSummaryBackend(
        settings({
          llmEndpoint: "http://localhost:11434/v1",
          llmModel: " ",
        }),
      ),
    ).toBeNull();
  });

  it("treats bundled runtime port 8011 without a selected model as unavailable", () => {
    const backend = resolveSummaryBackend(settings({ llmEndpoint: "http://127.0.0.1:8011/v1" }));
    expect(backend).toBeNull();
    expect(isSummaryAvailable(settings({ llmEndpoint: "http://127.0.0.1:8011/v1" }))).toBe(false);
  });

  it("treats bundled fallback ports without a selected model as unavailable", () => {
    expect(
      resolveSummaryBackend(settings({ llmEndpoint: "http://127.0.0.1:18210/v1" })),
    ).toBeNull();
  });

  it("resolves bundled local runtime when llmLocalModelId is set", () => {
    const backend = resolveSummaryBackend(
      settings({
        llmEndpoint: "http://127.0.0.1:8011/v1",
        llmModel: "qwen2.5-3b-instruct-q4",
        llmLocalModelId: "qwen2.5-3b-instruct-q4",
      }),
    );
    expect(backend?.kind).toBe("local");
  });

  it("does not block a user's own localhost server outside bundled ports", () => {
    const backend = resolveSummaryBackend(
      settings({
        llmEndpoint: "http://localhost:11434/v1",
        llmModel: "qwen2.5:7b",
      }),
    );
    expect(backend?.kind).toBe("local");
  });

  it("keeps the DeepSeek API preset on the custom runner, never the bundled one", () => {
    const preset = TEXT_MODEL_PRESETS.find((candidate) => candidate.id === "deepseek");
    const deepseekSettings = settings({
      llmEndpoint: preset?.endpoint ?? "",
      llmModel: preset?.model ?? "",
      llmLocalModelId: "",
      llmApiKey: "user-key",
    });
    const backend = resolveSummaryBackend(deepseekSettings);

    expect(preset).toBeDefined();
    // "custom" means the runner only calls process_text: the bundled runtime
    // (start_local_llm) is never started for an API text model.
    expect(backend?.kind).toBe("custom");
    expect(backend?.label).toBe("https://api.deepseek.com");
    expect(isSummaryAvailable(deepseekSettings)).toBe(true);
  });
});

describe("stored settings migration for bundled local LLM", () => {
  it("migrates old 8011 bundled runtime settings into llmLocalModelId", () => {
    const normalized = normalizeSavedSettings({
      llmEndpoint: "http://127.0.0.1:8011/v1",
      llmModel: "qwen2.5-3b-instruct-q4",
    });
    expect(normalized.llmLocalModelId).toBe("qwen2.5-3b-instruct-q4");
  });

  it("migrates Qwen3 bundled runtime settings into llmLocalModelId", () => {
    const normalized = normalizeSavedSettings({
      llmEndpoint: "http://127.0.0.1:8011/v1",
      llmModel: "qwen3-1.7b-instruct-q4",
    });
    expect(normalized.llmLocalModelId).toBe("qwen3-1.7b-instruct-q4");
  });

  it("migrates fallback bundled runtime ports into llmLocalModelId", () => {
    const normalized = normalizeSavedSettings({
      llmEndpoint: "http://127.0.0.1:18208/v1",
      llmModel: "qwen2.5-7b-instruct-q4",
    });
    expect(normalized.llmLocalModelId).toBe("qwen2.5-7b-instruct-q4");
  });

  it("does not mark a user-managed localhost endpoint as bundled runtime", () => {
    const normalized = normalizeSavedSettings({
      llmEndpoint: "http://localhost:11434/v1",
      llmModel: "qwen2.5:7b",
    });
    expect(normalized.llmLocalModelId).toBeUndefined();
  });
});

describe("stored settings migration for local STT", () => {
  it("repairs stale mode flags when Whisper endpoint is local", () => {
    const normalized = normalizeSavedSettings({
      provider: "openai",
      whisperApiKey: "stale-key",
      whisperEndpoint: "http://127.0.0.1:8000",
    });

    expect(normalized.provider).toBe("custom");
    expect(normalized.whisperApiKey).toBe("");
  });

  it("migrates removed Qwen and Parakeet endpoints to unified transcribe.cpp runtime", () => {
    const normalized = normalizeSavedSettings({
      provider: "custom",
      whisperApiKey: "",
      whisperEndpoint: "http://127.0.0.1:8002",
    });

    expect(normalized.whisperEndpoint).toBe("http://127.0.0.1:8000");
  });

  it("migrates the legacy local STT streaming toggle state", () => {
    const normalized = normalizeSavedSettings({
      localModels: {
        "nemotron-35-asr-streaming-06b": {
          status: "downloaded",
          streamingEnabled: false,
        },
      },
    });

    expect(normalized.realtimeTranscriptionEnabled).toBe(false);
  });
});

describe("long text map-reduce processing", () => {
  it("splits large local text into bounded model calls", async () => {
    const source = Array.from(
      { length: 90 },
      (_, index) =>
        `[00:${String(index).padStart(2, "0")}:00] Ученик: длинный фрагмент урока с деталями HTML, CSS, атрибутами, классами и домашним заданием.`,
    ).join("\n");
    const calls: Array<{ text: string; prompt: string; maxTokens?: number }> = [];

    const result = await runTextMapReduce(
      source,
      "Сделай подробное саммари урока.",
      0.3,
      async ({ text, prompt, maxTokens }) => {
        calls.push({ text, prompt, maxTokens });
        return `Краткие тезисы ${calls.length}`;
      },
      undefined,
      undefined,
      LOCAL_TEXT_PROCESSING_LIMITS,
    );

    expect(result).toBe(`Краткие тезисы ${calls.length}`);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0].text.length).toBeLessThanOrEqual(LOCAL_TEXT_PROCESSING_LIMITS.chunkChars);
    expect(calls[1].text.length).toBeLessThanOrEqual(LOCAL_TEXT_PROCESSING_LIMITS.chunkChars);
    expect(Math.max(...calls.map((call) => call.text.length))).toBeLessThan(source.length);
    expect(calls[0].prompt).toContain("НЕ пиши финальное саммари");
    expect(calls[0].maxTokens).toBeLessThan(calls[calls.length - 1]?.maxTokens ?? 0);
    expect(calls[calls.length - 1]?.prompt).toContain(
      "Объедини их в один связный итоговый результат",
    );
  });
});

it("aborted text runners never start requests or local warm-up", async () => {
  const controller = new AbortController();
  controller.abort();
  for (const configured of [
    settings({ llmApiKey: "key" }),
    settings({
      llmEndpoint: "http://127.0.0.1:8011/v1",
      llmLocalModelId: "qwen3-1.7b-instruct-q4",
    }),
  ]) {
    const backend = resolveSummaryBackend(configured);
    await expect(
      backend?.run({ text: "Hello", prompt: "Clean", signal: controller.signal }),
    ).rejects.toThrow();
  }
});

it("shared text runner forwards cleanup operation and correlation to native command", async () => {
  const previous = globalThis.window;
  const calls: { command: string; req: Record<string, unknown> }[] = [];
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command: string, args: { req: Record<string, unknown> }) => {
        calls.push({ command, req: args.req });
        return { result: "Hello." };
      },
    },
  } as unknown as Window & typeof globalThis;
  try {
    const backend = resolveSummaryBackend(
      settings({ llmEndpoint: "https://example.test/v1", llmModel: "test", llmApiKey: "SECRET" }),
    );
    expect(
      await backend?.run({
        text: "Hello",
        prompt: "Clean",
        operation: "cleanup",
        requestId: "attempt-2",
        entryId: "entry-1",
        deadlineMs: 123,
      }),
    ).toBe("Hello.");
    expect(calls[0].command).toBe("process_text");
    expect(calls[0].req).toMatchObject({
      operation: "cleanup",
      request_id: "attempt-2",
      entry_id: "entry-1",
      deadline_ms: 123,
    });
    await backend?.run({ text: "Hello", prompt: "Summarize" });
    expect(calls[1].req.operation).toBeNull();
    expect(calls[1].req.request_id).toBeNull();
  } finally {
    globalThis.window = previous;
  }
});

it("local cleanup failure is not replayed, while the next take can recover", async () => {
  const previous = globalThis.window;
  const commands: string[] = [];
  let requests = 0;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command: string) => {
        commands.push(command);
        if (command === "start_local_llm") return "http://127.0.0.1:8011/v1";
        if (command === "process_text") {
          if (++requests === 1) throw new Error("[text:transport] Ошибка соединения");
          return { result: "Hello." };
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    },
  } as unknown as Window & typeof globalThis;
  try {
    const backend = resolveSummaryBackend(
      settings({
        llmEndpoint: "http://127.0.0.1:8011/v1",
        llmLocalModelId: "qwen3-1.7b-instruct-q4",
      }),
    );
    const params = { text: "Hello", prompt: "Clean", operation: "cleanup" as const };
    await expect(backend?.run(params)).rejects.toThrow("transport");
    expect(commands).toEqual(["start_local_llm", "process_text"]);
    expect(await backend?.run(params)).toBe("Hello.");
    expect(commands).toEqual(["start_local_llm", "process_text", "process_text"]);
  } finally {
    globalThis.window = previous;
  }
});

it("local summaries retain runtime recovery for safe native transport errors", async () => {
  const previous = globalThis.window;
  const commands: string[] = [];
  let requests = 0;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command: string) => {
        commands.push(command);
        if (command === "start_local_llm") return "http://127.0.0.1:8011/v1";
        if (command === "stop_local_llm") return;
        if (++requests === 1) throw new Error("[text:transport] Ошибка соединения");
        return { result: "Summary" };
      },
    },
  } as unknown as Window & typeof globalThis;
  try {
    const backend = resolveSummaryBackend(
      settings({
        llmEndpoint: "http://127.0.0.1:8011/v1",
        llmLocalModelId: "qwen3-1.7b-instruct-q4",
      }),
    );
    expect(await backend?.run({ text: "Hello", prompt: "Summarize" })).toBe("Summary");
    expect(commands).toEqual([
      "start_local_llm",
      "process_text",
      "stop_local_llm",
      "start_local_llm",
      "process_text",
    ]);
  } finally {
    globalThis.window = previous;
  }
});
