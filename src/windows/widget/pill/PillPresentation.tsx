import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  type FileTranscriptionProgress,
  type FileTranscriptionStatus,
  getFileTranscriptionPercent,
} from "../../../lib/fileTranscription";
import { NATIVE_VOICE_LEVEL_EVENT } from "../../../lib/hotkeyEvents";
import { useI18n } from "../../../lib/i18n";
import {
  IconCheck,
  IconCopy,
  IconFileMusic,
  IconLanguage,
  IconLoader2,
  IconPhoneCall,
} from "../../../lib/icons";
import { TextTicker } from "../ticker/TextTicker";
import { TICKER_PILL_WIDTH } from "../ticker/tickerText";
import { WidgetRecordButton } from "../WidgetRecordButton";
import {
  ACTIVE_WIDGET_SHELL_HEIGHT,
  ACTIVE_WIDGET_SHELL_WIDTH,
  CALL_BUBBLE_SIZE,
  FILE_DROP_WIDGET_HEIGHT,
  FILE_DROP_WIDGET_WIDTH,
  IDLE_HOVER_SCALE,
  IDLE_HOVER_WIDGET_HEIGHT,
  IDLE_HOVER_WIDGET_WIDTH,
  WIDGET_CONTROL_GAP,
  WIDGET_PRIMARY_INLINE_INSET,
  WIDGET_SHELL_HEIGHT,
  WIDGET_SHELL_WIDTH,
} from "../widgetConstants";

const WIDGET_RECORD_BUTTON_LEFT = 10;

export type WidgetFileDropState =
  | "idle"
  | "drag-over"
  | "processing"
  | "success"
  | "error"
  | "closing";
export type WidgetCallState =
  | "idle"
  | "starting"
  | "recording"
  | "processing"
  | "success"
  | "error";
export type WidgetLiveTranslationState = "idle" | "starting" | "recording" | "stopping" | "error";

const FRAME_INTERVAL_MS = 1000 / 30;

const WIDGET_WAVES = [
  {
    className: "widget-wave-line-1",
    dur: "2.8s",
    values: [
      "M0 17 C 24 16, 42 16, 58 17 S 82 5, 96 6 S 122 28, 140 17 S 174 16, 190 17",
      "M0 17 C 24 17, 42 16, 58 17 S 82 8, 96 9 S 122 25, 140 17 S 174 17, 190 17",
      "M0 17 C 24 16, 42 16, 58 17 S 82 5, 96 6 S 122 28, 140 17 S 174 16, 190 17",
    ],
  },
  {
    className: "widget-wave-line-2",
    dur: "3.4s",
    values: [
      "M0 17 C 20 18, 42 18, 58 17 S 78 30, 96 29 S 118 4, 138 17 S 170 18, 190 17",
      "M0 17 C 22 17, 42 18, 58 17 S 80 26, 96 25 S 118 8, 138 17 S 170 17, 190 17",
      "M0 17 C 20 18, 42 18, 58 17 S 78 30, 96 29 S 118 4, 138 17 S 170 18, 190 17",
    ],
  },
  {
    className: "widget-wave-line-3",
    dur: "3.1s",
    values: [
      "M0 17 C 22 17, 44 16, 60 17 S 84 11, 96 12 S 116 23, 136 17 S 170 16, 190 17",
      "M0 17 C 22 16, 44 17, 60 17 S 84 13, 96 14 S 116 21, 136 17 S 170 17, 190 17",
      "M0 17 C 22 17, 44 16, 60 17 S 84 11, 96 12 S 116 23, 136 17 S 170 16, 190 17",
    ],
  },
] as const;

