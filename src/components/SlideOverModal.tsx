import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import { IconX } from "../lib/icons";

/**
 * A panel that slides in from the right over a dimmed backdrop. Closes on the
 * close button, a click on the free area to the left (backdrop), or Escape.
 * Manages its own enter/exit animation, then calls `onClose` once the exit
 * transition finishes, so the parent can simply unmount it.
 */
export function SlideOverModal({
  onClose,
  title,
  width = 440,
  topOffset = 0,
  children,
}: {
  onClose: () => void;
  title?: ReactNode;
  width?: number | string;
  topOffset?: number | string;
  children: ReactNode;
}): ReactElement {
  const { t } = useI18n();
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const requestClose = () => {
    setEntered(false);
    window.setTimeout(onClose, 240);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the backdrop closes the modal on click; keyboard users have Escape and the close button.
    <div
      onClick={requestClose}
      className={`ui-slide-over${entered ? " ui-slide-over--entered" : ""}`}
      style={{ top: topOffset }}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click handler only stops propagation so clicks inside the panel do not close the modal. */}
      <div
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="ui-slide-over__panel"
        style={{ width }}
      >
        <div className="ui-slide-over__header">
          <div className="ui-slide-over__title">{title}</div>
          <button
            type="button"
            className="ui-icon-button"
            onClick={requestClose}
            title={t("summary.close")}
            aria-label={t("summary.close")}
          >
            <IconX size={14} stroke={2} />
          </button>
        </div>

        <div className="ui-slide-over__body">{children}</div>
      </div>
    </div>
  );
}
