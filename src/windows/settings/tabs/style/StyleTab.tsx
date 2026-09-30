import type { ReactElement } from "react";

import {
  type Icon,
  IconBriefcase,
  IconCode,
  IconMessage,
  IconTypography,
} from "../../../../lib/icons";
import type { AppSettings } from "../../../../lib/store";
import { TRANSCRIPTION_STYLE_OPTIONS } from "../../../../lib/transcriptionPrompts";
import { OptionCard } from "../OptionCard";
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

  const styleTabOptions: Array<{
    id: "style" | "prompts";
    label: string;
    Icon: Icon;
  }> = [
    { id: "style", label: t("models.styleTab.style"), Icon: IconTypography },
    { id: "prompts", label: t("models.styleTab.prompts"), Icon: IconMessage },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-hi)" }}>
          {t("models.textProcessing.title")}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}>
          {t("models.textProcessing.desc")}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          background: "var(--control-track)",
          borderRadius: 10,
          padding: 3,
          gap: 2,
        }}
      >
        {styleTabOptions.map(({ id, label, Icon }) => {
          const active = styleTabView === id;

          return (
            <button
              key={id}
              onClick={() => setStyleTabView(id)}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 8,
                border: "none",
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                fontFamily: "var(--font-main)",
                background: active ? "var(--dropdown-active)" : "transparent",
                color: active ? "var(--text-hi)" : "var(--text-mid)",
                cursor: "pointer",
                transition: "all 0.18s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
              }}
            >
              <Icon size={15} stroke={active ? 2.2 : 1.7} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {styleTabView === "style" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {TRANSCRIPTION_STYLE_OPTIONS.map((st) => {
            const isActive = settings.style === st.id;
            const Icon = STYLE_ICONS[st.id];

            return (
              <OptionCard
                key={st.id}
                active={isActive}
                icon={<Icon size={20} stroke={isActive ? 2.4 : 1.8} />}
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
        </div>
      )}

      {styleTabView === "prompts" && (
        <PromptLibrary settings={settings} onReload={syncSettings} update={update} />
      )}

      {IS_DEV && styleTabView === "style" && (
        <details className="card" style={{ background: "var(--surface)" }}>
          <summary
            style={{
              cursor: "pointer",
              listStyle: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--text-hi)",
                  marginBottom: 4,
                }}
              >
                {t("models.preview.title")}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text-mid)",
                  lineHeight: 1.6,
                }}
              >
                {t("models.preview.desc")}
              </div>
            </div>
            {promptPreview && <div className="label">v{promptPreview.version}</div>}
          </summary>

          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            {promptPreviewError ? (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--danger)",
                  lineHeight: 1.6,
                }}
              >
                {t("models.preview.buildError", { error: promptPreviewError })}
              </div>
            ) : promptPreview ? (
              <>
                <div style={{ display: "grid", gap: 4 }}>
                  <div className="label">{t("models.preview.profile")}</div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-hi)",
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    }}
                  >
                    {promptPreview.profileKey}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div className="label">{t("models.preview.layers")}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {promptPreview.layers.map((layer) => (
                      <span
                        key={layer}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 999,
                          background: "var(--control-track)",
                          fontSize: 11,
                          color: "var(--text-mid)",
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        }}
                      >
                        {layer}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div className="label">{t("models.preview.promptText")}</div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 14,
                      borderRadius: 12,
                      background: "var(--control-muted)",
                      color: "var(--text-mid)",
                      fontSize: 11,
                      lineHeight: 1.65,
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      whiteSpace: "pre-wrap",
                      maxHeight: 300,
                      overflow: "auto",
                    }}
                  >
                    {promptPreview.prompt}
                  </pre>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-mid)" }}>
                {t("models.preview.building")}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
