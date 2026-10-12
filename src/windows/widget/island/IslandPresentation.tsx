import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { NATIVE_VOICE_LEVEL_EVENT } from "../../../lib/hotkeyEvents";
import { useI18n } from "../../../lib/i18n";
import { IconCopy } from "../../../lib/icons";
import { logError } from "../../../lib/logger";
import { Button } from "../../../ui/Button";
import { TextTicker } from "../ticker/TextTicker";
import {
  computeIslandLayout,
  type IslandLayoutInput,
  type IslandVisualState,
  islandTransition,
} from "./islandLayout";
import { islandBarScale, islandVoiceLevel } from "./islandLevel";
import { type IslandNotice, islandNoticeIsInteractive, islandShowsCopyButton } from "./islandState";

const LEVEL_FRAME_MS = 1000 / 30;

export interface IslandPresentationProps {
  anchor: IslandLayoutInput;
  state: IslandVisualState;
  notice: IslandNotice | null;
  cleanupEnabled: boolean;
  elapsedMs: number;
  tickerText: string;
  tickerLive: boolean;
  copyText: string | null;
}

export function IslandPresentation({
  anchor,
  state,
  notice,
  cleanupEnabled,
  elapsedMs,
  tickerText,
  tickerLive,
  copyText,
}: IslandPresentationProps): ReactElement {
  const { t } = useI18n();
  const reduced = usePrefersReducedMotion();
  const showCopy = islandShowsCopyButton(state, copyText);
  const layout = computeIslandLayout(state, anchor, {
    cleanupEnabled,
    noticeText: notice?.message ?? "",
    ticker: tickerText.length > 0,
  });
  const earWidth = Math.max(0, (layout.width - anchor.notchWidth) / 2);
  const expandedRadius = layout.expanded ? 22 : 14;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        pointerEvents: islandNoticeIsInteractive(notice) ? "auto" : "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          transform: "translateX(-50%)",
          width: layout.width,
          height: layout.height,
          background: "#000",
          borderBottomLeftRadius: expandedRadius,
          borderBottomRightRadius: expandedRadius,
          opacity: reduced && state === "idle" ? 0 : 1,
          transition: islandTransition(reduced),
        }}
      >
        <Shoulder side="left" />
        <Shoulder side="right" />
        <Slot
          side="left"
          width={earWidth}
          height={tickerText ? anchor.notchHeight : undefined}
          reduced={reduced}
          contentKey={layout.leftSlot}
        >
          {layout.leftSlot === "recording" && (
            <>
              <RecordingDot />
              <Timer elapsedMs={elapsedMs} />
            </>
          )}
          {layout.leftSlot === "cleanup" && <CleanupMark label={t("cleanup.indicator")} />}
        </Slot>
        <Slot
          side="right"
          width={earWidth}
          height={tickerText ? anchor.notchHeight : undefined}
          reduced={reduced}
          contentKey={layout.rightSlot}
        >
          {layout.rightSlot === "level" && <LevelBars active={state === "recording"} />}
          {layout.rightSlot === "spinner" && <ProcessingSpinner reduced={reduced} />}
          {layout.rightSlot === "check" &&
            (showCopy && copyText ? (
              <CopyButton
                label={t("widget.idle.copy")}
                onCopy={() => {
                  void writeText(copyText);
                }}
              />
            ) : (
              <DoneCheck />
            ))}
          {layout.rightSlot === "call" && <CallLabel label={t("widget.island.call")} />}
        </Slot>
        {layout.expanded && notice && (
          <div
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              top: anchor.notchHeight + 8,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                color: "#fff",
                fontSize: 13,
                lineHeight: "16px",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {notice.message}
            </div>
            {notice.actionLabel && (
              <Button
                style={{ background: "#fff", color: "#000" }}
                onClick={() => {
                  if (notice.actionTab) {
                    void invoke("open_settings_tab", { tab: notice.actionTab });
                  }
                  void invoke("hide_widget_notice");
                }}
              >
                {notice.actionLabel}
              </Button>
            )}
          </div>
        )}
        {tickerText && (
          <div
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              bottom: 6,
              height: 18,
              display: "flex",
              alignItems: "center",
            }}
          >
            <TextTicker text={tickerText} live={tickerLive} />
          </div>
        )}
      </div>
    </div>
  );
}

