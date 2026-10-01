import { describe, expect, test } from "bun:test";

import { guardTranscriptionResult, isClearlySilentAudio } from "./transcriptionGuard";

describe("transcription hallucination guard", () => {
  test("rejects the Russian refusal hallucinated on silence", () => {
    expect(
      guardTranscriptionResult(
        {
          raw: "Извините, я не могу помочь с этой просьбой.",
          cleaned: "Извините, я не могу помочь с этой просьбой.",
        },
        "ru",
      ),
    ).toMatchObject({
      transcription: null,
      rejectionReason: "known-silence-hallucination",
    });
  });

  test("rejects a short Hangul-only result for Russian recognition", () => {
    expect(guardTranscriptionResult({ raw: "점심시간", cleaned: "점심시간" }, "ru")).toMatchObject({
      transcription: null,
      rejectionReason: "unexpected-short-script",
    });
    expect(guardTranscriptionResult({ raw: "", cleaned: "점심시간" }, "ru")).toMatchObject({
      transcription: null,
      rejectionReason: "unexpected-short-script",
    });
  });

  test("keeps existing caption hallucinations filtered", () => {
    expect(
      guardTranscriptionResult(
        { raw: "Продолжение следует...", cleaned: "Продолжение следует..." },
        "ru",
      ),
    ).toMatchObject({
      transcription: null,
      rejectionReason: "known-silence-hallucination",
    });
  });

  test("allows the same Korean phrase for Korean and automatic recognition", () => {
    expect(
      guardTranscriptionResult({ raw: "점심시간", cleaned: "점심시간" }, "ko").transcription
        ?.cleaned,
    ).toBe("점심시간");
    expect(
      guardTranscriptionResult({ raw: "점심시간", cleaned: "점심시간" }, "auto").transcription
        ?.cleaned,
    ).toBe("점심시간");
  });

  test("falls back to the raw text when cleanup echoes the instruction", () => {
    const guarded = guardTranscriptionResult(
      {
        raw: "Скорость примерно сто двадцать километров в час, это тридцать три метра в секунду.",
        cleaned: "Верни только исправленный текст без пояснений.",
      },
      "ru",
    );
    expect(guarded.cleanedFallbackReason).toBe("instruction-echo");
    expect(guarded.transcription?.cleaned).toBe(
      "Скорость примерно сто двадцать километров в час, это тридцать три метра в секунду.",
    );
  });

  test("rejects the English instruction echo as well", () => {
    expect(
      guardTranscriptionResult(
        { raw: "Hello there", cleaned: "Return only the corrected text" },
        "en",
      ).cleanedFallbackReason,
    ).toBe("instruction-echo");
  });

  test("does not flag real dictation that merely mentions the words", () => {
    const guarded = guardTranscriptionResult(
      {
        raw: "Верни только исправленный текст без пояснений, пожалуйста, сказал он.",
        cleaned: "Верни только исправленный текст без пояснений, пожалуйста, сказал он.",
      },
      "ru",
    );
    expect(guarded.cleanedFallbackReason).toBeNull();
    expect(guarded.transcription?.cleaned).toContain("сказал он");
  });

  test("keeps ordinary short Russian speech", () => {
    expect(
      guardTranscriptionResult({ raw: "Добрый день.", cleaned: "Добрый день." }, "ru")
        .transcription,
    ).toEqual({ raw: "Добрый день.", cleaned: "Добрый день." });
  });

  test("falls back to recognized raw text when cleanup returns a refusal", () => {
    expect(
      guardTranscriptionResult(
        {
          raw: "Составь план встречи.",
          cleaned: "Извините, я не могу помочь с этой просьбой.",
        },
        "ru",
      ),
    ).toMatchObject({
      transcription: {
        raw: "Составь план встречи.",
        cleaned: "Составь план встречи.",
      },
      rejectionReason: null,
      cleanedFallbackReason: "known-silence-hallucination",
    });
  });

  test("detects only effectively silent audio stats", () => {
    expect(isClearlySilentAudio({ peak: 0, rms: 0 })).toBe(true);
    expect(isClearlySilentAudio({ peak: 0.0009, rms: 0.00009 })).toBe(true);
    expect(isClearlySilentAudio({ peak: 0.01, rms: 0.002 })).toBe(false);
    expect(isClearlySilentAudio(undefined)).toBe(false);
  });
});

test("cleanup length boundary preserves raw and rejects expansion", () => {
  expect(
    guardTranscriptionResult({ raw: "Hello", cleaned: "a".repeat(50) }, "en").cleanedFallbackReason,
  ).toBeNull();
  expect(guardTranscriptionResult({ raw: "Hello", cleaned: "a".repeat(51) }, "en")).toMatchObject({
    transcription: { raw: "Hello", cleaned: "Hello" },
    cleanedFallbackReason: "excessive-cleanup-length",
  });
});
