import { expect, test } from "bun:test";
import type { AppSettings } from "./store";
import { cleanupDictation, stripThinking } from "./textCleanup";

const settings = {
  cleanupEnabled: true,
  llmEndpoint: "https://example.test/v1",
  llmModel: "test",
  llmApiKey: "key",
  apiKey: "",
  llmLocalModelId: "",
  language: "ru",
  selectedCleanupPromptId: "mine",
  prompts: [{ id: "mine", kind: "cleanup", name: "Test", prompt: "Clean" }],
} as AppSettings;
test("cleanup executes custom prompt, strips thinking and preserves fallback text", async () => {
  expect(stripThinking(" <think>x\ny</think> Привет.")).toBe("Привет.");
  expect(
    await cleanupDictation("Привет", settings, {
      run: async ({ text, prompt, signal, deadlineMs, operation }) => {
        expect(operation).toBe("cleanup");
        expect(text).toBe("Привет");
        expect(prompt).toContain("Clean");
        expect(signal?.aborted).toBe(false);
        expect(deadlineMs).toBeGreaterThan(Date.now());
        return "<think>x</think>Привет.";
      },
    }),
  ).toMatchObject({ text: "Привет.", applied: true });
  expect(
    await cleanupDictation("Привет", settings, {
      run: async () => {
        throw new Error("offline");
      },
    }),
  ).toMatchObject({ text: "Привет", reason: "error" });
  expect(
    await cleanupDictation("Привет", settings, { run: async () => "a".repeat(100) }),
  ).toMatchObject({ text: "Привет", reason: "rejected" });
  expect(await cleanupDictation("Привет", settings, { run: async () => "" })).toMatchObject({
    reason: "rejected",
  });
  expect(
    await cleanupDictation(
      "Привет",
      { ...settings, cleanupEnabled: false },
      {
        run: async () => {
          throw new Error("must not run");
        },
      },
    ),
  ).toMatchObject({ reason: "disabled" });
  expect(await cleanupDictation("Привет", { ...settings, llmModel: "none" })).toMatchObject({
    reason: "no-backend",
  });
  expect(
    await cleanupDictation("", settings, {
      run: async () => {
        throw new Error("must not run");
      },
    }),
  ).toMatchObject({ text: "", applied: false });
});
test("timeout aborts runner and discards late result", async () => {
  let signal: AbortSignal | undefined;
  let finish: (value: string) => void = () => {};
  const result = await cleanupDictation("Привет", settings, {
    run: (params) => {
      signal = params.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  expect(result).toMatchObject({ text: "Привет", reason: "timeout", applied: false });
  expect(signal?.aborted).toBe(true);
  finish("Поздний ответ");
  expect(result.text).toBe("Привет");
}, 12000);

test("builtin prompt follows selected id, caches successes and refreshes language/custom", async () => {
  const calls: string[] = [];
  const prompts: string[] = [];
  const loadPrompt = async (language: string, style: string) => {
    calls.push(`${language}:${style}`);
    return { prompt: `Builtin ${language}:${style}`, version: 4, temperature: 0 };
  };
  const run = async ({ prompt }: { prompt: string }) => {
    prompts.push(prompt);
    return "Привет.";
  };
  const builtin = {
    ...settings,
    language: "cache-ru",
    style: "classic",
    selectedCleanupPromptId: "tech",
  } as AppSettings;
  await cleanupDictation("Привет", builtin, { run, loadPrompt });
  await cleanupDictation("Привет", builtin, { run, loadPrompt });
  await cleanupDictation("Привет", { ...builtin, language: "cache-en" }, { run, loadPrompt });
  await cleanupDictation(
    "Привет",
    { ...builtin, selectedCleanupPromptId: "classic" },
    { run, loadPrompt },
  );
  expect(calls).toEqual(["cache-ru:tech", "cache-en:tech", "cache-ru:classic"]);
  expect(prompts[0]).toContain("cache-ru:tech");
  await cleanupDictation("Привет", settings, { run, loadPrompt });
  await cleanupDictation(
    "Привет",
    { ...settings, prompts: [{ ...settings.prompts[0], prompt: "Changed" }] },
    { run, loadPrompt },
  );
  expect(prompts[prompts.length - 1]).toContain("Changed");
  expect(calls).toHaveLength(3);
});

test("a failed builtin load is not cached", async () => {
  let calls = 0;
  const loadPrompt = async () => {
    if (++calls === 1) throw new Error("failed");
    return { prompt: "Clean" };
  };
  const builtin = {
    ...settings,
    language: "cache-retry",
    selectedCleanupPromptId: "tech",
  } as AppSettings;
  const deps = { loadPrompt, run: async () => "Привет." };
  expect((await cleanupDictation("Привет", builtin, deps)).reason).toBe("error");
  expect((await cleanupDictation("Привет", builtin, deps)).applied).toBe(true);
  expect(calls).toBe(2);
});

test("cleanup logs correlated safe decisions, fallback categories and one end", async () => {
  const raw = "PRIVATE_TRANSCRIPT_MARKER";
  for (const variant of [
    "success",
    "disabled",
    "no-model",
    "no-key",
    "failure",
    "empty",
  ] as const) {
    const logs: string[] = [];
    let calls = 0;
    const configured = {
      ...settings,
      llmEndpoint: "https://user:SECRET_URL@example.test/v1?token=SECRET_QUERY",
      llmApiKey: "SECRET_KEY",
    };
    if (variant === "disabled") configured.cleanupEnabled = false;
    if (variant === "no-model") configured.llmModel = "none";
    if (variant === "no-key") configured.llmApiKey = "";
    const outcome = await cleanupDictation(variant === "empty" ? "" : raw, configured, {
      context: {
        requestId: "attempt-2",
        entryId: "entry-1",
        trigger: "retry",
        globalEnabled: true,
        override: null,
      },
      log: (message) => logs.push(message),
      run: async ({ requestId, entryId, operation }) => {
        calls++;
        expect({ requestId, entryId, operation }).toEqual({
          requestId: "attempt-2",
          entryId: "entry-1",
          operation: "cleanup",
        });
        if (variant === "failure")
          throw new Error("[text:http_401] SECRET_BODY PRIVATE_TRANSCRIPT_MARKER");
        return raw;
      },
    });
    expect(calls).toBe(variant === "success" || variant === "failure" ? 1 : 0);
    expect(logs.filter((line) => line.includes("event=end"))).toHaveLength(1);
    expect(
      logs.every(
        (line) => line.includes("request_id=attempt-2") && line.includes("entry_id=entry-1"),
      ),
    ).toBe(true);
    const combined = logs.join("\n");
    for (const secret of [raw, "SECRET_KEY", "SECRET_QUERY", "SECRET_URL", "SECRET_BODY", "Clean"])
      expect(combined).not.toContain(secret);
    expect(combined).toContain("endpoint=https://example.test/v1");
    expect(combined).toContain("prep_ms=");
    if (variant === "failure")
      expect(outcome).toMatchObject({ text: raw, reason: "error", errorCode: "http_401" });
  }
});

test("approved glossary augments one custom request without rewriting its preset", async () => {
  let requests = 0;
  const logs: string[] = [];
  const before = JSON.stringify(settings.prompts);
  await cleanupDictation("Привет", settings, {
    vocabularyHints: [{ id: "term", canonical: "PRIVATE_TERM", provenance: "manual" }],
    log: (message) => logs.push(message),
    run: async ({ prompt }) => {
      requests += 1;
      expect(prompt).toContain("Clean");
      expect(prompt).toContain('["PRIVATE_TERM"]');
      return "Привет.";
    },
  });
  expect(requests).toBe(1);
  expect(JSON.stringify(settings.prompts)).toBe(before);
  expect(logs.join("\n")).not.toContain("PRIVATE_TERM");
});
