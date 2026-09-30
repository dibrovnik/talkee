import type { ReactElement, ReactNode } from "react";

export interface FormRowProps {
  label: ReactNode;
  control: ReactNode;
  description?: ReactNode;
  className?: string;
}

export function FormRow({ label, control, description, className }: FormRowProps): ReactElement {
  return (
    <div className={["ui-form-row", className ?? ""].filter(Boolean).join(" ")}>
      <div className="ui-form-row__label">
        {label}
        {description ? <div className="ui-form-section__footer">{description}</div> : null}
      </div>
      <div className="ui-form-row__control">{control}</div>
    </div>
  );
}
