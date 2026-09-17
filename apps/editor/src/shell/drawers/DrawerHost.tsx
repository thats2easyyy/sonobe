import { useEffect, useRef, useState, type ReactNode } from "react";
import { Splitter } from "../../ui/Splitter.tsx";
import { useDismissableLayer } from "../../ui/lib/layerStack.ts";
import { SIZE_LIMITS, layoutStore, useLayout, type DrawerId } from "../layoutStore.ts";
import { AssistantDrawer } from "./AssistantDrawer.tsx";
import { LearnDrawer } from "./LearnDrawer.tsx";
import "./drawers.css";

const EXIT_MS = 150;

/** Right-side drawer slot for Learn and Assistant. Escape closes it; the left edge resizes it. */
export function DrawerHost({ learn, assistant }: { learn?: ReactNode; assistant?: ReactNode }) {
  const drawer = useLayout((s) => s.drawer);
  const width = useLayout((s) => s.sizes.drawer);
  const [rendered, setRendered] = useState<DrawerId | null>(drawer);
  const [closing, setClosing] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

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
  useDismissableLayer(drawer !== null, close, [asideRef], { outside: false });

  if (!rendered) return null;

  return (
    <aside
      ref={asideRef}
      className="sb-drawer"
      data-state={closing ? "closing" : "open"}
      data-shortcut-scope="drawer"
      aria-label={rendered === "learn" ? "Learn" : "Assistant"}
      style={{ width }}
    >
      <Splitter
        orientation="vertical"
        invert
        size={width}
        min={SIZE_LIMITS.drawer[0]}
        max={SIZE_LIMITS.drawer[1]}
        defaultSize={360}
        label="Resize drawer"
        className="sb-drawer__splitter"
        onResize={(size) => {
          if (asideRef.current) asideRef.current.style.width = `${size}px`;
        }}
        onResizeEnd={(size) => layoutStore.getState().setSize("drawer", size)}
      />
      {rendered === "learn" ? (learn ?? <LearnDrawer onClose={close} />) : (assistant ?? <AssistantDrawer onClose={close} />)}
    </aside>
  );
}
