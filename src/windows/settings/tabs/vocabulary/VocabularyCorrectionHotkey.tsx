import type { ReactElement } from "react";
import { useI18n } from "../../../../lib/i18n";
import { type AppSettings, formatHotkeyLabel, getSettings } from "../../../../lib/store";
import { Button } from "../../../../ui/Button";
import { FormRow } from "../../../../ui/FormRow";
import { useHotkeyCapture } from "../../useHotkeyCapture";

export function VocabularyCorrectionHotkey({
  settings,
  onApplied,
}: {
  settings: AppSettings;
  onApplied: (settings: AppSettings) => void;
}): ReactElement {
  const { t } = useI18n();
  const capture = useHotkeyCapture({
    target: "vocabularyCorrection",
    logTag: "VOCABULARY",
    messages: {
      initial: "",
      saved: "Горячая клавиша сохранена",
      applyFailed: t("settingsGeneralExtra.hotkey.applyFailed"),
      changeAgain: t("settingsGeneralExtra.hotkey.changeAgain"),
      pressNew: t("settingsGeneralExtra.hotkey.pressNew"),
      releaseToApply: t("settingsGeneralExtra.hotkey.releaseToApply"),
      cancelledKept: t("settingsGeneralExtra.hotkey.cancelledKept"),
      needMainKey: t("settingsGeneralExtra.hotkey.needMainKey"),
      invalid: "Недопустимая комбинация",
      recognizeFailed: t("settingsGeneralExtra.hotkey.recognizeFailed"),
      checkingFree: t("settingsGeneralExtra.hotkey.checkingFree"),
      sendFailed: t("settingsGeneralExtra.hotkey.sendFailed"),
      startingCapture: t("settingsGeneralExtra.hotkey.startingCapture"),
      pressNewCombo: t("settingsGeneralExtra.hotkey.pressNewCombo"),
      captureStartFailed: t("settingsGeneralExtra.hotkey.captureStartFailed"),
    },
    onApplied: async () => onApplied(await getSettings({ reload: true })),
  });
  return (
    <>
      <FormRow
        label="Запомнить исправление"
        description="Выделите исправленную фразу в редакторе и нажмите эту комбинацию."
        control={
          <span style={{ display: "flex", gap: 8 }}>
            {/* biome-ignore lint/a11y/useSemanticElements: shared native hotkey capture expects a focusable div. */}
            <div
              ref={capture.surfaceRef}
              role="button"
              tabIndex={0}
              className={`ui-input-hotkey${capture.active ? " ui-input-hotkey--active" : ""}`}
              onKeyDown={capture.handleSurfaceKeyDown}
              onMouseDown={capture.handleSurfaceMouseDown}
            >
              <span className="ui-input-hotkey__value">
                {formatHotkeyLabel(capture.draft ?? settings.vocabularyCorrectionHotkey) ||
                  "Не назначена"}
              </span>
              <span className="ui-input-hotkey__hint">
                {capture.active ? t("settings.hotkey.recording") : "Изменить"}
              </span>
            </div>
            {settings.vocabularyCorrectionHotkey && (
              <Button disabled={capture.submitting} onClick={() => void capture.submit("")}>
                Сбросить
              </Button>
            )}
          </span>
        }
      />
      {capture.feedback && (
        <FormRow
          label=""
          control={
            <span
              aria-live="polite"
              className={`ui-form-feedback${capture.tone === "error" ? " ui-form-feedback--error" : ""}`}
            >
              {capture.feedback}
            </span>
          }
        />
      )}
    </>
  );
}
