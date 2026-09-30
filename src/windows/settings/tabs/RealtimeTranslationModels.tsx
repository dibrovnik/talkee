import { invoke } from "@tauri-apps/api/core";
import { type ReactElement, useRef, useState } from "react";

import { ModelCardDisclosureButton } from "../../../components/ModelCardDisclosureButton";
import { useI18n } from "../../../lib/i18n";
import { IconBolt, IconBroadcast, IconCheck } from "../../../lib/icons";
import {
  hasVerifiedRealtimeCapability,
  REALTIME_TRANSLATION_ADAPTERS,
  type RealtimeTranslationAdapterId,
  realtimeConfigurationFingerprint,
} from "../../../lib/realtimeModels";
import type { ApiAdapterSettings, AppSettings } from "../../../lib/store";
import { Badge } from "../../../ui/Badge";
import { Button } from "../../../ui/Button";
import { FormSection } from "../../../ui/FormSection";
import { PopUpButton } from "../../../ui/PopUpButton";
import { SecureField } from "../../../ui/SecureField";
import { Spinner } from "../../../ui/Spinner";
import { TextField } from "../../../ui/TextField";

const CUSTOM_MODEL = "__custom_model__";
type TestStatus = "idle" | "testing" | "success" | "error";

export function RealtimeTranslationModels({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}): ReactElement {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<RealtimeTranslationAdapterId | null>(null);
  const [statuses, setStatuses] = useState<
    Partial<Record<RealtimeTranslationAdapterId, { status: TestStatus; message?: string }>>
  >({});
  const [dirtyAdapters, setDirtyAdapters] = useState<
    Partial<Record<RealtimeTranslationAdapterId, boolean>>
  >({});
  const editRevisionsRef = useRef<Partial<Record<RealtimeTranslationAdapterId, number>>>({});

  const patchAdapter = (
    id: RealtimeTranslationAdapterId,
    patch: Partial<ApiAdapterSettings>,
  ): void => {
    editRevisionsRef.current[id] = (editRevisionsRef.current[id] || 0) + 1;
    const catalogAdapter = REALTIME_TRANSLATION_ADAPTERS.find((adapter) => adapter.id === id);
    update({
      translationAdapters: {
        ...settings.translationAdapters,
        [id]: {
          ...(settings.translationAdapters[id] || {
            apiKey: "",
            model: catalogAdapter?.recommendedModel || "",
            endpoint: "",
          }),
          ...patch,
          connectionStatus: "saved",
          streamingCapability: undefined,
          streamingCapabilityFingerprint: undefined,
        },
      },
    });
    setDirtyAdapters((current) => ({ ...current, [id]: true }));
    setStatuses((current) => ({ ...current, [id]: { status: "idle" } }));
  };

  const test = async (id: RealtimeTranslationAdapterId): Promise<void> => {
    const adapter = REALTIME_TRANSLATION_ADAPTERS.find((item) => item.id === id);
    const values = settings.translationAdapters[id];
    if (!adapter || !values?.apiKey.trim() || !values.model.trim()) {
      setStatuses((current) => ({
        ...current,
        [id]: { status: "error", message: t("models.test.needKeyAndModel") },
      }));
      return;
    }

    const testedRevision = editRevisionsRef.current[id] || 0;
    setStatuses((current) => ({ ...current, [id]: { status: "testing" } }));
    try {
      const result = await invoke<{ success: boolean; message: string }>(
        "test_realtime_connection",
        {
          req: {
            provider: id,
            apiKey: values.apiKey,
            model: values.model,
            endpoint: values.endpoint || adapter.defaultEndpoint,
            targetLanguage: settings.translation.liveTargetLanguage,
            purpose: "translation",
          },
        },
      );
      if (!result.success) throw new Error(result.message);
      if ((editRevisionsRef.current[id] || 0) !== testedRevision) {
        setStatuses((current) => ({ ...current, [id]: { status: "idle" } }));
        return;
      }

      const fingerprint = realtimeConfigurationFingerprint({
        provider: id,
        apiKey: values.apiKey,
        model: values.model,
        endpoint: values.endpoint,
        defaultEndpoint: adapter.defaultEndpoint,
      });
      update({
        translationAdapters: {
          ...settings.translationAdapters,
          [id]: {
            ...values,
            connectionStatus: "verified",
            lastConnectedAt: new Date().toISOString(),
            streamingCapability: "supported",
            streamingCapabilityFingerprint: fingerprint,
          },
        },
        selectedTranslationAdapter: id,
      });
      setDirtyAdapters((current) => ({ ...current, [id]: false }));
      setStatuses((current) => ({ ...current, [id]: { status: "success" } }));
    } catch (error) {
      if ((editRevisionsRef.current[id] || 0) !== testedRevision) {
        setStatuses((current) => ({ ...current, [id]: { status: "idle" } }));
        return;
      }
      setStatuses((current) => ({
        ...current,
        [id]: {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  return (
    <FormSection title={t("models.translation.title")} footer={t("models.translation.desc")}>
      {REALTIME_TRANSLATION_ADAPTERS.map((adapter) => {
        const id = adapter.id as RealtimeTranslationAdapterId;
        const values = settings.translationAdapters[id] || {
          apiKey: "",
          model: adapter.recommendedModel,
          endpoint: "",
        };
        const verified = !dirtyAdapters[id] && hasVerifiedRealtimeCapability(adapter, values);
        const isSelected = settings.selectedTranslationAdapter === id && verified;
        const status = statuses[id]?.status || (verified ? "success" : "idle");
        const isExpanded = expanded === id;
        const knownModel = adapter.models.some((model) => model.id === values.model);
        const selectValue = knownModel ? values.model : CUSTOM_MODEL;
        const statusLabel = isSelected
          ? t("models.adapterStatus.selected")
          : status === "testing"
            ? t("models.adapterStatus.testing")
            : status === "success"
              ? t("models.adapterStatus.ready")
              : status === "error"
                ? t("models.adapterStatus.error")
                : t("models.adapterStatus.readyToTest");
        const statusVariant =
          isSelected || status === "success"
            ? "success"
            : status === "error"
              ? "danger"
              : "neutral";
        const canTest =
          status !== "testing" && Boolean(values.apiKey.trim()) && Boolean(values.model.trim());

        return (
          <FormSection
            key={id}
            nested
            title={
              <>
                <span className="ui-form-section__heading">{adapter.name}</span>
                <Badge variant={statusVariant} title={statuses[id]?.message}>
                  {statusLabel}
                </Badge>
              </>
            }
            footer={
              <>
                {t("models.translation.desc")}{" "}
                {t("models.adapter.recommendedModel", { model: adapter.recommendedModel })}
                {verified ? (
                  <span className="ui-form-stat">
                    <IconBroadcast size={14} stroke={1.9} />
                    {t("models.stat.streaming")}
                  </span>
                ) : null}
              </>
            }
            action={
              <ModelCardDisclosureButton
                expanded={isExpanded}
                onToggle={() => setExpanded(isExpanded ? null : id)}
                label={t(isExpanded ? "mainTab.collapse" : "mainTab.expand")}
              />
            }
          >
            {isExpanded ? (
              <>
                <div className="ui-form-field">
                  <span className="ui-form-field__label">{t("models.field.apiKey")}</span>
                  <SecureField
                    id={`translation-${id}-key`}
                    value={values.apiKey}
                    placeholder="API key"
                    className="ui-textfield--mono"
                    onChange={(event) => patchAdapter(id, { apiKey: event.currentTarget.value })}
                  />
                </div>

                <div className="ui-form-field">
                  <span className="ui-form-field__label">{t("models.field.model")}</span>
                  <PopUpButton
                    value={selectValue}
                    ariaLabel={t("models.field.model")}
                    options={[
                      ...adapter.models.map((model) => ({
                        value: model.id,
                        label: `${model.id} · ${t("models.stat.streaming")}`,
                      })),
                      { value: CUSTOM_MODEL, label: t("models.field.customModel") },
                    ]}
                    onChange={(value) =>
                      patchAdapter(id, { model: value === CUSTOM_MODEL ? "" : value })
                    }
                  />
                  {selectValue === CUSTOM_MODEL ? (
                    <TextField
                      value={values.model}
                      aria-label={t("models.field.customModelPlaceholder")}
                      placeholder={t("models.field.customModelPlaceholder")}
                      className="ui-textfield--mono"
                      onChange={(event) => patchAdapter(id, { model: event.currentTarget.value })}
                    />
                  ) : null}
                  <span className="ui-form-hint">
                    {t("models.field.recommended", { model: adapter.recommendedModel })}
                  </span>
                </div>

                <div className="ui-form-field">
                  <span className="ui-form-field__label">{t("models.field.host")}</span>
                  <TextField
                    id={`translation-${id}-host`}
                    type="url"
                    value={values.endpoint || ""}
                    className="ui-textfield--mono"
                    placeholder={t("models.field.hostDefaultPlaceholder", {
                      endpoint: adapter.defaultEndpoint,
                    })}
                    onChange={(event) => patchAdapter(id, { endpoint: event.currentTarget.value })}
                  />
                  {values.endpoint?.trim() ? (
                    <Button
                      onClick={() => patchAdapter(id, { endpoint: "" })}
                      aria-label={t("models.common.reset")}
                    >
                      {t("models.common.reset")}
                    </Button>
                  ) : (
                    <span className="ui-form-hint">{t("models.common.optional")}</span>
                  )}
                </div>

                <div className="ui-form-actions">
                  {isSelected ? (
                    <Badge variant="success">
                      <IconCheck size={14} stroke={2.5} />
                      {t("models.common.selected")}
                    </Badge>
                  ) : (
                    <Button variant="primary" disabled={!canTest} onClick={() => void test(id)}>
                      {status === "testing" ? (
                        <Spinner size={14} />
                      ) : (
                        <IconBolt size={14} stroke={2.2} />
                      )}
                      {status === "testing"
                        ? t("models.test.checking")
                        : t("models.test.testAndSave")}
                    </Button>
                  )}
                </div>
              </>
            ) : null}
          </FormSection>
        );
      })}
    </FormSection>
  );
}