interface PillPresentationProps {
  scaledStackWidth: number;
  scaledStackHeight: number;
  stackWidth: number;
  stackHeight: number;
  widgetScale: number;
  fileDropActive: boolean;
  fileDropState: WidgetFileDropState;
  fileDropName: string;
  fileStatus: FileTranscriptionStatus | null;
  fileProgress: FileTranscriptionProgress | null;
  openLatestFileResult: () => void;
  handleDragPointerDown: DragHandlers["onPointerDown"];
  handleDragPointerMove: DragHandlers["onPointerMove"];
  handleDragPointerUp: DragHandlers["onPointerUp"];
  cleanupEnabled: boolean;
  displayWidgetState: "idle" | "recording" | "processing";
  latestCopyText: string | null;
  toggleManualRecording: () => void;
  rememberPasteTargetWindow: () => void;
  stream: MediaStream | null;
  lockedRecording: boolean;
  displayCallState: WidgetCallState;
  callError: string;
  callBubbleDisabled: boolean;
  handleCallBubbleClick: () => void;
  liveTranslationVisible: boolean;
  liveTranslationState: WidgetLiveTranslationState;
  liveTranslationBubbleDisabled: boolean;
  handleLiveTranslationBubbleClick: () => void;
  showCleanupMenu: () => void;
  tickerText: string;
  tickerLive: boolean;
}

export function PillPresentation({
  scaledStackWidth,
  scaledStackHeight,
  stackWidth,
  stackHeight,
  widgetScale,
  fileDropActive,
  fileDropState,
  fileDropName,
  fileStatus,
  fileProgress,
  openLatestFileResult,
  handleDragPointerDown,
  handleDragPointerMove,
  handleDragPointerUp,
  cleanupEnabled,
  displayWidgetState,
  latestCopyText,
  toggleManualRecording,
  rememberPasteTargetWindow,
  stream,
  lockedRecording,
  displayCallState,
  callError,
  callBubbleDisabled,
  handleCallBubbleClick,
  liveTranslationVisible,
  liveTranslationState,
  liveTranslationBubbleDisabled,
  handleLiveTranslationBubbleClick,
  showCleanupMenu,
  tickerText,
  tickerLive,
}: PillPresentationProps): ReactNode {
  const { t } = useI18n();
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "transparent",
        overflow: "visible",
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        role="toolbar"
        aria-label={t("cleanup.styles")}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            void showCleanupMenu();
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          void showCleanupMenu();
        }}
        style={{
          position: "relative",
          width: scaledStackWidth,
          height: scaledStackHeight,
          display: "grid",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: stackWidth,
            height: stackHeight,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: WIDGET_CONTROL_GAP,
            pointerEvents: "none",
            zoom: widgetScale,
          }}
        >
          {fileDropActive && (
            <FileDropPill
              state={fileDropState}
              fileName={fileDropName}
              status={fileStatus}
              progress={fileProgress}
              onOpenResult={openLatestFileResult}
              onPointerDown={handleDragPointerDown}
              onPointerMove={handleDragPointerMove}
              onPointerUp={handleDragPointerUp}
              onPointerCancel={handleDragPointerUp}
            />
          )}
          {!fileDropActive && (
            <div
              style={{
                position: "relative",
                marginInlineEnd: -WIDGET_PRIMARY_INLINE_INSET,
                pointerEvents: "none",
              }}
            >
              {cleanupEnabled &&
                (displayWidgetState === "idle" || displayWidgetState === "recording") && (
                  <span
                    role="img"
                    aria-label={t("cleanup.indicator")}
                    title={t("cleanup.indicator")}
                    style={{
                      position: "absolute",
                      right: 8,
                      top: 2,
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "var(--accent)",
                      pointerEvents: "none",
                      zIndex: 2,
                    }}
                  />
                )}
              {tickerText ? (
                <TickerPill
                  text={tickerText}
                  live={tickerLive}
                  onToggleRecording={
                    displayWidgetState === "recording" ? toggleManualRecording : undefined
                  }
                  onPointerDown={handleDragPointerDown}
                  onPointerMove={handleDragPointerMove}
                  onPointerUp={handleDragPointerUp}
                  onPointerCancel={handleDragPointerUp}
                />
              ) : null}
              {!tickerText && displayWidgetState === "idle" && (
                <IdlePill
                  latestCopyText={latestCopyText}
                  onToggleRecording={toggleManualRecording}
                  onClick={openLatestFileResult}
                  onRememberPasteTarget={rememberPasteTargetWindow}
                  onPointerDown={handleDragPointerDown}
                  onPointerMove={handleDragPointerMove}
                  onPointerUp={handleDragPointerUp}
                  onPointerCancel={handleDragPointerUp}
                />
              )}
              {!tickerText && displayWidgetState === "recording" && (
                <RecordingPill
                  stream={stream}
                  locked={lockedRecording}
                  onToggleRecording={toggleManualRecording}
                  onPointerDown={handleDragPointerDown}
                  onPointerMove={handleDragPointerMove}
                  onPointerUp={handleDragPointerUp}
                  onPointerCancel={handleDragPointerUp}
                />
              )}
              {!tickerText && displayWidgetState === "processing" && (
                <ProcessingPill
                  onPointerDown={handleDragPointerDown}
                  onPointerMove={handleDragPointerMove}
                  onPointerUp={handleDragPointerUp}
                  onPointerCancel={handleDragPointerUp}
                />
              )}
            </div>
          )}
          <div
            style={{
              pointerEvents: "none",
            }}
          >
            <CallBubble
              state={displayCallState}
              error={callError}
              disabled={callBubbleDisabled}
              onClick={handleCallBubbleClick}
              onPointerDown={handleDragPointerDown}
              onPointerMove={handleDragPointerMove}
              onPointerUp={handleDragPointerUp}
              onPointerCancel={handleDragPointerUp}
            />
          </div>
          {liveTranslationVisible && (
            <div style={{ pointerEvents: "none" }}>
              <LiveTranslationBubble
                state={liveTranslationState}
                disabled={liveTranslationBubbleDisabled}
                onClick={handleLiveTranslationBubbleClick}
                onPointerDown={handleDragPointerDown}
                onPointerMove={handleDragPointerMove}
                onPointerUp={handleDragPointerUp}
                onPointerCancel={handleDragPointerUp}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TickerPill({
  text,
  live,
  onToggleRecording,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: DragHandlers & {
  text: string;
  live: boolean;
  onToggleRecording?: () => void;
}): ReactNode {
  return (
    <ActiveWidgetShell
      width={TICKER_PILL_WIDTH}
      height={28}
      onClick={onToggleRecording}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: 999,
          background: "#050505",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 14px 0 12px",
          overflow: "hidden",
        }}
      >
        {live && (
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#ff3b30",
              flex: "0 0 auto",
            }}
          />
        )}
        <TextTicker text={text} live={live} />
      </div>
    </ActiveWidgetShell>
  );
}

