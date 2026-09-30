import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { IconDots } from "../lib/icons";
import { type MenuPosition, resolveRowActionsMenuPosition } from "./rowActionsMenuPosition";

export interface RowActionItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Tooltip shown on a disabled item, explaining why it can't be used. */
  hint?: string;
}

/**
 * Compact "⋯" button that opens a small dropdown of row actions. Reused by the
 * history rows (MainTab) and the summary-history rows (SummaryModal). Closes on
 * outside click or after an item is chosen.
 */
export function RowActionsMenu({
  items,
  label,
}: {
  items: RowActionItem[];
  label?: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback((): void => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;

    const anchorRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    setPosition(
      resolveRowActionsMenuPosition({
        anchorRight: anchorRect.right,
        anchorTop: anchorRect.top,
        anchorBottom: anchorRect.bottom,
        menuWidth: menuRect.width,
        menuHeight: menuRect.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    updatePosition();
  }, [items, open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
        <button
          ref={buttonRef}
          type="button"
          className="ui-icon-button"
          aria-label={label}
          title={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
        >
          <IconDots size={16} />
        </button>
      </div>

      {open &&
        createPortal(
          // biome-ignore lint/a11y/useKeyWithClickEvents: the menu handles keyboard interaction via its own focus management; this handler only stops propagation.
          <div
            ref={menuRef}
            role="menu"
            onClick={(event) => event.stopPropagation()}
            className="ui-menu"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              visibility: position ? "visible" : "hidden",
            }}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.disabled ? item.hint : undefined}
                className={`ui-menu-item${item.danger ? " ui-menu-item--danger" : ""}`}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
