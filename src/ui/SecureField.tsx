import type { InputHTMLAttributes, ReactElement } from "react";

export interface SecureFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export function SecureField({ className, ...rest }: SecureFieldProps): ReactElement {
  return (
    <input
      type="password"
      className={["ui-textfield", className ?? ""].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
