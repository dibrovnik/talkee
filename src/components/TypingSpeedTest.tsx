import { emit } from "@tauri-apps/api/event";
import type { ChangeEvent, ClipboardEvent, DragEvent, ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SETTINGS_UPDATED_EVENT } from "../lib/hotkeyEvents";
import { useI18n } from "../lib/i18n";
import { logError } from "../lib/logger";
import { saveSettings } from "../lib/store";
import { normalizeTypingWpm, SUGGESTED_TYPING_WPM } from "../lib/typingSpeed";

/** Test length. The user can only leave through cancel, which saves nothing. */
const TEST_SECONDS = 60;

/** Below this many correctly typed words the measurement is not meaningful. */
const MIN_CORRECT_WORDS = 5;

/**
 * A single input event adding more characters than this is treated as a paste
 * (a fast typist produces one or two per keystroke). The `onPaste` handler is
 * the primary guard; this catches pastes that never fire it.
 */
const PASTE_CHUNK_LENGTH = 16;

/**
 * Local practice material. Never fetched, never uploaded: the whole test runs
 * on device. Three paragraphs keep a very fast typist busy for the full minute.
 */
const PROMPTS: readonly string[] = [
  `Сегодня мы проверяем, как быстро вы печатаете на обычной клавиатуре. Текст составлен из простых слов, чтобы измерение оставалось честным. Не спешите и старайтесь попадать по клавишам точно. Если заметили опечатку, можно её исправить, это нормально. Главное, чтобы результат отражал вашу настоящую скорость, а не случайный рывок.`,
  `Спокойная работа с текстом похожа на разговор с хорошим собеседником. Мы думаем быстрее, чем печатаем, поэтому голос часто экономит время. Диктовка помогает быстрее записать мысль, письмо или заметку. Потом текст можно прочитать, поправить и отправить адресату. Проверим, сколько времени вы на самом деле тратите на клавиши.`,
  `Хороший текст получается, когда мысль успевает за руками. Печатать вслепую полезно, но даже уверенный навык уступает голосу в скорости. Этот короткий тест показывает вашу среднюю скорость в словах за минуту. Число нужно только для оценки экономии времени и никуда не отправляется. Печатайте в своём ритме и не смотрите на секунды.`,
];

type Phase = "idle" | "running" | "finished" | "saved";

interface TypingMetrics {
  /** Every word present in the textarea. */
  typedWords: number;
  /** Words matching the prompt at the same position. */
  correctWords: number;
  /** Contrary or unmatched words inside the compared range. */
  mistakes: number;
}

interface TypingSpeedTestProps {
  /** Called after the measured speed has been persisted to settings. */
  onSaved?: (typingWpm: number) => void;
  /** Called when the user leaves the test without saving. */
  onClose?: () => void;
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function splitWords(text: string): string[] {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).map(normalizeWord) : [];
}

/**
 * Compare the typed text with the prompt position by position. Words typed past
 * the end of the prompt have nothing to compare against and are not counted.
 */
function countMetrics(prompt: string, typed: string): TypingMetrics {
  const promptWords = splitWords(prompt);
  const typedWords = splitWords(typed);
  const compared = Math.min(typedWords.length, promptWords.length);
  let correctWords = 0;
  let mistakes = 0;

  for (let index = 0; index < compared; index += 1) {
    const expected = promptWords[index] ?? "";
    if (expected !== "" && typedWords[index] === expected) {
      correctWords += 1;
    } else {
      mistakes += 1;
    }
  }

  return { typedWords: typedWords.length, correctWords, mistakes };
}

function pickPromptIndex(current: number): number {
  if (PROMPTS.length <= 1) {
    return 0;
  }
  let next = current;
  while (next === current) {
    next = Math.floor(Math.random() * PROMPTS.length);
  }
  return next;
}

