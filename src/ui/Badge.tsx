import type { HTMLAttributes, ReactElement, ReactNode } from "react";

export type BadgeVariant = "neutral" | "success" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({
  children,
  variant = "neutral",
  className,
  ...rest
}: BadgeProps): ReactElement {
  const classes = ["ui-badge", variant !== "neutral" ? `ui-badge--${variant}` : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
