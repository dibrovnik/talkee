import type { ReactElement } from "react";

export interface ProgressBarProps {
  /** Progress in the 0..1 range. */
  value: number;
  ariaLabel?: string;
  className?: string;
}

export function ProgressBar({ value, ariaLabel, className }: ProgressBarProps): ReactElement {
  const percent = Math.max(0, Math.min(1, value)) * 100;

  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className={["ui-progress", className ?? ""].filter(Boolean).join(" ")}
    >
      <div className="ui-progress__bar" style={{ width: `${percent}%` }} />
    </div>
  );
}
