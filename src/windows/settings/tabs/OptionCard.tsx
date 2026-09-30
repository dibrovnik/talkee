import { useState } from "react";

import { useI18n } from "../../../lib/i18n";
import { IconCheck } from "../../../lib/icons";

interface OptionCardProps {
  active?: boolean;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  badge?: string;
  onClick?: () => void;
  disabled?: boolean;
}

const CARD_TEXT_PREVIEW_LIMIT = 250;

/**
 * Long card text (e.g. a prompt body) shown truncated with a Раскрыть/Скрыть
 * toggle — the same pattern as the history table. The toggle stops propagation so
 * it doesn't also trigger the card's own onClick (which selects the prompt).
 */
function CollapsibleCardText({ text }: { text: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const tooLong = text.length > CARD_TEXT_PREVIEW_LIMIT;
  const visible =
    tooLong && !expanded ? `${text.slice(0, CARD_TEXT_PREVIEW_LIMIT).trimEnd()}...` : text;
  return (
    <div style={{ display: "grid", gap: 3 }}>
      <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{visible}</span>
      {tooLong && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          style={{
            justifySelf: "start",
            padding: 0,
            border: "none",
            background: "transparent",
            color: "var(--text-hi)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "var(--font-main)",
          }}
        >
          {expanded ? t("mainTab.collapse") : t("mainTab.expand")}
        </button>
      )}
    </div>
  );
}

function OptionCard({
  active = false,
  icon,
  title,
  description,
  badge,
  onClick,
  disabled = false,
}: OptionCardProps) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: option cards are selected with the mouse; each card contains its own focusable controls.
    // biome-ignore lint/a11y/noStaticElementInteractions: option cards are composite clickable surfaces, not plain static elements.
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        position: "relative",
        padding: 18,
        borderRadius: 10,
        background: active ? "var(--dropdown-active)" : "var(--surface)",
        border: `1px solid ${active ? "var(--border-strong)" : "var(--border)"}`,
        color: "var(--text-hi)",
        cursor: disabled ? "not-allowed" : onClick ? "pointer" : "default",
        transition: "transform 0.16s ease, border-color 0.16s ease, background 0.16s ease",
        opacity: disabled ? 0.72 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled && onClick && !active) e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div style={{ display: "flex", gap: 16 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 999,
            background: active ? "var(--control-muted-strong)" : "var(--avatar-bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: active ? "var(--text-hi)" : "var(--text-mid)",
            flexShrink: 0,
          }}
        >
          {icon}
        </div>

        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: active ? 700 : 600,
                color: "var(--text-hi)",
              }}
            >
              {title}
            </div>
            {badge && (
              <div className="label" style={{ color: "var(--text-low)" }}>
                {badge}
              </div>
            )}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.65, color: "var(--text-mid)" }}>
            {description}
          </div>
        </div>
      </div>

      {active && (
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            color: "var(--text-hi)",
          }}
        >
          <IconCheck size={18} stroke={2.6} />
        </div>
      )}
    </div>
  );
}

export { CollapsibleCardText, OptionCard, type OptionCardProps };
