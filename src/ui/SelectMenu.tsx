import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import { type Icon, IconCheck, IconChevronDown } from "../lib/icons";
import { firstMatchingIndex, moveListIndex } from "./keyboard";

export interface SelectMenuOption {
  value: string;
  label: string;
  description?: string;
  icon?: Icon;
}

export interface SelectMenuProps {
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
}

const TYPEAHEAD_RESET_MS = 500;

/**
 * Custom popover list for options that need icons or descriptions. Unlike the
 * native `PopUpButton`, it implements the full keyboard model required by the
 * spec: arrows, Enter, Escape and first-letter type-ahead.
 */
export function SelectMenu({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  placeholder,
  className,
  style,
}: SelectMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<number | null>(null);

  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      listRef.current?.focus();
    }
  }, [open]);

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current !== null) {
        window.clearTimeout(typeaheadTimerRef.current);
      }
    },
    [],
  );

  const openMenu = (): void => {
    const index = options.findIndex((option) => option.value === value);
    setActiveIndex(index >= 0 ? index : 0);
    setOpen(true);
  };

  const commit = (index: number): void => {
    const option = options[index];
    if (!option) {
      return;
    }
    onChange(option.value);
    setOpen(false);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) {
      return;
    }
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      openMenu();
    }
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commit(activeIndex);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        moveListIndex(index, event.key === "ArrowDown" ? 1 : -1, options.length),
      );
      return;
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      typeaheadRef.current += event.key;
      if (typeaheadTimerRef.current !== null) {
        window.clearTimeout(typeaheadTimerRef.current);
      }
      typeaheadTimerRef.current = window.setTimeout(() => {
        typeaheadRef.current = "";
      }, TYPEAHEAD_RESET_MS);
      const match = firstMatchingIndex(
        options.map((option) => option.label),
        typeaheadRef.current,
        activeIndex,
      );
      if (match >= 0) {
        setActiveIndex(match);
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className={className}
      style={{ position: "relative", minWidth: 0, ...style }}
    >
      <button
        type="button"
        className="ui-button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        style={{ width: "100%", justifyContent: "space-between", gap: 8 }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {current?.icon ? <current.icon size={14} /> : null}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {current?.label ?? placeholder ?? value}
          </span>
        </span>
        <IconChevronDown
          size={12}
          style={{
            flexShrink: 0,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      </button>

      {open ? (
        <div
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          onKeyDown={handleListKeyDown}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            maxHeight: 280,
            overflowY: "auto",
            background: "var(--dropdown-bg)",
            border: "1px solid var(--separator)",
            borderRadius: "var(--radius-group)",
            boxShadow: "var(--shadow-modal)",
            zIndex: 100,
            padding: 4,
          }}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            const IconComponent = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(index)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  padding: "5px 8px",
                  borderRadius: 5,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: active ? "var(--selected-bg)" : "transparent",
                  color: active ? "var(--accent-contrast)" : "var(--label)",
                  font: "inherit",
                  fontSize: "var(--fs-body)",
                }}
              >
                {IconComponent ? <IconComponent size={14} /> : null}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {option.label}
                  </span>
                  {option.description ? (
                    <span
                      style={{
                        display: "block",
                        fontSize: "var(--fs-callout)",
                        opacity: active ? 0.85 : 0.7,
                      }}
                    >
                      {option.description}
                    </span>
                  ) : null}
                </span>
                {selected ? <IconCheck size={13} weight="bold" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
