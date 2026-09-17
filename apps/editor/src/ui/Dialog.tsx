import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useOptionalCommands } from "./commands/CommandProvider.tsx";
import { Portal } from "./Portal.tsx";
import { cx } from "./lib/cx.ts";
import { getFocusable, trapFocus } from "./lib/focus.ts";
import { useLatest } from "./lib/hooks.ts";
import { useDismissableLayer } from "./lib/layerStack.ts";
import "./Surface.css";
import "./Dialog.css";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** "top" suits search-style dialogs (command palette, patch picker). */
  placement?: "center" | "top";
  width?: number | string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnOverlayClick?: boolean;
  /** Shortcut scope pushed while open so global shortcuts don't fire underneath. */
  modalScope?: string;
  className?: string;
  style?: CSSProperties;
}

/** Modal dialog: overlay, focus trap, Escape to close, focus restored on close. */
export function Dialog(props: DialogProps) {
  if (!props.open) return null;
  return <DialogContent {...props} />;
}

function DialogContent({
  onOpenChange,
  children,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  placement = "center",
  width = 480,
  initialFocusRef,
  closeOnOverlayClick = true,
  modalScope = "dialog",
  className,
  style,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const commands = useOptionalCommands();
  const initialFocus = useLatest(initialFocusRef);
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => commands?.shortcuts.pushModalScope(modalScope), [commands, modalScope]);

  useDismissableLayer(
    true,
    (reason) => {
      if (reason === "outside" && !closeOnOverlayClick) return;
      onOpenChange(false);
    },
    [panelRef],
  );

  useLayoutEffect(() => {
    previouslyFocused.current = document.activeElement;
    return () => (previouslyFocused.current as HTMLElement | null)?.focus?.({ preventScroll: true });
  }, []);

  // Focus once the portaled panel exists, unless something inside already took focus.
  useLayoutEffect(() => {
    if (!panel || panel.contains(document.activeElement)) return;
    const target = initialFocus.current?.current ?? getFocusable(panel)[0] ?? panel;
    target.focus({ preventScroll: true });
  }, [panel, initialFocus]);

  return (
    <Portal>
      <div className="sb-dialog-overlay" data-placement={placement}>
        <div
          ref={(node) => {
            panelRef.current = node;
            setPanel(node);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          tabIndex={-1}
          className={cx("sb-dialog", "sb-surface", className)}
          style={{ width, ...style }}
          onKeyDown={(event) => trapFocus(event, panelRef.current)}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}
