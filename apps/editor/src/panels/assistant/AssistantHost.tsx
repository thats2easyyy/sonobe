import { useEffect, useRef, useState } from "react";
import { DEFAULT_LAYOUT, SIZE_LIMITS, layoutStore, useLayout } from "../../shell/layoutStore.ts";
import { Splitter } from "../../ui/Splitter.tsx";
import { useDismissableLayer } from "../../ui/lib/layerStack.ts";
import { observeResize } from "../../ui/lib/observeResize.ts";
import { assistantStore, useAssistant } from "./assistantStore.ts";
import { AssistantDrawer, type AssistantDrawerProps } from "./AssistantDrawer.tsx";

const EXIT_MS = 150;

/**
 * A right-side sheet bound to assistantStore.open, for shells that don't give the Assistant a drawer
 * slot. It is as wide as the Learn drawer, and resizing either resizes both, so switching between them
 * keeps the left edge still. Escape closes it (unless a reply is running, where Escape stops it); the
 * left edge resizes it. The chat keeps running while it's closed.
 */
export function AssistantHost(props: Omit<AssistantDrawerProps, "onClose" | "store">) {
  const open = useAssistant((s) => s.open);
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const width = useLayout((s) => s.sizes.drawer);
  const ref = useRef<HTMLElement>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    setClosing(true);
    const timer = setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // Closing gives focus back to what had it before the sheet opened. When that is gone (the Design box's Open chat button
  // closes with the box) or nothing had it (a shortcut), the canvas takes it, not the page.
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (open) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !ref.current?.contains(active)) invoker.current = active;
      return;
    }
    if (!closed) return;
    const recorded = invoker.current;
    invoker.current = null;
    if (document.activeElement && document.activeElement !== document.body && !ref.current?.contains(document.activeElement)) return;
    const target = recorded?.isConnected ? recorded : document.querySelector<HTMLElement>(".sb-cv");
    target?.focus({ preventScroll: true });
  }, [open]);

  // The banners live in the shell, not above this sheet: measure them so the sheet starts below them.
  useEffect(() => {
    const sheet = ref.current;
    const banners = document.querySelector<HTMLElement>(".sb-shell__banners");
    if (!sheet || !banners) return;
    const measure = () => sheet.style.setProperty("--sb-banner-h", `${banners.offsetHeight}px`);
    measure();
    return observeResize([banners], measure);
  }, [rendered]);

  const close = () => assistantStore.getState().hide();
  useDismissableLayer(open, close, [ref], { outside: false });

  if (!rendered) return null;
  return (
    <aside ref={ref} className="sb-assistant-sheet" data-state={closing ? "closing" : "open"} data-shortcut-scope="drawer" aria-label="Assistant" style={{ width }}>
      <Splitter
        orientation="vertical"
        invert
        size={width}
        min={SIZE_LIMITS.drawer[0]}
        max={SIZE_LIMITS.drawer[1]}
        defaultSize={DEFAULT_LAYOUT.sizes.drawer}
        label="Resize Assistant"
        className="sb-assistant-sheet__splitter"
        onResize={(size) => {
          if (ref.current) ref.current.style.width = `${size}px`;
        }}
        onResizeEnd={(size) => layoutStore.getState().setSize("drawer", size)}
      />
      <AssistantDrawer {...props} onClose={close} />
    </aside>
  );
}
