import * as Primitive from "@radix-ui/react-dialog";
import type { ReactElement, ReactNode } from "react";
import { Button } from "./Button";

export interface DialogProps {
  trigger: ReactElement;
  title: string;
  description: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Dialog({
  trigger,
  title,
  description,
  children,
  open,
  onOpenChange,
}: DialogProps): ReactElement {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Trigger asChild>{trigger}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Overlay className="ui-dialog-overlay" />
        <Primitive.Content className="ui-dialog-content">
          <Primitive.Title className="ui-dialog-title">{title}</Primitive.Title>
          <Primitive.Description className="ui-dialog-description">
            {description}
          </Primitive.Description>
          {children}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
            <Primitive.Close asChild>
              <Button>Закрыть</Button>
            </Primitive.Close>
          </div>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
