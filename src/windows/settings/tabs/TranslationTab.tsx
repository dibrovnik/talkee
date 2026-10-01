import { emit, listen } from "@tauri-apps/api/event";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { LANGUAGES } from "../../../config/languages";
import { SETTINGS_UPDATED_EVENT } from "../../../lib/hotkeyEvents";
import { useI18n } from "../../../lib/i18n";
import { logError } from "../../../lib/logger";
import {
  type AppSettings,
  DEFAULT_SELECTION_TRANSLATION_HOTKEY,
  formatHotkeyLabel,
  getSettings,
  saveSettings,
  type TranslationSettings,
} from "../../../lib/store";
import { FormRow } from "../../../ui/FormRow";
import { FormSection } from "../../../ui/FormSection";
import { PopUpButton } from "../../../ui/PopUpButton";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { Slider } from "../../../ui/Slider";
import { Toggle } from "../../../ui/Toggle";
import { useHotkeyCapture } from "../useHotkeyCapture";

const LIVE_VOICES = ["marin", "cedar", "coral", "verse"] as const;
const LIVE_VOICE_SPEEDS = [0.9, 1, 1.05, 1.1, 1.2] as const;

type TranslationView = "live" | "other";

function fallbackTargetLanguage(sourceLanguage: string): string {
  return sourceLanguage === "en" ? "ru" : "en";
}

function normalizeTargetLanguage(sourceLanguage: string, targetLanguage: string): string {
  if (
    targetLanguage &&
    targetLanguage !== "auto" &&
    (sourceLanguage === "auto" || targetLanguage !== sourceLanguage)
  ) {
    return targetLanguage;
  }

  return fallbackTargetLanguage(sourceLanguage);
}

function fallbackSelectionTargetLanguage(sourceLanguage: string): string {
  return sourceLanguage && sourceLanguage !== "auto" ? sourceLanguage : "en";
}

function normalizeSelectionTargetLanguage(sourceLanguage: string, targetLanguage: string): string {
  if (targetLanguage && targetLanguage !== "auto") {
    return targetLanguage;
  }

  return fallbackSelectionTargetLanguage(sourceLanguage);
}

