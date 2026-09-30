import type { ReactElement, ReactNode } from "react";

export interface FormSectionProps {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function FormSection({
  title,
  footer,
  children,
  className,
}: FormSectionProps): ReactElement {
  return (
    <section className={["ui-form-section", className ?? ""].filter(Boolean).join(" ")}>
      {title ? <h3 className="ui-form-section__title">{title}</h3> : null}
      <div className="ui-form-group">{children}</div>
      {footer ? <p className="ui-form-section__footer">{footer}</p> : null}
    </section>
  );
}
