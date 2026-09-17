import {
  Children,
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { Kbd } from "./Kbd.tsx";
import { Portal } from "./Portal.tsx";
import { isFocusVisible } from "./lib/focus.ts";
import { useMergedRefs } from "./lib/hooks.ts";
import type { Placement } from "./lib/position.ts";
import { useFloating } from "./lib/useFloating.ts";
import "./Tooltip.css";

/** After one tooltip closes, the next opens instantly for this long (scanning a toolbar). */
const GROUP_WINDOW_MS = 400;
let lastHiddenAt = 0;

interface AnchorProps {
  ref?: Ref<HTMLElement>;
  onPointerEnter?: PointerEventHandler<HTMLElement>;
  onPointerLeave?: PointerEventHandler<HTMLElement>;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  onFocus?: FocusEventHandler<HTMLElement>;
  onBlur?: FocusEventHandler<HTMLElement>;
  "aria-describedby"?: string;
}

export interface TooltipProps {
  content: ReactNode;
  /** Shortcut hint shown after the label. */
  shortcut?: string | readonly string[];
  placement?: Placement;
  /** Hover delay in ms. Keyboard focus opens immediately. */
  delay?: number;
  disabled?: boolean;
  /** A single element that accepts a ref and pointer/focus handlers. */
  children: ReactElement;
}

/** Hover/focus label with an optional shortcut hint. Never interactive; use Popover for rich content. */
export function Tooltip({ content, shortcut, placement = "bottom", delay = 500, disabled = false, children }: TooltipProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const child = Children.only(children) as ReactElement<AnchorProps>;
  const ref = useMergedRefs<HTMLElement>(setAnchor, child.props.ref);

  const clear = () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };
  const setVisible = (visible: boolean) => {
    if (openRef.current && !visible) lastHiddenAt = Date.now();
    openRef.current = visible;
    setOpen(visible);
  };
  const show = (immediate: boolean) => {
    if (disabled) return;
    clear();
    if (immediate || Date.now() - lastHiddenAt < GROUP_WINDOW_MS) setVisible(true);
    else timer.current = setTimeout(() => setVisible(true), delay);
  };
  const hide = () => {
    clear();
    if (openRef.current) setVisible(false);
  };

  useEffect(() => clear, []);

  useEffect(() => {
    if (disabled && openRef.current) {
      openRef.current = false;
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trigger = cloneElement(child, {
    ref,
    "aria-describedby": open ? id : child.props["aria-describedby"],
    onPointerEnter: (event) => {
      child.props.onPointerEnter?.(event);
      if (event.pointerType === "mouse") show(false);
    },
    onPointerLeave: (event) => {
      child.props.onPointerLeave?.(event);
      hide();
    },
    onPointerDown: (event) => {
      child.props.onPointerDown?.(event);
      hide();
    },
    onFocus: (event) => {
      child.props.onFocus?.(event);
      if (isFocusVisible(event.currentTarget)) show(true);
    },
    onBlur: (event) => {
      child.props.onBlur?.(event);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {open && anchor && content !== undefined && content !== null && content !== "" && (
        <TooltipBubble id={id} anchor={anchor} placement={placement} content={content} shortcut={shortcut} />
      )}
    </>
  );
}

function TooltipBubble({
  id,
  anchor,
  placement,
  content,
  shortcut,
}: {
  id: string;
  anchor: HTMLElement;
  placement: Placement;
  content: ReactNode;
  shortcut?: string | readonly string[];
}) {
  const floating = useFloating<HTMLDivElement>({ open: true, anchor, placement, offset: 6 });
  return (
    <Portal themeFrom={anchor}>
      <div ref={floating.ref} id={id} role="tooltip" className="sb-tooltip" data-side={floating.side} style={floating.style}>
        <span className="sb-tooltip__text">{content}</span>
        {shortcut && <Kbd shortcut={shortcut} variant="plain" className="sb-tooltip__kbd" />}
      </div>
    </Portal>
  );
}
