import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildCallLiveSpeakerTranscript,
  type CallCaptureSession,
  checkpointCallTranscription,
  formatCallLiveTranscript,
  pauseCallCaptureMic,
  restoreInterruptedCallCaptureHistory,
  resumeCallCaptureMic,
  saveCallCaptureMicTrack,
  saveFailedCallCaptureEntry,
  startCallCapture,
  stopCallCapture,
  transcribeCallCaptureSession,
} from "../../lib/callCapture";
import { buildCleanupMenuModel, selectCleanupPreset, toggleCleanup } from "../../lib/cleanupToggle";
import {
  type FileTranscriptionProgress,
  type FileTranscriptionStatus,
  fileNameFromPath,
  toFileTranscriptionErrorMessage,
  transcribeFilePathOnly,
} from "../../lib/fileTranscription";
import {
  APP_DATA_MIGRATION_ERROR_EVENT,
  CALL_CAPTURE_STOP_REQUEST_EVENT,
  type CallCaptureStopRequestPayload,
  DICTATION_STREAM_UPDATE_EVENT,
  type DictationStreamUpdatePayload,
  HISTORY_CLEARED_EVENT,
  HISTORY_DELETED_EVENT,
  HISTORY_UPDATED_EVENT,
  PROCESSING_CANCEL_REQUEST_EVENT,
  type ProcessingCancelRequestPayload,
  SETTINGS_UPDATED_EVENT,
  WIDGET_RETRY_PROCESSING_EVENT,
  type WidgetRetryProcessingPayload,
} from "../../lib/hotkeyEvents";
import { tn, useI18n } from "../../lib/i18n";
import { logError, logInfo } from "../../lib/logger";
import { requestSystemAudioPermission, requiresSystemAudioPermission } from "../../lib/permissions";
import {
  beginProcessing,
  cancelProcessing,
  finishProcessing,
  isAbortError,
} from "../../lib/processingControl";
import {
  addHistoryEntry,
  DEFAULT_SELECTION_TRANSLATION_HOTKEY,
  getHistory,
  getSettings,
  type HistoryEntry,
  reconcileInterruptedProcessing,
  type TranslationSettings,
  updateHistoryEntry,
} from "../../lib/store";
import { setTrayRecording } from "../../lib/tray";
import { scaleWidgetDimension } from "../../lib/widgetScale";
import { useWidgetController } from "./hooks/useWidgetController";
import { IslandPresentation } from "./island/IslandPresentation";
import {
  applyStoredWidgetPresentation,
  ISLAND_ANCHOR_EVENT,
  ISLAND_NOTICE_EVENT,
  type IslandAnchor,
  isIslandPresentationActive,
  setIslandPresentationActive,
} from "./island/islandSession";
import { type IslandNotice, islandNoticeIsInteractive, mapIslandState } from "./island/islandState";
import {
  PillPresentation,
  type WidgetCallState,
  type WidgetFileDropState,
  type WidgetLiveTranslationState,
} from "./pill/PillPresentation";
import { requestCallMicrophoneStream, resolveCallMicrophoneLabel } from "./services/callMicrophone";
import {
  createCallLiveDictationOptions,
  warmUpLiveDictationRuntime,
} from "./services/dictationStreamOverlay";
import {
  applyLiveTranslationEvent,
  buildLiveTranslationHistoryEntry,
  createLiveTranslationOverlayState,
  type LiveTranslationEventPayload,
  type LiveTranslationOverlayState,
  liveTranslationVisibleSegments,
  resolveLiveTranslationConnection,
} from "./services/liveTranslation";
import {
  createLiveTranslationOverlayRenderer,
  type LiveTranslationOverlayRenderer,
} from "./services/liveTranslationOverlayRenderer";
import { createRecordingRuntimeController } from "./services/recordingRuntime";
import { showWidgetErrorOverlay } from "./services/widgetErrorOverlay";
import { stackWidthWithTicker, tickerFollowsTail, tickerLine } from "./ticker/tickerText";
import {
  shouldAutoDismissTextOverlay,
  TEXT_OVERLAY_AUTO_DISMISS_MS,
  TEXT_OVERLAY_EVENT,
  type WidgetTextOverlayState,
  widgetStackHeight,
  widgetStackWidth,
} from "./widgetConstants";

const FILE_DROP_LEAVE_GRACE_MS = 260;
const FILE_DROP_CLOSE_ANIMATION_MS = 160;

type WidgetRetryProcessingSource = WidgetRetryProcessingPayload["source"];

interface CallTranscriptRuntime {
  entry: HistoryEntry;
  sessionId: string | null;
  micRequestId: string | null;
  systemRequestId: string | null;
  micText: string;
  systemText: string;
  channelStartedAt: Record<"mic" | "system", number | null>;
  lastCheckpointAt: Record<"mic" | "system", number>;
  lastUiEmitAt: number;
}

const CALL_DRAFT_CHECKPOINT_MS = 5_000;

const DEFAULT_TRANSLATION_SETTINGS: TranslationSettings = {
  widgetEnabled: false,
  active: false,
  targetLanguage: "en",
  selectionTargetLanguage: "en",
  selectionTargetMigrationVersion: 1,
  selectionEnabled: false,
  selectionHotkey: DEFAULT_SELECTION_TRANSLATION_HOTKEY,
  selectionLocalTranslatorProvider: "",
  selectionEnableMigrationVersion: 1,
  liveWidgetEnabled: false,
  liveMicrophoneEnabled: false,
  liveTargetLanguage: "en",
  liveVoiceEnabled: false,
  liveVoice: "marin",
  liveVoiceVolume: 0.8,
  liveVoiceSpeed: 1.05,
  liveMuteOriginalEnabled: true,
};
class CallCaptureStartError extends Error {
  readonly permissionRelated: boolean;
  readonly rawCause: unknown;

  constructor(message: string, permissionRelated = false, rawCause?: unknown) {
    super(message);
    this.name = "CallCaptureStartError";
    this.permissionRelated = permissionRelated;
    this.rawCause = rawCause;
  }
}

function getCopyableText(entry: HistoryEntry | null | undefined): string | null {
  if (!entry || entry.status === "failed") {
    return null;
  }

  const cleaned = entry.cleaned.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.stop();
  });
}

function isPermissionDeniedError(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }

  return error.name === "NotAllowedError" || error.name === "SecurityError";
}

function isSelectedMicUnavailableError(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }

  return error.name === "NotFoundError" || error.name === "OverconstrainedError";
}

function microphoneStartErrorMessage(error: unknown): string {
  if (isPermissionDeniedError(error)) {
    return tn("widget.mic.permissionDenied");
  }

  if (error instanceof DOMException && error.name === "NotReadableError") {
    return tn("widget.mic.busy");
  }

  if (isSelectedMicUnavailableError(error)) {
    return tn("widget.mic.unavailable");
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return tn("widget.mic.startTimeout");
  }

  return tn("widget.mic.accessFailed");
}

function formatCallCaptureRawError(error: unknown): string {
  const source = error instanceof CallCaptureStartError && error.rawCause ? error.rawCause : error;

  if (source instanceof DOMException) {
    const constraint =
      "constraint" in source && typeof source.constraint === "string"
        ? `, constraint=${source.constraint}`
        : "";
    return `${source.name}: ${source.message || "[no message]"}${constraint}`;
  }

  if (source instanceof Error) {
    return `${source.name}: ${source.message}`;
  }

  return String(source);
}

function callCaptureStartErrorMessage(error: unknown): string {
  if (error instanceof CallCaptureStartError) {
    return error.message;
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes("audiohardwarecreateprocesstap") ||
    normalized.includes("audiodevicestart") ||
    normalized.includes("звука системы") ||
    normalized.includes("system audio")
  ) {
    return tn("widget.call.systemAudioPermission");
  }

  return tn("widget.call.startFailed");
}

