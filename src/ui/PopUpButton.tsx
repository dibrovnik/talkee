import type { CSSProperties, ReactElement } from "react";

export interface PopUpButtonOption {
  value: string;
  label: string;
}

export interface PopUpButtonProps {
  value: string;
  options: PopUpButtonOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Wrapper over the native `<select>`. WKWebView renders it as an NSPopUpButton
 * with the system menu, so it is native and keyboard-accessible for free. Use
 * `SelectMenu` instead when options need icons or descriptions.
 */
export function PopUpButton({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  id,
  className,
  style,
}: PopUpButtonProps): ReactElement {
  return (
    <select
      id={id}
      className={["ui-select", className ?? ""].filter(Boolean).join(" ")}
      style={style}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
