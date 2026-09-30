import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

import { ModelCardDisclosureButton } from "../../../../components/ModelCardDisclosureButton";
import { useI18n } from "../../../../lib/i18n";
import { IconBolt } from "../../../../lib/icons";
import type { AppSettings } from "../../../../lib/store";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { PopUpButton } from "../../../../ui/PopUpButton";
import { SecureField } from "../../../../ui/SecureField";
import { Spinner } from "../../../../ui/Spinner";
import { TextField } from "../../../../ui/TextField";
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
        : "var(--label-3)";
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
    <div className="ui-model-card">
      <div className="ui-model-card__head">
        <div className="ui-model-card__main">
          <div className="ui-model-card__titlebar">
            <div className="ui-model-card__title">{t("models.textModel.title")}</div>
            <Badge className="ui-model-card__state" style={{ color: statusColor }}>
              {statusLabel}
            </Badge>
          </div>
          <div className="ui-model-card__body">
            <div className="ui-model-card__desc">{t("models.textModel.desc")}</div>
          </div>
          <ModelCardDisclosureButton
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            label={t(expanded ? "mainTab.collapse" : "mainTab.expand")}
          />
        </div>
      </div>

      {expanded && (
        <div className="ui-model-card__detail">
          <div className="ui-model-card__field">
            <div className="ui-model-card__field-label">{t("models.field.apiKey")}</div>
            <SecureField
              value={settings.llmApiKey}
              onChange={(e) => editField({ llmApiKey: e.target.value })}
              placeholder={t("models.textModel.apiKeyPlaceholder")}
              spellCheck={false}
              className="ui-textfield--mono"
            />
          </div>
          <div className="ui-model-card__field">
            <div className="ui-model-card__field-label">{t("models.field.model")}</div>
            <div className="ui-model-card__field-control">
              <PopUpButton
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
                ariaLabel={t("models.field.model")}
              />
              {modelSelectValue === CUSTOM_API_MODEL_VALUE && (
                <TextField
                  value={settings.llmModel}
                  onChange={(event) => editField({ llmModel: event.currentTarget.value })}
                  placeholder={t("models.field.customModelPlaceholder")}
                  aria-label={t("models.field.customModelPlaceholder")}
                  spellCheck={false}
                  className="ui-textfield--mono"
                />
              )}
            </div>
          </div>
          <div className="ui-model-card__field">
            <div className="ui-model-card__field-label">{t("models.field.host")}</div>
            <TextField
              type="url"
              value={settings.llmEndpoint}
              onChange={(e) => editField({ llmEndpoint: e.target.value })}
              placeholder="https://api.openai.com/v1 · http://127.0.0.1:2455/v1"
              spellCheck={false}
              className="ui-textfield--mono"
            />
            {settings.llmEndpoint.trim() ? (
              <Button onClick={() => editField({ llmEndpoint: "" })}>
                {t("models.common.reset")}
              </Button>
            ) : (
              <div className="ui-model-card__hint">{t("models.common.optional")}</div>
            )}
          </div>
          <div className="ui-model-card__actions">
            <Button
              variant="primary"
              onClick={() => void testTextModel()}
              disabled={testState.status === "testing"}
            >
              {testState.status === "testing" ? (
                <>
                  <Spinner size={14} />
                  {t("models.test.checking")}
                </>
              ) : (
                <>
                  <IconBolt size={14} stroke={2.2} />
                  {t("models.textModel.testButton")}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export { TextModelCard };
