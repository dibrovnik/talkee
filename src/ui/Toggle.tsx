import type { ReactElement } from "react";

export type ToggleSize = "regular" | "large";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: ToggleSize;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
}

export function Toggle({
  checked,
  onChange,
  size = "regular",
  disabled,
  id,
  ariaLabel,
  className,
}: ToggleProps): ReactElement {
  const classes = [
    "ui-toggle",
    size === "large" ? "ui-toggle--large" : "",
    checked ? "ui-toggle--on" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={classes}
    />
  );
}
