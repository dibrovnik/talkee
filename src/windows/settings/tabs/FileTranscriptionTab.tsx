import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import type { ChangeEvent, DragEvent, JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { SpeakerNameInput } from "../../../components/SpeakerNameInput";
import { SummaryModal } from "../../../components/SummaryModal";
import {
  type FileTranscriptionProgress,
  type FileTranscriptionStatus,
  fileNameFromPath,
  formatFileSize,
  getFileTranscriptionPercent,
  toFileTranscriptionErrorMessage,
  transcribeFileOnly,
  transcribeFilePathOnly,
} from "../../../lib/fileTranscription";
import {
  CALL_CAPTURE_STOP_REQUEST_EVENT,
  HISTORY_UPDATED_EVENT,
  SETTINGS_UPDATED_EVENT,
} from "../../../lib/hotkeyEvents";
import { type TFunc, useI18n } from "../../../lib/i18n";
import {
  IconAlertCircle,
  IconCheck,
  IconClipboard,
  IconFileMusic,
  IconListCheck,
  IconSquare,
  IconX,
} from "../../../lib/icons";
import {
  type AppSettings,
  addHistoryEntry,
  getHistory,
  getSettings,
  type HistoryEntry,
  type SpeakerTranscriptSegment,
  saveSettings,
  updateHistoryEntry,
} from "../../../lib/store";
import { isSummaryAvailable } from "../../../lib/summarize";
import { formatErrorMessage } from "../../../lib/utils";
import { Button } from "../../../ui/Button";
import { ProgressBar } from "../../../ui/ProgressBar";
import { Spinner } from "../../../ui/Spinner";
import { Toggle } from "../../../ui/Toggle";

type ProcessingState = "idle" | FileTranscriptionStatus | "error";
type SpeakerSetupIntent = "toggle" | "process";
interface SelectedTranscriptionFile {
  name: string;
  size: number | null;
}
interface FileTranscriptionTabProps {
  focusedEntryId?: string | null;
}
const RESULT_PREVIEW_LIMIT = 250;
const DIARIZATION_MODEL_ID = "sherpa-diarization-pyannote-titanet-int8";
const LOCAL_WHISPER_MODEL_ID = "whisper-large-v3-turbo";
const LOCAL_WHISPER_ENDPOINT = "http://127.0.0.1:8000";
const RECOMMENDED_LOCAL_WHISPER_LABEL = "Whisper Large V3 Turbo";
const DIARIZATION_WHISPER_OPTIONS = [
  {
    id: "whisper-large-v3-turbo",
    model: "whisper-large-v3-turbo",
    label: "Whisper Large V3 Turbo",
  },
  {
    id: "whisper-large-v3",
    model: "whisper-large-v3",
    label: "Whisper Large V3",
  },
  {
    id: "whisper-large-v2",
    model: "whisper-large-v2",
    label: "Whisper Large V2",
  },
  { id: "whisper-medium", model: "whisper-medium", label: "Whisper Medium" },
  { id: "whisper-small", model: "whisper-small", label: "Whisper Small" },
  { id: "whisper-base", model: "whisper-base", label: "Whisper Base" },
  { id: "whisper-tiny", model: "whisper-tiny", label: "Whisper Tiny" },
] as const;
const STRONG_DIARIZATION_WHISPER_IDS = new Set([
  "whisper-large-v3-turbo",
  "whisper-large-v3",
  "whisper-large-v2",
  "whisper-medium",
]);

function isModelDownloaded(settings: AppSettings, modelId: string): boolean {
  return settings.localModels?.[modelId]?.status === "downloaded";
}

function isLocalSttSettings(settings: AppSettings): boolean {
  return /127\.0\.0\.1|localhost/i.test(settings.whisperEndpoint || "");
}

function getDiarizationWhisperOption(
  settings: AppSettings,
): (typeof DIARIZATION_WHISPER_OPTIONS)[number] | null {
  const currentModel = (settings.whisperModel || "").trim().toLowerCase();
  const currentOption = DIARIZATION_WHISPER_OPTIONS.find(
    (option) =>
      option.model.toLowerCase() === currentModel && isModelDownloaded(settings, option.id),
  );

  if (currentOption && STRONG_DIARIZATION_WHISPER_IDS.has(currentOption.id)) {
    return currentOption;
  }

  const strongestDownloadedOption = DIARIZATION_WHISPER_OPTIONS.find(
    (option) =>
      STRONG_DIARIZATION_WHISPER_IDS.has(option.id) && isModelDownloaded(settings, option.id),
  );

  return (
    strongestDownloadedOption ||
    currentOption ||
    DIARIZATION_WHISPER_OPTIONS.find((option) => isModelDownloaded(settings, option.id)) ||
    null
  );
}

function statusLabel(
  status: ProcessingState,
  progress: FileTranscriptionProgress | null,
  t: TFunc,
): string {
  if (status === "reading") return t("fileTab.status.reading");
  if (status === "converting") return t("fileTab.status.converting");
  if (status === "uploading") return t("fileTab.status.uploading");
  if (status === "preparing") return progress?.message || t("fileTab.status.preparing");
  if (status === "diarizing") return progress?.message || t("fileTab.status.diarizing");
  if (status === "transcribing") {
    if (progress && progress.totalChunks > 0) {
      return t("fileTab.status.transcribingChunk", {
        current: progress.currentChunk,
        total: progress.totalChunks,
      });
    }

    return t("fileTab.status.transcribing");
  }
  if (status === "assembling") return progress?.message || t("fileTab.status.assembling");
  if (status === "done") return t("fileTab.status.done");
  if (status === "error") return t("fileTab.status.error");
  return t("fileTab.status.idle");
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatSpeakerTranscript(segments: SpeakerTranscriptSegment[]): string {
  return segments
    .map(
      (segment) =>
        `[${formatTimestamp(segment.start)}] ${segment.speakerLabel}: ${segment.text.trim()}`,
    )
    .join("\n");
}

function resultSourceLabel(entry: HistoryEntry, t: TFunc): string {
  if (entry.source === "call") return t("fileTab.source.call");
  if (entry.source === "file") return t("fileTab.source.file");
  return t("fileTab.source.voice");
}

function isSpeakerSetupReady(settings: AppSettings): boolean {
  return (
    getDiarizationWhisperOption(settings) !== null &&
    settings.localModels?.[DIARIZATION_MODEL_ID]?.status === "downloaded"
  );
}

function isSpeakerSetupRepairError(error: unknown): boolean {
  const normalized = formatErrorMessage(error).toLowerCase();
  return (
    normalized.includes("sherpa-onnx установлен") &&
    (normalized.includes("diarization binary") ||
      normalized.includes("binary для разметки говорящих"))
  );
}

function isAuthFailureLike(normalized: string): boolean {
  return (
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("invalid api key") ||
    normalized.includes("api-ключ") ||
    normalized.includes("ключ доступа") ||
    (normalized.includes("авторизоваться") && normalized.includes("api"))
  );
}

function toSpeakerSetupErrorMessage(
  error: unknown,
  t: TFunc,
  settings: AppSettings | null = null,
): string {
  const raw = formatErrorMessage(error);
  const normalized = raw.toLowerCase();
  const isLocalStt = settings ? isLocalSttSettings(settings) : false;

  if (
    isLocalStt ||
    normalized.includes("локальный stt runtime") ||
    normalized.includes("local stt runtime") ||
    normalized.includes("127.0.0.1") ||
    normalized.includes("localhost")
  ) {
    if (
      isAuthFailureLike(normalized) ||
      normalized.includes("403") ||
      normalized.includes("forbidden")
    ) {
      return t("fileTab.setupError.localRuntimeRejected");
    }

    return raw.trim()
      ? t("fileTab.setupError.genericWithDetail", { detail: raw })
      : t("fileTab.setupError.generic");
  }

  if (isAuthFailureLike(normalized)) {
    return t("fileTab.setupError.rejectedKey");
  }

  if (normalized.includes("403")) {
    return t("fileTab.setupError.forbidden");
  }

  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return t("fileTab.setupError.timeout");
  }

  if (
    normalized.includes("ensurepip") ||
    normalized.includes("python3.12-venv") ||
    normalized.includes("python3-venv") ||
    normalized.includes("no module named pip")
  ) {
    return t("fileTab.setupError.noVenv");
  }

  if (
    normalized.includes("connect") ||
    normalized.includes("подключиться") ||
    normalized.includes("runtime")
  ) {
    return raw;
  }

  return raw.trim()
    ? t("fileTab.setupError.genericWithDetail", { detail: raw })
    : t("fileTab.setupError.generic");
}

async function refreshSpeakerInstalledModels(settings: AppSettings): Promise<AppSettings> {
  let result: { success: boolean; models: string[]; message: string };
  try {
    result = await invoke<{
      success: boolean;
      models: string[];
      message: string;
    }>("list_stt_models", {
      req: {
        api_key: settings.apiKey || "",
        whisper_api_key: settings.whisperApiKey || null,
        whisper_endpoint: LOCAL_WHISPER_ENDPOINT,
        local_models_dir: settings.localModelsDir || null,
      },
    });
  } catch {
    return settings;
  }

  if (!result.success) {
    return settings;
  }

  const installedModels = new Set(result.models || []);
  const now = new Date().toISOString();
  const nextLocalModels = { ...(settings.localModels || {}) };
  let changed = false;

  for (const option of DIARIZATION_WHISPER_OPTIONS) {
    const current = nextLocalModels[option.id];
    if (installedModels.has(option.model)) {
      nextLocalModels[option.id] = {
        ...current,
        status: "downloaded",
        message: undefined,
        downloadedAt: current?.downloadedAt || now,
        lastCheckedAt: now,
      };
      changed = true;
    } else if (current?.status === "downloaded") {
      delete nextLocalModels[option.id];
      changed = true;
    }
  }

  const currentDiarization = nextLocalModels[DIARIZATION_MODEL_ID];
  if (installedModels.has(DIARIZATION_MODEL_ID)) {
    nextLocalModels[DIARIZATION_MODEL_ID] = {
      ...currentDiarization,
      status: "downloaded",
      message: undefined,
      downloadedAt: currentDiarization?.downloadedAt || now,
      lastCheckedAt: now,
    };
    changed = true;
  } else if (currentDiarization?.status === "downloaded") {
    delete nextLocalModels[DIARIZATION_MODEL_ID];
    changed = true;
  }

  if (!changed) {
    return settings;
  }

  await saveSettings({ localModels: nextLocalModels });
  return { ...settings, localModels: nextLocalModels };
}

export function FileTranscriptionTab({
  focusedEntryId = null,
}: FileTranscriptionTabProps = {}): JSX.Element {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultSectionRef = useRef<HTMLElement | null>(null);
  const liveResultContentRef = useRef<HTMLDivElement | null>(null);
  const isProcessingRef = useRef(false);
  const nativeDropAtRef = useRef(0);
  const speakerDiarizationToggleRunRef = useRef(0);
  const settingsRef = useRef<AppSettings | null>(null);
  const processFilePathRef = useRef<(filePath: string) => Promise<void>>(async () => {});
  const [selectedFile, setSelectedFile] = useState<SelectedTranscriptionFile | null>(null);
  const [status, setStatus] = useState<ProcessingState>("idle");
  const [progress, setProgress] = useState<FileTranscriptionProgress | null>(null);
  const [resultEntry, setResultEntry] = useState<HistoryEntry | null>(null);
  const [liveCallEntry, setLiveCallEntry] = useState<HistoryEntry | null>(null);
  const [callStopRequested, setCallStopRequested] = useState(false);
  const [error, setError] = useState("");
  const [convertedInfo, setConvertedInfo] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryAvailable, setSummaryAvailable] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);
  const [speakerDiarization, setSpeakerDiarization] = useState(false);
  const [diarizationInstalled, setDiarizationInstalled] = useState(false);
  const [localWhisperDownloaded, setLocalWhisperDownloaded] = useState(false);
  const [localWhisperLabel, setLocalWhisperLabel] = useState("");
  const [speakerSetupModalOpen, setSpeakerSetupModalOpen] = useState(false);
  const [speakerSetupInstalling, setSpeakerSetupInstalling] = useState(false);
  const [speakerSetupMessage, setSpeakerSetupMessage] = useState("");
  const [speakerSetupError, setSpeakerSetupError] = useState("");
  const [pendingSpeakerFilePath, setPendingSpeakerFilePath] = useState<string | null>(null);
  const [speakerSetupIntent, setSpeakerSetupIntent] = useState<SpeakerSetupIntent | null>(null);
  const [speakerSetupForceRepair, setSpeakerSetupForceRepair] = useState(false);

  const isProcessing =
    status === "reading" ||
    status === "converting" ||
    status === "uploading" ||
    status === "preparing" ||
    status === "diarizing" ||
    status === "assembling" ||
    status === "transcribing";
  const progressPercent = getFileTranscriptionPercent(status, progress);

  const syncSpeakerSetupState = (settings: AppSettings): void => {
    const localWhisperOption = getDiarizationWhisperOption(settings);
    setDiarizationInstalled(settings.localModels?.[DIARIZATION_MODEL_ID]?.status === "downloaded");
    setLocalWhisperDownloaded(localWhisperOption !== null);
    setLocalWhisperLabel(localWhisperOption?.label || RECOMMENDED_LOCAL_WHISPER_LABEL);
  };

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    let mounted = true;

    getSettings({ reload: true })
      .then((settings) => {
        if (!mounted) return;

        settingsRef.current = settings;
        setSummaryAvailable(isSummaryAvailable(settings));
        setSpeakerDiarization(settings.fileSpeakerDiarization);
        syncSpeakerSetupState(settings);

        const validationRun = speakerDiarizationToggleRunRef.current;
        void (async () => {
          const syncedSettings = await refreshSpeakerInstalledModels(settings);

          if (!mounted) return;

          settingsRef.current = syncedSettings;
          setSummaryAvailable(isSummaryAvailable(syncedSettings));
          syncSpeakerSetupState(syncedSettings);
          if (speakerDiarizationToggleRunRef.current !== validationRun) {
            return;
          }

          if (syncedSettings.fileSpeakerDiarization && !isSpeakerSetupReady(syncedSettings)) {
            setSpeakerDiarization(false);
            void saveSettings({ fileSpeakerDiarization: false });
            return;
          }

          setSpeakerDiarization(syncedSettings.fileSpeakerDiarization);
        })();
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const content = liveResultContentRef.current;
    if (!liveCallEntry || !content) return;

    const frameId = requestAnimationFrame(() => {
      content.scrollTop = content.scrollHeight;
    });
    return () => cancelAnimationFrame(frameId);
  }, [liveCallEntry?.cleaned, liveCallEntry?.raw]);

  useEffect(() => {
    setCallStopRequested(false);
  }, [liveCallEntry?.id]);

  // Keep the summary availability in sync when the text model is changed from
  // the «Models» tab (same window) or another window.
  useEffect(() => {
    let mounted = true;
    const unlisten = listen(SETTINGS_UPDATED_EVENT, () => {
      void getSettings({ reload: true }).then((settings) => {
        if (mounted) setSummaryAvailable(isSummaryAvailable(settings));
      });
    });
    return () => {
      mounted = false;
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const resetResult = (): void => {
    setResultEntry(null);
    setError("");
    setConvertedInfo("");
    setProgress(null);
    setCopied(false);
    setResultExpanded(false);
  };

  const requestStopLiveCall = async (): Promise<void> => {
    if (!liveCallEntry || callStopRequested) return;

    setCallStopRequested(true);
    try {
      await emit(CALL_CAPTURE_STOP_REQUEST_EVENT, {
        entryId: liveCallEntry.id,
      });
    } catch {
      setCallStopRequested(false);
      setError(t("fileTab.live.stopFailed"));
    }
  };

  const showHistoryEntryResult = (entry: HistoryEntry, scrollToResult = false): void => {
    setSelectedFile({
      name: entry.fileName || t("fileTab.source.file"),
      size: entry.fileSize ?? null,
    });
    setError("");
    setConvertedInfo("");
    setProgress(null);
    setCopied(false);
    setResultExpanded(entry.mode === "speakers");
    setResultEntry(entry);
    setStatus("done");

    if (scrollToResult) {
      requestAnimationFrame(() => {
        resultSectionRef.current?.scrollIntoView({
          block: "start",
          behavior: "smooth",
        });
      });
    }
  };

  useEffect(() => {
    let mounted = true;
    void getHistory()
      .then((history) => {
        if (!mounted) return;
        const activeCall = [...history]
          .reverse()
          .find(
            (entry) =>
              entry.source === "call" &&
              (entry.status === "recording" || entry.callCapturePhase === "finalizing"),
          );
        setLiveCallEntry(activeCall || null);
      })
      .catch(() => {});

    const unlistenPromise = listen<HistoryEntry>(HISTORY_UPDATED_EVENT, ({ payload }) => {
      if (payload.source === "call") {
        const isActive =
          payload.status === "recording" || payload.callCapturePhase === "finalizing";
        setLiveCallEntry((current) =>
          isActive ? payload : current?.id === payload.id ? null : current,
        );
      }

      if (
        isProcessingRef.current ||
        (payload.source !== "file" && payload.source !== "call") ||
        payload.status !== "completed"
      ) {
        return;
      }

      showHistoryEntryResult(payload);
    });

    return () => {
      mounted = false;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!focusedEntryId) {
      return;
    }

    let mounted = true;

    const showFocusedEntry = async (): Promise<void> => {
      try {
        const history = await getHistory();
        const entry = history.find((item) => item.id === focusedEntryId);

        if (!mounted || !entry) {
          return;
        }

        showHistoryEntryResult(entry, true);
      } catch (caughtError) {
        if (!mounted) {
          return;
        }

        setError(toFileTranscriptionErrorMessage(caughtError));
        setStatus("error");
      }
    };

    void showFocusedEntry();

    return () => {
      mounted = false;
    };
  }, [focusedEntryId]);

  const processFile = async (file: File): Promise<void> => {
    setSelectedFile({ name: file.name, size: file.size });
    resetResult();
    setStatus("reading");
    let activeSettings: AppSettings | null = null;

    try {
      if (speakerDiarization) {
        throw new Error(t("fileTab.error.speakerNeedsDialog"));
      }
      const settings = await getSettings();
      activeSettings = settings;
      const startedAt = Date.now();
      const transcription = await transcribeFileOnly({
        file,
        settings,
        onStatus: setStatus,
      });
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        duration: 0,
        raw: transcription.text,
        cleaned: transcription.text,
        source: "file",
        fileName: file.name,
        fileSize: file.size,
        status: "completed",
        processingTime: Date.now() - startedAt,
        mode: "plain",
      };

      await addHistoryEntry(entry);
      await emit(HISTORY_UPDATED_EVENT, entry);
      setResultEntry(entry);
      setConvertedInfo(
        transcription.converted
          ? t("fileTab.convertedInfo", {
              name: transcription.uploadedFileName,
              size: formatFileSize(transcription.uploadedSizeBytes),
            })
          : "",
      );
      setStatus("done");
    } catch (caughtError) {
      setError(
        toFileTranscriptionErrorMessage(caughtError, {
          settings: activeSettings,
        }),
      );
      setStatus("error");
    }
  };

  const processFilePath = async (
    filePath: string,
    speakerMode = speakerDiarization,
  ): Promise<void> => {
    const fileName = fileNameFromPath(filePath);
    setSelectedFile({ name: fileName, size: null });
    resetResult();
    setStatus("idle");

    try {
      const settings = await refreshSpeakerInstalledModels(await getSettings({ reload: true }));
      settingsRef.current = settings;
      syncSpeakerSetupState(settings);

      if (speakerMode && !isSpeakerSetupReady(settings)) {
        setPendingSpeakerFilePath(filePath);
        setSpeakerSetupIntent("process");
        setSpeakerSetupMessage("");
        setSpeakerSetupError("");
        setSpeakerSetupModalOpen(true);
        return;
      }

      setStatus("preparing");
      const startedAt = Date.now();
      const transcription = await transcribeFilePathOnly({
        filePath,
        settings,
        onStatus: setStatus,
        onProgress: setProgress,
        speakerDiarization: speakerMode,
        identifyFirstSpeakerAsUser: true,
      });
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        duration: 0,
        raw: transcription.text,
        cleaned: transcription.text,
        source: "file",
        fileName,
        status: "completed",
        processingTime: Date.now() - startedAt,
        mode: transcription.mode,
        speakers: transcription.speakers,
        segments: transcription.segments,
      };

      await addHistoryEntry(entry);
      await emit(HISTORY_UPDATED_EVENT, entry);
      setResultEntry(entry);
      setConvertedInfo("");
      setStatus("done");
    } catch (caughtError) {
      if (speakerMode && isSpeakerSetupRepairError(caughtError)) {
        setSpeakerDiarization(false);
        await saveSettings({ fileSpeakerDiarization: false });
        setPendingSpeakerFilePath(filePath);
        setSpeakerSetupIntent("process");
        setSpeakerSetupForceRepair(true);
        setSpeakerSetupMessage("");
        setSpeakerSetupError(
          toFileTranscriptionErrorMessage(caughtError, {
            settings: settingsRef.current,
          }),
        );
        setSpeakerSetupModalOpen(true);
        setStatus("idle");
        return;
      }

      setError(
        toFileTranscriptionErrorMessage(caughtError, {
          settings: settingsRef.current,
        }),
      );
      setStatus("error");
    }
  };

  processFilePathRef.current = processFilePath;

  useEffect(() => {
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        if (!isProcessingRef.current) {
          setIsDragOver(true);
        }
        return;
      }

      if (event.payload.type === "leave") {
        setIsDragOver(false);
        return;
      }

      setIsDragOver(false);
      nativeDropAtRef.current = Date.now();

      const filePath = event.payload.paths[0];
      if (!filePath || isProcessingRef.current) {
        return;
      }

      void processFilePathRef.current(filePath);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const openFileDialog = async (): Promise<void> => {
    if (isProcessing) return;

    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: t("fileTab.dialog.audioVideoFilter"),
            extensions: [
              "mp3",
              "wav",
              "m4a",
              "mp4",
              "mov",
              "webm",
              "ogg",
              "flac",
              "mpeg",
              "mpga",
              "avi",
              "mkv",
            ],
          },
        ],
      });

      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath === "string" && filePath.trim()) {
        void processFilePath(filePath);
      }
    } catch (caughtError) {
      setError(toFileTranscriptionErrorMessage(caughtError));
      setStatus("error");
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (file) {
      void processFile(file);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragOver(false);

    if (Date.now() - nativeDropAtRef.current < 1000) {
      return;
    }

    const file = event.dataTransfer.files?.[0];
    if (file) {
      void processFile(file);
    }
  };

  const copyResult = async (): Promise<void> => {
    if (!resultEntry?.cleaned) return;

    await navigator.clipboard.writeText(resultEntry.cleaned);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const installSpeakerSetup = async (): Promise<void> => {
    if (speakerSetupInstalling) return;

    setSpeakerSetupInstalling(true);
    setSpeakerSetupMessage(t("fileTab.setup.preparing"));
    setSpeakerSetupError("");
    try {
      let settings = await getSettings({ reload: true });
      const now = new Date().toISOString();
      const nextLocalModels = { ...(settings.localModels || {}) };

      if (!getDiarizationWhisperOption(settings)) {
        setSpeakerSetupMessage(
          t("fileTab.setup.downloading", {
            name: RECOMMENDED_LOCAL_WHISPER_LABEL,
          }),
        );
        const whisperResult = await invoke<{
          success: boolean;
          message: string;
          whisper_endpoint?: string | null;
        }>("install_stt_model", {
          req: {
            api_key: settings.apiKey || "",
            whisper_api_key: settings.whisperApiKey || null,
            whisper_endpoint: LOCAL_WHISPER_ENDPOINT,
            local_models_dir: settings.localModelsDir || null,
            whisper_model: LOCAL_WHISPER_MODEL_ID,
          },
        });

        if (!whisperResult.success) {
          throw new Error(whisperResult.message);
        }

        nextLocalModels[LOCAL_WHISPER_MODEL_ID] = {
          status: "downloaded",
          downloadedAt: now,
          lastCheckedAt: now,
        };

        await saveSettings({ localModels: nextLocalModels });
        settings = await getSettings({ reload: true });
      }

      if (
        speakerSetupForceRepair ||
        settings.localModels?.[DIARIZATION_MODEL_ID]?.status !== "downloaded"
      ) {
        setSpeakerSetupMessage(
          speakerSetupForceRepair
            ? t("fileTab.setup.repairing")
            : t("fileTab.setup.downloadingDiarization"),
        );
        const speakerResult = await invoke<{
          success: boolean;
          message: string;
        }>("install_stt_model", {
          req: {
            api_key: settings.apiKey || "",
            whisper_api_key: settings.whisperApiKey || null,
            whisper_endpoint: "http://127.0.0.1:8003",
            local_models_dir: settings.localModelsDir || null,
            whisper_model: DIARIZATION_MODEL_ID,
          },
        });

        if (!speakerResult.success) {
          throw new Error(speakerResult.message);
        }

        const refreshedSettings = await getSettings({ reload: true });
        await saveSettings({
          localModels: {
            ...(refreshedSettings.localModels || {}),
            [DIARIZATION_MODEL_ID]: {
              status: "downloaded",
              downloadedAt: new Date().toISOString(),
              lastCheckedAt: new Date().toISOString(),
            },
          },
        });
      }

      const finalSettings = await getSettings({ reload: true });
      settingsRef.current = finalSettings;
      syncSpeakerSetupState(finalSettings);
      setSpeakerSetupMessage(
        speakerSetupIntent === "toggle" ? t("fileTab.setup.done") : t("fileTab.setup.doneContinue"),
      );
      setSpeakerSetupError("");
      setError("");
      setSpeakerSetupModalOpen(false);
      setSpeakerSetupForceRepair(false);
      setSpeakerDiarization(true);
      await saveSettings({ fileSpeakerDiarization: true });

      if (speakerSetupIntent === "toggle") {
        setSpeakerSetupIntent(null);
        return;
      }

      if (pendingSpeakerFilePath) {
        const filePath = pendingSpeakerFilePath;
        setPendingSpeakerFilePath(null);
        setStatus("preparing");
        void processFilePath(filePath, true);
      }
      setSpeakerSetupIntent(null);
    } catch (caughtError) {
      setSpeakerSetupError(toSpeakerSetupErrorMessage(caughtError, t, settingsRef.current));
    } finally {
      setSpeakerSetupInstalling(false);
    }
  };

  const renameSpeaker = async (speakerId: string, label: string): Promise<void> => {
    if (!resultEntry?.segments || !resultEntry.speakers) return;

    const nextSpeakers = resultEntry.speakers.map((speaker) =>
      speaker.id === speakerId ? { ...speaker, label } : speaker,
    );
    const nextSegments = resultEntry.segments.map((segment) =>
      segment.speakerId === speakerId ? { ...segment, speakerLabel: label } : segment,
    );
    const nextText = formatSpeakerTranscript(nextSegments);
    const nextEntry: HistoryEntry = {
      ...resultEntry,
      raw: nextText,
      cleaned: nextText,
      speakers: nextSpeakers,
      segments: nextSegments,
      mode: "speakers",
    };

    setResultEntry(nextEntry);
    await updateHistoryEntry(nextEntry);
    await emit(HISTORY_UPDATED_EVENT, nextEntry);
  };

  const toggleSpeakerDiarization = (): void => {
    const runId = speakerDiarizationToggleRunRef.current + 1;
    speakerDiarizationToggleRunRef.current = runId;
    const isCurrentToggleRun = (): boolean => speakerDiarizationToggleRunRef.current === runId;

    if (speakerDiarization) {
      setSpeakerDiarization(false);
      void saveSettings({ fileSpeakerDiarization: false });
      return;
    }

    setError("");
    setSpeakerDiarization(true);
    void saveSettings({ fileSpeakerDiarization: true });

    const cachedSettings = settingsRef.current;
    if (!cachedSettings) {
      setPendingSpeakerFilePath(null);
      setSpeakerSetupIntent("toggle");
      setSpeakerSetupMessage("");
      setSpeakerSetupError("");
      setSpeakerSetupModalOpen(true);
    } else if (!isSpeakerSetupReady(cachedSettings)) {
      setPendingSpeakerFilePath(null);
      setSpeakerSetupIntent("toggle");
      setSpeakerSetupMessage("");
      setSpeakerSetupError("");
      setSpeakerSetupModalOpen(true);
    }

    void (async () => {
      try {
        const settings = await refreshSpeakerInstalledModels(await getSettings({ reload: true }));
        if (!isCurrentToggleRun()) {
          return;
        }

        settingsRef.current = settings;
        syncSpeakerSetupState(settings);

        if (isSpeakerSetupReady(settings)) {
          setSpeakerSetupModalOpen(false);
          setSpeakerSetupIntent(null);
          return;
        }

        setPendingSpeakerFilePath(null);
        setSpeakerSetupIntent("toggle");
        setSpeakerSetupMessage("");
        setSpeakerSetupError("");
        setSpeakerSetupModalOpen(true);
      } catch (caughtError) {
        if (!isCurrentToggleRun()) {
          return;
        }

        setSpeakerSetupModalOpen(false);
        setSpeakerSetupIntent(null);
        setError(
          toFileTranscriptionErrorMessage(caughtError, {
            settings: settingsRef.current,
          }),
        );
        setSpeakerDiarization(false);
        await saveSettings({ fileSpeakerDiarization: false });
        return;
      }
    })();
  };

  const displayedResultEntry = liveCallEntry || resultEntry;
  const resultText = displayedResultEntry?.cleaned || displayedResultEntry?.raw || "";
  const shouldCollapseResult = !liveCallEntry && resultText.length > RESULT_PREVIEW_LIMIT;
  const visibleResult =
    shouldCollapseResult && !resultExpanded
      ? `${resultText.slice(0, RESULT_PREVIEW_LIMIT).trimEnd()}...`
      : resultText;
  const speakerSetupActionLabel = t("common.download");
  const closeSpeakerSetupModal = (): void => {
    if (speakerSetupInstalling) return;

    if (speakerSetupIntent === "toggle") {
      speakerDiarizationToggleRunRef.current += 1;
      setSpeakerDiarization(false);
      void saveSettings({ fileSpeakerDiarization: false });
    }

    setSpeakerSetupModalOpen(false);
    setPendingSpeakerFilePath(null);
    setSpeakerSetupIntent(null);
    setSpeakerSetupForceRepair(false);
  };

  return (
    <div className="ui-tab">
      <div className="ui-page-header">
        <h2 className="ui-page-header__title">{t("fileTab.heading")}</h2>
        <div className="ui-page-header__desc">{t("fileTab.subheading")}</div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov,.webm,.ogg,.flac,.mpeg,.mpga,.avi,.mkv"
        onChange={handleInputChange}
        style={{ display: "none" }}
      />

      {!liveCallEntry ? (
        <>
          {/* biome-ignore lint/a11y/useSemanticElements: file drop zone needs drag-and-drop handlers and a large layout; a <button> cannot host them. */}
          <section
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the drop zone intentionally exposes button semantics on a <section>.
            role="button"
            tabIndex={isProcessing ? -1 : 0}
            className={`ui-dropzone${isDragOver ? " ui-dropzone--over" : ""}${
              isProcessing ? " ui-dropzone--busy" : ""
            }`}
            onClick={() => {
              if (!isProcessing) {
                void openFileDialog();
              }
            }}
            onKeyDown={(event) => {
              if (isProcessing || (event.key !== "Enter" && event.key !== " ")) {
                return;
              }

              event.preventDefault();
              void openFileDialog();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="ui-dropzone__content">
              <div className="ui-dropzone__icon">
                {isProcessing ? (
                  <Spinner size={24} label={t("fileTab.heading")} />
                ) : (
                  <IconFileMusic size={25} stroke={1.8} />
                )}
              </div>

              <div className="ui-dropzone__text">
                <div className="ui-dropzone__name">
                  {selectedFile ? selectedFile.name : t("fileTab.dropzone.title")}
                </div>
                <div className="ui-dropzone__status">
                  {selectedFile
                    ? `${selectedFile.size !== null ? `${formatFileSize(selectedFile.size)} · ` : ""}${statusLabel(status, progress, t)}${isProcessing ? ` · ${progressPercent}%` : ""}`
                    : t("fileTab.dropzone.hint")}
                </div>
                {convertedInfo && <div className="ui-dropzone__converted">{convertedInfo}</div>}
              </div>

              {isProcessing && (
                <div className="ui-dropzone__progress">
                  <ProgressBar value={progressPercent / 100} ariaLabel={t("fileTab.heading")} />
                </div>
              )}

              {error && (
                <div className="ui-inline-error">
                  <IconAlertCircle size={16} stroke={2} />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </section>

          <section className="ui-form-group ui-section-row">
            <div>
              <div className="ui-section-row__title">{t("fileTab.speaker.toggleTitle")}</div>
              <div className="ui-section-row__desc">{t("fileTab.speaker.toggleDesc")}</div>
            </div>
            <Toggle
              size="large"
              checked={speakerDiarization}
              disabled={isProcessing}
              ariaLabel={t("fileTab.speaker.toggleTitle")}
              onChange={() => {
                void toggleSpeakerDiarization();
              }}
            />
          </section>
        </>
      ) : null}

      <section ref={resultSectionRef} className="ui-result">
        <div className="ui-result__header">
          <div className="ui-result__title">{t("fileTab.result.title")}</div>

          <div className="ui-result__actions">
            {liveCallEntry ? (
              <Button
                variant="destructive"
                disabled={callStopRequested || liveCallEntry.callCapturePhase === "finalizing"}
                onClick={() => {
                  void requestStopLiveCall();
                }}
              >
                {callStopRequested || liveCallEntry.callCapturePhase === "finalizing" ? (
                  <Spinner size={13} label={t("fileTab.live.stopping")} />
                ) : (
                  <IconSquare size={11} stroke={2} fill="currentColor" />
                )}
                {callStopRequested || liveCallEntry.callCapturePhase === "finalizing"
                  ? t("fileTab.live.stopping")
                  : t("fileTab.live.stop")}
              </Button>
            ) : null}

            {!liveCallEntry && resultEntry && (
              <Button
                onClick={() => {
                  void copyResult();
                }}
              >
                {copied ? (
                  <IconCheck size={13} stroke={2.2} />
                ) : (
                  <IconClipboard size={13} stroke={2} />
                )}
                {copied ? t("fileTab.result.copied") : t("fileTab.result.copy")}
              </Button>
            )}

            {!liveCallEntry && resultEntry && (
              <Button
                disabled={!summaryAvailable}
                title={summaryAvailable ? undefined : t("summary.unavailable.tooltip")}
                onClick={() => setSummaryOpen(true)}
              >
                <IconListCheck size={13} stroke={2} />
                {t("summary.button")}
              </Button>
            )}

            {!liveCallEntry && (resultEntry || error || selectedFile) && !isProcessing && (
              <Button
                aria-label={t("fileTab.result.clear")}
                title={t("fileTab.result.clear")}
                onClick={() => {
                  setSelectedFile(null);
                  setStatus("idle");
                  resetResult();
                }}
              >
                <IconX size={14} stroke={2} />
              </Button>
            )}
          </div>
        </div>

        {!liveCallEntry && resultEntry && !summaryAvailable && (
          <div className="ui-inline-note">
            <IconAlertCircle size={14} stroke={2} />
            <span>{t("summary.unavailable.note")}</span>
          </div>
        )}

        {!liveCallEntry && summaryOpen && resultEntry && summaryAvailable && (
          <SummaryModal
            entry={resultEntry}
            onClose={() => setSummaryOpen(false)}
            onEntryChange={setResultEntry}
          />
        )}

        {displayedResultEntry ? (
          displayedResultEntry.mode === "speakers" &&
          (liveCallEntry || displayedResultEntry.segments?.length) ? (
            <div className="ui-result__speakers">
              {displayedResultEntry.speakers?.length ? (
                <div className="ui-speaker-list">
                  {displayedResultEntry.speakers.map((speaker) => (
                    <SpeakerNameInput
                      key={speaker.id}
                      value={speaker.label}
                      ariaLabel={t("fileTab.speaker.nameAria", {
                        name: speaker.label,
                      })}
                      readOnly={Boolean(liveCallEntry)}
                      onCommit={(label) => renameSpeaker(speaker.id, label)}
                    />
                  ))}
                </div>
              ) : null}
              <div
                ref={liveCallEntry ? liveResultContentRef : undefined}
                className={`ui-transcript${liveCallEntry ? " ui-transcript--scroll" : ""}`}
              >
                {displayedResultEntry.segments?.map((segment, index) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: segments can share speaker and start time; the index keeps the key unique.
                    key={`${segment.speakerId}-${segment.start}-${index}`}
                    className="ui-transcript__segment"
                  >
                    <div className="ui-transcript__time">{formatTimestamp(segment.start)}</div>
                    <div className="ui-transcript__body">
                      <div className="ui-transcript__speaker">{segment.speakerLabel}</div>
                      <div className="ui-transcript__text">{segment.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <table className="b-table">
              <thead>
                <tr>
                  <th style={{ width: 92 }}>{t("fileTab.table.time")}</th>
                  <th style={{ paddingLeft: 8 }}>{t("fileTab.table.text")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="ui-result__time-cell">
                    <div className="ui-history__time">
                      <span>
                        {new Date(displayedResultEntry.timestamp).toLocaleTimeString("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="ui-history__time-meta">
                        {resultSourceLabel(displayedResultEntry, t)}
                      </span>
                    </div>
                  </td>
                  <td className="ui-history__text-cell">
                    <div
                      ref={liveCallEntry ? liveResultContentRef : undefined}
                      className={`ui-expandable-text${
                        liveCallEntry ? " ui-expandable-text--scroll" : ""
                      }`}
                    >
                      <span>{visibleResult || t("fileTab.result.empty")}</span>
                      {shouldCollapseResult && (
                        <button
                          type="button"
                          className="ui-disclosure-link"
                          onClick={() => setResultExpanded((current) => !current)}
                        >
                          {resultExpanded
                            ? t("fileTab.result.collapse")
                            : t("fileTab.result.expand")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          )
        ) : (
          <div className="ui-result__empty">{t("fileTab.result.empty")}</div>
        )}
      </section>

      {speakerSetupModalOpen && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: modal scrim closes on click; keyboard users have the Escape handler and the dialog controls.
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="speaker-setup-title"
          className="ui-modal-scrim"
          onClick={closeSpeakerSetupModal}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click handler only stops propagation so clicks inside the dialog do not close it. */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the click handler only stops propagation so clicks inside the dialog do not close it. */}
          <div className="ui-modal" onClick={(event) => event.stopPropagation()}>
            <div id="speaker-setup-title" className="ui-modal__title">
              {t("fileTab.modal.title")}
            </div>
            <div className="ui-modal__body">
              {localWhisperDownloaded
                ? t("fileTab.modal.descDownloaded", { name: localWhisperLabel })
                : t("fileTab.modal.descNeedDownload", {
                    name: RECOMMENDED_LOCAL_WHISPER_LABEL,
                  })}
            </div>

            <div className="ui-modal__requirements">
              <div
                className={`ui-requirement${localWhisperDownloaded ? " ui-requirement--ready" : ""}`}
              >
                {localWhisperDownloaded ? (
                  <IconCheck size={15} stroke={2.2} />
                ) : (
                  <IconAlertCircle size={15} stroke={2} />
                )}
                <span>
                  {localWhisperDownloaded
                    ? t("fileTab.modal.whisperReady", {
                        name: localWhisperLabel,
                      })
                    : t("fileTab.modal.whisperWillDownload", {
                        name: RECOMMENDED_LOCAL_WHISPER_LABEL,
                      })}
                </span>
              </div>
              <div
                className={`ui-requirement${diarizationInstalled ? " ui-requirement--ready" : ""}`}
              >
                {diarizationInstalled ? (
                  <IconCheck size={15} stroke={2.2} />
                ) : (
                  <IconAlertCircle size={15} stroke={2} />
                )}
                <span>
                  {diarizationInstalled
                    ? t("fileTab.modal.diarizationReady")
                    : t("fileTab.modal.diarizationWillDownload")}
                </span>
              </div>
            </div>

            {(speakerSetupMessage || speakerSetupError) && (
              <div
                className={`ui-modal__message${
                  speakerSetupError ? " ui-modal__message--error" : ""
                }`}
              >
                {speakerSetupError || speakerSetupMessage}
              </div>
            )}

            <div className="ui-modal__actions">
              <Button disabled={speakerSetupInstalling} onClick={closeSpeakerSetupModal}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={speakerSetupInstalling}
                onClick={() => {
                  void installSpeakerSetup();
                }}
              >
                {speakerSetupInstalling ? <Spinner size={14} /> : null}
                {speakerSetupActionLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
