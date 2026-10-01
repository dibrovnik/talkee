import * as RadioGroup from "@radix-ui/react-radio-group";
import type { ReactElement } from "react";

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
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => {
        const option = options.find((option) => option.value === next);
        if (option) onChange(option.value);
      }}
      orientation="horizontal"
      disabled={disabled}
      aria-label={ariaLabel}
      className={["ui-segmented", className ?? ""].filter(Boolean).join(" ")}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            disabled={disabled}
            className={`ui-segment${selected ? " ui-segment--selected" : ""}`}
          >
            {option.label}
            {option.needsAttention ? (
              <span className="ui-segment__marker" title={option.label} aria-hidden="true" />
            ) : null}
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
