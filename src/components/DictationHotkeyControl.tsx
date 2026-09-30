import type { ReactElement } from "react";

import { useI18n } from "../lib/i18n";
import { type AppSettings, DEFAULT_HOTKEY, formatHotkeyLabel, getSettings } from "../lib/store";
import { useHotkeyCapture } from "../windows/settings/useHotkeyCapture";
import { HotkeyKeycaps } from "./HotkeyKeycaps";
import { useLiveHotkeyPreview } from "./useLiveHotkeyPreview";

export function DictationHotkeyControl({
  settings,
  onSettingsChange,
  appearance = "field",
  livePreview = false,
}: {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  appearance?: "field" | "keycaps";
  livePreview?: boolean;
}): ReactElement {
  const { t } = useI18n();
  const capture = useHotkeyCapture({
    target: "dictation",
    logTag: "HOTKEY",
    messages: {
      initial: t("settingsGeneralExtra.hotkey.initial"),
      applyFailed: t("settingsGeneralExtra.hotkey.applyFailed"),
      saved: t("settingsGeneralExtra.hotkey.saved"),
      changeAgain: t("settingsGeneralExtra.hotkey.changeAgain"),
      pressNew: t("settingsGeneralExtra.hotkey.pressNew"),
      releaseToApply: t("settingsGeneralExtra.hotkey.releaseToApply"),
      cancelledKept: t("settingsGeneralExtra.hotkey.cancelledKept"),
      needMainKey: t("settingsGeneralExtra.hotkey.needMainKey"),
      invalid: t("settingsGeneralExtra.hotkey.invalid"),
      recognizeFailed: t("settingsGeneralExtra.hotkey.recognizeFailed"),
      checkingFree: t("settingsGeneralExtra.hotkey.checkingFree"),
      sendFailed: t("settingsGeneralExtra.hotkey.sendFailed"),
      startingCapture: t("settingsGeneralExtra.hotkey.startingCapture"),
      pressNewCombo: t("settingsGeneralExtra.hotkey.pressNewCombo"),
      captureStartFailed: t("settingsGeneralExtra.hotkey.captureStartFailed"),
    },
    onApplied: async () => {
      onSettingsChange(await getSettings({ reload: true }));
    },
  });
  const displayValue = capture.draft
    ? formatHotkeyLabel(capture.draft)
    : capture.active
      ? t("settings.hotkey.press")
      : formatHotkeyLabel(settings.hotkey || DEFAULT_HOTKEY);
  const pressedKeys = useLiveHotkeyPreview({
    enabled: livePreview,
    hotkeyLabel: displayValue,
  });

  const surfaceClass =
    appearance === "keycaps"
      ? `ui-hotkey-keycaps${capture.active ? " ui-hotkey-keycaps--active" : ""}`
      : `ui-input-hotkey${capture.active ? " ui-input-hotkey--active" : ""}`;

  return (
    <div className="ui-form-stack">
      {/* biome-ignore lint/a11y/useSemanticElements: custom hotkey-capture surface keeps its grid/keycaps layout; a <button> would change rendering. */}
      <div
        ref={capture.surfaceRef}
        role="button"
        tabIndex={0}
        aria-disabled={capture.submitting}
        aria-label={`${t("settings.hotkey.title")}: ${displayValue}`}
        onMouseDown={capture.handleSurfaceMouseDown}
        onKeyDown={capture.handleSurfaceKeyDown}
        className={surfaceClass}
        style={{ opacity: capture.submitting ? 0.8 : 1 }}
      >
        {appearance === "keycaps" ? (
          <HotkeyKeycaps label={displayValue} pressedKeys={pressedKeys} size="large" />
        ) : (
          <>
            <span className="ui-input-hotkey__value">{displayValue}</span>
            <span className="ui-input-hotkey__hint">
              {capture.submitting
                ? t("settings.hotkey.checking")
                : capture.active
                  ? t("settings.hotkey.recording")
                  : t("settings.hotkey.change")}
            </span>
          </>
        )}
      </div>
      {(capture.active || capture.submitting || capture.tone !== "idle") && (
        <div
          role={capture.tone === "error" ? "alert" : "status"}
          className={[
            "ui-form-feedback",
            capture.tone === "error" ? "ui-form-feedback--error" : "",
            capture.tone === "success" ? "ui-form-feedback--success" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {capture.feedback}
        </div>
      )}
    </div>
  );
}
