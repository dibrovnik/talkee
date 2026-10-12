import type { ReactElement, ReactNode } from "react";

import type { Icon } from "../lib/icons";

export interface SidebarItemProps {
  label: ReactNode;
  icon?: Icon;
  active?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  className?: string;
}

export function SidebarItem({
  label,
  icon: IconComponent,
  active,
  dimmed,
  onClick,
  className,
}: SidebarItemProps): ReactElement {
  const classes = [
    "ui-sidebar-item",
    active ? "ui-sidebar-item--active" : "",
    active && dimmed ? "ui-sidebar-item--inactive" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={classes}
    >
      {IconComponent ? <IconComponent size={16} weight="regular" aria-hidden="true" /> : null}
      <span>{label}</span>
    </button>
  );
}
