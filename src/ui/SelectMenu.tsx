import * as Select from "@radix-ui/react-select";
import type { CSSProperties, ReactElement } from "react";

import { type Icon, IconCheck, IconChevronDown } from "../lib/icons";

export interface SelectMenuOption {
  value: string;
  label: string;
  description?: string;
  icon?: Icon;
}

export interface SelectMenuProps {
  value: string;
  options: SelectMenuOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
}

/** Radix owns focus, type-ahead and dismissal; native lists use PopUpButton. */
export function SelectMenu({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  placeholder,
  className,
  style,
}: SelectMenuProps): ReactElement {
  const current = options.find((option) => option.value === value);

  return (
    <Select.Root
      value={current ? `option:${value}` : ""}
      onValueChange={(next) => onChange(next.slice("option:".length))}
      disabled={disabled}
    >
      <Select.Trigger
        className={["ui-button", "ui-select-trigger", className ?? ""].filter(Boolean).join(" ")}
        aria-label={ariaLabel}
        style={style}
      >
        <Select.Value placeholder={placeholder ?? value}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {current?.icon ? <current.icon size={16} aria-hidden="true" /> : null}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {current?.label ?? placeholder ?? value}
            </span>
          </span>
        </Select.Value>
        <Select.Icon>
          <IconChevronDown size={14} aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="ui-select-content" position="popper" sideOffset={6}>
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={`option:${option.value}`}
                textValue={option.label}
                className="ui-select-option"
              >
                {option.icon ? <option.icon size={16} aria-hidden="true" /> : null}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <Select.ItemText>{option.label}</Select.ItemText>
                  {option.description ? (
                    <span className="ui-select-option__description">{option.description}</span>
                  ) : null}
                </span>
                <Select.ItemIndicator>
                  <IconCheck size={16} aria-hidden="true" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
