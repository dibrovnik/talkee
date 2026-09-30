import type { ReactElement } from "react";

import { type Icon, IconBriefcase, IconCode, IconMessage } from "../../../../lib/icons";
import type { AppSettings } from "../../../../lib/store";
import { TRANSCRIPTION_STYLE_OPTIONS } from "../../../../lib/transcriptionPrompts";
import { Badge } from "../../../../ui/Badge";
import { SegmentedControl } from "../../../../ui/SegmentedControl";
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

  if (!settings) return null;

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

      <SegmentedControl
        value={styleTabView}
        options={[
          { value: "style", label: t("models.styleTab.style") },
          { value: "prompts", label: t("models.styleTab.prompts") },
        ]}
        onChange={setStyleTabView}
        ariaLabel={t("models.textProcessing.title")}
      />

      {styleTabView === "style" && (
        <OptionList ariaLabel={t("models.styleTab.style")}>
          {TRANSCRIPTION_STYLE_OPTIONS.map((st) => {
            const isActive = settings.style === st.id;
            const Icon = STYLE_ICONS[st.id];

            return (
              <OptionCard
                key={st.id}
                active={isActive}
                icon={<Icon size={16} />}
                title={st.title}
                description={st.description}
                onClick={() =>
                  update({
                    style: st.id as AppSettings["style"],
                    selectedCleanupPromptId: st.id,
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
