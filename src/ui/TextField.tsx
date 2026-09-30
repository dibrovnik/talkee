import type { InputHTMLAttributes, ReactElement } from "react";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export function TextField({ className, ...rest }: TextFieldProps): ReactElement {
  return (
    <input
      type="text"
      className={["ui-textfield", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
