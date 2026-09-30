import { invoke } from "@tauri-apps/api/core";
import { lazy, type ReactElement, Suspense } from "react";

import { LocalSttModelCard } from "../../../../components/LocalSttModelCard";
import { ModelCardDisclosureButton } from "../../../../components/ModelCardDisclosureButton";
import {
  type Icon,
  IconBolt,
  IconBroadcast,
  IconCheck,
  IconDownload,
  IconGauge,
  IconGlobe,
  IconTargetArrow,
  IconTrash,
  IconX,
} from "../../../../lib/icons";
import {
  apiModelModeSettingsPatch,
  localModelModeSettingsPatch,
  resolveProcessingMode,
} from "../../../../lib/modelMode";
import {
  hasVerifiedRealtimeCapability,
  realtimeConfigurationFingerprint,
  STREAMING_STT_ADAPTERS,
} from "../../../../lib/realtimeModels";
import type { AppSettings, LocalModelSettings } from "../../../../lib/store";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { PopUpButton } from "../../../../ui/PopUpButton";
import { SecureField } from "../../../../ui/SecureField";
import { SegmentedControl } from "../../../../ui/SegmentedControl";
import { Spinner } from "../../../../ui/Spinner";
import { TextField } from "../../../../ui/TextField";
import { RealtimeTranslationModels } from "../RealtimeTranslationModels";
import {
  type AdapterTestStatus,
  API_ADAPTER_DESCRIPTION_KEYS,
  API_ADAPTERS,
  type ApiAdapterId,
  type ApiAdapterOption,
  CUSTOM_API_MODEL_VALUE,
  LOCAL_MODEL_DESCRIPTION_KEYS,
  LOCAL_MODEL_OPTIONS,
  LOCAL_OTHER_COMPONENTS,
  LOCAL_RUNTIME_ENDPOINTS,
  LOCAL_STT_PRESET_MODEL,
  type LocalModelOption,
  type LocalOtherComponent,
  type ModelMode,
} from "../settingsTabsTypes";
import { useSettingsTabsState } from "../useSettingsTabsState";
import { TextModelCard } from "./TextModelCard";

const LocalLlmModels = lazy(() =>
  import("../../../../components/LocalLlmModels").then((module) => ({
    default: module.LocalLlmModels,
  })),
);

