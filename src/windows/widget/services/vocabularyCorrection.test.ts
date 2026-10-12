import { expect, test } from "bun:test";
import {
  type CorrectionCapture,
  captureVocabularyCorrection,
  noteSuccessfulDictationPaste,
} from "./vocabularyCorrection";

test("capture reads selection before focus and only suggests a recent source", async () => {
  const calls: string[] = [];
  let captured: CorrectionCapture | null = null;
  noteSuccessfulDictationPaste("source-1", 1000);
  const deps = {
    copy: async () => {
      calls.push("copy");
      return "PIM";
    },
    show: async () => {
      calls.push("show");
    },
    publish: async (value: CorrectionCapture) => {
      calls.push("publish");
      captured = value;
    },
    now: () => 1001,
  };
  await captureVocabularyCorrection(deps);
  expect(calls).toEqual(["copy", "show", "publish"]);
  expect(captured!.sourceId).toBe("source-1");
  await captureVocabularyCorrection({ ...deps, now: () => 602000 });
  expect(captured!.sourceId).toBeNull();
});

test("empty selection and denied permission never show or publish", async () => {
  let writes = 0;
  const deps = {
    copy: async () => "  ",
    show: async () => {
      writes++;
    },
    publish: async (_value: CorrectionCapture) => {
      writes++;
    },
    now: Date.now,
  };
  await expect(captureVocabularyCorrection(deps)).rejects.toThrow();
  await expect(
    captureVocabularyCorrection({
      ...deps,
      copy: async () => {
        throw new Error("permission");
      },
    }),
  ).rejects.toThrow("permission");
  expect(writes).toBe(0);
});
