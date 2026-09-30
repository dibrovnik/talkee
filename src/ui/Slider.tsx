import type { CSSProperties, ReactElement } from "react";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  /** Fired once the drag/keyboard interaction ends — use it to persist. */
  onCommit?: () => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

export function Slider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  ariaLabel,
  id,
  className,
  style,
}: SliderProps): ReactElement {
  return (
    <input
      id={id}
      type="range"
      className={["ui-slider", className ?? ""].filter(Boolean).join(" ")}
      style={style}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(Number(event.target.value))}
      onPointerUp={onCommit ? () => onCommit() : undefined}
      onPointerCancel={onCommit ? () => onCommit() : undefined}
      onKeyUp={onCommit ? () => onCommit() : undefined}
      onBlur={onCommit ? () => onCommit() : undefined}
    />
  );
}
