import { type KeyboardEvent, type ReactElement, type ReactNode, useState } from "react";

import { useI18n } from "../../../lib/i18n";
import { IconCheck } from "../../../lib/icons";

interface OptionCardProps {
  active?: boolean;
  icon: ReactNode;
  title: string;
  description: ReactNode;
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
function CollapsibleCardText({ text }: { text: string }): ReactElement {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const tooLong = text.length > CARD_TEXT_PREVIEW_LIMIT;
  const visible =
    tooLong && !expanded ? `${text.slice(0, CARD_TEXT_PREVIEW_LIMIT).trimEnd()}...` : text;
  return (
    <div className="ui-expandable-text">
      <span style={{ whiteSpace: "pre-wrap" }}>{visible}</span>
      {tooLong && (
        <button
          type="button"
          className="ui-disclosure-link"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {expanded ? t("mainTab.collapse") : t("mainTab.expand")}
        </button>
      )}
    </div>
  );
}

/** Radio-style list of `OptionCard` rows inside one grouped surface. */
function OptionList({
  ariaLabel,
  children,
}: {
  ariaLabel?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="ui-form-group ui-choice-list">
      {children}
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
}: OptionCardProps): ReactElement {
  const select = (): void => {
    if (!disabled) onClick?.();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      select();
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: the row hosts nested controls, so a native radio input cannot wrap it.
    <div
      role="radio"
      aria-checked={active}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={select}
      onKeyDown={handleKeyDown}
      className={[
        "ui-choice",
        active ? "ui-choice--active" : "",
        disabled ? "ui-choice--disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="ui-choice__icon">{icon}</div>
      <div className="ui-choice__main">
        <div className="ui-choice__title">
          <span>{title}</span>
          {badge && <span className="ui-choice__badge">{badge}</span>}
        </div>
        <div className="ui-choice__desc">{description}</div>
      </div>
      <div className="ui-choice__check" aria-hidden="true">
        {active && <IconCheck size={14} stroke={2.6} />}
      </div>
    </div>
  );
}

export { CollapsibleCardText, OptionCard, type OptionCardProps, OptionList };
