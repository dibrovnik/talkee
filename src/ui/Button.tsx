import type { ButtonHTMLAttributes, ReactElement } from "react";

export type ButtonVariant = "default" | "primary" | "destructive";
export type ButtonSize = "regular" | "large";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "default",
  size = "regular",
  type = "button",
  className,
  ...rest
}: ButtonProps): ReactElement {
  const classes = [
    "ui-button",
    variant === "primary" ? "ui-button--primary" : "",
    variant === "destructive" ? "ui-button--destructive" : "",
    size === "large" ? "ui-button--large" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <button type={type} className={classes} {...rest} />;
}