function FileDropPill({
  state,
  status,
  progress,
  onOpenResult,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: DragHandlers & {
  state: WidgetFileDropState;
  fileName: string;
  status: FileTranscriptionStatus | null;
  progress: FileTranscriptionProgress | null;
  onOpenResult: () => void;
}): ReactNode {
  const { t } = useI18n();
  const isProcessing = state === "processing";
  const isSuccess = state === "success";
  const isError = state === "error";
  const isClosing = state === "closing";
  const progressPercent = getFileTranscriptionPercent(
    isSuccess ? "done" : isError ? "error" : (status ?? "idle"),
    progress,
  );
  const showPercent = isProcessing && progressPercent > 0;

  return (
    <ActiveWidgetShell
      width={FILE_DROP_WIDGET_WIDTH}
      height={FILE_DROP_WIDGET_HEIGHT}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      cursor={isSuccess ? "pointer" : "grab"}
      onClick={() => {
        if (isSuccess) {
          onOpenResult();
        }
      }}
    >
      <div
        style={{
          width: FILE_DROP_WIDGET_WIDTH,
          height: FILE_DROP_WIDGET_HEIGHT,
          borderRadius: 18,
          background: isError ? "rgba(42, 9, 9, 0.98)" : "rgba(5, 5, 5, 0.98)",
          border: "1.5px dashed rgba(255,255,255,0.34)",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "0 18px",
          boxShadow: "none",
          WebkitFontSmoothing: "antialiased",
          opacity: isClosing ? 0 : 1,
          transform: isClosing ? "scale(0.94)" : "scale(1)",
          transformOrigin: "center center",
          transition: "opacity 0.16s ease, transform 0.16s cubic-bezier(0.22, 1, 0.36, 1)",
          animation: isClosing
            ? undefined
            : "widget-file-drop-in 0.18s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            color: isError ? "#ff8f8f" : "rgba(255,255,255,0.86)",
            background: "rgba(255,255,255,0.08)",
          }}
        >
          {isProcessing ? (
            <IconLoader2 className="loading-soft-icon" size={20} stroke={2} />
          ) : isSuccess ? (
            <IconCheck size={20} stroke={2.4} />
          ) : (
            <IconFileMusic size={20} stroke={2} />
          )}
        </span>
        <span
          style={{
            minWidth: 0,
            overflow: "visible",
            whiteSpace: "nowrap",
            fontSize: 14,
            lineHeight: 1.2,
            fontWeight: 750,
            color: isError ? "#ffb4b4" : "rgba(255,255,255,0.94)",
          }}
        >
          {showPercent
            ? t("widget.fileDrop.transcribingPercent", {
                percent: progressPercent,
              })
            : t("widget.fileDrop.transcribing")}
        </span>
      </div>
    </ActiveWidgetShell>
  );
}

function CallBubble({
  state,
  error,
  disabled,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: DragHandlers & {
  state: WidgetCallState;
  error: string;
  disabled: boolean;
  onClick: () => void;
}): ReactNode {
  const { t } = useI18n();
  const isStarting = state === "starting";
  const isRecording = state === "recording";
  const isProcessing = state === "processing";
  const isSuccess = state === "success";
  const isError = state === "error";
  const copyIconColor = "rgba(255,255,255,0.72)";
  const title = isError
    ? error || t("widget.callBubble.error")
    : isStarting
      ? t("widget.callBubble.requestingAccess")
      : isProcessing
        ? t("widget.callBubble.transcribing")
        : isSuccess
          ? t("widget.callBubble.ready")
          : isRecording
            ? t("widget.callBubble.stopAndTranscribe")
            : t("widget.callBubble.record");
  const iconColor = disabled
    ? "rgba(255,255,255,0.28)"
    : isRecording || isError
      ? "#ff4d4d"
      : isSuccess
        ? "#fff"
        : copyIconColor;
  const background = "#050505";
  const iconSize = 12;

  return (
    <ActiveWidgetShell
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
      cursor={disabled ? "grab" : "pointer"}
      width={CALL_BUBBLE_SIZE}
      height={CALL_BUBBLE_SIZE}
    >
      {/* biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useSemanticElements: the bubble is a visual surface; the surrounding shell handles click and drag. */}
      <div
        aria-label={title}
        title={title}
        role="button"
        style={{
          width: CALL_BUBBLE_SIZE,
          height: CALL_BUBBLE_SIZE,
          borderRadius: 999,
          background,
          border: "none",
          color: iconColor,
          display: "grid",
          placeItems: "center",
          boxShadow: "none",
          opacity: disabled ? 0.72 : 1,
          transform: isRecording ? "scale(1.02)" : "scale(1)",
          transition:
            "background 0.16s ease, border-color 0.16s ease, color 0.16s ease, opacity 0.16s ease, transform 0.16s ease",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {isStarting || isProcessing ? (
          <IconLoader2 className="loading-soft-icon" size={iconSize} stroke={2.2} />
        ) : isSuccess ? (
          <IconCheck size={iconSize} stroke={2.6} />
        ) : isError ? (
          <span
            style={{
              fontSize: 12,
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            !
          </span>
        ) : (
          <IconPhoneCall size={iconSize} stroke={isRecording ? 2.4 : 2} />
        )}
      </div>
    </ActiveWidgetShell>
  );
}

function LiveTranslationBubble({
  state,
  disabled,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: DragHandlers & {
  state: WidgetLiveTranslationState;
  disabled: boolean;
  onClick: () => void;
}): ReactNode {
  const isActive = state === "recording";
  const isBusy = state === "starting" || state === "stopping";
  const title = isActive
    ? "Остановить синхронный перевод"
    : isBusy
      ? "Подключаем синхронный перевод"
      : "Начать синхронный перевод";

  return (
    <ActiveWidgetShell
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={onClick}
      cursor={disabled ? "grab" : "pointer"}
      width={CALL_BUBBLE_SIZE}
      height={CALL_BUBBLE_SIZE}
    >
      {/* biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useSemanticElements: the bubble is a visual surface; the surrounding shell handles click and drag. */}
      <div
        role="button"
        aria-label={title}
        aria-pressed={isActive}
        aria-disabled={disabled}
        title={title}
        style={{
          width: CALL_BUBBLE_SIZE,
          height: CALL_BUBBLE_SIZE,
          borderRadius: 999,
          background: "#050505",
          color: disabled
            ? "rgba(255,255,255,0.28)"
            : isActive
              ? "#ff4d4d"
              : "rgba(255,255,255,0.72)",
          display: "grid",
          placeItems: "center",
          opacity: disabled ? 0.72 : 1,
        }}
      >
        {isBusy ? (
          <IconLoader2 className="loading-soft-icon" size={12} stroke={2.2} />
        ) : (
          <IconLanguage size={12} stroke={isActive ? 2.5 : 2} />
        )}
      </div>
    </ActiveWidgetShell>
  );
}

interface DragHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}

function IdlePill({
  latestCopyText,
  onToggleRecording,
  onClick,
  onRememberPasteTarget,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: DragHandlers & {
  latestCopyText: string | null;
  onToggleRecording: () => void;
  onClick: () => void;
  onRememberPasteTarget: () => void;
}): ReactNode {
  const { t } = useI18n();
  const [isHovered, setIsHovered] = useState(false);
  const [copySucceeded, setCopySucceeded] = useState(false);
  const canCopy = Boolean(latestCopyText);
  const controlsVisible = isHovered;

  const copyLatestText = async () => {
    if (!latestCopyText) {
      return;
    }

    await writeText(latestCopyText);
    setCopySucceeded(true);
    window.setTimeout(() => {
      setCopySucceeded(false);
    }, 1400);
  };

  return (
    <ActiveWidgetShell
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerEnter={() => {
        onRememberPasteTarget();
        setIsHovered(true);
      }}
      onPointerLeave={() => setIsHovered(false)}
      width={IDLE_HOVER_WIDGET_WIDTH}
      height={IDLE_HOVER_WIDGET_HEIGHT}
      cursor="pointer"
      onClick={() => {
        void onClick();
      }}
    >
      <WidgetCoreShell
        width={WIDGET_SHELL_WIDTH}
        height={WIDGET_SHELL_HEIGHT}
        scale={isHovered ? IDLE_HOVER_SCALE : 1}
      >
        <FlowRecordingWidget state="idle" controlsVisible={controlsVisible} />
      </WidgetCoreShell>
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      >
        <WidgetRecordButton
          label={t("widget.idle.startRecording")}
          left={WIDGET_RECORD_BUTTON_LEFT}
          visible={controlsVisible}
          onActivate={onToggleRecording}
        />
        {canCopy && (
          <button
            type="button"
            aria-label={t("widget.idle.copyLatest")}
            title={copySucceeded ? t("widget.idle.copied") : t("widget.idle.copy")}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              void copyLatestText();
            }}
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              width: 12,
              height: 12,
              minWidth: 12,
              border: "none",
              borderRadius: 999,
              padding: 0,
              background: "transparent",
              color: "rgba(255,255,255,0.72)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: controlsVisible ? 1 : 0,
              transform: controlsVisible
                ? "translateY(-50%) scale(1)"
                : "translateY(-50%) scale(0.84)",
              transition:
                "opacity 0.14s ease, transform 0.14s ease, background 0.14s ease, color 0.14s ease",
              pointerEvents: controlsVisible ? "auto" : "none",
              cursor: "pointer",
              WebkitFontSmoothing: "antialiased",
            }}
          >
            {copySucceeded ? (
              <IconCheck size={12} stroke={2.4} />
            ) : (
              <IconCopy size={12} stroke={2} />
            )}
          </button>
        )}
      </div>
    </ActiveWidgetShell>
  );
}

function WidgetCoreShell({
  children,
  width = "100%",
  height = "100%",
  scale = 1,
}: {
  children?: ReactNode;
  width?: number | string;
  height?: number | string;
  scale?: number;
}): ReactNode {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 999,
        background: "transparent",
        border: "none",
        boxShadow: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "visible",
        transform: `scale(${scale})`,
        transformOrigin: "center center",
        transition: "transform 0.18s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {children}
    </div>
  );
}

interface RecordingPillProps {
  stream: MediaStream | null;
  locked: boolean;
  onToggleRecording: () => void;
}

function FlowRecordingWidget({
  state,
  stream = null,
  controlsVisible = false,
  longMark = "record",
}: {
  state: "idle" | "recording" | "processing" | "long";
  stream?: MediaStream | null;
  controlsVisible?: boolean;
  longMark?: "record" | "phone" | "success" | "error";
}): ReactNode {
  const showWave = state !== "idle";
  const isRecording = state === "recording" || state === "long";
  const widgetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isRecording) {
      widgetRef.current?.style.setProperty("--widget-wave-scale", "1");
      widgetRef.current?.style.setProperty("--widget-wave-opacity", "1");
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;
    let smoothedLevel = 0;

    void listen<{ rms: number; peak: number }>(NATIVE_VOICE_LEVEL_EVENT, (event) => {
      const { rms, peak } = event.payload;
      const boostedLevel = Math.min(1, Math.max(rms * 15, peak * 9)) ** 0.58;
      const quietFloor = rms > 0.003 ? 0.1 : 0.025;
      smoothedLevel = smoothedLevel * 0.48 + Math.max(quietFloor, boostedLevel) * 0.52;

      widgetRef.current?.style.setProperty("--widget-wave-scale", String(1 + smoothedLevel * 0.42));
      widgetRef.current?.style.setProperty(
        "--widget-wave-opacity",
        String(0.82 + smoothedLevel * 0.18),
      );
    }).then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isRecording]);

  useEffect(() => {
    if (!stream || state !== "recording") {
      return;
    }

    const audioContext = new AudioContext({ latencyHint: "interactive" });
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.32;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.fftSize);
    let animationFrame = 0;
    let smoothedLevel = 0;
    let lastDrawTime = 0;

    const draw = (now: number) => {
      animationFrame = requestAnimationFrame(draw);
      if (now - lastDrawTime < FRAME_INTERVAL_MS) {
        return;
      }
      lastDrawTime = now;

      analyser.getByteTimeDomainData(dataArray);

      let sumSquares = 0;
      for (let index = 0; index < dataArray.length; index += 1) {
        const normalized = (dataArray[index] - 128) / 128;
        sumSquares += normalized * normalized;
      }

      const rms = Math.sqrt(sumSquares / dataArray.length);
      const boostedLevel = Math.min(1, rms * 15) ** 0.58;
      const quietFloor = rms > 0.003 ? 0.1 : 0.025;
      smoothedLevel = smoothedLevel * 0.48 + Math.max(quietFloor, boostedLevel) * 0.52;

      widgetRef.current?.style.setProperty("--widget-wave-scale", String(1 + smoothedLevel * 0.42));
      widgetRef.current?.style.setProperty(
        "--widget-wave-opacity",
        String(0.82 + smoothedLevel * 0.18),
      );
    };

    void audioContext.resume().catch(() => {});
    animationFrame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationFrame);
      source.disconnect();
      void audioContext.close();
    };
  }, [state, stream]);

  return (
    <div
      ref={widgetRef}
      className={`flow-recording-widget is-${state}${controlsVisible ? " is-controls-visible" : ""}`}
      aria-hidden="true"
    >
      {state === "idle" && (
        <div className="flow-widget-idle">
          <span />
          <span />
        </div>
      )}
      {showWave && (
        <svg viewBox="0 0 190 34" preserveAspectRatio="none" aria-hidden="true">
          {WIDGET_WAVES.map((wave) => (
            <path
              key={wave.className}
              className={`widget-wave-line ${wave.className}`}
              d={wave.values[0]}
            >
              <animate
                attributeName="d"
                dur={wave.dur}
                values={wave.values.join("; ")}
                keyTimes="0; 0.5; 1"
                calcMode="spline"
                keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
                repeatCount="indefinite"
              />
            </path>
          ))}
        </svg>
      )}
      {state === "long" && (
        <span className={`flow-widget-long-mark is-${longMark}`}>
          {longMark === "phone" && <IconPhoneCall size={9} stroke={2.2} />}
          {longMark === "success" && <IconCheck size={9} stroke={2.6} />}
          {longMark === "error" && "!"}
        </span>
      )}
    </div>
  );
}

