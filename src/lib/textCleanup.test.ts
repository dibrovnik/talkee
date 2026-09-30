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
      run: async ({ text, prompt, signal, deadlineMs }) => {
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
