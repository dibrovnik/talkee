import { invoke } from "@tauri-apps/api/core";
import { type CSSProperties, useState } from "react";

import { Dropdown } from "../../../../components/Dropdown";
import { ModelCardDisclosureButton } from "../../../../components/ModelCardDisclosureButton";
import { useI18n } from "../../../../lib/i18n";
import { IconBolt } from "../../../../lib/icons";
import type { AppSettings } from "../../../../lib/store";
import {
  type AdapterTestStatus,
  CUSTOM_API_MODEL_VALUE,
  TEXT_MODEL_OPTIONS,
} from "../settingsTabsTypes";

function TextModelCard({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [testState, setTestState] = useState<{
    status: AdapterTestStatus;
    message: string;
  }>({ status: "idle", message: "" });
  const endpoint = (settings.llmEndpoint || "").trim();
  const model = (settings.llmModel || "").trim();
  const apiKey = (settings.llmApiKey || settings.apiKey || "").trim();
  const isLocalEndpoint = /127\.0\.0\.1|localhost/i.test(endpoint);
  const hasSelectedModel = Boolean(model) && model.toLowerCase() !== "none";
  const configured = hasSelectedModel && (isLocalEndpoint || Boolean(apiKey));
  const isKnownModel = TEXT_MODEL_OPTIONS.includes(settings.llmModel);
  const modelSelectValue = isKnownModel ? settings.llmModel : CUSTOM_API_MODEL_VALUE;
  const statusLabel =
    testState.status === "testing"
      ? t("models.textModel.statusTesting")
      : testState.status === "error"
        ? t("models.textModel.statusError")
        : configured
          ? t("models.textModel.statusSet")
          : t("models.textModel.statusUnset");
  const statusColor =
    testState.status === "error"
      ? "var(--error-bright)"
      : configured || testState.status === "success"
        ? "var(--success-bright)"
        : "var(--text-low)";
  const FIELD_STYLE: CSSProperties = {
    flex: 1,
    minWidth: 0,
    height: 36,
    padding: "8px 10px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
  };
  // Editing a custom text model means it's no longer the bundled local runtime, so
  // drop the marker that tells summary to auto-start the sidecar.
  const editField = (patch: Partial<AppSettings>) => {
    setTestState({ status: "idle", message: "" });
    update({ ...patch, llmLocalModelId: "" });
  };
  const testTextModel = async (): Promise<void> => {
    if (!hasSelectedModel) {
      setTestState({
        status: "error",
        message: t("models.textModel.needModel"),
      });
      return;
    }
    if (!isLocalEndpoint && !apiKey) {
      setTestState({
        status: "error",
        message: t("models.textModel.needApiKey"),
      });
      return;
    }

    setTestState({
      status: "testing",
      message: t("models.connection.testing"),
    });
    try {
      await invoke<{ result: string }>("process_text", {
        req: {
          text: "Connection test",
          prompt: "Reply only with OK.",
          temperature: 0,
          max_tokens: 8,
          endpoint: endpoint || null,
          model,
          api_key: apiKey || null,
        },
      });
      setTestState({
        status: "success",
        message: t("models.textModel.testSuccess"),
      });
    } catch (error) {
      setTestState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflow: expanded ? "visible" : "hidden",
        position: "relative",
        zIndex: expanded ? 10 : 0,
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          position: "relative",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          textAlign: "left",
          fontFamily: "var(--font-main)",
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginBottom: 3,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-hi)" }}>
              {t("models.textModel.title")}
            </div>
            <div
              title={testState.message || undefined}
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: statusColor,
                padding: "5px 9px",
                borderRadius: 999,
                background: "var(--control-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {statusLabel}
            </div>
          </div>
          <div
            style={{
              paddingRight: 34,
              fontSize: 12,
              lineHeight: 1.45,
              color: "var(--text-mid)",
            }}
          >
            {t("models.textModel.desc")}
          </div>
          <ModelCardDisclosureButton
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            label={t(expanded ? "mainTab.collapse" : "mainTab.expand")}
          />
        </div>
      </div>

      {expanded && (
        <div
          style={{
            borderTop: "1px solid var(--border-subtle)",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="label" style={{ width: 76, flexShrink: 0 }}>
              {t("models.field.apiKey")}
            </div>
            <input
              type="password"
              value={settings.llmApiKey}
              onChange={(e) => editField({ llmApiKey: e.target.value })}
              className="input"
              placeholder={t("models.textModel.apiKeyPlaceholder")}
              spellCheck={false}
              style={FIELD_STYLE}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="label" style={{ width: 76, flexShrink: 0 }}>
              {t("models.field.model")}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
              <Dropdown
                value={modelSelectValue}
                options={[
                  ...TEXT_MODEL_OPTIONS.map((modelOption) => ({
                    value: modelOption,
                    label: modelOption,
                  })),
                  {
                    value: CUSTOM_API_MODEL_VALUE,
                    label: t("models.field.customModel"),
                  },
                ]}
                onChange={(value) =>
                  editField({
                    llmModel: value === CUSTOM_API_MODEL_VALUE ? "" : value,
                  })
                }
              />
              {modelSelectValue === CUSTOM_API_MODEL_VALUE && (
                <input
                  type="text"
                  value={settings.llmModel}
                  onChange={(event) => editField({ llmModel: event.currentTarget.value })}
                  className="input"
                  placeholder={t("models.field.customModelPlaceholder")}
                  aria-label={t("models.field.customModelPlaceholder")}
                  spellCheck={false}
                  style={{ ...FIELD_STYLE, width: "100%" }}
                />
              )}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-low)",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {t("models.field.recommended", { model: "gpt-4o-mini" })}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="label" style={{ width: 76, flexShrink: 0 }}>
              {t("models.field.host")}
            </div>
            <input
              type="url"
              value={settings.llmEndpoint}
              onChange={(e) => editField({ llmEndpoint: e.target.value })}
              className="input"
              placeholder="https://api.openai.com/v1 · http://127.0.0.1:2455/v1"
              spellCheck={false}
              style={FIELD_STYLE}
            />
            {settings.llmEndpoint.trim() ? (
              <button
                type="button"
                onClick={() => editField({ llmEndpoint: "" })}
                style={{
                  border: "1px solid var(--border-dashed)",
                  background: "var(--control-muted)",
                  color: "var(--text-hi)",
                  borderRadius: 8,
                  padding: "7px 9px",
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "var(--font-main)",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  cursor: "pointer",
                }}
              >
                {t("models.common.reset")}
              </button>
            ) : (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-low)",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {t("models.common.optional")}
              </div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => void testTextModel()}
              disabled={testState.status === "testing"}
              style={{
                padding: "9px 12px",
                borderRadius: 10,
                border: "1px solid var(--border-dashed)",
                background:
                  testState.status === "testing" ? "var(--control-muted)" : "var(--accent)",
                color:
                  testState.status === "testing" ? "var(--text-mid)" : "var(--accent-contrast)",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "var(--font-main)",
                cursor: testState.status === "testing" ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {testState.status === "testing" ? (
                <>
                  <span className="loading-soft-ring" />
                  {t("models.test.checking")}
                </>
              ) : (
                <>
                  <IconBolt size={14} stroke={2.2} />
                  {t("models.textModel.testButton")}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { TextModelCard };