function Shoulder({ side }: { side: "left" | "right" }): ReactElement {
  const mirror = side === "right";
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        [side]: -8,
        width: 8,
        height: 8,
        background: `radial-gradient(circle at ${mirror ? "100%" : "0"} 100%, transparent 8px, #000 8.5px)`,
      }}
    />
  );
}

function Slot({
  side,
  width,
  height,
  reduced,
  contentKey,
  children,
}: {
  side: "left" | "right";
  width: number;
  height?: number;
  reduced: boolean;
  contentKey: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        [side]: 0,
        width,
        height: height ?? "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        overflow: "hidden",
        transition: islandTransition(reduced),
      }}
    >
      <div key={contentKey} className="island-slot-content">
        {children}
      </div>
    </div>
  );
}

function RecordingDot(): ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff3b30", flex: "0 0 auto" }}
    />
  );
}

function Timer({ elapsedMs }: { elapsedMs: number }): ReactElement {
  return (
    <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", color: "#fff" }}>
      {formatIslandTimer(elapsedMs)}
    </span>
  );
}

function LevelBars({ active }: { active: boolean }): ReactElement {
  const level = useVoiceLevel(active);
  return (
    <span
      aria-hidden="true"
      style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 14 }}
    >
      {[0, 1, 2, 3, 4].map((index) => {
        return (
          <span
            key={index}
            className="island-level-bar"
            style={{
              width: 2,
              height: 14,
              transform: `scaleY(${islandBarScale(level, index)})`,
              borderRadius: 1,
              background: "#fff",
            }}
          />
        );
      })}
    </span>
  );
}

function ProcessingSpinner({ reduced }: { reduced: boolean }): ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        border: "1.5px solid rgba(255,255,255,0.35)",
        borderTopColor: "#fff",
        animation: reduced ? "none" : "spin 0.8s linear infinite",
      }}
    />
  );
}

function CopyButton({ label, onCopy }: { label: string; onCopy: () => void }): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onCopy();
      }}
      style={{
        width: 22,
        height: 22,
        border: "none",
        borderRadius: 11,
        padding: 0,
        background: "rgba(255,255,255,0.16)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        pointerEvents: "auto",
      }}
    >
      <IconCopy size={12} stroke={2} />
    </button>
  );
}

function DoneCheck(): ReactElement {
  return (
    <span aria-hidden="true" style={{ color: "#fff", fontSize: 14, lineHeight: 1 }}>
      ✓
    </span>
  );
}

function CleanupMark({ label }: { label: string }): ReactElement {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }}
    />
  );
}

function CallLabel({ label }: { label: string }): ReactElement {
  return <span style={{ fontSize: 12, color: "#fff" }}>{label}</span>;
}

function formatIslandTimer(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function useVoiceLevel(active: boolean): number {
  const [level, setLevel] = useState(0);
  const lastFrame = useRef(0);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<{ rms: number; peak: number }>(NATIVE_VOICE_LEVEL_EVENT, (event) => {
      const now = performance.now();
      if (now - lastFrame.current < LEVEL_FRAME_MS) {
        return;
      }
      lastFrame.current = now;
      const { rms, peak } = event.payload;
      const next = islandVoiceLevel(rms, peak);
      if (!disposed) {
        setLevel(next);
      }
    })
      .then((stop) => {
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
      })
      .catch((error) => {
        if (!disposed)
          void logError("ISLAND", `Failed to listen for voice levels: ${String(error)}`);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active]);

  return level;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (): void => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
