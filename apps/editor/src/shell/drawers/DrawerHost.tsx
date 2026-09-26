import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Splitter } from "../../ui/Splitter.tsx";
import { isFocusVisible } from "../../ui/lib/focus.ts";
import { useDismissableLayer } from "../../ui/lib/layerStack.ts";
import { DEFAULT_LAYOUT, SIZE_LIMITS, layoutStore, useLayout, type DrawerId } from "../layoutStore.ts";

const EXIT_MS = 150;

export interface DrawerHostProps {
  learn?: ReactNode;
  /**
   * Docked drawers sit beside the panels instead of over them (the shell makes room), so a lesson
   * can point at the inspector while its steps stay visible.
   */
  docked?: boolean;
  /** Called while the edge is dragged, before the size is committed. */
  onLiveResize?: (width: number) => void;
}

/**
 * Right-side drawer for Learn. Escape closes it, unless it is docked beside a lesson, where Escape
 * belongs to the canvas; the left edge resizes it. Opened from the keyboard it takes focus, and
 * closing it gives focus back to what opened it.
 */
export function DrawerHost({ learn, docked = false, onLiveResize }: DrawerHostProps) {
  const drawer = useLayout((s) => s.drawer);
  const width = useLayout((s) => s.sizes.drawer);
  const [rendered, setRendered] = useState<DrawerId | null>(drawer);
  const [closing, setClosing] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const focusOnOpen = useRef(false);

  useEffect(
    () =>
      layoutStore.subscribe((state, prev) => {
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (state.drawer && !prev.drawer) {
          opener.current = active;
          focusOnOpen.current = !!active && isFocusVisible(active);
        } else if (!state.drawer && prev.drawer) {
          const previous = opener.current;
          opener.current = null;
          if (previous?.isConnected && (!active || active === document.body || asideRef.current?.contains(active))) previous.focus();
        }
      }),
    [],
  );

  useLayoutEffect(() => {
    if (!rendered || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const aside = asideRef.current;
    if (aside && !aside.contains(document.activeElement)) aside.focus();
  }, [rendered]);

  useEffect(() => {
    if (drawer) {
      setRendered(drawer);
      setClosing(false);
      return;
    }
    setClosing(true);
    const timer = setTimeout(() => {
      setRendered(null);
      setClosing(false);
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [drawer]);

  const close = () => layoutStore.getState().setDrawer(null);
  useDismissableLayer(drawer !== null && learn !== undefined, close, [asideRef], { escape: !docked, outside: false });

  if (!rendered || learn === undefined) return null;

  return (
    <aside ref={asideRef} className="sb-drawer" data-state={closing ? "closing" : "open"} data-docked={docked || undefined} data-shortcut-scope="drawer" aria-label="Learn" tabIndex={-1} style={{ width }}>
      <Splitter
        orientation="vertical"
        invert
        size={width}
        min={SIZE_LIMITS.drawer[0]}
        max={SIZE_LIMITS.drawer[1]}
        defaultSize={DEFAULT_LAYOUT.sizes.drawer}
        label="Resize drawer"
        className="sb-drawer__splitter"
        onResize={(size) => {
          if (asideRef.current) asideRef.current.style.width = `${size}px`;
          onLiveResize?.(size);
        }}
        onResizeEnd={(size) => layoutStore.getState().setSize("drawer", size)}
      />
      {learn}
    </aside>
  );
}
