import type { KeyboardEvent, ReactElement } from "react";

import { segmentIndexForKey } from "./keyboard";

export interface SegmentedControlOption<Value extends string = string> {
  value: Value;
  label: string;
  /** Shows a marker dot after the label (e.g. an unconfigured slot). */
  needsAttention?: boolean;
}

export interface SegmentedControlProps<Value extends string = string> {
  value: Value;
  options: SegmentedControlOption<Value>[];
  onChange: (value: Value) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl<Value extends string = string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  className,
}: SegmentedControlProps<Value>): ReactElement {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) {
      return;
    }
    const current = options.findIndex((option) => option.value === value);
    const next = segmentIndexForKey(current, event.key, options.length);
    if (next === null) {
      return;
    }
    event.preventDefault();
    const option = options[next];
    if (option) {
      onChange(option.value);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={["ui-segmented", className ?? ""].filter(Boolean).join(" ")}
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a segmented control is a radiogroup of styled buttons; native radios cannot be rendered as macOS segments.
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            className={`ui-segment${selected ? " ui-segment--selected" : ""}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {option.needsAttention ? (
              <span className="ui-segment__marker" title={option.label} aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
