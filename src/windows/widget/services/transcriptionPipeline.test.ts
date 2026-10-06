import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { AppSettings } from "../../../lib/store";
import type { CleanupOutcome } from "../../../lib/textCleanup";
import { createEmptyVocabularyState, type VocabularyState } from "../../../lib/vocabulary";
import { captureDictationVocabulary } from "./dictationVocabulary";
import {
  applyDictationTranslation,
  processDictationText,
  runDictationStage,
} from "./transcriptionPipeline";

test("enabled cleanup without a model preserves raw text and offers model selection", async () => {
  const notices: Array<{ message: string; actionLabel?: string }> = [];
  const raw = "Не меняй ветку dev";
  const result = await processDictationText(
    { raw, cleaned: raw },
    { cleanupEnabled: true, llmModel: "none", prompts: [] } as unknown as AppSettings,
    { requestId: "no-backend", trigger: "main-hotkey", globalEnabled: true, override: null },
    async (message, actionLabel) => {
      notices.push({ message, actionLabel });
    },
  );
  expect(result.raw).toBe(raw);
  expect(result.cleaned).toBe(raw);
  expect(notices).toHaveLength(1);
  expect(notices[0].message).toBeTruthy();
  expect(notices[0].actionLabel).toBeTruthy();
});

test("STT and paste share the attempt id and end on errors without logging payload", async () => {
  for (const stage of ["stt", "paste"] as const)
    for (const fails of [true, false]) {
      const logs: string[] = [];
      const work = () =>
        fails
          ? Promise.reject(new Error("[text:transport] SECRET_BODY"))
          : Promise.resolve("PRIVATE_TEXT");
      const result = runDictationStage(
        {
          requestId: "attempt-2",
          entryId: "entry-1",
          trigger: "retry",
          globalEnabled: true,
          override: null,
        },
        stage,
        work,
        (line) => logs.push(line),
      );
      if (fails) await expect(result).rejects.toThrow("SECRET_BODY");
      else expect(await result).toBe("PRIVATE_TEXT");
      expect(logs).toHaveLength(2);
      expect(logs[0]).toContain("event=start request_id=attempt-2 entry_id=entry-1");
      expect(logs[1]).toContain(`outcome=${fails ? "error" : "success"}`);
      expect(logs[1]).toContain(`${stage}_ms=`);
      expect(logs.join(" ")).not.toContain("SECRET_BODY");
      expect(logs.join(" ")).not.toContain("PRIVATE_TEXT");
    }
});

test("batch and streaming results stay in the ticker after paste, window behavior is unchanged", async () => {
  const { pasteWithDictationOverlay } = await import("./transcriptionPipeline");
  const context = {
    requestId: "batch",
    trigger: "pipeline" as const,
    globalEnabled: true,
    override: null,
  };
  for (const streaming of [false, true]) {
    const events: string[] = [];
    const stream = streaming
      ? {
          requestId: "stream",
          latestText: () => "old",
          showInserting: async () => {
            events.push("window-inserting");
          },
          showError: async () => {
            events.push("window-error");
          },
          hide: async () => {
            events.push("hide");
          },
          dispose: () => {
            events.push("dispose");
          },
        }
      : null;
    const show = async (payload: {
      requestId: string;
      status: string;
      text: string;
    }): Promise<void> => {
      expect(payload.requestId).toBe(streaming ? "stream" : "batch");
      expect(payload.text).toBe("final");
      events.push(payload.status);
    };
    expect(
      await pasteWithDictationOverlay(
        "final",
        context,
        true,
        stream,
        async () => {
          events.push("paste");
        },
        show,
      ),
    ).toBe(false);
    expect(events).toEqual([
      ...(streaming ? ["dispose"] : []),
      "dictating",
      "inserting",
      "paste",
      "done",
    ]);
    events.length = 0;
    expect(
      await pasteWithDictationOverlay(
        "final",
        context,
        true,
        stream,
        async () => {
          throw new Error("paste failed");
        },
        show,
      ),
    ).toBe(true);
    expect(events[events.length - 1]).toBe("error");
    expect(events).not.toContain("hide");
    events.length = 0;
    await pasteWithDictationOverlay(
      "final",
      context,
      false,
      stream,
      async () => {
        events.push("paste");
      },
      show,
    );
    expect(events).toEqual(
      streaming ? ["dispose", "window-inserting", "paste", "hide"] : ["paste"],
    );
  }
});

