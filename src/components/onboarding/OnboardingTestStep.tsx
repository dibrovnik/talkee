import { listen } from "@tauri-apps/api/event";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { HISTORY_DELETED_EVENT, HISTORY_UPDATED_EVENT } from "../../lib/hotkeyEvents";
import { useI18n } from "../../lib/i18n";
import { IconCheck } from "../../lib/icons";
import { logError } from "../../lib/logger";
import { matchesOnboardingTestPhrase } from "../../lib/onboarding";
import type { AppSettings, HistoryEntry } from "../../lib/store";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import { DictationHotkeyControl } from "../DictationHotkeyControl";
import { OnboardingConfetti } from "./OnboardingConfetti";
import { OnboardingShell } from "./OnboardingShell";

export function OnboardingTestStep({
  settings,
  onBack,
  onComplete,
}: {
  settings: AppSettings;
  onBack: () => void;
  onComplete: () => void;
}): ReactElement {
  const { t } = useI18n();
  const mountedAtRef = useRef(Date.now());
  const activeEntryIdRef = useRef<string | null>(null);
  const [activeSettings, setActiveSettings] = useState(settings);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [phraseMatched, setPhraseMatched] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    const unlistenPromise = listen<HistoryEntry>(HISTORY_UPDATED_EVENT, ({ payload: entry }) => {
      if (
        disposed ||
        entry.source !== "voice" ||
        Date.parse(entry.timestamp) < mountedAtRef.current
      ) {
        return;
      }

      if (entry.status === "processing") {
        activeEntryIdRef.current = entry.id;
        setProcessing(true);
        setTranscript("");
        setPhraseMatched(false);
        setError("");
        return;
      }

      if (entry.id !== activeEntryIdRef.current) return;

      setProcessing(false);
      if (entry.status === "failed") {
        activeEntryIdRef.current = null;
        setPhraseMatched(false);
        setError(entry.errorMessage || t("onboarding.test.failed"));
        return;
      }

      if (entry.status === "interrupted") {
        activeEntryIdRef.current = null;
        setPhraseMatched(false);
        setError(entry.errorMessage || t("onboarding.test.failed"));
        return;
      }

      const recognized = entry.raw.trim() || entry.cleaned.trim();
      if (entry.status === "completed" && recognized) {
        activeEntryIdRef.current = null;
        setTranscript(recognized);
        setPhraseMatched(matchesOnboardingTestPhrase(recognized, t("onboarding.test.phrase")));
        setError("");
        return;
      }

      if (entry.status === "completed") {
        activeEntryIdRef.current = null;
        setPhraseMatched(false);
        setError(t("onboarding.test.noSpeech"));
      }
    });

    const unlistenDeletedPromise = listen<{ id: string }>(HISTORY_DELETED_EVENT, ({ payload }) => {
      if (disposed || payload.id !== activeEntryIdRef.current) return;
      activeEntryIdRef.current = null;
      setProcessing(false);
      setTranscript("");
      setPhraseMatched(false);
      setError(t("onboarding.test.noSpeech"));
    });

    unlistenPromise.catch((cause) => {
      logError(
        "ONBOARDING",
        `Failed to listen for dictation test result: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    });
    unlistenDeletedPromise.catch((cause) => {
      logError(
        "ONBOARDING",
        `Failed to listen for empty dictation test result: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    });

    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
      void unlistenDeletedPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [t]);

  const canFinish = Boolean(transcript) && phraseMatched;

  return (
    <OnboardingShell
      currentStep={2}
      title={t("onboarding.test.title")}
      footer={
        <>
          <Button onClick={onBack}>← {t("onboarding.back")}</Button>
          {canFinish ? (
            <Button variant="primary" size="large" onClick={onComplete}>
              {t("onboarding.test.finish")}
            </Button>
          ) : (
            <Button onClick={onComplete}>{t("onboarding.test.skip")}</Button>
          )}
        </>
      }
    >
      <div className="ui-onboarding-test">
        <DictationHotkeyControl
          settings={activeSettings}
          onSettingsChange={setActiveSettings}
          appearance="keycaps"
          livePreview
        />

        <p className="ui-onboarding-test__phrase">{t("onboarding.test.phrase")}</p>

        {processing && (
          <div role="status" aria-live="polite" className="ui-onboarding-test__processing">
            <Spinner size={24} label={t("onboarding.test.processing")} />
            <span className="ui-onboarding__status">{t("onboarding.test.processing")}</span>
          </div>
        )}

        {transcript && phraseMatched && (
          <div
            className="ui-onboarding-test__result onboarding-success-reveal"
            role="status"
            aria-live="polite"
          >
            <OnboardingConfetti key={transcript} />
            <div className="ui-onboarding-test__result-title ui-onboarding-test__result-title--success">
              <IconCheck size={16} stroke={2.5} />
              {t("onboarding.test.result")}
            </div>
            <p className="ui-onboarding-test__transcript">{transcript}</p>
          </div>
        )}

        {transcript && !phraseMatched && (
          <div role="status" aria-live="polite" className="ui-onboarding-test__result">
            <div className="ui-onboarding-test__result-title ui-onboarding-test__result-title--error">
              {t("onboarding.test.mismatchTitle")}
            </div>
            <p className="ui-onboarding-test__transcript">{transcript}</p>
            <span className="ui-form-hint">{t("onboarding.test.mismatchHint")}</span>
          </div>
        )}

        {error && (
          <div role="alert" className="ui-callout ui-callout--error">
            {error}
          </div>
        )}
      </div>
    </OnboardingShell>
  );
}
