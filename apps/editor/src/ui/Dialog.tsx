import { X } from "lucide-react";
import {
  cloneElement,
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { useOptionalCommands } from "./commands/CommandProvider.tsx";
import { IconButton } from "./IconButton.tsx";
import { Portal } from "./Portal.tsx";
import { cx } from "./lib/cx.ts";
import { getFocusable, holdFocus, trapFocus } from "./lib/focus.ts";
import { useLatest } from "./lib/hooks.ts";
import { useDismissableLayer } from "./lib/layerStack.ts";
import "./Surface.css";
import "./Dialog.css";

/** The three dialog widths. */
export const DIALOG_WIDTH = { sm: 420, md: 540, lg: 680 } as const;

/** "default" rises and fades in; "fade" only fades, briefly; "none" is instant (search-style dialogs). */
export type DialogMotion = "default" | "fade" | "none";

interface DialogContextValue {
  close: () => void;
  scrolled: boolean;
  setScrolled: (scrolled: boolean) => void;
  titleId: string;
  registerTitle: () => () => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** "top" suits search-style dialogs (command palette, patch picker). */
  placement?: "center" | "top";
  width?: number | string;
  /** Overrides the default: the first `[data-autofocus]`, else the first field, else the footer's last button (the safe or primary one), else the first control that isn't a close button. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  motion?: DialogMotion;
  closeOnOverlayClick?: boolean;
  /** Shortcut scope pushed while open so global shortcuts don't fire underneath. */
  modalScope?: string;
  className?: string;
  style?: CSSProperties;
}

/** Modal dialog: overlay, focus trap (Tab stays inside, and nothing behind it can take focus), Escape to close, focus restored on close. */
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
  motion = "default",
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
  const [scrolled, setScrolled] = useState(false);
  const [titles, setTitles] = useState(0);
  const titleId = useId();
  const registerTitle = useCallback(() => {
    setTitles((n) => n + 1);
    return () => setTitles((n) => n - 1);
  }, []);
  const context = useMemo<DialogContextValue>(
    () => ({ close: () => onOpenChange(false), scrolled, setScrolled, titleId, registerTitle }),
    [onOpenChange, scrolled, titleId, registerTitle],
  );

  useEffect(() => commands?.shortcuts.pushModalScope(modalScope), [commands, modalScope]);

  useDismissableLayer(
    true,
    (reason) => {
      if (reason === "outside" && !closeOnOverlayClick) return;
      onOpenChange(false);
    },
    [panelRef],
  );

  // Declared before the effect that gives focus back, so closing lets go first.
  useLayoutEffect(() => (panel ? holdFocus(panel, () => initialTarget(panel)) : undefined), [panel]);

  useLayoutEffect(() => {
    previouslyFocused.current = document.activeElement;
    return () => (previouslyFocused.current as HTMLElement | null)?.focus?.({ preventScroll: true });
  }, []);

  // Focus once the portaled panel exists, unless something inside already took focus.
  useLayoutEffect(() => {
    if (!panel || panel.contains(document.activeElement)) return;
    const target = initialFocus.current?.current ?? initialTarget(panel);
    target.focus({ preventScroll: true });
  }, [panel, initialFocus]);

  return (
    <Portal>
      <div className="sb-dialog-overlay" data-placement={placement} data-motion={motion}>
        <div
          ref={(node) => {
            panelRef.current = node;
            setPanel(node);
          }}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy ?? (ariaLabel === undefined && titles > 0 ? titleId : undefined)}
          tabIndex={-1}
          className={cx("sb-dialog", "sb-surface", className)}
          style={{ width, ...style }}
          onKeyDown={(event) => trapFocus(event, panelRef.current)}
        >
          <DialogContext value={context}>{children}</DialogContext>
        </div>
      </div>
    </Portal>
  );
}

function initialTarget(panel: HTMLElement): HTMLElement {
  const marked = panel.querySelector<HTMLElement>("[data-autofocus]");
  if (marked) return marked;
  const focusable = getFocusable(panel);
  const field = focusable.find((el) => el.matches("input, textarea, select"));
  if (field) return field;
  const inFooterStart = (el: HTMLElement) => !!el.closest(".sb-dialog__footer-start");
  const footerButton = focusable.findLast((el) => el.matches("button") && !!el.closest("footer") && !inFooterStart(el));
  if (footerButton) return footerButton;
  const skipped = (el: HTMLElement) => el.hasAttribute("data-dialog-close") || el.getAttribute("aria-label") === "Close" || inFooterStart(el);
  return focusable.find((el) => !skipped(el)) ?? panel;
}

export interface DialogHeaderProps {
  title: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  /** Shows a close button that calls this. Leave it out when the footer has the way out. */
  onClose?: () => void;
}

function DialogHeader({ title, description, onClose }: DialogHeaderProps) {
  const context = use(DialogContext);
  const registerTitle = context?.registerTitle;
  useLayoutEffect(() => registerTitle?.(), [registerTitle]);
  return (
    <header className="sb-dialog__header" data-scrolled={context?.scrolled || undefined}>
      <div className="sb-dialog__heading">
        <h2 id={context?.titleId} className="sb-dialog__title">
          {title}
        </h2>
        {description && <p className="sb-dialog__description">{description}</p>}
      </div>
      {onClose && <IconButton size="sm" icon={<X size={14} />} label="Close" shortcut="Escape" tooltipPlacement="left" data-dialog-close="" className="sb-dialog__close" onClick={onClose} />}
    </header>
  );
}

function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  const setScrolled = use(DialogContext)?.setScrolled;
  return (
    <div className={cx("sb-dialog__body sb-scroll", className)} onScroll={(event) => setScrolled?.(event.currentTarget.scrollTop > 0)}>
      {children}
    </div>
  );
}

function DialogFooter({ children, start, className }: { children: ReactNode; /** Left side: a destructive action. */ start?: ReactNode; className?: string }) {
  return (
    <footer className={cx("sb-dialog__footer", className)}>
      {start && <div className="sb-dialog__footer-start">{start}</div>}
      {children}
    </footer>
  );
}

interface CloseChildProps {
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  "data-dialog-close"?: string;
}

/** Wraps a button that leaves the dialog: it isn't the first thing focused, and a click runs its own handler, then closes. */
function DialogClose({ children }: { children: ReactElement<CloseChildProps> }) {
  const context = use(DialogContext);
  return cloneElement(children, {
    "data-dialog-close": "",
    onClick: (event) => {
      children.props.onClick?.(event);
      if (!event.defaultPrevented) context?.close();
    },
  });
}

Dialog.Header = DialogHeader;
Dialog.Body = DialogBody;
Dialog.Footer = DialogFooter;
Dialog.Close = DialogClose;
