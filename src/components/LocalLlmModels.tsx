import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type ReactElement, useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import {
  type Icon,
  IconAlertCircle,
  IconCheck,
  IconDownload,
  IconGauge,
  IconGlobe,
  IconTargetArrow,
  IconTrash,
  IconX,
} from "../lib/icons";
import {
  isLocalLlmEndpoint,
  localLlmDeleteSettingsPatch,
  localLlmDeselectionSettingsPatch,
  selectedLocalLlmModelId,
} from "../lib/localLlmSelection";
import type { AppSettings } from "../lib/store";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ProgressBar } from "../ui/ProgressBar";
import { Spinner } from "../ui/Spinner";
import { ModelCardDisclosureButton } from "./ModelCardDisclosureButton";

interface LocalLlmModel {
  id: string;
  label: string;
  description: string;
  file_name: string;
  size_label: string;
  min_ram_gb: number;
  speed: string;
  accuracy: string;
  language_label: string;
  recommended: boolean;
  downloaded: boolean;
}

interface DownloadProgress {
  model_id: string;
  status: string;
  percent: number | null;
}

/**
 * Local text (LLM) model slot for "Локально" mode — same card style as the local
 * STT models: download a bundled GGUF model and start the managed runtime, then
 * point summary at it.
 */
export function LocalLlmModels({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  const { t } = useI18n();
  const [models, setModels] = useState<LocalLlmModel[]>([]);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const list = await invoke<LocalLlmModel[]>("list_local_llm_models");
      setModels(list);
    } catch {
      /* keep last known state */
    }
  };

  useEffect(() => {
    void refresh();
    // Restore any in-flight download started before this view was mounted, so the
    // progress survives switching tabs / minimizing the app.
    invoke<DownloadProgress[]>("get_llm_download_progress")
      .then((items) => {
        setProgress((prev) => {
          const next = { ...prev };
          for (const item of items) {
            next[item.model_id] = item;
          }
          return next;
        });
      })
      .catch(() => {});

    const unlisten = listen<DownloadProgress>("local-llm-model-download-progress", (event) => {
      const payload = event.payload;
      setProgress((prev) => {
        const next = { ...prev };
        if (
          payload.status === "downloaded" ||
          payload.status === "cancelled" ||
          payload.status === "error"
        ) {
          delete next[payload.model_id];
        } else {
          next[payload.model_id] = payload;
        }
        return next;
      });
      if (payload.status === "downloaded" || payload.status === "cancelled") {
        void refresh();
      }
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const download = async (model: LocalLlmModel): Promise<void> => {
    setError(null);
    // Optimistic start; the backend registry + events drive the bar from here,
    // so it survives this component unmounting (tab switch / minimize).
    setProgress((prev) => ({
      ...prev,
      [model.id]: { model_id: model.id, status: "starting", percent: null },
    }));
    try {
      await invoke("download_local_llm_model", { modelId: model.id });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!message.includes("отменена")) {
        setError(message);
      }
    }
    await refresh();
  };

  const cancelDownload = async (model: LocalLlmModel): Promise<void> => {
    try {
      await invoke("cancel_local_model_download", { modelId: model.id });
    } catch {
      /* best-effort */
    }
  };

  const remove = async (model: LocalLlmModel): Promise<void> => {
    setBusy(model.id);
    setDeleting(model.id);
    setError(null);
    try {
      await invoke("delete_local_llm_model", { modelId: model.id });
      const cleanupPatch = localLlmDeleteSettingsPatch(settings, model.id);
      if (cleanupPatch) {
        update(cleanupPatch);
      }
      setProgress((prev) => {
        const next = { ...prev };
        delete next[model.id];
        return next;
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setDeleting(null);
    }
  };

  const selectForSummary = async (model: LocalLlmModel): Promise<void> => {
    setBusy(model.id);
    setError(null);
    try {
      const baseUrl = await invoke<string>("start_local_llm", {
        modelId: model.id,
      });
      // Mark this as the BUNDLED runtime so summary can auto-(re)start the sidecar
      // after an app restart (the process dies but the endpoint stays persisted).
      update({
        llmEndpoint: baseUrl,
        llmModel: model.id,
        llmLocalModelId: model.id,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const deselect = async (model: LocalLlmModel): Promise<void> => {
    setBusy(model.id);
    setError(null);
    try {
      await invoke<void>("stop_local_llm");
    } catch {
      // The persisted selection must still be cleared if the runtime has
      // already stopped or is temporarily unavailable.
    } finally {
      update(localLlmDeselectionSettingsPatch());
      setBusy(null);
    }
  };

  const usingLocalEndpoint = isLocalLlmEndpoint(settings.llmEndpoint);
  const selectedModelId = selectedLocalLlmModelId(settings);

  const translateSpeedValue = (value: string): string => {
    switch (value) {
      case "очень быстро":
        return t("models.speedValue.veryFast");
      case "быстро":
        return t("models.speedValue.fast");
      case "средне":
        return t("models.speedValue.medium");
      default:
        return value;
    }
  };

  const translateAccuracyValue = (value: string): string => {
    switch (value) {
      case "максимальная":
        return t("models.accuracyValue.maximum");
      case "высокая":
        return t("models.accuracyValue.high");
      case "средняя":
        return t("models.accuracyValue.medium");
      case "средняя+":
        return t("models.accuracyValue.mediumPlus");
      case "базовая":
        return t("models.accuracyValue.basic");
      case "низкая+":
        return t("models.accuracyValue.lowPlus");
      case "служебная":
        return t("models.accuracyValue.utility");
      default:
        return value;
    }
  };

  const translateLanguageValue = (value: string): string => {
    if (value === "English") return t("models.languageValue.english");
    if (/^\d+\+?$/.test(value)) return t("models.languageValue.count", { value });
    return value;
  };

  const renderLocalLlmStats = (model: LocalLlmModel): ReactElement => {
    const speedValueLabel = translateSpeedValue(model.speed);
    const accuracyValueLabel = translateAccuracyValue(model.accuracy);
    const languageValueLabel = translateLanguageValue(model.language_label);
    const stats: { key: string; title: string; Icon: Icon; value: string }[] = [
      {
        key: "speed",
        title: t("models.stat.speedTitle", { value: speedValueLabel }),
        Icon: IconGauge,
        value: speedValueLabel,
      },
      {
        key: "accuracy",
        title: t("models.stat.accuracyTitle", { value: accuracyValueLabel }),
        Icon: IconTargetArrow,
        value: accuracyValueLabel,
      },
    ];

    return (
      <div className="ui-model-stats">
        <div
          role="img"
          title={t("models.stat.downloadSizeTitle", { value: model.size_label })}
          aria-label={t("models.stat.downloadSizeTitle", { value: model.size_label })}
          className="ui-model-stat"
        >
          <IconDownload size={14} stroke={1.9} />
          <span>{model.size_label}</span>
        </div>

        <div
          role="img"
          title={t("models.stat.languagesTitle", { value: languageValueLabel })}
          aria-label={t("models.stat.languagesTitle", { value: languageValueLabel })}
          className="ui-model-stat"
        >
          <IconGlobe size={14} stroke={1.9} />
          <span>{languageValueLabel}</span>
        </div>

        {stats.map(({ key, title, Icon, value }) => (
          <div key={key} role="img" title={title} aria-label={title} className="ui-model-stat">
            <Icon size={14} stroke={1.9} />
            <span>{value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="ui-tab">
      <div className="ui-page-header">
        <div className="ui-page-header__title">{t("localLlm.title")}</div>
        <div className="ui-page-header__desc">{t("localLlm.desc")}</div>
      </div>

      {error && (
        <div className="ui-model-card__notice ui-model-card__notice--error" role="alert">
          {error}
        </div>
      )}

      {!usingLocalEndpoint && (
        <div className="ui-inline-note">
          <IconAlertCircle size={14} stroke={2} aria-hidden="true" />
          <span>{t("localLlm.required")}</span>
        </div>
      )}

      <div className="ui-tab">
        {models.map((model) => {
          const prog = progress[model.id];
          const isDownloading = prog?.status === "downloading" || prog?.status === "starting";
          const isBusy = busy === model.id;
          const isDeleting = deleting === model.id;
          const isSelected = selectedModelId === model.id && usingLocalEndpoint;
          // Collapsed by default like the recognition cards; force-open while a
          // download runs so its progress bar stays visible.
          const open = expandedId === model.id || isDownloading;

          const statusLabel = isDeleting
            ? t("localLlm.status.deleting")
            : isDownloading
              ? t("localLlm.status.downloading")
              : isSelected
                ? t("localLlm.status.selected")
                : model.downloaded
                  ? t("localLlm.status.ready")
                  : t("localLlm.status.notDownloaded");
          const statusColor = isSelected
            ? "var(--success-bright)"
            : model.downloaded
              ? "var(--success-bright)"
              : isDownloading || isDeleting
                ? "var(--label)"
                : "var(--label-3)";

          return (
            <div key={model.id} className="ui-model-card">
              <div className="ui-model-card__head">
                <div className="ui-model-card__main">
                  <div className="ui-model-card__titlebar">
                    <div className="ui-model-card__title">
                      <span>{model.label}</span>
                      {model.recommended && <Badge>{t("models.local.recommendedBadge")}</Badge>}
                    </div>
                    <Badge className="ui-model-card__state" style={{ color: statusColor }}>
                      {statusLabel}
                    </Badge>
                  </div>
                  <div className="ui-model-card__body">
                    <div className="ui-model-card__desc">{model.description}</div>
                    {renderLocalLlmStats(model)}
                  </div>
                  <ModelCardDisclosureButton
                    expanded={open}
                    onToggle={() => setExpandedId(expandedId === model.id ? null : model.id)}
                    label={t(open ? "mainTab.collapse" : "mainTab.expand")}
                  />
                </div>
              </div>

              {open && (
                <div className="ui-model-card__detail">
                  {isDownloading && (
                    <div className="ui-model-progress" role="status">
                      <div className="ui-model-progress__head">
                        <span>{t("localLlm.downloadingModel")}</span>
                        <span className="ui-model-progress__value">
                          {prog?.percent != null ? `${prog.percent}%` : t("localLlm.preparing")}
                        </span>
                      </div>
                      <ProgressBar value={(prog?.percent ?? 2) / 100} />
                    </div>
                  )}

                  <div className="ui-model-card__actions">
                    {!model.downloaded ? (
                      isDownloading ? (
                        <Button onClick={() => void cancelDownload(model)}>
                          <IconX size={14} stroke={2.2} />
                          {t("localLlm.cancel")}
                        </Button>
                      ) : (
                        <Button variant="primary" onClick={() => void download(model)}>
                          <IconDownload size={14} stroke={2.2} />
                          {t("localLlm.download")}
                        </Button>
                      )
                    ) : (
                      <>
                        {isSelected ? (
                          <Button onClick={() => void deselect(model)} disabled={isBusy}>
                            <IconX size={14} stroke={2.2} />
                            {t("localLlm.deselect")}
                          </Button>
                        ) : (
                          <Button onClick={() => void selectForSummary(model)} disabled={isBusy}>
                            {isBusy ? <Spinner size={14} /> : <IconCheck size={14} stroke={2.5} />}
                            {t("localLlm.select")}
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          onClick={() => void remove(model)}
                          disabled={isBusy}
                        >
                          <IconTrash size={14} stroke={2.2} />
                          {t("localLlm.delete")}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
