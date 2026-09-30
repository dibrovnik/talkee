import type { ReactElement } from "react";

import { IconChevronDown } from "../lib/icons";
import { Button } from "../ui/Button";

export function ModelCardDisclosureButton({
  expanded,
  onToggle,
  label,
}: {
  expanded: boolean;
  onToggle: () => void;
  label: string;
}): ReactElement {
  return (
    <Button
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className="ui-icon-button ui-model-disclosure"
    >
      <IconChevronDown
        size={15}
        stroke={2}
        aria-hidden="true"
        style={{
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 160ms ease",
        }}
      />
    </Button>
  );
}