/**
 * Optional 60-second typing test used to measure the words-per-minute value
 * behind the dictation savings estimate.
 *
 * The typed text is compared against a local prompt, paste is rejected and the
 * measured value is only written to the settings store after an explicit
 * confirmation — cancel always leaves settings untouched.
 */
export function TypingSpeedTest({ onSaved, onClose }: TypingSpeedTestProps): ReactElement {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [promptIndex, setPromptIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [pasteBlocked, setPasteBlocked] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedWpm, setSavedWpm] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const prompt = PROMPTS[promptIndex] ?? PROMPTS[0] ?? "";
  const metrics = useMemo(() => countMetrics(prompt, typed), [prompt, typed]);
  const remainingSec = Math.max(0, Math.ceil(TEST_SECONDS - elapsedSec));
  const measuredWpm =
    phase === "finished" || phase === "saved"
      ? Math.round(metrics.correctWords / (TEST_SECONDS / 60))
      : 0;

  useEffect(() => {
    if (phase !== "running" || startedAt === null) {
      return;
    }

    const tick = (): void => {
      const elapsed = (Date.now() - startedAt) / 1000;
      if (elapsed >= TEST_SECONDS) {
        setElapsedSec(TEST_SECONDS);
        setPhase("finished");
        return;
      }
      setElapsedSec(elapsed);
    };

    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [phase, startedAt]);

  useEffect(() => {
    if (phase === "running") {
      textareaRef.current?.focus();
    }
  }, [phase]);

  const reset = useCallback((): void => {
    setPhase("idle");
    setTyped("");
    setElapsedSec(0);
    setStartedAt(null);
    setPasteBlocked(false);
    setErrorMessage(null);
    setSavedWpm(null);
  }, []);

  const handleStart = useCallback((): void => {
    setPromptIndex((current) => pickPromptIndex(current));
    setTyped("");
    setElapsedSec(0);
    setStartedAt(Date.now());
    setPasteBlocked(false);
    setErrorMessage(null);
    setSavedWpm(null);
    setPhase("running");
  }, []);

  const handleCancel = useCallback((): void => {
    reset();
    onClose?.();
  }, [onClose, reset]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>): void => {
      const value = event.target.value;
      if (value.length - typed.length > PASTE_CHUNK_LENGTH) {
        // Pasted text must not count as typing.
        setPasteBlocked(true);
        return;
      }
      setTyped(value);
    },
    [typed],
  );

  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>): void => {
    event.preventDefault();
    setPasteBlocked(true);
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLTextAreaElement>): void => {
    event.preventDefault();
    setPasteBlocked(true);
  }, []);

  const handleSave = useCallback(async (): Promise<void> => {
    const typingWpm = normalizeTypingWpm(measuredWpm);
    if (typingWpm === undefined || metrics.correctWords < MIN_CORRECT_WORDS) {
      setErrorMessage(t("stats.typing.tooFewWords"));
      return;
    }

    setSaving(true);
    try {
      await saveSettings({ typingWpm });
      // Same convention as the settings tabs: let open windows reload settings.
      await emit(SETTINGS_UPDATED_EVENT).catch(() => null);
      setSavedWpm(typingWpm);
      setErrorMessage(null);
      setPhase("saved");
      onSaved?.(typingWpm);
    } catch (error) {
      void logError(
        "STATS",
        `Failed to save typing speed: ${error instanceof Error ? error.message : String(error)}`,
      );
      setErrorMessage(t("stats.typing.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [measuredWpm, metrics.correctWords, onSaved, t]);

  const running = phase === "running";
  const finished = phase === "finished";
  const saved = phase === "saved";

  return (
    <section
      style={{
        display: "grid",
        gap: 12,
        padding: "16px 18px",
        borderRadius: "var(--radius-lg)",
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <header style={{ display: "grid", gap: 4 }}>
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: "var(--fs-title3)",
            fontWeight: 600,
            color: "var(--text-hi)",
          }}
        >
          {t("stats.typing.title")}
        </h3>
        <p style={{ margin: 0, fontSize: "var(--fs-callout)", color: "var(--text-mid)" }}>
          {t("stats.typing.description", { seconds: TEST_SECONDS })}
        </p>
      </header>

      <p
        style={{
          margin: 0,
          padding: "10px 12px",
          borderRadius: "var(--radius-md)",
          background: "var(--bg)",
          border: "1px solid var(--border-subtle)",
          fontSize: "var(--fs-body)",
          lineHeight: 1.6,
          color: "var(--text-hi)",
        }}
      >
        {prompt}
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span
          aria-live="polite"
          style={{
            fontVariantNumeric: "tabular-nums",
            fontSize: "var(--fs-title3)",
            fontWeight: 600,
            color: running && remainingSec <= 10 ? "var(--danger)" : "var(--text-hi)",
          }}
        >
          {running
            ? t("stats.typing.timeLeft", { seconds: remainingSec })
            : finished || saved
              ? t("stats.typing.timeUp")
              : t("stats.typing.manualHint", { wpm: SUGGESTED_TYPING_WPM })}
        </span>
        <span style={{ fontSize: "var(--fs-callout)", color: "var(--text-mid)" }}>
          {t("stats.typing.correct", { count: metrics.correctWords })}
        </span>
        <span style={{ fontSize: "var(--fs-callout)", color: "var(--text-mid)" }}>
          {t("stats.typing.mistakes", { count: metrics.mistakes })}
        </span>
        <span style={{ fontSize: "var(--fs-callout)", color: "var(--text-low)" }}>
          {t("stats.typing.wordsTyped", { count: metrics.typedWords })}
        </span>
      </div>

      <textarea
        ref={textareaRef}
        value={typed}
        disabled={!running}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        aria-label={t("stats.typing.title")}
        placeholder={t("stats.typing.placeholder")}
        onChange={handleChange}
        onPaste={handlePaste}
        onDrop={handleDrop}
        style={{
          width: "100%",
          minHeight: 96,
          resize: "vertical",
          padding: "10px 12px",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border)",
          background: "var(--control-bg)",
          color: "var(--text-hi)",
          fontFamily: "var(--font)",
          fontSize: "var(--fs-body)",
          lineHeight: 1.6,
          opacity: running ? 1 : 0.6,
        }}
      />

      {pasteBlocked ? (
        <p style={{ margin: 0, fontSize: "var(--fs-callout)", color: "var(--danger)" }}>
          {t("stats.typing.pasteBlocked")}
        </p>
      ) : null}

      {finished || saved ? (
        <div style={{ display: "grid", gap: 4 }}>
          <strong style={{ fontSize: "var(--fs-title2)", color: "var(--text-hi)" }}>
            {t("stats.typing.result", { wpm: measuredWpm })}
          </strong>
          <span style={{ fontSize: "var(--fs-callout)", color: "var(--text-mid)" }}>
            {t("stats.typing.resultHint")}
          </span>
        </div>
      ) : null}

      {saved && savedWpm !== null ? (
        <p style={{ margin: 0, fontSize: "var(--fs-callout)", color: "var(--success)" }}>
          {t("stats.typing.saved", { wpm: savedWpm })}
        </p>
      ) : null}

      {errorMessage ? (
        <p style={{ margin: 0, fontSize: "var(--fs-callout)", color: "var(--danger)" }}>
          {errorMessage}
        </p>
      ) : null}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {phase === "idle" ? (
          <button type="button" className="btn btn-primary" onClick={handleStart}>
            {t("stats.typing.start")}
          </button>
        ) : null}

        {finished ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {t("stats.typing.save")}
          </button>
        ) : null}

        {finished || saved ? (
          <button type="button" className="btn" onClick={handleStart}>
            {t("stats.typing.retry")}
          </button>
        ) : null}

        {phase !== "idle" ? (
          <button type="button" className="btn" onClick={handleCancel}>
            {t("stats.typing.cancel")}
          </button>
        ) : null}
      </div>
    </section>
  );
}