function ActiveWidgetShell({
  children,
  width = WIDGET_SHELL_WIDTH,
  height = WIDGET_SHELL_HEIGHT,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerEnter,
  onPointerLeave,
  onClick,
  cursor = "grab",
}: {
  children: ReactNode;
  width?: number;
  height?: number;
  onClick?: () => void;
  cursor?: string;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
} & DragHandlers): ReactNode {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: this draggable shell handles pointer gestures and clicks; keyboard control is provided by the widget's global hotkeys.
    <div
      style={{
        width,
        height,
        borderRadius: 999,
        background: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        pointerEvents: "auto",
        transformOrigin: "center center",
        transition: "transform 0.18s ease",
        overflow: "visible",
        cursor,
      }}
      onClick={() => {
        onClick?.();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => {
        void onPointerMove(event);
      }}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>
  );
}

function RecordingPill({
  stream,
  locked,
  onToggleRecording,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: RecordingPillProps & DragHandlers): ReactNode {
  const { t } = useI18n();
  return (
    <ActiveWidgetShell
      width={IDLE_HOVER_WIDGET_WIDTH}
      height={IDLE_HOVER_WIDGET_HEIGHT}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <WidgetCoreShell width={ACTIVE_WIDGET_SHELL_WIDTH} height={ACTIVE_WIDGET_SHELL_HEIGHT}>
        <FlowRecordingWidget state={locked ? "long" : "recording"} stream={stream} />
      </WidgetCoreShell>
      {locked && (
        <button
          type="button"
          aria-label={t("widget.recording.stopRecording")}
          title={t("widget.recording.stopRecording")}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onToggleRecording();
          }}
          style={{
            position: "absolute",
            top: "50%",
            left: WIDGET_RECORD_BUTTON_LEFT,
            width: 12,
            height: 12,
            border: "none",
            borderRadius: 999,
            padding: 0,
            background: "transparent",
            transform: "translateY(-50%)",
            pointerEvents: "auto",
            cursor: "pointer",
          }}
        />
      )}
    </ActiveWidgetShell>
  );
}

function ProcessingPill({
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: DragHandlers): ReactNode {
  return (
    <ActiveWidgetShell
      width={IDLE_HOVER_WIDGET_WIDTH}
      height={IDLE_HOVER_WIDGET_HEIGHT}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <WidgetCoreShell width={ACTIVE_WIDGET_SHELL_WIDTH} height={ACTIVE_WIDGET_SHELL_HEIGHT}>
        <FlowRecordingWidget state="processing" />
      </WidgetCoreShell>
    </ActiveWidgetShell>
  );
}
