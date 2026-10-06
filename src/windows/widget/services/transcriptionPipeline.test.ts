import { expect, test } from "bun:test";
import type { AppSettings } from "../../../lib/store";
import { applyDictationCleanup, runDictationStage } from "./transcriptionPipeline";

test("enabled cleanup without a model preserves raw text and offers model selection", async () => {
  const notices: Array<{ message: string; actionLabel?: string }> = [];
  const raw = "Не меняй ветку dev";
  const result = await applyDictationCleanup(
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
