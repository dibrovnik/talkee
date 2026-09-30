import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ReactElement } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconAlertCircle, IconInfoCircle } from "../../lib/icons";

import {
  NOTICE_AREA_HEIGHT,
  NOTICE_WIDGET_WIDTH,
  WIDGET_NOTICE_EVENT,
  type WidgetNoticeState,
} from "./widgetConstants";

export function WidgetNoticeOverlay(): ReactElement | null {
  const [notice, setNotice] = useState<WidgetNoticeState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;

    const unlistenPromise = listen<WidgetNoticeState>(WIDGET_NOTICE_EVENT, (event) => {
      if (!mounted) {
        return;
      }

      // A fresh notice always starts collapsed (Rust re-shows it at the small size).
      setExpanded(false);
      setNotice(event.payload);
    });

    return () => {
      mounted = false;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Resize the OS window to fit the bubble whenever the expanded state (or the
  // message) changes. scrollHeight is measured after React has dropped the
  // line-clamp, so it reflects the full text height including padding.
  useLayoutEffect(() => {
    if (!notice) {
      return;
    }
    const height =
      expanded && bubbleRef.current ? bubbleRef.current.scrollHeight : NOTICE_AREA_HEIGHT;
    void invoke("expand_widget_notice", { height });
  }, [expanded, notice]);

  if (!notice) {
    return null;
  }

  const toggleExpanded = () => {
    setExpanded((value) => !value);
  };
  const Icon = notice.tone === "error" ? IconAlertCircle : IconInfoCircle;
  const iconColor = notice.tone === "error" ? "var(--danger)" : "var(--label-2)";

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: the notice bubble is a styled container with expand/collapse behaviour, not a plain <button>. */}
      <div
        ref={bubbleRef}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggleExpanded}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }

          event.preventDefault();
          toggleExpanded();
        }}
        className="widget-overlay-enter"
        style={{
          position: "relative",
          width: NOTICE_WIDGET_WIDTH,
          minHeight: NOTICE_AREA_HEIGHT,
          maxHeight: expanded ? "100vh" : NOTICE_AREA_HEIGHT,
          padding: "10px 14px",
          borderRadius: 12,
          fontSize: "var(--fs-subhead)",
          lineHeight: 1.4,
          color: "var(--label)",
          background: "transparent",
          // The HUD material is always dark, so labels resolve in the dark scheme.
          colorScheme: "dark",
          overflowY: expanded ? "auto" : "hidden",
          overflowX: "hidden",
          pointerEvents: "auto",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            minHeight: NOTICE_AREA_HEIGHT - 20,
            display: "grid",
            gridTemplateColumns: "16px minmax(0, 1fr)",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon
            size={15}
            stroke={2.1}
            aria-hidden="true"
            style={{ flexShrink: 0, color: iconColor }}
          />
          <div
            style={
              expanded
                ? { paddingRight: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }
                : {
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    paddingRight: 4,
                  }
            }
          >
            {notice.message}
          </div>
        </div>
      </div>
    </div>
  );
}
