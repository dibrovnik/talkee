import { type ReactElement, useState } from "react";
import { DictationHotkeyControl } from "../../../../components/DictationHotkeyControl";
import { selectCleanupPreset, toggleCleanup } from "../../../../lib/cleanupToggle";
import { type Icon, IconBriefcase, IconCode, IconMessage } from "../../../../lib/icons";
import { logError } from "../../../../lib/logger";
import { type AppSettings, listPromptsByKind } from "../../../../lib/store";
import { TRANSCRIPTION_STYLE_OPTIONS } from "../../../../lib/transcriptionPrompts";
import { Badge } from "../../../../ui/Badge";
import { FormRow } from "../../../../ui/FormRow";
import { FormSection } from "../../../../ui/FormSection";
import { SegmentedControl } from "../../../../ui/SegmentedControl";
import { Toggle } from "../../../../ui/Toggle";
import { OptionCard, OptionList } from "../OptionCard";
import { useSettingsTabsState } from "../useSettingsTabsState";
import { PromptLibrary } from "./PromptLibrary";

const IS_DEV = import.meta.env.DEV;

export function StyleTab(): ReactElement | null {
  const {
    t,
    settings,
    update,
    syncSettings,
    styleTabView,
    setStyleTabView,
    promptPreview,
    promptPreviewError,
  } = useSettingsTabsState("style");

  const [cleanupError, setCleanupError] = useState("");
  if (!settings) return null;
  const changeCleanup = async (): Promise<void> => {
    try {
      await toggleCleanup();
      await syncSettings();
      setCleanupError("");
    } catch (error) {
      setCleanupError(String(error));
      logError("CLEANUP", String(error));
    }
  };

  const STYLE_ICONS: Record<AppSettings["style"], Icon> = {
    classic: IconMessage,
    business: IconBriefcase,
    tech: IconCode,
  };

  return (
    <div className="ui-tab">
      <div className="ui-page-header">
        <div className="ui-page-header__title">{t("models.textProcessing.title")}</div>
        <div className="ui-page-header__desc">{t("models.textProcessing.desc")}</div>
      </div>

      <FormSection footer={t("cleanup.localHint")}>
        <FormRow
          label={t("cleanup.title")}
          description={t("cleanup.hint")}
          control={
            <Toggle
              checked={settings.cleanupEnabled}
              ariaLabel={t("cleanup.title")}
              onChange={() => {
                void changeCleanup();
              }}
            />
          }
        />
        <FormRow
          label={t("cleanup.hotkey")}
          control={
            <DictationHotkeyControl
              target="cleanup"
              settings={settings}
              onSettingsChange={() => {
                void syncSettings();
              }}
            />
          }
        />
        {cleanupError && (
          <div role="alert" className="ui-form-feedback ui-form-feedback--error">
            {cleanupError}
          </div>
        )}
      </FormSection>

      <div className="ui-view-switch">
        <SegmentedControl
          value={styleTabView}
          options={[
            { value: "style", label: t("models.styleTab.style") },
            { value: "prompts", label: t("models.styleTab.prompts") },
          ]}
          onChange={setStyleTabView}
          ariaLabel={t("models.textProcessing.title")}
        />
      </div>

      {styleTabView === "style" && (
        <OptionList ariaLabel={t("models.styleTab.style")}>
          {listPromptsByKind(settings, "cleanup").map((st) => {
            const isActive = settings.selectedCleanupPromptId === st.id;
            const Icon = STYLE_ICONS[st.id as AppSettings["style"]] ?? IconMessage;

            return (
              <OptionCard
                key={st.id}
                active={isActive}
                icon={<Icon size={16} />}
                title={st.name}
                description={
                  TRANSCRIPTION_STYLE_OPTIONS.find((option) => option.id === st.id)?.description ??
                  st.prompt
                }
                onClick={() =>
                  void selectCleanupPreset(st.id)
                    .then(syncSettings)
                    .catch((error) => {
                      setCleanupError(String(error));
                      logError("CLEANUP", String(error));
                    })
                }
              />
            );
          })}
        </OptionList>
      )}

      {styleTabView === "prompts" && (
        <PromptLibrary settings={settings} onReload={syncSettings} update={update} />
      )}

      {IS_DEV && styleTabView === "style" && (
        <details className="ui-form-group ui-disclosure-panel">
          <summary className="ui-disclosure-panel__summary">
            <div className="ui-section-row__main">
              <div className="ui-section-row__title">{t("models.preview.title")}</div>
              <div className="ui-section-row__desc">{t("models.preview.desc")}</div>
            </div>
            {promptPreview && <Badge>v{promptPreview.version}</Badge>}
          </summary>

          <div className="ui-disclosure-panel__body">
            {promptPreviewError ? (
              <div className="ui-form-feedback ui-form-feedback--error">
                {t("models.preview.buildError", { error: promptPreviewError })}
              </div>
            ) : promptPreview ? (
              <>
                <div className="ui-form-stack">
                  <div className="ui-form-field__label">{t("models.preview.profile")}</div>
                  <div className="ui-code-inline">{promptPreview.profileKey}</div>
                </div>

                <div className="ui-form-stack">
                  <div className="ui-form-field__label">{t("models.preview.layers")}</div>
                  <div className="ui-speaker-list">
                    {promptPreview.layers.map((layer) => (
                      <Badge key={layer} className="ui-code-inline">
                        {layer}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="ui-form-stack">
                  <div className="ui-form-field__label">{t("models.preview.promptText")}</div>
                  <pre className="ui-code-block">{promptPreview.prompt}</pre>
                </div>
              </>
            ) : (
              <div className="ui-form-feedback">{t("models.preview.building")}</div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