function isCallCapturePermissionError(error: unknown): boolean {
  if (error instanceof CallCaptureStartError) {
    return error.permissionRelated;
  }

  if (isPermissionDeniedError(error)) {
    return true;
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalized = rawMessage.toLowerCase();
  return (
    normalized.includes("audiohardwarecreateprocesstap") ||
    normalized.includes("audiodevicestart") ||
    normalized.includes("звука системы") ||
    normalized.includes("system audio")
  );
}

export function Widget(): ReactNode {
  const { t } = useI18n();
  const widgetWindow = getCurrentWindow();
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragTriggeredRef = useRef(false);
  const callMicRuntimeRef = useRef(createRecordingRuntimeController());
  const callSessionRef = useRef<CallCaptureSession | null>(null);
  const callTranscriptRuntimeRef = useRef<CallTranscriptRuntime | null>(null);
  const callTranscriptPersistQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Ids of the entries currently being processed in this window, so a stop
  // request from the table can reset the matching widget UI immediately (a local
  // `invoke` keeps running and would otherwise leave the spinner going).
  const callProcessingIdRef = useRef<string | null>(null);
  const fileProcessingIdRef = useRef<string | null>(null);
  const callMicPausedForVoiceRef = useRef(false);
  const callSystemAudioPermissionReadyRef = useRef(false);
  const callStateRef = useRef<WidgetCallState>("idle");
  const liveTranslationStateRef = useRef<WidgetLiveTranslationState>("idle");
  const liveOverlayRef = useRef<LiveTranslationOverlayState | null>(null);
  const pendingLiveEventsRef = useRef<LiveTranslationEventPayload[]>([]);
  const liveOverlayRendererRef = useRef<LiveTranslationOverlayRenderer | null>(null);
  const liveStartedAtRef = useRef(0);
  const liveAdapterIdRef = useRef("unknown");
  const liveAudioWatchdogTimerRef = useRef<number | null>(null);
  const stopLiveTranslationRef = useRef<() => Promise<void>>(async () => {});
  const stopCallListeningRef = useRef<() => Promise<void>>(async () => {});
  const pauseCallMicForVoice = useCallback(() => {
    if (callStateRef.current !== "recording") {
      return;
    }

    callMicPausedForVoiceRef.current = true;
    const callSession = callSessionRef.current;
    if (callSession?.nativeMicActive) {
      void pauseCallCaptureMic(callSession.id)
        .then((paused) => {
          if (paused) {
            logInfo("CALL_CAPTURE", "Paused native call mic while voice recording");
          }
        })
        .catch((error) => {
          logError(
            "CALL_CAPTURE",
            `Failed to pause native call mic: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      return;
    }
    if (callMicRuntimeRef.current.pause()) {
      logInfo("CALL_CAPTURE", "Paused call mic while voice recording");
    }
  }, []);
  const resumeCallMicForVoice = useCallback(() => {
    if (!callMicPausedForVoiceRef.current) {
      return;
    }

    callMicPausedForVoiceRef.current = false;
    const callSession = callSessionRef.current;
    if (callSession?.nativeMicActive) {
      void resumeCallCaptureMic(callSession.id)
        .then((resumed) => {
          if (resumed) {
            logInfo("CALL_CAPTURE", "Resumed native call mic after voice recording");
          }
        })
        .catch((error) => {
          logError(
            "CALL_CAPTURE",
            `Failed to resume native call mic: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      return;
    }
    if (callMicRuntimeRef.current.resume()) {
      logInfo("CALL_CAPTURE", "Resumed call mic after voice recording");
    }
  }, []);
  const {
    cleanupEnabled,
    state,
    stream,
    lockedRecording,
    widgetScale,
    resizeWidget,
    toggleManualRecording,
  } = useWidgetController({
    onVoiceRecordingProcessing: resumeCallMicForVoice,
    onVoiceRecordingStart: pauseCallMicForVoice,
    onVoiceRecordingStartFailed: resumeCallMicForVoice,
  });
  const stateRef = useRef(state);
  const fileDropStateRef = useRef<WidgetFileDropState>("idle");
  const retryProcessingSourceRef = useRef<WidgetRetryProcessingSource | null>(null);
  const fileResetTimerRef = useRef<number | null>(null);
  const fileDragLeaveTimerRef = useRef<number | null>(null);
  const fileCloseTimerRef = useRef<number | null>(null);
  const fileDragDepthRef = useRef(0);
  const fileDropExpandedRef = useRef(false);
  const translationSettingsRef = useRef<TranslationSettings>(DEFAULT_TRANSLATION_SETTINGS);
  if (!liveOverlayRendererRef.current) {
    liveOverlayRendererRef.current = createLiveTranslationOverlayRenderer({
      isActive: (sessionId) => liveOverlayRef.current?.sessionId === sessionId,
      render: async (next) => {
        await invoke("show_widget_text_overlay", {
          payload: {
            status: "liveTranslation",
            sourceText: "",
            translatedText: "",
            targetLanguage: translationSettingsRef.current.liveTargetLanguage,
            requestId: next.sessionId,
            message: next.error,
            liveSegments: liveTranslationVisibleSegments(next),
          },
        });
      },
      onError: (error) => {
        logError("LIVE_TRANSLATION", `Failed to update overlay: ${error}`);
      },
    });
  }
  const fileProcessRef = useRef<(filePath: string) => Promise<void>>(async () => {});
  const [latestCopyText, setLatestCopyText] = useState<string | null>(null);
  const [pendingFileResultId, setPendingFileResultId] = useState<string | null>(null);
  const [fileDropState, setFileDropState] = useState<WidgetFileDropState>("idle");
  const [fileDropName, setFileDropName] = useState("");
  const [fileStatus, setFileStatus] = useState<FileTranscriptionStatus | null>(null);
  const [fileProgress, setFileProgress] = useState<FileTranscriptionProgress | null>(null);
  const [callState, setCallState] = useState<WidgetCallState>("idle");
  const [callSession, setCallSession] = useState<CallCaptureSession | null>(null);
  const [callStartedAt, setCallStartedAt] = useState<number>(0);
  const [callError, setCallError] = useState<string>("");
  const [appliedMode, setAppliedMode] = useState<"pill" | "island">("pill");
  const [islandAnchor, setIslandAnchor] = useState<IslandAnchor | null>(null);
  const [islandNotice, setIslandNotice] = useState<IslandNotice | null>(null);
  const [islandDone, setIslandDone] = useState(false);
  const [islandElapsedMs, setIslandElapsedMs] = useState(0);
  const [textDisplay, setTextDisplay] = useState<"window" | "ticker">("window");
  const [tickerPayload, setTickerPayload] = useState<WidgetTextOverlayState | null>(null);
  const appliedModeRef = useRef(appliedMode);
  const wasIslandProcessingRef = useRef(false);
  const [callSettings, setCallSettings] = useState<Awaited<ReturnType<typeof getSettings>> | null>(
    null,
  );
  const [translationSettings, setTranslationSettings] = useState<TranslationSettings>(
    DEFAULT_TRANSLATION_SETTINGS,
  );
  const [liveTranslationState, setLiveTranslationState] =
    useState<WidgetLiveTranslationState>("idle");
  const updateLiveTranslationState = (nextState: WidgetLiveTranslationState): void => {
    liveTranslationStateRef.current = nextState;
    setLiveTranslationState(nextState);
  };
  const [retryProcessingSource, setRetryProcessingSource] =
    useState<WidgetRetryProcessingSource | null>(null);

  const clearLiveAudioWatchdog = (): void => {
    if (liveAudioWatchdogTimerRef.current === null) return;
    window.clearTimeout(liveAudioWatchdogTimerRef.current);
    liveAudioWatchdogTimerRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (liveAudioWatchdogTimerRef.current !== null) {
        window.clearTimeout(liveAudioWatchdogTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const startedAt = Date.now();

    void getSettings({ reload: true })
      .then(async (settings) => {
        const runtimeEndpoint = await warmUpLiveDictationRuntime(settings);
        if (!runtimeEndpoint) return;

        await logInfo(
          "LOCAL_STT",
          `Startup warm-up ready at ${runtimeEndpoint} after ${Date.now() - startedAt}ms`,
        );
      })
      .catch(async (error) => {
        await logError(
          "LOCAL_STT",
          `Startup warm-up failed; recording fallback remains available: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }, []);

  useEffect(() => {
    liveTranslationStateRef.current = liveTranslationState;
  }, [liveTranslationState]);

  useEffect(() => {
    const unlistenPromise = listen<DictationStreamUpdatePayload>(
      DICTATION_STREAM_UPDATE_EVENT,
      ({ payload }) => {
        const runtime = callTranscriptRuntimeRef.current;
        if (!runtime) return;
        const channel =
          payload.requestId === runtime.micRequestId
            ? "mic"
            : payload.requestId === runtime.systemRequestId
              ? "system"
              : null;
        if (!channel || payload.status === "started") {
          return;
        }

        const now = Date.now();
        const startedAt = Date.parse(runtime.entry.timestamp);
        const duration = Number.isFinite(startedAt)
          ? Math.max(0, Math.round((now - startedAt) / 1000))
          : runtime.entry.duration;
        const nextText = payload.text.trim();
        if (nextText) {
          if (
            !runtime[channel === "mic" ? "micText" : "systemText"] &&
            runtime.channelStartedAt[channel] === null
          ) {
            runtime.channelStartedAt[channel] = duration;
          }
          if (channel === "mic") {
            runtime.micText = nextText;
          } else {
            runtime.systemText = nextText;
          }
        }
        const transcript = formatCallLiveTranscript(runtime.micText, runtime.systemText);
        runtime.entry = {
          ...runtime.entry,
          duration,
          raw: transcript || runtime.entry.raw,
          cleaned: transcript || runtime.entry.cleaned,
          ...buildCallLiveSpeakerTranscript({
            micText: runtime.micText,
            systemText: runtime.systemText,
            micStartedAt: runtime.channelStartedAt.mic,
            systemStartedAt: runtime.channelStartedAt.system,
            duration,
          }),
          errorMessage:
            payload.status === "error"
              ? tn("callCapture.liveUnavailable")
              : runtime.entry.errorMessage,
        };

        if (payload.status !== "partial" || now - runtime.lastUiEmitAt >= 150) {
          runtime.lastUiEmitAt = now;
          void emit(HISTORY_UPDATED_EVENT, runtime.entry);
        }

        const shouldCheckpointDraft =
          payload.status === "partial" &&
          now - runtime.lastCheckpointAt[channel] >= CALL_DRAFT_CHECKPOINT_MS;
        const durableStatus =
          payload.status === "final"
            ? "final"
            : payload.status === "error"
              ? "error"
              : shouldCheckpointDraft
                ? "draft"
                : null;
        if (!durableStatus || !runtime.sessionId) {
          return;
        }
        runtime.lastCheckpointAt[channel] = now;
        const entrySnapshot = { ...runtime.entry };
        const sessionId = runtime.sessionId;
        callTranscriptPersistQueueRef.current = callTranscriptPersistQueueRef.current
          .catch(() => {})
          .then(async () => {
            await checkpointCallTranscription({
              sessionId,
              channel,
              status: durableStatus,
              text: channel === "mic" ? runtime.micText : runtime.systemText,
              startedAtMs: now,
              message: payload.message,
            });
            await updateHistoryEntry(entrySnapshot);
            await emit(HISTORY_UPDATED_EVENT, entrySnapshot);
          })
          .catch((error) => {
            logError(
              "CALL_CAPTURE",
              `Failed to checkpoint live transcript: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
      },
    );
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<LiveTranslationEventPayload>(
      "live-translation:update",
      ({ payload }) => {
        const current = liveOverlayRef.current;
        if (!current) {
          pendingLiveEventsRef.current = [...pendingLiveEventsRef.current.slice(-15), payload];
          return;
        }
        const next = applyLiveTranslationEvent(current, payload);
        if (next === current) return;
        liveOverlayRef.current = next;
        liveOverlayRendererRef.current?.schedule(
          next,
          payload.status === "final" || payload.status === "error",
        );
      },
    );
    return () => {
      liveOverlayRendererRef.current?.cancel();
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    fileDropStateRef.current = fileDropState;
  }, [fileDropState]);

  useEffect(() => {
    retryProcessingSourceRef.current = retryProcessingSource;
  }, [retryProcessingSource]);

  useEffect(() => {
    translationSettingsRef.current = translationSettings;
  }, [translationSettings]);

  useEffect(() => {
    let mounted = true;

    const loadTranslationSettings = async (): Promise<void> => {
      try {
        const settings = await getSettings({ reload: true });
        if (!mounted) return;
        if (
          !settings.translation.liveWidgetEnabled &&
          liveTranslationStateRef.current === "recording"
        ) {
          void stopLiveTranslationRef.current();
        }
        setTranslationSettings(settings.translation);
      } catch (error) {
        logError(
          "TRANSLATION",
          `Failed to load translation settings: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    void loadTranslationSettings();
    const unlistenPromise = listen(SETTINGS_UPDATED_EVENT, () => {
      void loadTranslationSettings();
    });

    return () => {
      mounted = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const unlistenPromise = listen<WidgetRetryProcessingPayload>(
      WIDGET_RETRY_PROCESSING_EVENT,
      ({ payload }) => {
        if (!mounted) {
          return;
        }

        setRetryProcessingSource(payload.active ? payload.source : null);
      },
    );

    return () => {
      mounted = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const unlistenPromise = listen<string>(APP_DATA_MIGRATION_ERROR_EVENT, ({ payload }) => {
      if (!mounted) {
        return;
      }
      showWidgetErrorOverlay(payload);
    });

    return () => {
      mounted = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    // Recover durable call manifests and transcript checkpoints before the
    // generic processing reconciliation updates any remaining orphan rows.
    void restoreInterruptedCallCaptureHistory()
      .then((restored) => {
        if (restored.length > 0) {
          logInfo("CALL_CAPTURE", `Recovered interrupted call sessions: ${restored.length}`);
        }
      })
      .catch((error) => {
        logError(
          "CALL_CAPTURE",
          `Failed to recover interrupted calls: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      })
      .finally(() => {
        void reconcileInterruptedProcessing();
      });

    // Allow the history table (Settings window) to stop an in-flight job here.
    const unlistenPromise = listen<ProcessingCancelRequestPayload>(
      PROCESSING_CANCEL_REQUEST_EVENT,
      ({ payload }) => {
        if (!payload?.entryId) {
          return;
        }
        void cancelProcessing(payload.entryId);
        // Stop the widget spinner right away for the job it owns.
        if (payload.entryId === callProcessingIdRef.current) {
          resetCallProcessingUi();
        } else if (payload.entryId === fileProcessingIdRef.current) {
          resetFileProcessingUi();
        }
      },
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<CallCaptureStopRequestPayload>(
      CALL_CAPTURE_STOP_REQUEST_EVENT,
      ({ payload }) => {
        const runtime = callTranscriptRuntimeRef.current;
        if (!payload?.entryId || payload.entryId !== runtime?.entry.id) {
          return;
        }
        void stopCallListeningRef.current();
      },
    );

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  const showCallNotice = useCallback((message: string): void => {
    showWidgetErrorOverlay(message);
  }, []);

  const clearFileResetTimer = () => {
    if (!fileResetTimerRef.current) return;
    window.clearTimeout(fileResetTimerRef.current);
    fileResetTimerRef.current = null;
  };

  const clearFileDragLeaveTimer = () => {
    if (!fileDragLeaveTimerRef.current) return;
    window.clearTimeout(fileDragLeaveTimerRef.current);
    fileDragLeaveTimerRef.current = null;
  };

  const clearFileCloseTimer = () => {
    if (!fileCloseTimerRef.current) return;
    window.clearTimeout(fileCloseTimerRef.current);
    fileCloseTimerRef.current = null;
  };

  const resizeWidgetForFileDrop = async (active: boolean): Promise<void> => {
    if (fileDropExpandedRef.current === active) {
      return;
    }

    fileDropExpandedRef.current = active;
    await resizeWidget(
      widgetStackWidth(active, translationSettingsRef.current.liveWidgetEnabled),
      widgetStackHeight(active),
    ).catch((error) => {
      logError(
        "WIDGET_FILE",
        `Resize failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  };

  const resetFileDropUi = async (): Promise<void> => {
    clearFileResetTimer();
    clearFileDragLeaveTimer();
    clearFileCloseTimer();
    fileDragDepthRef.current = 0;
    setFileDropState("idle");
    setFileDropName("");
    setFileStatus(null);
    setFileProgress(null);
    await resizeWidgetForFileDrop(false);
  };

  const closeFileDropUi = (): void => {
    clearFileResetTimer();
    clearFileDragLeaveTimer();
    clearFileCloseTimer();

    if (fileDropStateRef.current === "idle") {
      return;
    }

    setFileDropState("closing");
    fileCloseTimerRef.current = window.setTimeout(() => {
      fileCloseTimerRef.current = null;
      void resetFileDropUi();
    }, FILE_DROP_CLOSE_ANIMATION_MS);
  };

  const scheduleFileDropReset = () => {
    clearFileResetTimer();
    fileResetTimerRef.current = window.setTimeout(() => {
      fileResetTimerRef.current = null;
      void resetFileDropUi();
    }, 1800);
  };

  // Immediately drop the widget out of its processing UI when a stop request
  // arrives for the entry it is working on — without waiting for the (possibly
  // long-running, non-abortable local) job to settle.
  const resetCallProcessingUi = (): void => {
    callProcessingIdRef.current = null;
    callMicRuntimeRef.current.dispose();
    callSessionRef.current = null;
    callTranscriptRuntimeRef.current = null;
    callMicPausedForVoiceRef.current = false;
    setCallSession(null);
    setCallSettings(null);
    setCallError("");
    setCallState("idle");
    setFileStatus(null);
    setFileProgress(null);
  };

  const resetFileProcessingUi = (): void => {
    fileProcessingIdRef.current = null;
    setFileStatus(null);
    setFileProgress(null);
    closeFileDropUi();
  };

  const canAcceptFileDrop = () =>
    stateRef.current === "idle" &&
    fileDropStateRef.current !== "processing" &&
    !isIslandPresentationActive();

  const startCallListening = async (): Promise<void> => {
    if (
      stateRef.current !== "idle" ||
      fileDropStateRef.current !== "idle" ||
      callState !== "idle"
    ) {
      return;
    }

    let micStream: MediaStream | null = null;
    let startedSession: CallCaptureSession | null = null;

    try {
      setCallError("");
      setCallState("starting");
      const settings = await getSettings({ reload: true });
      setCallSettings(settings);

      let micDeviceLabel: string | null = null;
      try {
        micDeviceLabel = await resolveCallMicrophoneLabel(settings.micId);
        logInfo(
          "CALL_CAPTURE",
          micDeviceLabel
            ? `Resolved selected call mic without opening WebView audio: ${micDeviceLabel}`
            : "Using native system default call mic",
        );
      } catch (error) {
        logError(
          "CALL_CAPTURE",
          settings.micId
            ? `Selected call mic unavailable; refusing default fallback to keep mic and system tracks separate: ${formatCallCaptureRawError(error)}`
            : `Default call mic unavailable: ${formatCallCaptureRawError(error)}`,
        );
        if (error instanceof CallCaptureStartError) {
          throw error;
        }

        throw new CallCaptureStartError(
          microphoneStartErrorMessage(error),
          isPermissionDeniedError(error),
          error,
        );
      }

      if (requiresSystemAudioPermission() && !callSystemAudioPermissionReadyRef.current) {
        await requestSystemAudioPermission();

        callSystemAudioPermissionReadyRef.current = true;
      }

      const startedAt = Date.now();
      const entryId = crypto.randomUUID();
      const micRequestId = `${entryId}:mic`;
      const systemRequestId = `${entryId}:system`;
      let micLiveOptions = createCallLiveDictationOptions(settings, micRequestId);
      let systemLiveOptions = createCallLiveDictationOptions(settings, systemRequestId);
      let liveStreamingReady = true;
      if (micLiveOptions?.provider === "local") {
        try {
          const runtimeEndpoint = await warmUpLiveDictationRuntime(settings, micLiveOptions.model);
          if (runtimeEndpoint) {
            micLiveOptions = {
              ...micLiveOptions,
              endpoint: runtimeEndpoint,
            };
            if (systemLiveOptions?.provider === "local") {
              systemLiveOptions = {
                ...systemLiveOptions,
                endpoint: runtimeEndpoint,
              };
            }
          }
          if (micLiveOptions.model !== settings.whisperModel) {
            logInfo(
              "CALL_CAPTURE",
              `Using local live preview model=${micLiveOptions.model}; final_model=${settings.whisperModel}`,
            );
          }
        } catch (error) {
          liveStreamingReady = false;
          logError(
            "CALL_CAPTURE",
            `Local live STT warm-up failed; audio recording and stop-time transcription remain active: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      if (!liveStreamingReady) {
        micLiveOptions = null;
        systemLiveOptions = null;
      }
      const baseEntry: HistoryEntry = {
        id: entryId,
        timestamp: new Date(startedAt).toISOString(),
        duration: 0,
        raw: "",
        cleaned: "",
        source: "call",
        fileName: tn("callCapture.fileName"),
        status: "recording",
        callCapturePhase: "recording",
        ...buildCallLiveSpeakerTranscript({}),
      };
      callTranscriptRuntimeRef.current = {
        entry: baseEntry,
        sessionId: null,
        micRequestId: micLiveOptions ? micRequestId : null,
        systemRequestId: systemLiveOptions ? systemRequestId : null,
        micText: "",
        systemText: "",
        channelStartedAt: { mic: null, system: null },
        lastCheckpointAt: { mic: 0, system: 0 },
        lastUiEmitAt: 0,
      };
      const session = await startCallCapture({
        targetId: "system-output",
        includeMic: true,
        includeSystem: true,
        micDeviceId: settings.micId || null,
        micDeviceLabel,
        storageDir: settings.transcriptionStorageDir || null,
        liveTranscription:
          micLiveOptions && systemLiveOptions
            ? { mic: micLiveOptions, system: systemLiveOptions }
            : null,
      });
      startedSession = session;
      setTrayRecording(true);

      if (session.nativeMicActive) {
        logInfo(
          "CALL_CAPTURE",
          "Native call mic started without a competing WebView audio session",
        );
      } else {
        logInfo("CALL_CAPTURE", "Native call mic unavailable; requesting WebView fallback");
        micStream = await requestCallMicrophoneStream(settings.micId);
        callMicRuntimeRef.current.start(micStream);
      }
      micStream = null;
      if (callMicPausedForVoiceRef.current) {
        if (session.nativeMicActive) {
          await pauseCallCaptureMic(session.id);
        } else {
          callMicRuntimeRef.current.pause();
        }
      }

      const runtime = callTranscriptRuntimeRef.current;
      const recordingEntry: HistoryEntry = {
        ...(runtime?.entry || baseEntry),
        callSessionId: session.id,
        callTracks: session.tracks.map((track) => ({
          kind: track.kind,
          label: track.label,
          path: track.path,
        })),
        errorMessage: session.liveTranscription?.errors.length
          ? tn("callCapture.liveUnavailable")
          : undefined,
      };
      if (runtime) {
        runtime.entry = recordingEntry;
        runtime.sessionId = session.id;
      }
      callTranscriptPersistQueueRef.current = callTranscriptPersistQueueRef.current
        .catch(() => {})
        .then(async () => {
          await addHistoryEntry(recordingEntry);
          await emit(HISTORY_UPDATED_EVENT, recordingEntry);
        });
      try {
        await callTranscriptPersistQueueRef.current;
      } catch (error) {
        logError(
          "CALL_CAPTURE",
          `Failed to persist live call row: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      callSessionRef.current = session;
      setCallStartedAt(startedAt);
      setCallSession(session);
      setCallState("recording");
    } catch (error) {
      stopMediaStream(micStream);
      setTrayRecording(false);
      if (startedSession) {
        await stopCallCapture(startedSession.id).catch((stopError) => {
          logError(
            "CALL_CAPTURE",
            `Failed to stop partially started call: ${
              stopError instanceof Error ? stopError.message : String(stopError)
            }`,
          );
        });
      }
      const message = callCaptureStartErrorMessage(error);
      logError("CALL_CAPTURE", `Call capture start failed: ${formatCallCaptureRawError(error)}`);
      callMicRuntimeRef.current.dispose();
      callSessionRef.current = null;
      callTranscriptRuntimeRef.current = null;
      callMicPausedForVoiceRef.current = false;
      if (isCallCapturePermissionError(error)) {
        callSystemAudioPermissionReadyRef.current = false;
      }
      setCallError(message);
      setCallSession(null);
      setCallSettings(null);
      setCallState("error");
      showCallNotice(message);
      window.setTimeout(() => {
        setCallState("idle");
        setCallError("");
      }, 2600);
    }
  };

  const stopCallListening = async (): Promise<void> => {
    if (!callSession || callState !== "recording") {
      return;
    }

    let stoppedSession: CallCaptureSession | null = null;
    let sessionForFailure: CallCaptureSession = callSession;
    try {
      setCallState("processing");
      setFileStatus("preparing");
      setFileProgress(null);
      const runtime = callTranscriptRuntimeRef.current;
      if (runtime) {
        runtime.entry = {
          ...runtime.entry,
          status: "processing",
          callCapturePhase: "finalizing",
          duration: Math.max(
            runtime.entry.duration,
            Math.round((Date.now() - callStartedAt) / 1000),
          ),
        };
        callProcessingIdRef.current = runtime.entry.id;
        const finalizingEntry = { ...runtime.entry };
        callTranscriptPersistQueueRef.current = callTranscriptPersistQueueRef.current
          .catch(() => {})
          .then(async () => {
            await updateHistoryEntry(finalizingEntry);
            await emit(HISTORY_UPDATED_EVENT, finalizingEntry);
          });
        try {
          await callTranscriptPersistQueueRef.current;
        } catch (error) {
          logError(
            "CALL_CAPTURE",
            `Failed to persist finalizing call state: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      if (!callSession.nativeMicActive) {
        await callMicRuntimeRef.current.stop();
      }
      const micBlob =
        !callSession.nativeMicActive && callMicRuntimeRef.current.hasAudioChunks()
          ? await callMicRuntimeRef.current.getAudioBlob()
          : null;
      const micFileName = micBlob?.type.includes("wav") ? "call-mic.wav" : "call-mic.webm";
      const micFile = micBlob
        ? new File([micBlob], micFileName, {
            type: micBlob.type || "audio/webm",
          })
        : null;
      let micFileForTranscription = micFile;
      if (micBlob) {
        try {
          const micTrack = await saveCallCaptureMicTrack(callSession.id, micBlob);
          micFileForTranscription = null;
          sessionForFailure = {
            ...sessionForFailure,
            tracks: [micTrack, ...sessionForFailure.tracks.filter((track) => track.kind !== "mic")],
          };
        } catch (saveError) {
          logError(
            "CALL_CAPTURE",
            `Failed to persist call mic track: ${
              saveError instanceof Error ? saveError.message : String(saveError)
            }`,
          );
        }
      }
      stoppedSession = await stopCallCapture(callSession.id);
      callSessionRef.current = null;
      setTrayRecording(false);
      if (runtime) {
        runtime.micRequestId = null;
        runtime.systemRequestId = null;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      await callTranscriptPersistQueueRef.current.catch(() => {});
      if (runtime && stoppedSession.liveTranscription) {
        runtime.micText = stoppedSession.liveTranscription.micText || runtime.micText;
        runtime.systemText = stoppedSession.liveTranscription.systemText || runtime.systemText;
        const liveText = formatCallLiveTranscript(runtime.micText, runtime.systemText);
        runtime.entry = {
          ...runtime.entry,
          raw: liveText || runtime.entry.raw,
          cleaned: liveText || runtime.entry.cleaned,
          ...buildCallLiveSpeakerTranscript({
            micText: runtime.micText,
            systemText: runtime.systemText,
            micStartedAt: runtime.channelStartedAt.mic,
            systemStartedAt: runtime.channelStartedAt.system,
            duration: runtime.entry.duration,
          }),
          callTracks: stoppedSession.tracks.map((track) => ({
            kind: track.kind,
            label: track.label,
            path: track.path,
          })),
          errorMessage: stoppedSession.liveTranscription.errors.length
            ? tn("callCapture.liveUnavailable")
            : runtime.entry.errorMessage,
        };
        try {
          await updateHistoryEntry(runtime.entry);
          await emit(HISTORY_UPDATED_EVENT, runtime.entry);
        } catch (error) {
          logError(
            "CALL_CAPTURE",
            `Failed to persist final live call draft: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      const settings = callSettings ?? (await getSettings({ reload: true }));
      const entry = await transcribeCallCaptureSession({
        session: stoppedSession,
        settings,
        micFile: micFileForTranscription,
        startedAt: callStartedAt,
        entryId: runtime?.entry.id,
        baseEntry: runtime?.entry,
        onStatus: setFileStatus,
        onProgress: setFileProgress,
        onStarted: (entryId) => {
          callProcessingIdRef.current = entryId;
        },
      });

      // A stop request already reset the UI (and possibly started a new call) —
      // ignore this now-stale result so we don't clobber the fresh state.
      if (callProcessingIdRef.current !== entry.id) {
        return;
      }
      callProcessingIdRef.current = null;

      callMicPausedForVoiceRef.current = false;
      callTranscriptRuntimeRef.current = null;
      setCallSession(null);
      setCallSettings(null);
      setFileProgress(null);

      if (entry.status === "completed") {
        callMicRuntimeRef.current.reset();
        setLatestCopyText(getCopyableText(entry));
        setCallState("success");
        setFileStatus("done");
        window.setTimeout(() => {
          setCallState("idle");
        }, 1800);
      } else {
        // interrupted (user stop) or failed — the entry is already persisted to
        // history with a retry option; return the widget to idle quietly.
        callMicRuntimeRef.current.dispose();
        setCallError("");
        setCallState("idle");
        setFileStatus(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("CALL_CAPTURE", `Call capture stop/process failed: ${message}`);
      setTrayRecording(false);
      const userFacingMessage = t("widget.call.processFailed");

      const failedRuntime = callTranscriptRuntimeRef.current;
      if (failedRuntime) {
        failedRuntime.micRequestId = null;
        failedRuntime.systemRequestId = null;
      }
      if (!stoppedSession && callSessionRef.current?.id === callSession.id) {
        try {
          stoppedSession = await stopCallCapture(callSession.id);
          sessionForFailure = stoppedSession;
        } catch (stopError) {
          logError(
            "CALL_CAPTURE",
            `Failed to stop call capture during error cleanup: ${
              stopError instanceof Error ? stopError.message : String(stopError)
            }`,
          );
        } finally {
          callSessionRef.current = null;
        }
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      await callTranscriptPersistQueueRef.current.catch(() => {});

      try {
        const runtime = callTranscriptRuntimeRef.current;
        if (runtime) {
          if (stoppedSession?.liveTranscription) {
            runtime.micText = stoppedSession.liveTranscription.micText || runtime.micText;
            runtime.systemText = stoppedSession.liveTranscription.systemText || runtime.systemText;
          }
          const preservedLiveText = formatCallLiveTranscript(runtime.micText, runtime.systemText);
          const failed: HistoryEntry = {
            ...runtime.entry,
            raw: preservedLiveText || runtime.entry.raw,
            cleaned: preservedLiveText || runtime.entry.cleaned,
            ...buildCallLiveSpeakerTranscript({
              micText: runtime.micText,
              systemText: runtime.systemText,
              micStartedAt: runtime.channelStartedAt.mic,
              systemStartedAt: runtime.channelStartedAt.system,
              duration: runtime.entry.duration,
            }),
            status: "failed",
            callCapturePhase: undefined,
            errorMessage: userFacingMessage,
            callTracks: (stoppedSession ?? sessionForFailure).tracks.map((track) => ({
              kind: track.kind,
              label: track.label,
              path: track.path,
            })),
          };
          await updateHistoryEntry(failed);
          await emit(HISTORY_UPDATED_EVENT, failed);
        } else {
          await saveFailedCallCaptureEntry({
            session: stoppedSession ?? sessionForFailure,
            errorMessage: userFacingMessage,
            startedAt: callStartedAt,
          });
        }
      } catch (historyError) {
        logError(
          "CALL_CAPTURE",
          `Failed to save failed call history entry: ${
            historyError instanceof Error ? historyError.message : String(historyError)
          }`,
        );
      }

      callMicRuntimeRef.current.dispose();
      callSessionRef.current = null;
      callTranscriptRuntimeRef.current = null;
      callMicPausedForVoiceRef.current = false;
      setCallError("");
      setCallState("idle");
      setFileStatus(null);
      setFileProgress(null);
      setCallSession(null);
      setCallSettings(null);
    }
  };
  stopCallListeningRef.current = stopCallListening;

  fileProcessRef.current = async (filePath: string): Promise<void> => {
    if (!filePath || !canAcceptFileDrop()) {
      return;
    }

    clearFileResetTimer();
    clearFileDragLeaveTimer();
    clearFileCloseTimer();
    const fileName = fileNameFromPath(filePath);
    setFileDropState("processing");
    setFileDropName(fileName);
    setFileStatus("preparing");
    setFileProgress(null);
    await resizeWidgetForFileDrop(true);

    const settings = await getSettings({ reload: true });
    const startedAt = Date.now();
    // Persist a "processing" row up front (keeping the source path for re-runs).
    const baseEntry: HistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      duration: 0,
      raw: "",
      cleaned: "",
      source: "file",
      fileName,
      status: "processing",
      filePath,
    };
    const handle = await beginProcessing(baseEntry, "add");
    fileProcessingIdRef.current = baseEntry.id;

    try {
      const transcription = await transcribeFilePathOnly({
        filePath,
        settings,
        onStatus: setFileStatus,
        onProgress: setFileProgress,
        speakerDiarization: settings.fileSpeakerDiarization === true,
        identifyFirstSpeakerAsUser: true,
      });

      if (handle.isCancelled()) {
        // UI was already reset by the stop handler; just record the outcome.
        await finishProcessing({
          ...baseEntry,
          status: "interrupted",
          errorMessage: t("widget.processing.interrupted"),
        });
        return;
      }
      fileProcessingIdRef.current = null;

      const entry: HistoryEntry = {
        ...baseEntry,
        raw: transcription.text,
        cleaned: transcription.text,
        status: "completed",
        errorMessage: undefined,
        processingTime: Date.now() - startedAt,
        mode: transcription.mode,
        speakers: transcription.speakers,
        segments: transcription.segments,
      };

      await finishProcessing(entry);
      setLatestCopyText(getCopyableText(entry));
      setPendingFileResultId(entry.id);
      setFileDropState("success");
      setFileStatus("done");
      setFileProgress(null);
      scheduleFileDropReset();
    } catch (error) {
      if (handle.isCancelled() || isAbortError(error)) {
        // UI was already reset by the stop handler; just record the outcome.
        await finishProcessing({
          ...baseEntry,
          status: "interrupted",
          errorMessage: t("widget.processing.interrupted"),
        });
        return;
      }
      fileProcessingIdRef.current = null;

      logError(
        "WIDGET_FILE",
        `File transcription failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await finishProcessing({
        ...baseEntry,
        status: "failed",
        errorMessage: toFileTranscriptionErrorMessage(error, { settings }),
      });
      setFileDropState("error");
      setFileStatus(null);
      setFileProgress(null);
      setFileDropName(toFileTranscriptionErrorMessage(error, { settings }));
      scheduleFileDropReset();
    } finally {
      handle.finish();
    }
  };

  useEffect(() => {
    let disposed = false;

    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      if (disposed) return;

      if (event.payload.type === "enter") {
        if (!canAcceptFileDrop()) return;
        clearFileDragLeaveTimer();
        clearFileCloseTimer();
        fileDragDepthRef.current += 1;
        clearFileResetTimer();
        setFileDropState("drag-over");
        setFileDropName(t("widget.fileDrop.release"));
        void resizeWidgetForFileDrop(true);
        return;
      }

      if (event.payload.type === "over") {
        if (!canAcceptFileDrop()) return;
        clearFileDragLeaveTimer();
        clearFileCloseTimer();
        fileDragDepthRef.current = Math.max(1, fileDragDepthRef.current);
        setFileDropState("drag-over");
        setFileDropName(t("widget.fileDrop.release"));
        return;
      }

      if (event.payload.type === "leave") {
        fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
        clearFileDragLeaveTimer();
        fileDragLeaveTimerRef.current = window.setTimeout(() => {
          fileDragLeaveTimerRef.current = null;
          if (fileDragDepthRef.current === 0 && fileDropStateRef.current === "drag-over") {
            closeFileDropUi();
          }
        }, FILE_DROP_LEAVE_GRACE_MS);
        return;
      }

      if (event.payload.type !== "drop") {
        return;
      }

      fileDragDepthRef.current = 0;
      clearFileDragLeaveTimer();
      const filePath = event.payload.paths[0];
      if (!filePath) {
        void resetFileDropUi();
        return;
      }

      void fileProcessRef.current(filePath);
    });

    return () => {
      disposed = true;
      clearFileResetTimer();
      clearFileDragLeaveTimer();
      clearFileCloseTimer();
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const refreshLatestCopyText = async () => {
      try {
        const history = await getHistory();
        if (!mounted) {
          return;
        }

        const latestCompleted = history.find((entry) => getCopyableText(entry) !== null);
        setLatestCopyText(getCopyableText(latestCompleted));
      } catch (error) {
        logError(
          "WIDGET",
          `Failed to load latest history entry: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    void refreshLatestCopyText();

    const unlistenUpdatedPromise = listen<HistoryEntry>(HISTORY_UPDATED_EVENT, ({ payload }) => {
      const text = getCopyableText(payload);
      if (text) {
        setLatestCopyText(text);
      }
    });
    const unlistenDeletedPromise = listen<{ id: string }>(HISTORY_DELETED_EVENT, () => {
      void refreshLatestCopyText();
    });
    const unlistenClearedPromise = listen(HISTORY_CLEARED_EVENT, () => {
      setLatestCopyText(null);
    });
    const unlistenSettingsPromise = listen(SETTINGS_UPDATED_EVENT, () => {
      void refreshLatestCopyText();
    });

    return () => {
      mounted = false;
      void unlistenUpdatedPromise.then((unlisten) => unlisten());
      void unlistenDeletedPromise.then((unlisten) => unlisten());
      void unlistenClearedPromise.then((unlisten) => unlisten());
      void unlistenSettingsPromise.then((unlisten) => unlisten());
    };
  }, []);

  const showCleanupMenu = async (): Promise<void> => {
    try {
      const model = buildCleanupMenuModel(await getSettings({ reload: true }));
      const menu = await Menu.new({
        items: [
          {
            id: "cleanup-toggle",
            text: t("cleanup.title"),
            checked: model.enabled,
            action: () => {
              void toggleCleanup().catch((error) => logError("CLEANUP", String(error)));
            },
          },
          {
            text: t("cleanup.styles"),
            items: model.presets.map((preset) => ({
              id: preset.id,
              text: preset.name,
              checked: preset.id === model.selectedId,
              action: () => {
                void selectCleanupPreset(preset.id).catch((error) =>
                  logError("CLEANUP", String(error)),
                );
              },
            })),
          },
        ],
      });
      try {
        await menu.popup();
      } finally {
        await menu.close();
      }
    } catch (error) {
      logError("CLEANUP", String(error));
    }
  };

  const handleDragPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    dragStartRef.current = { x: event.clientX, y: event.clientY };
    dragTriggeredRef.current = false;
  };

  const handleDragPointerMove = async (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || dragTriggeredRef.current || (event.buttons & 1) === 0) {
      return;
    }

    const deltaX = Math.abs(event.clientX - dragStartRef.current.x);
    const deltaY = Math.abs(event.clientY - dragStartRef.current.y);

    if (deltaX < 4 && deltaY < 4) {
      return;
    }

    dragTriggeredRef.current = true;

    try {
      await widgetWindow.startDragging();
    } catch {
      dragTriggeredRef.current = false;
    }
  };

  const handleDragPointerUp = () => {
    window.setTimeout(() => {
      dragStartRef.current = null;
      dragTriggeredRef.current = false;
    }, 0);
  };

  const openLatestFileResult = async () => {
    if (dragTriggeredRef.current) {
      return;
    }

    if (pendingFileResultId) {
      await invoke("open_settings_tab", {
        tab: "file",
        resultId: pendingFileResultId,
      });
      setPendingFileResultId(null);
      return;
    }

    await invoke("open_settings");
  };

  const fileDropActive = fileDropState !== "idle";
  const liveTranslationVisible = translationSettings.liveWidgetEnabled;
  const activeTickerLine = textDisplay === "ticker" ? tickerLine(tickerPayload) : "";
  const activeTickerLive = tickerPayload ? tickerFollowsTail(tickerPayload.status) : false;
  const showPillTicker = activeTickerLine.length > 0 && !fileDropActive;
  const stackWidth = stackWidthWithTicker(
    widgetStackWidth(fileDropActive, liveTranslationVisible),
    showPillTicker && appliedMode !== "island",
  );
  const stackHeight = widgetStackHeight(fileDropActive);
  const scaledStackWidth = scaleWidgetDimension(stackWidth, widgetScale);
  const scaledStackHeight = scaleWidgetDimension(stackHeight, widgetScale);
  const displayCallState: WidgetCallState =
    retryProcessingSource === "call" && callState === "idle" ? "processing" : callState;
  const displayWidgetState =
    retryProcessingSource === "voice" && state === "idle" && !fileDropActive ? "processing" : state;
  const callBubbleDisabled =
    displayCallState === "idle" &&
    (displayWidgetState !== "idle" || fileDropActive || liveTranslationState !== "idle");
  const liveTranslationBubbleDisabled =
    liveTranslationState === "starting" ||
    liveTranslationState === "stopping" ||
    (liveTranslationState === "idle" &&
      (displayWidgetState !== "idle" || fileDropActive || displayCallState !== "idle"));
  const islandVisual = mapIslandState({
    widgetState:
      displayWidgetState === "recording" || displayWidgetState === "processing"
        ? displayWidgetState
        : "idle",
    callActive: displayCallState === "recording" || displayCallState === "starting",
    notice: islandNotice,
    done: islandDone,
  });

  useEffect(() => {
    let disposed = false;
    const syncDisplay = async (): Promise<void> => {
      try {
        const settings = await getSettings();
        if (disposed) return;
        const mode = settings.textDisplay === "ticker" ? "ticker" : "window";
        setTextDisplay(mode);
        await invoke("set_text_display", { mode });
      } catch (error) {
        logError(
          "WIDGET",
          `Failed to apply text display: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    void syncDisplay();
    const unlistenSettings = listen(SETTINGS_UPDATED_EVENT, () => {
      void syncDisplay();
    });
    const unlistenText = listen<WidgetTextOverlayState | null>(TEXT_OVERLAY_EVENT, (event) => {
      setTickerPayload(event.payload?.status ? event.payload : null);
    });
    return () => {
      disposed = true;
      void unlistenSettings.then((stop) => stop());
      void unlistenText.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (textDisplay !== "ticker" || !tickerPayload) {
      return;
    }
    if (!shouldAutoDismissTextOverlay(tickerPayload.status)) {
      return;
    }
    const requestId = tickerPayload.requestId;
    const timer = window.setTimeout(() => {
      void invoke(
        requestId ? "hide_widget_text_overlay_request" : "hide_widget_text_overlay",
        requestId ? { requestId } : undefined,
      );
    }, TEXT_OVERLAY_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [textDisplay, tickerPayload]);

  useEffect(() => {
    let disposed = false;
    const sync = async (): Promise<void> => {
      try {
        const applied = await applyStoredWidgetPresentation();
        if (disposed) return;
        setAppliedMode(applied.mode);
        setIslandAnchor(applied.anchor);
      } catch (error) {
        logError(
          "ISLAND",
          `Failed to apply widget presentation: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    void sync();
    const unlistenSettings = listen(SETTINGS_UPDATED_EVENT, () => {
      void sync();
    });
    const unlistenAnchor = listen<{ anchor: IslandAnchor | null }>(ISLAND_ANCHOR_EVENT, (event) => {
      const anchor = event.payload.anchor;
      setIslandAnchor(anchor);
      if (anchor) {
        setAppliedMode("island");
        setIslandPresentationActive(true);
        return;
      }
      setAppliedMode("pill");
      setIslandPresentationActive(false);
    });
    const unlistenNotice = listen<IslandNotice | null>(ISLAND_NOTICE_EVENT, (event) => {
      const payload = event.payload;
      if (!payload?.message) {
        setIslandNotice(null);
        return;
      }
      setIslandNotice({
        message: payload.message,
        tone: payload.tone === "info" ? "info" : "error",
        actionLabel: payload.actionLabel,
        actionTab: payload.actionTab,
      });
    });
    return () => {
      disposed = true;
      void unlistenSettings.then((stop) => stop());
      void unlistenAnchor.then((stop) => stop());
      void unlistenNotice.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (appliedMode !== "island") {
      return;
    }
    void invoke("set_island_interactive", {
      interactive: islandNoticeIsInteractive(islandNotice),
    });
  }, [appliedMode, islandNotice]);

  useEffect(() => {
    if (displayWidgetState === "processing") {
      wasIslandProcessingRef.current = true;
      setIslandDone(false);
      return;
    }
    if (!wasIslandProcessingRef.current || displayWidgetState !== "idle") {
      return;
    }
    wasIslandProcessingRef.current = false;
    setIslandDone(true);
    const timer = window.setTimeout(() => setIslandDone(false), 800);
    return () => window.clearTimeout(timer);
  }, [displayWidgetState]);

  useEffect(() => {
    if (islandVisual !== "recording" && islandVisual !== "call") {
      setIslandElapsedMs(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setIslandElapsedMs(Date.now() - started), 250);
    return () => window.clearInterval(timer);
  }, [islandVisual]);

  useEffect(() => {
    if (appliedMode !== "island") return;
    if (state !== "recording" && callState !== "recording") return;
    void applyStoredWidgetPresentation()
      .then((applied) => {
        setAppliedMode(applied.mode);
        setIslandAnchor(applied.anchor);
      })
      .catch((error) => {
        logError(
          "ISLAND",
          `Failed to refresh island anchor: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, [appliedMode, callState, state]);

  useEffect(() => {
    if (appliedModeRef.current === appliedMode) return;
    appliedModeRef.current = appliedMode;
    if (appliedMode !== "pill") return;
    void resizeWidget(
      widgetStackWidth(fileDropStateRef.current !== "idle", translationSettings.liveWidgetEnabled),
      widgetStackHeight(fileDropStateRef.current !== "idle"),
    );
  }, [appliedMode, resizeWidget, translationSettings.liveWidgetEnabled]);

  useEffect(() => {
    void resizeWidget(
      stackWidthWithTicker(
        widgetStackWidth(
          fileDropStateRef.current !== "idle",
          translationSettings.liveWidgetEnabled,
        ),
        showPillTicker && appliedMode !== "island",
      ),
      widgetStackHeight(fileDropStateRef.current !== "idle"),
    ).catch((error) => {
      logError(
        "TRANSLATION",
        `Resize after translation visibility change failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, [appliedMode, resizeWidget, showPillTicker, translationSettings.liveWidgetEnabled]);

  const startLiveTranslation = async (): Promise<void> => {
    if (
      stateRef.current !== "idle" ||
      callStateRef.current !== "idle" ||
      fileDropStateRef.current !== "idle" ||
      liveTranslationStateRef.current !== "idle"
    ) {
      return;
    }
    clearLiveAudioWatchdog();
    updateLiveTranslationState("starting");
    try {
      const settings = await getSettings({ reload: true });
      const connection = resolveLiveTranslationConnection(settings);
      if (requiresSystemAudioPermission() && !callSystemAudioPermissionReadyRef.current) {
        await requestSystemAudioPermission();
        callSystemAudioPermissionReadyRef.current = true;
      }
      let micLabel: string | null = null;
      if (settings.translation.liveMicrophoneEnabled || settings.saveRecordingAudio) {
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        micLabel =
          devices.find(
            (device) => device.kind === "audioinput" && device.deviceId === settings.micId,
          )?.label || null;
      }
      const session = await invoke<{ sessionId: string; startedAt: string }>(
        "start_live_translation",
        {
          req: {
            provider: connection.provider,
            apiKey: connection.apiKey,
            model: connection.model,
            endpoint: connection.endpoint,
            targetLanguage: settings.translation.liveTargetLanguage,
            voiceEnabled: settings.translation.liveVoiceEnabled && connection.supportsVoice,
            voice: settings.translation.liveVoice,
            voiceVolume: settings.translation.liveVoiceVolume,
            voiceSpeed: settings.translation.liveVoiceSpeed,
            muteOriginal:
              settings.translation.liveVoiceEnabled && settings.translation.liveMuteOriginalEnabled,
            includeMicrophone: settings.translation.liveMicrophoneEnabled,
            micDeviceLabel: micLabel,
            saveAudio: settings.saveRecordingAudio,
            storageDir: settings.transcriptionStorageDir || null,
          },
        },
      );
      liveAdapterIdRef.current = connection.adapterId;
      liveStartedAtRef.current = Date.now();
      let overlay = createLiveTranslationOverlayState(session.sessionId);
      for (const event of pendingLiveEventsRef.current) {
        overlay = applyLiveTranslationEvent(overlay, event);
      }
      pendingLiveEventsRef.current = [];
      liveOverlayRef.current = overlay;
      updateLiveTranslationState("recording");
      await liveOverlayRendererRef.current?.renderNow(overlay);
      liveAudioWatchdogTimerRef.current = window.setTimeout(() => {
        liveAudioWatchdogTimerRef.current = null;
        if (liveTranslationStateRef.current !== "recording") return;

        void invoke<{
          maxDbfs: number;
          framesAboveNoiseFloor: number;
          outputFramesWritten: number;
        }>("get_live_translation_audio_level")
          .then((level) => {
            if (liveTranslationStateRef.current !== "recording") return;
            logInfo(
              "LIVE_TRANSLATION",
              `System audio watchdog: max=${level.maxDbfs.toFixed(1)} dBFS, frames_above_noise_floor=${level.framesAboveNoiseFloor}, output_frames=${level.outputFramesWritten}`,
            );
            if (level.framesAboveNoiseFloor > 0) return;

            const message =
              "Системный звук не поступает. Проверьте воспроизведение видео и разрешение Talkee на запись системного звука.";
            logError("LIVE_TRANSLATION", message);
            liveOverlayRef.current = null;
            pendingLiveEventsRef.current = [];
            showCallNotice(message);
            void stopLiveTranslationRef.current();
          })
          .catch((error) => {
            logError(
              "LIVE_TRANSLATION",
              `System audio watchdog failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
      }, 8_000);
    } catch (error) {
      clearLiveAudioWatchdog();
      const message = error instanceof Error ? error.message : String(error);
      pendingLiveEventsRef.current = [];
      logError("LIVE_TRANSLATION", `Failed to start: ${message}`);
      updateLiveTranslationState("error");
      showCallNotice(message);
      window.setTimeout(() => updateLiveTranslationState("idle"), 2200);
    }
  };

  const stopLiveTranslation = async (): Promise<void> => {
    if (liveTranslationStateRef.current !== "recording") return;
    clearLiveAudioWatchdog();
    updateLiveTranslationState("stopping");
    try {
      const settings = await getSettings({ reload: true });
      const result = await invoke<{
        sessionId: string;
        callCapture: CallCaptureSession;
      }>("stop_live_translation");
      const overlay = liveOverlayRef.current;
      if (overlay && overlay.sessionId === result.sessionId) {
        const entry = buildLiveTranslationHistoryEntry({
          state: overlay,
          adapterId: liveAdapterIdRef.current,
          targetLanguage: settings.translation.liveTargetLanguage,
          startedAt: liveStartedAtRef.current || Date.now(),
          callTracks: settings.saveRecordingAudio
            ? result.callCapture.tracks.map((track) => ({
                kind: track.kind,
                label: track.label,
                path: track.path,
              }))
            : undefined,
        });
        await addHistoryEntry(entry);
        await emit(HISTORY_UPDATED_EVENT, entry);
        setLatestCopyText(entry.cleaned || entry.raw || null);
      }
      liveOverlayRef.current = null;
      liveAdapterIdRef.current = "unknown";
      pendingLiveEventsRef.current = [];
      liveOverlayRendererRef.current?.cancel();
      await liveOverlayRendererRef.current
        ?.runAfterPending(() => invoke("hide_widget_text_overlay"))
        .catch(() => {});
      updateLiveTranslationState("idle");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("LIVE_TRANSLATION", `Failed to stop: ${message}`);
      if (liveOverlayRef.current) {
        liveOverlayRef.current = { ...liveOverlayRef.current, error: message };
      }
      updateLiveTranslationState("error");
      showCallNotice(message);
      window.setTimeout(() => updateLiveTranslationState("idle"), 2200);
    }
  };
  stopLiveTranslationRef.current = stopLiveTranslation;

  const handleLiveTranslationBubbleClick = (): void => {
    if (dragTriggeredRef.current) return;
    if (liveTranslationState === "recording") {
      void stopLiveTranslation();
    } else if (liveTranslationState === "idle") {
      void startLiveTranslation();
    }
  };
  const handleCallBubbleClick = () => {
    if (dragTriggeredRef.current) {
      return;
    }

    if (callState === "recording") {
      void stopCallListening();
      return;
    }

    if (displayCallState !== "idle") {
      return;
    }

    if (!callBubbleDisabled && callState === "idle") {
      void startCallListening();
    }
  };
  const rememberPasteTargetWindow = useCallback(() => {
    invoke("remember_paste_target_window").catch((error) => {
      logError("PASTE", `Failed to remember paste target window: ${error}`);
    });
  }, []);

  if (appliedMode === "island") {
    return (
      <IslandPresentation
        anchor={{
          notchWidth: islandAnchor?.notchWidth ?? 180,
          notchHeight: islandAnchor?.notchHeight ?? 32,
        }}
        state={islandVisual}
        notice={islandNotice}
        cleanupEnabled={cleanupEnabled}
        elapsedMs={islandElapsedMs}
        tickerText={activeTickerLine}
        tickerLive={activeTickerLive}
      />
    );
  }

  return (
    <PillPresentation
      scaledStackWidth={scaledStackWidth}
      scaledStackHeight={scaledStackHeight}
      stackWidth={stackWidth}
      stackHeight={stackHeight}
      widgetScale={widgetScale}
      fileDropActive={fileDropActive}
      fileDropState={fileDropState}
      fileDropName={fileDropName}
      fileStatus={fileStatus}
      fileProgress={fileProgress}
      openLatestFileResult={openLatestFileResult}
      handleDragPointerDown={handleDragPointerDown}
      handleDragPointerMove={handleDragPointerMove}
      handleDragPointerUp={handleDragPointerUp}
      cleanupEnabled={cleanupEnabled}
      displayWidgetState={displayWidgetState}
      latestCopyText={latestCopyText}
      toggleManualRecording={toggleManualRecording}
      rememberPasteTargetWindow={rememberPasteTargetWindow}
      stream={stream}
      lockedRecording={lockedRecording}
      displayCallState={displayCallState}
      callError={callError}
      callBubbleDisabled={callBubbleDisabled}
      handleCallBubbleClick={handleCallBubbleClick}
      liveTranslationVisible={liveTranslationVisible}
      liveTranslationState={liveTranslationState}
      liveTranslationBubbleDisabled={liveTranslationBubbleDisabled}
      handleLiveTranslationBubbleClick={handleLiveTranslationBubbleClick}
      showCleanupMenu={showCleanupMenu}
      tickerText={showPillTicker ? activeTickerLine : ""}
      tickerLive={activeTickerLive}
    />
  );
}