export function ModelsTab(): ReactElement | null {
  const {
    t,
    settings,
    update,
    modelModeView,
    setModelModeView,
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
    testStatus,
    setTestStatus,
    testMessage,
    setTestMessage,
    localInstalledModels,
    setLocalInstalledModels,
    localTranslators,
    refreshLocalInstalledModels,
    refreshLocalTranslators,
    apiAdapterTestStates,
    setApiAdapterTestStates,
    dirtyApiAdapters,
    setDirtyApiAdapters,
    apiAdapterEditRevisionsRef,
    localModelActionStates,
    setLocalModelActionStates,
    optimisticLocalInstalledModelsRef,
  } = useSettingsTabsState("model");

  if (!settings) return null;

  const activeModelMode: ModelMode = resolveProcessingMode(settings);
  const visibleModelMode = modelModeView ?? activeModelMode;
  const isApiMode = visibleModelMode === "api";
  const isLocalMode = visibleModelMode === "local";
  const selectedApiAdapterId = (settings.selectedApiAdapter || "openai") as ApiAdapterId;
  // In Local mode a local text (LLM) model is "selected" once llmEndpoint points
  // at a local runtime. Without it, transcription works but summarization can't.
  const localTextModelSelected = /127\.0\.0\.1|localhost/i.test(settings.llmEndpoint || "");
  // In API mode the text model is "set up" once its own endpoint or API key is
  // filled. The model name has a built-in default ("gpt-4o-mini"), so it can't
  // signal configuration on its own.
  const apiTextModelConfigured =
    Boolean((settings.llmEndpoint || "").trim()) || Boolean((settings.llmApiKey || "").trim());
  const localSttTargetModel =
    (settings.whisperModel || LOCAL_STT_PRESET_MODEL).trim() || LOCAL_STT_PRESET_MODEL;
  const localInstalledModelSet = new Set(localInstalledModels);
  const localModelsDir = (settings.localModelsDir || "").trim();
  const modeOptions: Array<{
    id: ModelMode;
    label: string;
  }> = [
    {
      id: "api",
      label: "API",
    },
    {
      id: "local",
      label: t("models.mode.local"),
    },
  ];

  const resetTestState = () => {
    setTestStatus("idle");
    setTestMessage(null);
    setApiAdapterTestStates({});
  };

  const resetInstallState = () => {
    setLocalModelActionStates({});
  };

  const getRuntimeKindFromEndpoint = (endpoint: string): LocalModelOption["runtimeKind"] | null => {
    try {
      const parsed = new URL(endpoint);
      const port = Number(parsed.port);
      if (
        (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") ||
        !Number.isFinite(port)
      ) {
        return null;
      }

      if (port === 8000 || port === 8001 || port === 8002 || (port >= 18000 && port <= 18149))
        return "whisper";
      if (port === 8003 || (port >= 18150 && port <= 18199)) return "diarization";
    } catch {
      return null;
    }

    return null;
  };

  const getLocalModelEndpoint = (model: LocalModelOption) => {
    const currentEndpoint = settings.whisperEndpoint.trim();
    if (currentEndpoint && getRuntimeKindFromEndpoint(currentEndpoint) === model.runtimeKind) {
      return currentEndpoint;
    }

    return LOCAL_RUNTIME_ENDPOINTS[model.runtimeKind];
  };

  const isApiAdapterSelected = (adapter: ApiAdapterOption) =>
    activeModelMode === "api" && selectedApiAdapterId === adapter.id;

  const getApiAdapterValues = (adapter: ApiAdapterOption) => {
    if (isApiAdapterSelected(adapter)) {
      return {
        apiKey: settings.apiKey || "",
        model: settings.whisperModel || "",
        endpoint: settings.whisperEndpoint || "",
      };
    }

    const savedAdapter = settings.apiAdapters?.[adapter.id];
    return {
      apiKey: savedAdapter?.apiKey || (adapter.id === "openai" ? settings.apiKey || "" : ""),
      model: savedAdapter?.model || adapter.recommendedModel,
      endpoint: savedAdapter?.endpoint || "",
    };
  };

  const getApiAdapterModelOption = (adapter: ApiAdapterOption, model: string) =>
    adapter.models.find((option) => option.id === model.trim());

  const getPersistedAdapterStatus = (
    adapter: ApiAdapterOption,
    apiKey: string,
    model: string,
    endpoint: string,
  ) => {
    const savedAdapter = settings.apiAdapters?.[adapter.id];
    const normalizedApiKey = apiKey.trim();
    const normalizedModel = model.trim();
    const normalizedEndpoint = endpoint.trim();

    if (!savedAdapter?.connectionStatus || !normalizedApiKey || !normalizedModel) {
      return null;
    }

    if (
      savedAdapter.lastTestedApiKey !== normalizedApiKey ||
      savedAdapter.lastTestedModel !== normalizedModel ||
      (savedAdapter.lastTestedEndpoint || "") !== normalizedEndpoint
    ) {
      return null;
    }

    return savedAdapter.connectionStatus;
  };

  const updateApiAdapterValues = (
    adapter: ApiAdapterOption,
    patch: Partial<{ apiKey: string; model: string; endpoint: string }>,
  ) => {
    apiAdapterEditRevisionsRef.current[adapter.id] =
      (apiAdapterEditRevisionsRef.current[adapter.id] || 0) + 1;
    const currentValues = getApiAdapterValues(adapter);
    const nextValues = {
      ...currentValues,
      ...patch,
    };

    update({
      ...(isApiAdapterSelected(adapter)
        ? {
            apiKey: nextValues.apiKey,
            whisperModel: nextValues.model,
            whisperEndpoint: nextValues.endpoint,
          }
        : {}),
      apiAdapters: {
        ...(settings.apiAdapters || {}),
        [adapter.id]: {
          ...nextValues,
        },
      },
    });
    setApiAdapterTestStates((prev) => ({
      ...prev,
      [adapter.id]: { status: "idle", message: "" },
    }));
    setDirtyApiAdapters((prev) => ({ ...prev, [adapter.id]: true }));
    if (adapter.id === "openai") {
      setTestStatus("idle");
      setTestMessage(null);
    }
  };

  const getAdapterStatus = (
    adapter: ApiAdapterOption,
    apiKey: string,
    model: string,
    endpoint: string,
  ) => {
    const persistedStatus = getPersistedAdapterStatus(adapter, apiKey, model, endpoint);
    const isSelected =
      isApiAdapterSelected(adapter) && Boolean(persistedStatus) && !dirtyApiAdapters[adapter.id];

    if (adapter.id === "openai") {
      const adapterState = apiAdapterTestStates[adapter.id];
      const effectiveStatus =
        adapterState?.status === "testing" ||
        adapterState?.status === "error" ||
        adapterState?.status === "success"
          ? adapterState.status
          : testStatus === "idle" && persistedStatus
            ? "success"
            : (testStatus as AdapterTestStatus);
      const label = isSelected
        ? t("models.adapterStatus.selected")
        : !apiKey.trim()
          ? t("models.adapterStatus.needApiKey")
          : effectiveStatus === "success"
            ? t("models.adapterStatus.ready")
            : effectiveStatus === "error"
              ? t("models.adapterStatus.error")
              : effectiveStatus === "testing"
                ? t("models.adapterStatus.testing")
                : t("models.adapterStatus.readyToTest");
      const color =
        isSelected || effectiveStatus === "success"
          ? "var(--success-bright)"
          : effectiveStatus === "error"
            ? "var(--error-bright)"
            : "var(--label-2)";

      return {
        label,
        message: effectiveStatus === "error" ? adapterState?.message || testMessage : null,
        status: isSelected ? ("success" as AdapterTestStatus) : effectiveStatus,
        color,
        isSelected,
      };
    }

    const adapterState = apiAdapterTestStates[adapter.id];
    const hasCredentials = Boolean(apiKey.trim()) && Boolean(model.trim());
    const effectiveStatus: AdapterTestStatus =
      adapterState?.status === "error"
        ? "error"
        : persistedStatus
          ? "success"
          : adapterState?.status || "idle";
    const label = isSelected
      ? t("models.adapterStatus.selected")
      : effectiveStatus === "success"
        ? t("models.adapterStatus.ready")
        : !apiKey.trim()
          ? t("models.adapterStatus.needApiKey")
          : !model.trim()
            ? t("models.adapterStatus.needModel")
            : t("models.adapterStatus.readyToSelect");

    return {
      label,
      message: effectiveStatus === "error" ? adapterState?.message : null,
      status: effectiveStatus,
      color:
        isSelected || effectiveStatus === "success"
          ? "var(--success-bright)"
          : effectiveStatus === "error"
            ? "var(--error-bright)"
            : hasCredentials
              ? "var(--label)"
              : "var(--label-2)",
      isSelected,
    };
  };

  const handleApiAdapterTest = async (adapter: ApiAdapterOption) => {
    const values = getApiAdapterValues(adapter);
    if (!values.apiKey.trim() || !values.model.trim()) {
      setApiAdapterTestStates((prev) => ({
        ...prev,
        [adapter.id]: {
          status: "error",
          message: t("models.test.needKeyAndModel"),
        },
      }));
      return;
    }
    const testedRevision = apiAdapterEditRevisionsRef.current[adapter.id] || 0;
    const configurationChanged = () =>
      (apiAdapterEditRevisionsRef.current[adapter.id] || 0) !== testedRevision;

    const modelOption = getApiAdapterModelOption(adapter, values.model);
    const realtimeCatalogAdapter = STREAMING_STT_ADAPTERS.find(
      (candidate) => candidate.id === adapter.id,
    );
    const shouldTestRealtime = Boolean(
      realtimeCatalogAdapter && (modelOption?.supportsStreaming || !modelOption),
    );
    let streamingCapability: "supported" | "unsupported" | undefined;
    let streamingCapabilityFingerprint: string | undefined;

    if (shouldTestRealtime && realtimeCatalogAdapter) {
      setApiAdapterTestStates((prev) => ({
        ...prev,
        [adapter.id]: {
          status: "testing",
          message: t("models.connection.testing"),
        },
      }));

      try {
        const result = await invoke<{ success: boolean; message: string }>(
          "test_realtime_connection",
          {
            req: {
              provider: adapter.id,
              apiKey: values.apiKey,
              model: values.model,
              endpoint: values.endpoint || realtimeCatalogAdapter.defaultEndpoint,
              purpose: "stt",
            },
          },
        );
        if (configurationChanged()) {
          setApiAdapterTestStates((prev) => ({
            ...prev,
            [adapter.id]: { status: "idle", message: "" },
          }));
          return;
        }
        setApiAdapterTestStates((prev) => ({
          ...prev,
          [adapter.id]: {
            status: result.success ? "success" : "error",
            message: result.success ? "" : result.message,
          },
        }));
        if (!result.success) return;
        streamingCapability = "supported";
        streamingCapabilityFingerprint = realtimeConfigurationFingerprint({
          provider: adapter.id,
          apiKey: values.apiKey,
          model: values.model,
          endpoint: values.endpoint,
          defaultEndpoint: realtimeCatalogAdapter.defaultEndpoint,
        });
      } catch (err) {
        if (configurationChanged()) {
          setApiAdapterTestStates((prev) => ({
            ...prev,
            [adapter.id]: { status: "idle", message: "" },
          }));
          return;
        }
        setApiAdapterTestStates((prev) => ({
          ...prev,
          [adapter.id]: {
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          },
        }));
        return;
      }
    } else if (adapter.testable) {
      setApiAdapterTestStates((prev) => ({
        ...prev,
        [adapter.id]: { status: "testing", message: "" },
      }));
      try {
        const result = await invoke<{ success: boolean; message: string }>("test_api_connection", {
          req: {
            api_key: values.apiKey,
            whisper_api_key: null,
            whisper_endpoint: values.endpoint || null,
            local_models_dir: null,
            whisper_model: values.model,
            llm_api_key: null,
            llm_endpoint: null,
            llm_model: "none",
            test_stt: true,
            test_llm: false,
          },
        });
        if (configurationChanged()) {
          setApiAdapterTestStates((prev) => ({
            ...prev,
            [adapter.id]: { status: "idle", message: "" },
          }));
          return;
        }
        if (!result.success) throw new Error(result.message);
      } catch (err) {
        if (configurationChanged()) {
          setApiAdapterTestStates((prev) => ({
            ...prev,
            [adapter.id]: { status: "idle", message: "" },
          }));
          return;
        }
        setApiAdapterTestStates((prev) => ({
          ...prev,
          [adapter.id]: {
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          },
        }));
        return;
      }
    } else {
      setApiAdapterTestStates((prev) => ({
        ...prev,
        [adapter.id]: {
          status: "success",
          message: "",
        },
      }));
    }

    if (configurationChanged()) {
      return;
    }
    setApiAdapterTestStates((prev) => ({
      ...prev,
      [adapter.id]: {
        status: "success",
        message: "",
      },
    }));
    setDirtyApiAdapters((prev) => ({ ...prev, [adapter.id]: false }));
    update({
      apiAdapters: {
        ...(settings.apiAdapters || {}),
        [adapter.id]: {
          apiKey: values.apiKey,
          model: values.model,
          endpoint: values.endpoint,
          connectionStatus: shouldTestRealtime || adapter.testable ? "verified" : "saved",
          lastConnectedAt: new Date().toISOString(),
          lastTestedApiKey: values.apiKey.trim(),
          lastTestedModel: values.model.trim(),
          lastTestedEndpoint: values.endpoint.trim(),
          streamingCapability,
          streamingCapabilityFingerprint,
        },
      },
    });
  };

  const buildActiveApiAdapterSnapshot = (): Partial<AppSettings> => {
    if (activeModelMode !== "api") {
      return {};
    }

    const adapterId = selectedApiAdapterId || "openai";
    const currentAdapter = settings.apiAdapters?.[adapterId] || {
      apiKey: settings.apiKey || "",
      model: settings.whisperModel || "whisper-1",
    };

    return {
      apiAdapters: {
        ...(settings.apiAdapters || {}),
        [adapterId]: {
          ...currentAdapter,
          apiKey: settings.apiKey || "",
          model: settings.whisperModel || "whisper-1",
          endpoint: settings.whisperEndpoint || "",
        },
      },
    };
  };

  const handleSelectApiAdapter = (adapter: ApiAdapterOption) => {
    const values = getApiAdapterValues(adapter);
    const apiKey = values.apiKey.trim();
    const model = values.model.trim();
    const endpoint = values.endpoint.trim();

    if (!apiKey || !model) {
      setApiAdapterTestStates((prev) => ({
        ...prev,
        [adapter.id]: {
          status: "error",
          message: t("models.test.needKeyAndModelBeforeSelect"),
        },
      }));
      return;
    }

    update({
      provider: "openai",
      selectedApiAdapter: adapter.id,
      apiKey,
      whisperApiKey: "",
      whisperEndpoint: endpoint,
      whisperModel: model,
      llmApiKey: "",
      llmEndpoint: "",
      llmModel: "none",
      apiAdapters: {
        ...(settings.apiAdapters || {}),
        [adapter.id]: {
          ...(settings.apiAdapters?.[adapter.id] || {}),
          apiKey,
          model,
          endpoint,
          connectionStatus: settings.apiAdapters?.[adapter.id]?.connectionStatus || "saved",
          lastConnectedAt:
            settings.apiAdapters?.[adapter.id]?.lastConnectedAt || new Date().toISOString(),
          lastTestedApiKey: settings.apiAdapters?.[adapter.id]?.lastTestedApiKey,
          lastTestedModel: settings.apiAdapters?.[adapter.id]?.lastTestedModel,
          lastTestedEndpoint: settings.apiAdapters?.[adapter.id]?.lastTestedEndpoint,
        },
      },
    });
    setModelModeView("api");
    resetInstallState();
  };

  const handleModeChange = (mode: ModelMode) => {
    if (mode === visibleModelMode) {
      return;
    }

    setModelModeView(mode);
    resetTestState();
    resetInstallState();
  };

  // Explicit "use this mode" commit for the API / Local segments. The recognition
  // and text model share the same backend flag, so committing the mode here is the
  // single source of truth; the specific adapter / model is still picked below.
  const handleSelectApiMode = () => {
    const adapter =
      API_ADAPTERS.find((candidate) => candidate.id === selectedApiAdapterId) || API_ADAPTERS[0];
    const values = getApiAdapterValues(adapter);
    update(
      apiModelModeSettingsPatch({
        adapterId: adapter.id,
        apiKey: values.apiKey,
        endpoint: values.endpoint,
        model: values.model,
      }),
    );
    setModelModeView("api");
    resetTestState();
    resetInstallState();
  };

  const handleSelectLocalMode = () => {
    const preferredModel =
      LOCAL_MODEL_OPTIONS.find(
        (model) => model.purpose !== "diarization" && localInstalledModelSet.has(model.model),
      ) ||
      LOCAL_MODEL_OPTIONS.find(
        (model) =>
          model.purpose !== "diarization" &&
          settings.localModels?.[model.id]?.status === "downloaded",
      ) ||
      LOCAL_MODEL_OPTIONS.find((model) => model.model === LOCAL_STT_PRESET_MODEL) ||
      LOCAL_MODEL_OPTIONS[0];

    update(
      localModelModeSettingsPatch(
        {
          endpoint: getLocalModelEndpoint(preferredModel),
          model: preferredModel.model,
        },
        buildActiveApiAdapterSnapshot(),
      ),
    );
    setModelModeView("local");
    resetTestState();
    resetInstallState();
  };

  const renderModeCommitRow = (mode: "api" | "local") => {
    const isActive = activeModelMode === mode;
    const modeLabel = mode === "api" ? "API" : t("models.mode.local");
    return (
      <div className="ui-model-card__notice ui-model-card__actions">
        <div
          className="ui-model-card__actions-leading ui-model-card__status-note"
          style={{ color: isActive ? "var(--success-bright)" : "var(--label-2)" }}
        >
          {isActive && <IconCheck size={14} stroke={2.5} />}
          <span>
            {isActive
              ? t("models.modeCommit.active")
              : t("models.modeCommit.label", { mode: modeLabel })}
          </span>
        </div>
        {!isActive && (
          <Button
            variant="primary"
            onClick={mode === "api" ? handleSelectApiMode : handleSelectLocalMode}
          >
            {t("models.modeCommit.select")}
          </Button>
        )}
      </div>
    );
  };

  const updateLocalModelCache = (modelId: string, patch: Partial<LocalModelSettings>) => {
    const current = settings.localModels?.[modelId] || {
      status: "not_downloaded" as const,
    };
    update({
      localModels: {
        ...(settings.localModels || {}),
        [modelId]: {
          ...current,
          ...patch,
        },
      },
    });
  };

  const handleSelectLocalTranslator = (component: LocalOtherComponent, selected: boolean) => {
    update({
      translation: {
        ...settings.translation,
        selectionLocalTranslatorProvider: selected ? component.id : "",
      },
    });
  };

  const getLocalModelStatus = (model: LocalModelOption) => {
    const actionState = localModelActionStates[model.id];
    const cachedState = settings.localModels?.[model.id];
    const isRuntimeReady = model.runtimeReady === true;
    const isInstalled = isRuntimeReady && localInstalledModelSet.has(model.model);
    const isSelected =
      activeModelMode === "local" && localSttTargetModel === model.model && isInstalled;

    if (!isRuntimeReady) {
      const runtimeName = model.runtimeKind === "diarization" ? "Diarization" : "transcribe.cpp";
      const isRuntimeSlotReady = model.runtimeKind === "diarization";
      return {
        label: isRuntimeSlotReady
          ? t("models.local.modelNotConnected")
          : t("models.local.engineNotConnected"),
        connectionLabel: isRuntimeSlotReady
          ? t("models.local.runtimeReadyModelOff", { runtime: runtimeName })
          : t("models.local.runtimeSlotPrepared", { runtime: runtimeName }),
        status: "unsupported" as const,
        color: "var(--label-2)",
        message:
          model.unavailableReason || t("models.local.sidecarPending", { runtime: runtimeName }),
        isInstalled: false,
        isSelected: false,
      };
    }

    if (actionState?.status === "deleting") {
      return {
        label: t("models.local.deleting"),
        connectionLabel: "",
        status: "deleting" as const,
        color: "var(--label)",
        message: actionState.message || cachedState?.message || null,
        isInstalled,
        isSelected,
      };
    }

    if (
      !isInstalled &&
      (actionState?.status === "installing" || cachedState?.status === "downloading")
    ) {
      return {
        label: t("models.local.downloading"),
        connectionLabel: "",
        status: "installing" as const,
        color: "var(--label)",
        message: actionState?.message || cachedState?.message || null,
        isInstalled,
        isSelected,
      };
    }

    if (isSelected) {
      return {
        label: t("models.local.selected"),
        connectionLabel: "",
        status: "selected" as const,
        color: "var(--success-bright)",
        message: actionState?.message || cachedState?.message || null,
        isInstalled,
        isSelected,
      };
    }

    if (isInstalled) {
      return {
        label: t("models.local.ready"),
        connectionLabel: "",
        status: "installed" as const,
        color: "var(--success-bright)",
        message: actionState?.message || cachedState?.message || null,
        isInstalled,
        isSelected,
      };
    }

    if (actionState?.status === "error" || cachedState?.status === "error") {
      return {
        label: t("models.adapterStatus.error"),
        connectionLabel: t("models.local.prepareFailed"),
        status: "error" as const,
        color: "var(--error-bright)",
        message: actionState?.message || cachedState?.message || null,
        isInstalled,
        isSelected,
      };
    }

    return {
      label: t("models.local.notDownloaded"),
      connectionLabel: "",
      status: "idle" as const,
      color: "var(--label-2)",
      message: actionState?.message || cachedState?.message || null,
      isInstalled,
      isSelected,
    };
  };

  const getLocalOtherStatus = (component: LocalOtherComponent) => {
    const actionState = localModelActionStates[component.id];
    const cachedState = settings.localModels?.[component.id];
    const backendState =
      localTranslators[component.id] ||
      (component.id === "nllb-200" ? localTranslators.trad : undefined);
    const isSelected =
      settings.translation.selectionLocalTranslatorProvider === component.id ||
      (component.id === "nllb-200" &&
        settings.translation.selectionLocalTranslatorProvider === "trad");

    if (actionState?.status === "deleting") {
      return {
        label: t("models.local.deleting"),
        status: "deleting" as const,
        color: "var(--label)",
        message: actionState.message || cachedState?.message || backendState?.message || null,
        isInstalled: backendState?.status === "ready",
        isSelected,
        canDelete: backendState?.managed === true,
      };
    }

    if (actionState?.status === "installing" || backendState?.status === "downloading") {
      return {
        label: t("models.localOther.status.downloading"),
        status: "installing" as const,
        color: "var(--label)",
        message: actionState?.message || cachedState?.message || backendState?.message || null,
        isInstalled: false,
        isSelected: false,
        canDelete: false,
      };
    }

    if (backendState?.status === "ready") {
      return {
        label: t("models.localOther.status.ready"),
        status: "installed" as const,
        color: "var(--success-bright)",
        message: backendState.message || cachedState?.message || null,
        isInstalled: true,
        isSelected,
        canDelete: backendState.managed === true,
      };
    }

    if (actionState?.status === "error" || backendState?.status === "error") {
      return {
        label: t("models.localOther.status.error"),
        status: "error" as const,
        color: "var(--error-bright)",
        message: actionState?.message || cachedState?.message || backendState?.message || null,
        isInstalled: false,
        isSelected: false,
        canDelete: false,
      };
    }

    return {
      label: t("models.localOther.status.notInstalled"),
      status: "idle" as const,
      color: "var(--label-2)",
      message: backendState?.message || null,
      isInstalled: false,
      isSelected: false,
      canDelete: false,
    };
  };

  const formatLocalDownloadBytes = (bytes?: number, options: { showZero?: boolean } = {}) => {
    if (!bytes || bytes <= 0) return options.showZero ? t("models.size.zero") : "";
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      const gb = mb / 1024;
      return t("models.size.gb", {
        value: gb.toFixed(gb >= 10 ? 0 : 1).replace(".", ","),
      });
    }

    return t("models.size.mb", {
      value: mb.toFixed(mb >= 10 ? 0 : 1).replace(".", ","),
    });
  };

  const getLocalModelStorageLabel = (
    model: Pick<LocalModelOption, "downloadBytes" | "runtimeReady">,
  ) => {
    return (
      formatLocalDownloadBytes(model.downloadBytes) ||
      (model.runtimeReady ? t("models.size.unknown") : t("models.size.notConnected"))
    );
  };

  const translateSpeedValue = (value: string) => {
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

  const translateAccuracyValue = (value: string) => {
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

  const translateLanguageValue = (value: string) => {
    if (value === "English") return t("models.languageValue.english");
    if (value.includes("->") || value.includes("→")) return value;
    return t("models.languageValue.count", { value });
  };

  const renderLocalModelStats = (
    model: Pick<
      LocalModelOption,
      | "downloadBytes"
      | "runtimeReady"
      | "speed"
      | "accuracy"
      | "languageLabel"
      | "supportsStreaming"
    >,
  ) => {
    const speedValueLabel = translateSpeedValue(model.speed);
    const accuracyValueLabel = translateAccuracyValue(model.accuracy);
    const languageValueLabel = translateLanguageValue(model.languageLabel);
    const stats: { key: string; title: string; Icon: Icon; value: string }[] = [
      {
        key: "speed",
        title: t("models.stat.speedTitle", { value: speedValueLabel }),
        Icon: IconGauge,
        value: speedValueLabel,
      },
      {
        key: "accuracy",
        title: t("models.stat.accuracyTitle", {
          value: accuracyValueLabel,
        }),
        Icon: IconTargetArrow,
        value: accuracyValueLabel,
      },
    ];
    const storageLabel = getLocalModelStorageLabel(model);

    return (
      <div className="ui-model-stats">
        <div
          role="img"
          title={t("models.stat.downloadSizeTitle", { value: storageLabel })}
          aria-label={t("models.stat.downloadSizeTitle", { value: storageLabel })}
          className="ui-model-stat"
        >
          <IconDownload size={14} stroke={1.9} />
          <span>{storageLabel}</span>
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

        {model.supportsStreaming && (
          <div
            role="img"
            title={t("models.stat.streaming")}
            aria-label={t("models.stat.streaming")}
            className="ui-model-stat"
          >
            <IconBroadcast size={14} stroke={1.9} />
            <span>{t("models.stat.streaming")}</span>
          </div>
        )}
      </div>
    );
  };

  const handleSelectLocalModel = (model: LocalModelOption, endpointOverride?: string) => {
    update({
      ...buildActiveApiAdapterSnapshot(),
      provider: "custom",
      whisperApiKey: "",
      whisperEndpoint: endpointOverride || getLocalModelEndpoint(model),
      whisperModel: model.model,
    });
    setModelModeView("local");
    resetTestState();
    resetInstallState();

    if (localInstalledModelSet.has(model.model)) {
      updateLocalModelCache(model.id, {
        status: "downloaded",
        downloadedAt: settings.localModels?.[model.id]?.downloadedAt || new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        message: undefined,
      });
    }
  };

  const handleInstallLocalSttModel = async (model: LocalModelOption) => {
    optimisticLocalInstalledModelsRef.current.delete(model.model);
    setLocalModelActionStates((prev) => ({
      ...prev,
      [model.id]: {
        status: "installing",
        message: t("models.install.preparingRuntime"),
        progress: 0,
      },
    }));
    updateLocalModelCache(model.id, {
      status: "downloading",
      message: t("models.install.preparingRuntime"),
    });

    try {
      const result = await invoke<{
        success: boolean;
        message: string;
        whisper_endpoint?: string | null;
      }>("install_stt_model", {
        req: {
          api_key: settings.apiKey || "",
          whisper_api_key: settings.whisperApiKey || null,
          whisper_endpoint: getLocalModelEndpoint(model),
          local_models_dir: localModelsDir || null,
          whisper_model: model.model,
        },
      });

      if (result.success) {
        optimisticLocalInstalledModelsRef.current.add(model.model);
        setLocalInstalledModels((prev) =>
          prev.includes(model.model) ? prev : [...prev, model.model],
        );
      } else {
        optimisticLocalInstalledModelsRef.current.delete(model.model);
      }
      setLocalModelActionStates((prev) => ({
        ...prev,
        [model.id]: {
          status: result.success ? "success" : "error",
          message: result.success ? "" : result.message,
        },
      }));
      updateLocalModelCache(model.id, {
        status: result.success ? "downloaded" : "error",
        message: result.success ? undefined : result.message,
        downloadedAt: result.success ? new Date().toISOString() : undefined,
        lastCheckedAt: new Date().toISOString(),
      });

      if (result.success && model.purpose !== "diarization") {
        handleSelectLocalModel(model, result.whisper_endpoint || undefined);
        await refreshLocalInstalledModels();
      } else if (result.success) {
        await refreshLocalInstalledModels();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("отменена")) {
        // IconUser cancelled — reset to the not-downloaded state silently.
        optimisticLocalInstalledModelsRef.current.delete(model.model);
        setLocalModelActionStates((prev) => {
          const next = { ...prev };
          delete next[model.id];
          return next;
        });
        updateLocalModelCache(model.id, {
          status: "not_downloaded",
          message: undefined,
          lastCheckedAt: new Date().toISOString(),
        });
        return;
      }
      optimisticLocalInstalledModelsRef.current.delete(model.model);
      setLocalModelActionStates((prev) => ({
        ...prev,
        [model.id]: { status: "error", message },
      }));
      updateLocalModelCache(model.id, {
        status: "error",
        message,
        lastCheckedAt: new Date().toISOString(),
      });
    }
  };

  const handleCancelLocalSttDownload = async (model: LocalModelOption) => {
    try {
      await invoke("cancel_local_model_download", { modelId: model.model });
    } catch {
      /* best-effort */
    }
  };

  const handleDeleteLocalSttModel = async (model: LocalModelOption) => {
    setPendingDeleteModel(null);
    optimisticLocalInstalledModelsRef.current.delete(model.model);
    setLocalModelActionStates((prev) => ({
      ...prev,
      [model.id]: {
        status: "deleting",
        message: t("models.delete.removingFile"),
      },
    }));

    try {
      const result = await invoke<{ success: boolean; message: string }>("delete_stt_model", {
        req: {
          api_key: settings.apiKey || "",
          whisper_api_key: settings.whisperApiKey || null,
          whisper_endpoint: getLocalModelEndpoint(model),
          local_models_dir: localModelsDir || null,
          whisper_model: model.model,
        },
      });

      setLocalModelActionStates((prev) => ({
        ...prev,
        [model.id]: {
          status: result.success ? "success" : "error",
          message: result.success ? "" : result.message,
        },
      }));
      updateLocalModelCache(model.id, {
        status: result.success ? "not_downloaded" : "error",
        message: result.success ? undefined : result.message,
        downloadedAt: undefined,
        lastCheckedAt: new Date().toISOString(),
      });

      if (result.success) {
        setLocalInstalledModels((prev) => prev.filter((id) => id !== model.model));
        await refreshLocalInstalledModels();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLocalModelActionStates((prev) => ({
        ...prev,
        [model.id]: { status: "error", message },
      }));
      updateLocalModelCache(model.id, {
        status: "error",
        message,
        lastCheckedAt: new Date().toISOString(),
      });
    }
  };

  const handleInstallLocalTranslator = async (component: LocalOtherComponent) => {
    setLocalModelActionStates((prev) => ({
      ...prev,
      [component.id]: {
        status: "installing",
        message: t("models.install.preparingRuntime"),
        progress: 0,
      },
    }));
    updateLocalModelCache(component.id, {
      status: "downloading",
      message: t("models.install.preparingRuntime"),
    });

    try {
      const result = await invoke<{ success: boolean; message: string }>(
        "download_local_translator",
        {
          req: { provider: component.id },
        },
      );
      setLocalModelActionStates((prev) => ({
        ...prev,
        [component.id]: {
          status: result.success ? "success" : "error",
          message: result.success ? "" : result.message,
        },
      }));
      updateLocalModelCache(component.id, {
        status: result.success ? "downloaded" : "error",
        message: result.success ? undefined : result.message,
        downloadedAt: result.success ? new Date().toISOString() : undefined,
        lastCheckedAt: new Date().toISOString(),
      });
      await refreshLocalTranslators();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLocalModelActionStates((prev) => ({
        ...prev,
        [component.id]: { status: "error", message },
      }));
      updateLocalModelCache(component.id, {
        status: "error",
        message,
        lastCheckedAt: new Date().toISOString(),
      });
      await refreshLocalTranslators();
    }
  };

  const handleDeleteLocalTranslator = async (component: LocalOtherComponent) => {
    setLocalModelActionStates((prev) => ({
      ...prev,
      [component.id]: {
        status: "deleting",
        message: t("models.delete.removingFile"),
      },
    }));

    try {
      const result = await invoke<{ success: boolean; message: string }>(
        "delete_local_translator",
        {
          req: { provider: component.id },
        },
      );
      setLocalModelActionStates((prev) => ({
        ...prev,
        [component.id]: {
          status: result.success ? "success" : "error",
          message: result.success ? "" : result.message,
        },
      }));
      updateLocalModelCache(component.id, {
        status: result.success ? "not_downloaded" : "error",
        message: result.success ? undefined : result.message,
        downloadedAt: undefined,
        lastCheckedAt: new Date().toISOString(),
      });
      if (
        result.success &&
        (settings.translation.selectionLocalTranslatorProvider === component.id ||
          (component.id === "nllb-200" &&
            settings.translation.selectionLocalTranslatorProvider === "trad"))
      ) {
        handleSelectLocalTranslator(component, false);
      }
      await refreshLocalTranslators();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLocalModelActionStates((prev) => ({
        ...prev,
        [component.id]: { status: "error", message },
      }));
      updateLocalModelCache(component.id, {
        status: "error",
        message,
        lastCheckedAt: new Date().toISOString(),
      });
      await refreshLocalTranslators();
    }
  };

  return (
    <div className="ui-tab">
      <div>
        <div className="ui-page-header">
          <div className="ui-page-header__title">{t("models.modeSection.title")}</div>
          <div className="ui-page-header__desc">{t("models.modeSection.desc")}</div>
        </div>

        <SegmentedControl
          value={visibleModelMode}
          options={modeOptions.map(({ id, label }) => ({ value: id, label }))}
          onChange={handleModeChange}
          ariaLabel={t("models.modeSection.title")}
        />
      </div>

      {isApiMode && (
        <div className="ui-tab">
          <SegmentedControl
            value={apiModelKind}
            options={[
              { value: "transcription", label: t("models.local.tabTranscription") },
              {
                value: "text",
                label: t("models.local.tabText"),
                needsAttention: !apiTextModelConfigured,
              },
              { value: "translation", label: t("models.local.tabTranslation") },
            ]}
            onChange={setApiModelKind}
            ariaLabel={t("models.apiSection.title")}
          />

          {renderModeCommitRow("api")}

          {apiModelKind === "transcription" && (
            <>
              <div className="ui-page-header">
                <div className="ui-page-header__title">{t("models.apiSection.title")}</div>
                <div className="ui-page-header__desc">{t("models.apiSection.desc")}</div>
              </div>
              <div className="ui-tab">
                {API_ADAPTERS.map((adapter) => {
                  const isExpanded = expandedApiAdapter === adapter.id;
                  const adapterValues = getApiAdapterValues(adapter);
                  const adapterStatus = getAdapterStatus(
                    adapter,
                    adapterValues.apiKey,
                    adapterValues.model,
                    adapterValues.endpoint,
                  );
                  const selectedModelOption = getApiAdapterModelOption(
                    adapter,
                    adapterValues.model,
                  );
                  const realtimeCatalogAdapter = STREAMING_STT_ADAPTERS.find(
                    (candidate) => candidate.id === adapter.id,
                  );
                  const streamingVerified = Boolean(
                    !dirtyApiAdapters[adapter.id] &&
                      realtimeCatalogAdapter &&
                      hasVerifiedRealtimeCapability(
                        realtimeCatalogAdapter,
                        settings.apiAdapters?.[adapter.id],
                      ),
                  );
                  const modelSelectValue = selectedModelOption?.id || CUSTOM_API_MODEL_VALUE;
                  const isAdapterSelected = adapterStatus.isSelected;
                  const isAdapterReady = adapterStatus.status === "success";
                  const canSelectApiAdapter =
                    Boolean(adapterValues.apiKey.trim()) && Boolean(adapterValues.model.trim());
                  const isAdapterTestDisabled =
                    adapterStatus.status === "testing" || !canSelectApiAdapter;

                  return (
                    <div
                      key={adapter.id}
                      className={["ui-model-card", isExpanded ? "ui-model-card--overlay" : ""]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div className="ui-model-card__head">
                        <div className="ui-model-card__main">
                          <div className="ui-model-card__titlebar">
                            <div className="ui-model-card__title">{adapter.name}</div>
                            <Badge
                              className="ui-model-card__state"
                              style={{ color: adapterStatus.color }}
                              title={adapterStatus.message || undefined}
                            >
                              {adapterStatus.label}
                            </Badge>
                          </div>
                          <div className="ui-model-card__body">
                            <div className="ui-model-card__desc">
                              {t(API_ADAPTER_DESCRIPTION_KEYS[adapter.id])}{" "}
                              {t("models.adapter.recommendedModel", {
                                model: adapter.recommendedModel,
                              })}
                            </div>
                            {streamingVerified &&
                              (selectedModelOption?.supportsStreaming || !selectedModelOption) && (
                                <div className="ui-model-stats">
                                  <div
                                    role="img"
                                    title={t("models.stat.streaming")}
                                    aria-label={t("models.stat.streaming")}
                                    className="ui-model-stat"
                                  >
                                    <IconBroadcast size={14} stroke={1.9} />
                                    <span>{t("models.stat.streaming")}</span>
                                  </div>
                                </div>
                              )}
                          </div>
                          <ModelCardDisclosureButton
                            expanded={isExpanded}
                            onToggle={() => setExpandedApiAdapter(isExpanded ? null : adapter.id)}
                            label={t(isExpanded ? "mainTab.collapse" : "mainTab.expand")}
                          />
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="ui-model-card__detail">
                          <div className="ui-model-card__field">
                            <div className="ui-model-card__field-label">
                              {t("models.field.apiKey")}
                            </div>
                            <SecureField
                              value={adapterValues.apiKey}
                              onChange={(e) =>
                                updateApiAdapterValues(adapter, {
                                  apiKey: e.target.value,
                                })
                              }
                              placeholder="API key"
                              spellCheck={false}
                              className="ui-textfield--mono"
                            />
                          </div>

                          <div className="ui-model-card__field">
                            <div className="ui-model-card__field-label">
                              {t("models.field.model")}
                            </div>
                            <div className="ui-model-card__field-control">
                              <PopUpButton
                                value={modelSelectValue}
                                options={[
                                  ...adapter.models.map((modelOption) => ({
                                    value: modelOption.id,
                                    label: `${modelOption.id}${modelOption.supportsStreaming ? ` · ${t("models.stat.streaming")}` : ""}`,
                                  })),
                                  {
                                    value: CUSTOM_API_MODEL_VALUE,
                                    label: t("models.field.customModel"),
                                  },
                                ]}
                                onChange={(value) => {
                                  updateApiAdapterValues(adapter, {
                                    model: value === CUSTOM_API_MODEL_VALUE ? "" : value,
                                  });
                                }}
                                ariaLabel={t("models.field.model")}
                              />
                              {modelSelectValue === CUSTOM_API_MODEL_VALUE && (
                                <TextField
                                  value={adapterValues.model}
                                  onChange={(event) =>
                                    updateApiAdapterValues(adapter, {
                                      model: event.currentTarget.value,
                                    })
                                  }
                                  placeholder={t("models.field.customModelPlaceholder")}
                                  aria-label={t("models.field.customModelPlaceholder")}
                                  spellCheck={false}
                                  className="ui-textfield--mono"
                                />
                              )}
                            </div>
                            <div className="ui-model-card__hint">
                              {t("models.field.recommended", {
                                model: adapter.recommendedModel,
                              })}
                            </div>
                          </div>

                          <div className="ui-model-card__field">
                            <div className="ui-model-card__field-label">
                              {t("models.field.host")}
                            </div>
                            <TextField
                              type="url"
                              value={adapterValues.endpoint}
                              onChange={(e) =>
                                updateApiAdapterValues(adapter, {
                                  endpoint: e.target.value,
                                })
                              }
                              placeholder={
                                adapter.defaultEndpoint
                                  ? t("models.field.hostDefaultPlaceholder", {
                                      endpoint: adapter.defaultEndpoint,
                                    })
                                  : t("models.field.hostPlaceholder")
                              }
                              spellCheck={false}
                              className="ui-textfield--mono"
                            />
                            {adapterValues.endpoint.trim() ? (
                              <Button
                                onClick={() =>
                                  updateApiAdapterValues(adapter, {
                                    endpoint: "",
                                  })
                                }
                              >
                                {t("models.common.reset")}
                              </Button>
                            ) : (
                              <div className="ui-model-card__hint">
                                {t("models.common.optional")}
                              </div>
                            )}
                          </div>

                          <div className="ui-model-card__actions">
                            {isAdapterSelected ? (
                              <Badge variant="success" className="ui-model-card__state">
                                <IconCheck size={14} stroke={2.5} />
                                {t("models.common.selected")}
                              </Badge>
                            ) : (
                              <>
                                {isAdapterReady && (
                                  <Button
                                    onClick={() => handleSelectApiAdapter(adapter)}
                                    disabled={!canSelectApiAdapter}
                                  >
                                    <IconCheck size={14} stroke={2.5} />
                                    {t("models.common.select")}
                                  </Button>
                                )}

                                <Button
                                  variant="primary"
                                  onClick={() => void handleApiAdapterTest(adapter)}
                                  disabled={isAdapterTestDisabled}
                                >
                                  {adapterStatus.status === "testing" ? (
                                    <>
                                      <Spinner size={14} />
                                      {t("models.test.checking")}
                                    </>
                                  ) : (
                                    <>
                                      <IconBolt size={14} stroke={2.2} />
                                      {adapter.testable
                                        ? t("models.test.testAndSave")
                                        : t("models.test.saveButton")}
                                    </>
                                  )}
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
            </>
          )}

          {apiModelKind === "text" && <TextModelCard settings={settings} update={update} />}
          {apiModelKind === "translation" && (
            <RealtimeTranslationModels settings={settings} update={update} />
          )}
        </div>
      )}

      {isLocalMode && (
        <div className="ui-tab">
          <SegmentedControl
            value={localModelKind}
            options={[
              { value: "transcription", label: t("models.local.tabTranscription") },
              {
                value: "text",
                label: t("models.local.tabText"),
                needsAttention: !localTextModelSelected,
              },
              { value: "other", label: t("models.local.tabOther") },
            ]}
            onChange={setLocalModelKind}
            ariaLabel={t("models.local.sectionTitle")}
          />

          {renderModeCommitRow("local")}

          {localModelKind === "transcription" && (
            <>
              <div className="ui-page-header">
                <div className="ui-page-header__title">{t("models.local.sectionTitle")}</div>
                <div className="ui-page-header__desc">{t("models.local.sectionDesc")}</div>
              </div>

              <div className="ui-tab">
                {LOCAL_MODEL_OPTIONS.map((model) => {
                  const isExpanded = expandedLocalModel === model.id;
                  const modelStatus = getLocalModelStatus(model);
                  const modelActionState = localModelActionStates[model.id];
                  const isRuntimeReady =
                    modelStatus.status !== "unsupported" && model.runtimeReady === true;
                  const isDownloaded = modelStatus.isInstalled;
                  const isModelBusy =
                    modelStatus.status === "installing" || modelStatus.status === "deleting";
                  const isInstallDisabled = isModelBusy || !isRuntimeReady;
                  const canSelect =
                    isRuntimeReady && modelStatus.isInstalled && model.purpose !== "diarization";
                  const downloadProgress =
                    modelStatus.status === "installing" ? modelActionState?.progress : undefined;
                  const downloadedLabel = formatLocalDownloadBytes(
                    modelActionState?.downloadedBytes,
                    { showZero: Boolean(modelActionState?.totalBytes) },
                  );
                  const totalLabel = formatLocalDownloadBytes(modelActionState?.totalBytes);

                  return (
                    <LocalSttModelCard
                      key={model.id}
                      name={model.name}
                      description={t(LOCAL_MODEL_DESCRIPTION_KEYS[model.id])}
                      recommendedLabel={
                        model.recommended ? t("models.local.recommendedBadge") : undefined
                      }
                      statusLabel={modelStatus.label}
                      statusColor={modelStatus.color}
                      expanded={isExpanded}
                      onToggle={() => setExpandedLocalModel(isExpanded ? null : model.id)}
                      disclosureLabel={t(isExpanded ? "mainTab.collapse" : "mainTab.expand")}
                      stats={{
                        storageLabel: getLocalModelStorageLabel(model),
                        storageTitle: t("models.stat.downloadSizeTitle", {
                          value: getLocalModelStorageLabel(model),
                        }),
                        languageLabel: translateLanguageValue(model.languageLabel),
                        languageTitle: t("models.stat.languagesTitle", {
                          value: translateLanguageValue(model.languageLabel),
                        }),
                        speedLabel: translateSpeedValue(model.speed),
                        speedTitle: t("models.stat.speedTitle", {
                          value: translateSpeedValue(model.speed),
                        }),
                        accuracyLabel: translateAccuracyValue(model.accuracy),
                        accuracyTitle: t("models.stat.accuracyTitle", {
                          value: translateAccuracyValue(model.accuracy),
                        }),
                        streamingLabel: model.supportsStreaming
                          ? t("models.stat.streaming")
                          : undefined,
                      }}
                      notice={
                        modelStatus.message &&
                        modelStatus.status !== "installing" &&
                        modelStatus.status !== "installed" &&
                        modelStatus.status !== "selected"
                          ? {
                              message: modelStatus.message,
                              tone: modelStatus.status === "error" ? "error" : "neutral",
                            }
                          : undefined
                      }
                      progress={
                        modelStatus.status === "installing"
                          ? {
                              message: modelActionState?.message || t("models.download.loading"),
                              percent: downloadProgress,
                              valueLabel: downloadedLabel || t("models.download.preparing"),
                              downloadedLabel,
                              totalLabel,
                              totalTemplate: totalLabel
                                ? t("models.download.of", {
                                    total: totalLabel,
                                  })
                                : undefined,
                            }
                          : undefined
                      }
                      connectionLabel={modelStatus.connectionLabel || undefined}
                      connectionColor={modelStatus.color}
                      showConnectionCheck={
                        modelStatus.status === "installed" || modelStatus.status === "selected"
                      }
                      actions={
                        <>
                          {canSelect && !modelStatus.isSelected && (
                            <Button onClick={() => handleSelectLocalModel(model)}>
                              <IconCheck size={14} stroke={2.5} />
                              {t("models.common.select")}
                            </Button>
                          )}

                          {!isModelBusy && (
                            <Button
                              variant={isDownloaded || isInstallDisabled ? "default" : "primary"}
                              onClick={() => {
                                if (isDownloaded) {
                                  setPendingDeleteModel(model);
                                  return;
                                }

                                void handleInstallLocalSttModel(model);
                              }}
                              disabled={isInstallDisabled}
                            >
                              {isDownloaded ? (
                                <>
                                  <IconTrash size={14} stroke={2.2} />
                                  {t("models.common.delete")}
                                </>
                              ) : (
                                <>
                                  <IconDownload size={14} stroke={2.2} />
                                  {isRuntimeReady
                                    ? t("models.common.download")
                                    : t("models.common.unavailable")}
                                </>
                              )}
                            </Button>
                          )}

                          {modelStatus.status === "installing" && (
                            <Button onClick={() => void handleCancelLocalSttDownload(model)}>
                              <IconX size={14} stroke={2.2} />
                              {t("models.common.cancel")}
                            </Button>
                          )}
                        </>
                      }
                    />
                  );
                })}
              </div>
              {pendingDeleteModel && (
                // biome-ignore lint/a11y/useKeyWithClickEvents: modal scrim closes on click; keyboard users have the Escape handler and the dialog controls.
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="delete-local-model-title"
                  className="ui-modal-scrim"
                  onClick={() => setPendingDeleteModel(null)}
                >
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click handler only stops propagation so clicks inside the dialog do not close it. */}
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: the click handler only stops propagation so clicks inside the dialog do not close it. */}
                  <div
                    className="ui-modal"
                    style={{ width: "min(420px, 100%)", background: "var(--window-bg)" }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div id="delete-local-model-title" className="ui-modal__title">
                      {t("models.deleteDialog.title")}
                    </div>
                    <div className="ui-modal__body">
                      {t("models.deleteDialog.body", {
                        name: pendingDeleteModel.name,
                      })}
                    </div>
                    <div className="ui-modal__actions">
                      <Button onClick={() => setPendingDeleteModel(null)}>
                        {t("models.common.cancel")}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => void handleDeleteLocalSttModel(pendingDeleteModel)}
                      >
                        {t("models.common.delete")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {localModelKind === "text" && (
            <Suspense
              fallback={
                <div className="ui-model-card__notice ui-form-feedback">
                  {t("models.download.loading")}
                </div>
              }
            >
              <LocalLlmModels settings={settings} update={update} />
            </Suspense>
          )}

          {localModelKind === "other" && (
            <div className="ui-tab">
              <div className="ui-page-header">
                <div className="ui-page-header__title">{t("models.localOther.sectionTitle")}</div>
                <div className="ui-page-header__desc">{t("models.localOther.sectionDesc")}</div>
              </div>

              <div className="ui-tab">
                {LOCAL_OTHER_COMPONENTS.map((component) => {
                  const componentStatus = getLocalOtherStatus(component);
                  const isBusy =
                    componentStatus.status === "installing" ||
                    componentStatus.status === "deleting";
                  const isExpanded = expandedLocalOtherComponent === component.id || isBusy;

                  return (
                    <div key={component.id} className="ui-model-card">
                      <div className="ui-model-card__head">
                        <div className="ui-model-card__main">
                          <div className="ui-model-card__titlebar">
                            <div className="ui-model-card__title">{component.name}</div>
                            <Badge
                              className="ui-model-card__state"
                              style={{ color: componentStatus.color }}
                            >
                              {componentStatus.label}
                            </Badge>
                          </div>
                          <div className="ui-model-card__body">
                            <div className="ui-model-card__desc">{t(component.descriptionKey)}</div>
                            {renderLocalModelStats(component)}
                          </div>
                          <ModelCardDisclosureButton
                            expanded={isExpanded}
                            onToggle={() =>
                              setExpandedLocalOtherComponent(isExpanded ? null : component.id)
                            }
                            label={t(isExpanded ? "mainTab.collapse" : "mainTab.expand")}
                          />
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="ui-model-card__detail">
                          {componentStatus.message && componentStatus.status !== "installed" && (
                            <div
                              className={[
                                "ui-model-card__notice",
                                componentStatus.status === "error"
                                  ? "ui-model-card__notice--error"
                                  : "",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            >
                              {componentStatus.message}
                            </div>
                          )}

                          <div className="ui-model-card__actions">
                            {componentStatus.status === "installed" && (
                              <div
                                className="ui-model-card__actions-leading ui-model-card__status-note"
                                style={{ color: componentStatus.color }}
                              >
                                <IconCheck size={14} stroke={2.5} />
                                {componentStatus.isSelected
                                  ? t("models.localOther.selected")
                                  : t("models.localOther.installedNotSelected")}
                              </div>
                            )}

                            {!isBusy && componentStatus.isInstalled && (
                              <Button
                                onClick={() =>
                                  handleSelectLocalTranslator(
                                    component,
                                    !componentStatus.isSelected,
                                  )
                                }
                              >
                                {componentStatus.isSelected ? (
                                  <>
                                    <IconX size={14} stroke={2.2} />
                                    {t("models.localOther.cancelSelection")}
                                  </>
                                ) : (
                                  <>
                                    <IconCheck size={14} stroke={2.5} />
                                    {t("models.localOther.select")}
                                  </>
                                )}
                              </Button>
                            )}

                            {!isBusy &&
                              (!componentStatus.isInstalled || componentStatus.canDelete) && (
                                <Button
                                  variant={componentStatus.isInstalled ? "destructive" : "primary"}
                                  onClick={() => {
                                    if (componentStatus.isInstalled) {
                                      void handleDeleteLocalTranslator(component);
                                      return;
                                    }

                                    void handleInstallLocalTranslator(component);
                                  }}
                                >
                                  {componentStatus.isInstalled ? (
                                    <>
                                      <IconTrash size={14} stroke={2.2} />
                                      {t("models.common.delete")}
                                    </>
                                  ) : (
                                    <>
                                      <IconDownload size={14} stroke={2.2} />
                                      {t("models.common.download")}
                                    </>
                                  )}
                                </Button>
                              )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