describe("personal vocabulary in the dictation pipeline", () => {
  const context = {
    requestId: "vocab",
    trigger: "pipeline" as const,
    globalEnabled: false,
    override: null,
  };
  const off = { cleanupEnabled: false, llmModel: "none", prompts: [] } as unknown as AppSettings;

  function vocabularyState(revision = 1): VocabularyState {
    const state = createEmptyVocabularyState();
    state.revision = revision;
    state.lexiconRevision = revision;
    state.config = { ...state.config, enabled: true };
    state.terms = [
      {
        id: "term-pim",
        canonical: "PIM",
        language: "any",
        category: "service",
        scope: { global: true },
        enabled: true,
        useAsHint: true,
        provenance: "manual",
        variants: [
          {
            id: "rule-pim",
            source: "пим",
            enabled: true,
            caseSensitive: false,
            contextWords: [],
            provenance: "manual",
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    return state;
  }

  async function capture(state: VocabularyState | null) {
    return captureDictationVocabulary("ru", {
      getView: async () =>
        state ? { status: "ready" as const, state } : { status: "corrupt" as const, reason: "x" },
    });
  }

  function cleanupStub(text: string, applied: boolean, reason?: CleanupOutcome["reason"]) {
    const calls: string[] = [];
    const clean = async (raw: string): Promise<CleanupOutcome> => {
      calls.push(raw);
      return { requestId: "r", prepMs: 0, text, applied, reason, durationMs: 1 };
    };
    return { calls, clean: clean as never };
  }

  test("cleanup off: approved rule applies without any LLM call and raw stays the real STT", async () => {
    const result = await processDictationText(
      { raw: "открой пим", cleaned: "открой пим" },
      off,
      context,
      async () => {},
      await capture(vocabularyState()),
    );
    expect(result.raw).toBe("открой пим");
    expect(result.cleaned).toBe("открой PIM");
    expect(result.cleanupApplied).toBe(false);
    expect(result.preVocabularyText).toBeUndefined();
    expect(result.personalization).toMatchObject({
      lexiconRevision: 1,
      replacements: 1,
      ruleIds: ["rule-pim"],
      status: "applied",
      hintMode: "none",
    });
  });

  test("cleanup failure notices differ with and without vocabulary replacements", async () => {
    const notices: string[] = [];
    const notice = async (message: string): Promise<void> => {
      notices.push(message);
    };
    for (const raw of ["открой пим", "открой файл"]) {
      const stub = cleanupStub(raw, false, "timeout");
      await processDictationText(
        { raw, cleaned: raw },
        off,
        context,
        notice,
        await capture(vocabularyState()),
        stub.clean,
      );
    }
    expect(notices).toHaveLength(2);
    expect(notices[0]).not.toBe(notices[1]);
    expect(notices[0]).toContain("словарь");
  });

  test("text before the vocabulary is kept only when cleanup changed it and the vocabulary changed it again", async () => {
    const stub = cleanupStub("Открой пим.", true);
    const result = await processDictationText(
      { raw: "открой пим", cleaned: "открой пим" },
      off,
      context,
      async () => {},
      await capture(vocabularyState()),
      stub.clean,
    );
    expect(stub.calls).toEqual(["открой пим"]);
    expect(result).toMatchObject({
      raw: "открой пим",
      cleaned: "Открой PIM.",
      cleanupApplied: true,
      preVocabularyText: "Открой пим.",
    });
    const untouched = await processDictationText(
      { raw: "открой файл", cleaned: "открой файл" },
      off,
      context,
      async () => {},
      await capture(vocabularyState()),
      cleanupStub("Открой файл.", true).clean,
    );
    expect(untouched.preVocabularyText).toBeUndefined();
    expect(untouched.personalization?.status).toBe("unchanged");
  });

  test("the same raw text and snapshot give the same final text on every path", async () => {
    const snapshot = await capture(vocabularyState());
    const results = await Promise.all(
      [0, 1, 2].map(() =>
        processDictationText(
          { raw: "пим и пим", cleaned: "пим и пим" },
          off,
          context,
          async () => {},
          snapshot,
        ),
      ),
    );
    expect(new Set(results.map((r) => r.cleaned))).toEqual(new Set(["PIM и PIM"]));
  });

  test("a snapshot captured at record start ignores rules changed during the recording", async () => {
    const state = vocabularyState(1);
    const atStart = await capture(state);
    const changed = vocabularyState(2);
    changed.terms[0].variants[0].enabled = false;
    const later = await capture(changed);
    const raw = { raw: "пим", cleaned: "пим" };
    expect((await processDictationText(raw, off, context, async () => {}, atStart)).cleaned).toBe(
      "PIM",
    );
    expect((await processDictationText(raw, off, context, async () => {}, later)).cleaned).toBe(
      "пим",
    );
  });

  test("an unreadable vocabulary leaves a successful transcription untouched", async () => {
    for (const captured of [
      await capture(null),
      await captureDictationVocabulary("ru", {
        getView: async () => {
          throw new Error("ipc down");
        },
      }),
    ]) {
      expect(captured.failure).toBeTruthy();
      const result = await processDictationText(
        { raw: "пим", cleaned: "пим" },
        off,
        context,
        async () => {},
        captured,
      );
      expect(result.cleaned).toBe("пим");
      expect(result.personalization).toBeUndefined();
    }
  });

  test("translation receives the normalized source and the translation is never normalized", async () => {
    const prompts: string[] = [];
    const translated = await applyDictationTranslation(
      {
        raw: "открой пим",
        cleaned: "открой PIM",
        personalization: undefined,
      },
      {
        ...off,
        language: "ru",
        translation: { active: true, targetLanguage: "en" },
      } as unknown as AppSettings,
      () =>
        ({
          kind: "custom",
          run: async ({ text }: { text: string }) => {
            prompts.push(text);
            return "open пим";
          },
        }) as never,
    );
    expect(prompts).toEqual(["открой PIM"]);
    expect(translated.cleaned).toBe("open пим");
    expect(translated.dictationTranslation?.sourceText).toBe("открой PIM");
    expect(translated.raw).toBe("открой пим");
  });

  test("provenance never claims a human correction, so it cannot feed itself back as evidence", async () => {
    const result = await processDictationText(
      { raw: "пим", cleaned: "пим" },
      off,
      context,
      async () => {},
      await capture(vocabularyState()),
    );
    const serialized = JSON.stringify(result.personalization);
    for (const marker of ["human", "provenance", "origin", "evidence"]) {
      expect(serialized).not.toContain(marker);
    }
  });

  test("only ordinary voice dictation runs the vocabulary pass", async () => {
    const root = join(import.meta.dir, "../../..");
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    const users: string[] = [];
    for await (const file of glob.scan(root)) {
      if (file.includes(".test.")) continue;
      const source = await Bun.file(join(root, file)).text();
      if (/applyVocabularyStage|processDictationText/.test(source)) users.push(file);
    }
    expect(users.sort()).toEqual([
      "windows/widget/services/dictationVocabulary.ts",
      "windows/widget/services/transcriptionPipeline.ts",
    ]);
  });
});