export function TranslationTab(): ReactElement {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeView, setActiveView] = useState<TranslationView>("live");
  const [liveVoiceVolumeDraft, setLiveVoiceVolumeDraft] = useState<number | null>(null);
  const liveVoiceVolumeDraftRef = useRef<number | null>(null);
  const selectionHotkeyCapture = useHotkeyCapture({
    target: "selection",
    logTag: "TRANSLATION",
    messages: {
      initial: "",
      applyFailed: t("settingsGeneralExtra.hotkey.applyFailed"),
      saved: t("translation.selection.hotkeySaved"),
      changeAgain: t("settingsGeneralExtra.hotkey.changeAgain"),
      pressNew: t("settingsGeneralExtra.hotkey.pressNew"),
      releaseToApply: t("settingsGeneralExtra.hotkey.releaseToApply"),
      cancelledKept: t("settingsGeneralExtra.hotkey.cancelledKept"),
      needMainKey: t("settingsGeneralExtra.hotkey.needMainKey"),
      invalid: t("translation.selection.hotkeyInvalid"),
      recognizeFailed: t("settingsGeneralExtra.hotkey.recognizeFailed"),
      checkingFree: t("settingsGeneralExtra.hotkey.checkingFree"),
      sendFailed: t("settingsGeneralExtra.hotkey.sendFailed"),
      startingCapture: t("settingsGeneralExtra.hotkey.startingCapture"),
      pressNewCombo: t("settingsGeneralExtra.hotkey.pressNewCombo"),
      captureStartFailed: t("settingsGeneralExtra.hotkey.captureStartFailed"),
    },
    onApplied: async () => {
      const latest = await getSettings({ reload: true });
      setSettings(latest);
    },
  });
  const {
    surfaceRef: selectionHotkeyRef,
    active: selectionHotkeyCaptureActive,
    submitting: selectionHotkeySubmitting,
    draft: selectionHotkeyDraft,
    feedback: selectionHotkeyFeedback,
    tone: selectionHotkeyTone,
    handleSurfaceKeyDown: handleSelectionHotkeyCaptureSurfaceKeyDown,
    handleSurfaceMouseDown: handleSelectionHotkeyCaptureSurfaceMouseDown,
  } = selectionHotkeyCapture;

  useEffect(() => {
    let mounted = true;
    const loadSettings = async (): Promise<void> => {
      try {
        const next = await getSettings({ reload: true });
        if (mounted) setSettings(next);
      } catch (error) {
        void logError(
          "TRANSLATION",
          `Failed to load translation settings: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    void loadSettings();
    const unlistenPromise = listen(SETTINGS_UPDATED_EVENT, () => {
      void loadSettings();
    });

    return () => {
      mounted = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const sourceLanguage = settings?.language || "ru";
  const targetOptions = useMemo(
    () =>
      LANGUAGES.filter(
        (language) =>
          language.code !== "auto" &&
          (sourceLanguage === "auto" || language.code !== sourceLanguage),
      ),
    [sourceLanguage],
  );
  const selectionTargetOptions = useMemo(
    () => LANGUAGES.filter((language) => language.code !== "auto"),
    [],
  );
  const targetLanguage = settings
    ? normalizeTargetLanguage(sourceLanguage, settings.translation.targetLanguage)
    : fallbackTargetLanguage(sourceLanguage);
  const selectionTargetLanguage = settings
    ? normalizeSelectionTargetLanguage(sourceLanguage, settings.translation.selectionTargetLanguage)
    : fallbackSelectionTargetLanguage(sourceLanguage);
  const liveTargetLanguage = settings?.translation.liveTargetLanguage || "en";
  const localModelMode = Boolean(/127\.0\.0\.1|localhost/i.test(settings?.whisperEndpoint || ""));
  const liveVoiceSupported = Boolean(
    settings && !localModelMode && settings.selectedTranslationAdapter === "openai",
  );
  const liveVoiceActive = liveVoiceSupported && Boolean(settings?.translation.liveVoiceEnabled);

  const updateTranslation = async (
    patch: Partial<TranslationSettings>,
  ): Promise<AppSettings | null> => {
    if (!settings) return null;

    const nextTranslation: TranslationSettings = {
      ...settings.translation,
      ...patch,
    };
    nextTranslation.targetLanguage = normalizeTargetLanguage(
      settings.language,
      nextTranslation.targetLanguage,
    );
    nextTranslation.selectionTargetLanguage = normalizeSelectionTargetLanguage(
      settings.language,
      nextTranslation.selectionTargetLanguage,
    );

    const nextSettings: AppSettings = {
      ...settings,
      translation: nextTranslation,
    };
    setSettings(nextSettings);

    try {
      await saveSettings({ translation: patch });
      const latest = await getSettings({ reload: true });
      setSettings(latest);
      await emit(SETTINGS_UPDATED_EVENT);
      return latest;
    } catch (error) {
      void logError(
        "TRANSLATION",
        `Failed to save translation settings: ${error instanceof Error ? error.message : String(error)}`,
      );
      const restored = await getSettings({ reload: true });
      setSettings(restored);
      await emit(SETTINGS_UPDATED_EVENT).catch(() => null);
      return restored;
    }
  };

  const previewLiveVoiceVolume = (value: number): void => {
    liveVoiceVolumeDraftRef.current = value;
    setLiveVoiceVolumeDraft(value);
  };

  const commitLiveVoiceVolume = async (): Promise<void> => {
    const value = liveVoiceVolumeDraftRef.current;
    if (value === null) return;

    liveVoiceVolumeDraftRef.current = null;
    setLiveVoiceVolumeDraft(null);
    if (!settings || value === settings.translation.liveVoiceVolume) return;

    await updateTranslation({ liveVoiceVolume: value });
  };

  const toggleSelectionTranslation = async (): Promise<void> => {
    if (!settings || selectionHotkeySubmitting) return;

    if (settings.translation.selectionEnabled) {
      selectionHotkeyCapture.resetFeedback();
      await updateTranslation({ selectionEnabled: false });
      return;
    }

    await selectionHotkeyCapture.submit(
      settings.translation.selectionHotkey || DEFAULT_SELECTION_TRANSLATION_HOTKEY,
    );
  };

  if (!settings) {
    return <div className="ui-tab-hint">{t("translation.loading")}</div>;
  }

  const displayedLiveVoiceVolume = liveVoiceVolumeDraft ?? settings.translation.liveVoiceVolume;
  const { translation } = settings;

  return (
    <div className="ui-tab">
      <div className="ui-page-header">
        <div className="ui-page-header__title">{t("translation.page.title")}</div>
        <div className="ui-page-header__desc">{t("translation.page.desc")}</div>
      </div>

      <div className="ui-view-switch">
        <SegmentedControl
          value={activeView}
          ariaLabel={t("translation.view.live")}
          options={[
            { value: "live" as const, label: t("translation.view.live") },
            { value: "other" as const, label: t("translation.view.other") },
          ]}
          onChange={setActiveView}
        />
      </div>

      {activeView === "other" ? (
        <>
          <FormSection title={t("translation.dictation.title")}>
            <FormRow
              label={t("translation.target.title")}
              control={
                <PopUpButton
                  value={targetLanguage}
                  ariaLabel={t("translation.target.title")}
                  options={targetOptions.map((language) => ({
                    value: language.code,
                    label: `${language.native} (${language.name})`,
                  }))}
                  onChange={(code) => {
                    void updateTranslation({ targetLanguage: code });
                  }}
                />
              }
            />
            <FormRow
              label={t("translation.widget.title")}
              control={
                <Toggle
                  checked={translation.active}
                  ariaLabel={t("translation.widget.title")}
                  onChange={(checked) => {
                    void updateTranslation({ active: checked });
                  }}
                />
              }
            />
          </FormSection>

          <FormSection title={t("translation.selection.title")}>
            <FormRow
              label={t("translation.selection.title")}
              control={
                <Toggle
                  checked={translation.selectionEnabled}
                  disabled={selectionHotkeySubmitting}
                  ariaLabel={t("translation.selection.title")}
                  onChange={() => {
                    void toggleSelectionTranslation();
                  }}
                />
              }
            />
            <FormRow
              label={t("translation.target.title")}
              control={
                <PopUpButton
                  value={selectionTargetLanguage}
                  ariaLabel={t("translation.target.title")}
                  options={selectionTargetOptions.map((language) => ({
                    value: language.code,
                    label: `${language.native} (${language.name})`,
                  }))}
                  onChange={(code) => {
                    void updateTranslation({ selectionTargetLanguage: code });
                  }}
                />
              }
            />
            <FormRow
              label={t("translation.selection.hotkeyLabel")}
              control={
                // biome-ignore lint/a11y/useSemanticElements: custom hotkey-capture surface keeps its grid layout; a <button> would change rendering.
                <div
                  id="selection-translation-hotkey"
                  ref={selectionHotkeyRef}
                  role="button"
                  tabIndex={0}
                  className={`ui-input-hotkey${
                    selectionHotkeyCaptureActive ? " ui-input-hotkey--active" : ""
                  }`}
                  onMouseDown={handleSelectionHotkeyCaptureSurfaceMouseDown}
                  onKeyDown={handleSelectionHotkeyCaptureSurfaceKeyDown}
                  onFocus={() => {
                    if (selectionHotkeyCaptureActive || selectionHotkeySubmitting) return;
                    selectionHotkeyCapture.showIdleFeedback(t("translation.selection.hotkeyIdle"));
                  }}
                >
                  <span className="ui-input-hotkey__value">
                    {selectionHotkeyDraft
                      ? formatHotkeyLabel(selectionHotkeyDraft)
                      : selectionHotkeyCaptureActive
                        ? t("settings.hotkey.press")
                        : selectionHotkeySubmitting
                          ? t("settingsGeneralExtra.hotkey.checkingFree")
                          : formatHotkeyLabel(
                              settings.translation.selectionHotkey ||
                                DEFAULT_SELECTION_TRANSLATION_HOTKEY,
                            )}
                  </span>
                  <span className="ui-input-hotkey__hint">
                    {selectionHotkeyCaptureActive
                      ? t("settings.hotkey.recording")
                      : t("translation.selection.hotkeyChange")}
                  </span>
                </div>
              }
            />
            {selectionHotkeyFeedback ? (
              <FormRow
                label=""
                control={
                  <span
                    aria-live="polite"
                    className={[
                      "ui-form-feedback",
                      selectionHotkeyTone === "error" ? "ui-form-feedback--error" : "",
                      selectionHotkeyTone === "success" ? "ui-form-feedback--success" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {selectionHotkeyFeedback}
                  </span>
                }
              />
            ) : null}
          </FormSection>
        </>
      ) : (
        <FormSection title={t("translation.live.title")} footer={t("translation.live.desc")}>
          <FormRow
            label={t("translation.live.target")}
            control={
              <PopUpButton
                value={liveTargetLanguage}
                ariaLabel={t("translation.live.target")}
                options={selectionTargetOptions.map((language) => ({
                  value: language.code,
                  label: `${language.native} (${language.name})`,
                }))}
                onChange={(code) => {
                  void updateTranslation({ liveTargetLanguage: code });
                }}
              />
            }
          />
          <FormRow
            label={t("translation.live.widget")}
            control={
              <Toggle
                checked={translation.liveWidgetEnabled}
                ariaLabel={t("translation.live.widget")}
                onChange={(checked) => {
                  void updateTranslation({ liveWidgetEnabled: checked });
                }}
              />
            }
          />
          <FormRow
            label={t("translation.live.microphone")}
            control={
              <Toggle
                checked={translation.liveMicrophoneEnabled}
                ariaLabel={t("translation.live.microphone")}
                onChange={(checked) => {
                  void updateTranslation({ liveMicrophoneEnabled: checked });
                }}
              />
            }
          />
          <FormRow
            label={t("translation.live.voice")}
            description={
              liveVoiceSupported
                ? t("translation.live.voiceDesc")
                : t("translation.live.voiceOpenAiOnly")
            }
            control={
              <Toggle
                checked={liveVoiceActive}
                disabled={!liveVoiceSupported}
                ariaLabel={t("translation.live.voice")}
                onChange={() => {
                  void updateTranslation({
                    liveVoiceEnabled: !settings.translation.liveVoiceEnabled,
                  });
                }}
              />
            }
          />
          {liveVoiceActive ? (
            <>
              <FormRow
                label={t("translation.live.muteOriginal")}
                description={t("translation.live.muteOriginalDesc")}
                control={
                  <Toggle
                    checked={translation.liveMuteOriginalEnabled}
                    ariaLabel={t("translation.live.muteOriginal")}
                    onChange={(checked) => {
                      void updateTranslation({ liveMuteOriginalEnabled: checked });
                    }}
                  />
                }
              />
              <FormRow
                label={t("translation.live.voiceName")}
                control={
                  <PopUpButton
                    value={translation.liveVoice}
                    ariaLabel={t("translation.live.voiceName")}
                    options={LIVE_VOICES.map((voice) => ({
                      value: voice,
                      label: t(`translation.live.voice.${voice}`),
                    }))}
                    onChange={(voice) => {
                      void updateTranslation({ liveVoice: voice });
                    }}
                  />
                }
              />
              <FormRow
                label={
                  <label htmlFor="translation-live-volume">{t("translation.live.volume")}</label>
                }
                control={
                  <div className="ui-slider-field">
                    <Slider
                      id="translation-live-volume"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={displayedLiveVoiceVolume}
                      ariaLabel={t("translation.live.volume")}
                      onChange={previewLiveVoiceVolume}
                      onCommit={() => void commitLiveVoiceVolume()}
                    />
                    <span className="ui-slider-field__value">
                      {Math.round(displayedLiveVoiceVolume * 100)}%
                    </span>
                  </div>
                }
              />
              <FormRow
                label={t("translation.live.speed")}
                control={
                  <PopUpButton
                    value={String(translation.liveVoiceSpeed)}
                    ariaLabel={t("translation.live.speed")}
                    options={LIVE_VOICE_SPEEDS.map((speed) => ({
                      value: String(speed),
                      label: `${speed.toFixed(2).replace(/0$/, "")}×`,
                    }))}
                    onChange={(speed) => {
                      void updateTranslation({ liveVoiceSpeed: Number(speed) });
                    }}
                  />
                }
              />
            </>
          ) : null}
        </FormSection>
      )}
    </div>
  );
}
