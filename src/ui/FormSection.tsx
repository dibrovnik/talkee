import type { ReactElement, ReactNode } from "react";

export interface FormSectionProps {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Renders the section inside another group without a second surface. */
  nested?: boolean;
  /** Trailing control rendered on the title line (e.g. a disclosure button). */
  action?: ReactNode;
  className?: string;
}

export function FormSection({
  title,
  footer,
  children,
  nested = false,
  action,
  className,
}: FormSectionProps): ReactElement {
  const classes = ["ui-form-section", nested ? "ui-form-section--nested" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes}>
      {title || action ? (
        <h3 className="ui-form-section__title">
          {title}
          {action ? <span className="ui-form-section__action">{action}</span> : null}
        </h3>
      ) : null}
      <div className="ui-form-group">{children}</div>
      {footer ? <p className="ui-form-section__footer">{footer}</p> : null}
    </section>
  );
}
