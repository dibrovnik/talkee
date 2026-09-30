import type { ReactElement, ReactNode } from "react";

export interface BadgeProps {
  children: ReactNode;
  className?: string;
}

export function Badge({ children, className }: BadgeProps): ReactElement {
  return (
    <span className={["ui-badge", className ?? ""].filter(Boolean).join(" ")}>{children}</span>
  );
}
