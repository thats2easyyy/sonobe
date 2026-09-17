import { useEffect, useRef, useState } from "react";
import { Splitter } from "../../ui/Splitter.tsx";
import { useDismissableLayer } from "../../ui/lib/layerStack.ts";
import { readString, writeString } from "../../ui/lib/storage.ts";
import { assistantStore, useAssistant } from "./assistantStore.ts";
import { AssistantDrawer, type AssistantDrawerProps } from "./AssistantDrawer.tsx";

const WIDTH_KEY = "sonobe.assistant.width";
const MIN_WIDTH = 320;
const MAX_WIDTH = 620;
const DEFAULT_WIDTH = 380;
const EXIT_MS = 150;

const storedWidth = () => {
  const n = Number(readString(WIDTH_KEY));
  return Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH ? n : DEFAULT_WIDTH;
};

/**
 * A right-side sheet bound to assistantStore.open, for shells that don't give the Assistant a drawer
 * slot. Escape closes it (unless a reply is running, where Escape stops it); the left edge resizes it.
 * The chat keeps running while it's closed.
 */
export function AssistantHost(props: Omit<AssistantDrawerProps, "onClose" | "store">) {
  const open = useAssistant((s) => s.open);
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  const [width, setWidth] = useState(storedWidth);
  const ref = useRef<HTMLElement>(null);

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

  const close = () => assistantStore.getState().hide();
  useDismissableLayer(open, close, [ref], { outside: false });

  if (!rendered) return null;
  return (
    <aside ref={ref} className="sb-assistant-sheet" data-state={closing ? "closing" : "open"} data-shortcut-scope="drawer" aria-label="Assistant" style={{ width }}>
      <Splitter
        orientation="vertical"
        invert
        size={width}
        min={MIN_WIDTH}
        max={MAX_WIDTH}
        defaultSize={DEFAULT_WIDTH}
        label="Resize Assistant"
        className="sb-assistant-sheet__splitter"
        onResize={(size) => {
          if (ref.current) ref.current.style.width = `${size}px`;
        }}
        onResizeEnd={(size) => {
          setWidth(size);
          writeString(WIDTH_KEY, String(size));
        }}
      />
      <AssistantDrawer {...props} onClose={close} />
    </aside>
  );
}
