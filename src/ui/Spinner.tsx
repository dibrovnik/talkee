import type { ReactElement } from "react";

export interface SpinnerProps {
  size?: number;
  /** Accessible label; defaults to the Russian "Загрузка". */
  label?: string;
  className?: string;
}

const STROKE_COUNT = 12;

/** NSProgressIndicator-style spinner: twelve spokes fading around the circle. */
export function Spinner({ size = 16, label = "Загрузка", className }: SpinnerProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="progressbar"
      aria-label={label}
      className={["ui-spinner", className ?? ""].filter(Boolean).join(" ")}
    >
      {Array.from({ length: STROKE_COUNT }, (_, index) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed set of spinner spokes, the order never changes.
          key={index}
          x="11"
          y="2"
          width="2"
          height="5"
          rx="1"
          fill="currentColor"
          opacity={0.15 + (index / (STROKE_COUNT - 1)) * 0.85}
          transform={`rotate(${index * (360 / STROKE_COUNT)} 12 12)`}
        />
      ))}
    </svg>
  );
}
