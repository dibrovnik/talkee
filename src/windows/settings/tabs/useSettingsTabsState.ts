import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import { SETTINGS_UPDATED_EVENT } from "../../../lib/hotkeyEvents";
import { useI18n } from "../../../lib/i18n";
import { logInfo } from "../../../lib/logger";
import { resolveProcessingMode } from "../../../lib/modelMode";
import { type AppSettings, getSettings, saveSettings } from "../../../lib/store";
import {
  type AdapterTestStatus,
  type ApiAdapterId,
  isLocalSttEndpoint,
  LOCAL_MODEL_OPTIONS,
  LOCAL_STT_MODEL_DOWNLOAD_PROGRESS_EVENT,
  LOCAL_STT_PRESET_ENDPOINT,
  type LocalModelActionState,
  type LocalModelDownloadProgressEvent,
  type LocalModelKind,
  type LocalModelOption,
  type LocalTranslatorInfo,
  type ModelMode,
  type PromptPreview,
} from "./settingsTabsTypes";

const IS_DEV = import.meta.env.DEV;

export function useSettingsTabsState(type: "model" | "style") {
  const { t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [promptPreview, setPromptPreview] = useState<PromptPreview | null>(null);
  const [promptPreviewError, setPromptPreviewError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [modelModeView, setModelModeView] = useState<ModelMode | null>(null);
  const [styleTabView, setStyleTabView] = useState<"style" | "prompts">("style");
  const [localModelKind, setLocalModelKind] = useState<LocalModelKind>("transcription");
  const [apiModelKind, setApiModelKind] = useState<"transcription" | "text" | "translation">(
    "transcription",
  );
  const [expandedApiAdapter, setExpandedApiAdapter] = useState<ApiAdapterId | null>(null);
  const [expandedLocalModel, setExpandedLocalModel] = useState<string | null>(null);
  const [expandedLocalOtherComponent, setExpandedLocalOtherComponent] = useState<string | null>(
    null,
  );
  const [pendingDeleteModel, setPendingDeleteModel] = useState<LocalModelOption | null>(null);
  const [localInstalledModels, setLocalInstalledModels] = useState<string[]>([]);
  const [localTranslators, setLocalTranslators] = useState<Record<string, LocalTranslatorInfo>>({});
  const [apiAdapterTestStates, setApiAdapterTestStates] = useState<
    Partial<Record<ApiAdapterId, { status: AdapterTestStatus; message: string }>>
  >({});
  const [dirtyApiAdapters, setDirtyApiAdapters] = useState<Partial<Record<ApiAdapterId, boolean>>>(
    {},
  );
  const apiAdapterEditRevisionsRef = useRef<Partial<Record<ApiAdapterId, number>>>({});
  const [localModelActionStates, setLocalModelActionStates] = useState<
    Partial<Record<string, LocalModelActionState>>
  >({});
  const settingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const optimisticLocalInstalledModelsRef = useRef<Set<string>>(new Set());

  const syncSettings = useCallback(async () => {
    const nextSettings = await getSettings({ reload: true });
    setSettings(nextSettings);
    return nextSettings;
  }, []);

  const refreshLocalInstalledModels = useCallback(async () => {
    if (!settings || type !== "model" || !isLocalSttEndpoint(settings.whisperEndpoint)) {
      return;
    }

    try {
      const result = await invoke<{
        success: boolean;
        models: string[];
        message: string;
      }>("list_stt_models", {
        req: {
          api_key: settings.apiKey || "",
          whisper_api_key: settings.whisperApiKey || null,
          whisper_endpoint: settings.whisperEndpoint || LOCAL_STT_PRESET_ENDPOINT,
          local_models_dir: settings.localModelsDir || null,
        },
      });

      const confirmedInstalledModels = result.models || [];
      for (const modelId of confirmedInstalledModels) {
        optimisticLocalInstalledModelsRef.current.delete(modelId);
      }
      const installedModels = Array.from(
        new Set([...confirmedInstalledModels, ...optimisticLocalInstalledModelsRef.current]),
      );
      setLocalInstalledModels(installedModels);

      const installedModelSet = new Set(installedModels);
      const installedLocalOptions = LOCAL_MODEL_OPTIONS.filter((model) =>
        installedModelSet.has(model.model),
      );
      const now = new Date().toISOString();
      const nextLocalModels = { ...(settings.localModels || {}) };
      let changed = false;

      for (const model of LOCAL_MODEL_OPTIONS) {
        const current = nextLocalModels[model.id];
        if (current?.status === "downloaded" && !installedModelSet.has(model.model)) {
          delete nextLocalModels[model.id];
          changed = true;
        }
      }

      for (const model of installedLocalOptions) {
        const current = nextLocalModels[model.id] || {
          status: "not_downloaded" as const,
        };
        if (current.status !== "downloaded" || current.message) {
          nextLocalModels[model.id] = {
            ...current,
            status: "downloaded",
            message: undefined,
            downloadedAt: current.downloadedAt || now,
            lastCheckedAt: now,
          };
          changed = true;
        }
      }

      if (changed) {
        update({ localModels: nextLocalModels });
        setLocalModelActionStates((prev) => {
          const next = { ...prev };
          for (const model of installedLocalOptions) {
            delete next[model.id];
          }
          return next;
        });
      }
    } catch {
      setLocalInstalledModels((prev) =>
        Array.from(new Set([...prev, ...optimisticLocalInstalledModelsRef.current])),
      );
    }
  }, [
    settings?.apiKey,
    settings?.provider,
    settings?.whisperApiKey,
    settings?.whisperEndpoint,
    settings?.localModelsDir,
    settings?.localModels,
    type,
  ]);

  const refreshLocalTranslators = useCallback(async () => {
    if (type !== "model") {
      return;
    }

    try {
      const translators = await invoke<LocalTranslatorInfo[]>("list_local_translators");
      setLocalTranslators(
        Object.fromEntries(translators.map((translator) => [translator.provider, translator])),
      );
    } catch (err) {
      logInfo(
        "SETTINGS",
        `Failed to refresh local translators: ${err instanceof Error ? err.message : String(err)}`,
      );
      setLocalTranslators({});
    }
  }, [type]);

  useEffect(() => {
    void syncSettings().catch(() => {});
  }, [syncSettings]);

  useEffect(() => {
    void refreshLocalTranslators();
  }, [refreshLocalTranslators]);

  useEffect(() => {
    const refreshSettings = () => {
      void syncSettings();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshSettings();
      }
    };

    window.addEventListener("focus", refreshSettings);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshSettings);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [syncSettings]);

  useEffect(() => {
    if (!settings || type !== "style" || !IS_DEV) return;

    let cancelled = false;

    invoke<PromptPreview>("get_cleanup_prompt_preview", {
      language: settings.language,
      style: settings.style,
    })
      .then((preview) => {
        if (cancelled) return;
        setPromptPreview(preview);
        setPromptPreviewError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setPromptPreview(null);
        setPromptPreviewError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [settings?.language, settings?.style, type]);

  useEffect(() => {
    void refreshLocalInstalledModels();
  }, [refreshLocalInstalledModels]);

  useEffect(() => {
    if (!settings) return;

    if (type !== "model") {
      setModelModeView(null);
      return;
    }

    const currentMode: ModelMode = resolveProcessingMode(settings);

    setModelModeView((current) => current ?? currentMode);
  }, [settings?.whisperEndpoint, type]);

  useEffect(() => {
    const unlistenPromise = listen<LocalModelDownloadProgressEvent>(
      LOCAL_STT_MODEL_DOWNLOAD_PROGRESS_EVENT,
      (event) => {
        const modelOptions = LOCAL_MODEL_OPTIONS.filter(
          (model) => model.model === event.payload.model,
        );
        if (modelOptions.length === 0) return;

        const progress =
          typeof event.payload.percent === "number"
            ? Math.max(0, Math.min(100, event.payload.percent))
            : undefined;
        const message =
          event.payload.message ||
          (progress !== undefined
            ? t("models.download.progress", { percent: progress })
            : t("models.download.inProgress"));

        setLocalModelActionStates((prev) => {
          const modelOption =
            modelOptions.find((model) => prev[model.id]?.status === "installing") ||
            modelOptions.find((model) => model.runtimeReady === true) ||
            modelOptions[0];

          return {
            ...prev,
            [modelOption.id]: {
              ...(prev[modelOption.id] || { status: "installing", message }),
              status: event.payload.status === "downloaded" ? "success" : "installing",
              message:
                event.payload.status === "downloaded"
                  ? event.payload.message || t("models.download.done")
                  : message,
              progress: event.payload.status === "downloaded" ? 100 : progress,
              downloadedBytes: event.payload.downloaded_bytes,
              totalBytes: event.payload.total_bytes ?? undefined,
            },
          };
        });
      },
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const update = (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const base = prev ?? settings;
      if (!base) {
        return prev;
      }
      const next = { ...base, ...patch };
      settingsSaveQueueRef.current = settingsSaveQueueRef.current
        .catch(() => {})
        .then(() => saveSettings(next))
        .then(() => {
          emit(SETTINGS_UPDATED_EVENT).catch(() => {});
        });
      return next;
    });
  };

  return {
    t,
    settings,
    update,
    syncSettings,
    promptPreview,
    promptPreviewError,
    testStatus,
    setTestStatus,
    testMessage,
    setTestMessage,
    modelModeView,
    setModelModeView,
    styleTabView,
    setStyleTabView,
    localModelKind,
    setLocalModelKind,
    apiModelKind,
    setApiModelKind,
    expandedApiAdapter,
    setExpandedApiAdapter,
    expandedLocalModel,
    setExpandedLocalModel,
    expandedLocalOtherComponent,
    setExpandedLocalOtherComponent,
    pendingDeleteModel,
    setPendingDeleteModel,
    localInstalledModels,
    setLocalInstalledModels,
    localTranslators,
    setLocalTranslators,
    apiAdapterTestStates,
    setApiAdapterTestStates,
    dirtyApiAdapters,
    setDirtyApiAdapters,
    apiAdapterEditRevisionsRef,
    localModelActionStates,
    setLocalModelActionStates,
    settingsSaveQueueRef,
    optimisticLocalInstalledModelsRef,
    refreshLocalInstalledModels,
    refreshLocalTranslators,
  };
}
