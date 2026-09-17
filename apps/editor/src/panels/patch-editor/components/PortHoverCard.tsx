/** Hover card for a port: name, type, live value, where it's driven from, and docs. */

import { canConnect, decodeInput, isDecodedLoop, type ValueType } from "@sonobe/core";
import { useEffect } from "react";
import { Portal } from "../../../ui/Portal.tsx";
import { PortGlyph, VALUE_TYPE_LABELS } from "../../../ui/PortGlyph.tsx";
import { useFloating } from "../../../ui/lib/useFloating.ts";
import { formatValueLong } from "../model/format.ts";
import { portKey, type GraphModel } from "../model/types.ts";
import { usePatchEditor, useLiveValue, useUi } from "../state/context.ts";

type RectLike = { x: number; y: number; width: number; height: number };

/** How far the pointer may stray from the row before the card closes. */
const SLOP = 10;

export function PortHoverCard({ model }: { model: GraphModel }) {
  const hover = useUi((s) => s.hoverPort);
  if (!hover || (hover.rect.width === 0 && hover.rect.height === 0)) return null;
  const port = model.ports.get(portKey(hover.side, hover.address));
  if (!port) return null;
  return <Card key={hover.address} rect={hover.rect} side={hover.side} address={hover.address} model={model} />;
}

/** Close the card on any press, scroll, window blur, or when the pointer leaves its row (rows can re-render without a pointerleave). */
function useDismiss(rect: RectLike) {
  const { ui } = usePatchEditor();
  useEffect(() => {
    const close = () => {
      if (ui.getState().hoverPort) ui.getState().set({ hoverPort: null });
    };
    const onMove = (e: PointerEvent) => {
      if (e.clientX < rect.x - SLOP || e.clientX > rect.x + rect.width + SLOP || e.clientY < rect.y - SLOP || e.clientY > rect.y + rect.height + SLOP) close();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("wheel", close, { capture: true, passive: true });
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("wheel", close, { capture: true });
      window.removeEventListener("blur", close);
    };
  }, [rect, ui]);
}

function Card({ rect, side, address, model }: { rect: RectLike; side: "in" | "out"; address: string; model: GraphModel }) {
  const { liveEnabled } = usePatchEditor();
  useDismiss(rect);
  const port = model.ports.get(portKey(side, address))!;
  const floating = useFloating<HTMLDivElement>({ open: true, anchor: rect, placement: side === "in" ? "left-start" : "right-start", offset: 12 });
  const liveAddress = side === "out" ? port.address : port.link;
  const live = useLiveValue(liveEnabled ? liveAddress : null);
  const source = port.link ? model.ports.get(portKey("out", port.link)) : undefined;
  const conversion = source && canConnect(source.type, port.type).conversion;
  const literal = port.literal !== undefined ? decodeInput(port.literal, port.type) : undefined;
  const format = (v: unknown, type: ValueType) => formatValueLong(isDecodedLoop(v) ? { __loop: true, items: v.items } : v, type, port.enumOptions ? { enumOptions: port.enumOptions } : {});
  const layerTarget = address.startsWith("@");
  let valueLine: string | null = null;
  if (live !== undefined) valueLine = port.type === "pulse" ? "Fires for one frame at a time" : format(live, port.type);
  else if (side === "in" && !port.connected && port.type !== "pulse" && !layerTarget) valueLine = literal !== undefined ? format(literal, port.type) : port.defaultValue !== undefined ? `${format(port.defaultValue, port.type)} (default)` : null;
  const hint =
    side === "out"
      ? "Drag to connect · click, then ⇧-click inputs"
      : port.connected
        ? "Drag the cable end to move or remove it"
        : layerTarget
          ? "Drag a cable here, or click Drive… to pick a patch"
          : port.literal !== undefined
            ? "Drag to scrub · ⌥-click to reset"
            : "Drag onto the canvas to add a patch";
  return (
    <Portal>
      <div ref={floating.ref} className="sb-pe-hovercard" style={floating.style} role="tooltip">
        <div className="sb-pe-hovercard__head">
          <PortGlyph type={port.type} size={9} />
          <span className="sb-pe-hovercard__name">{port.name}</span>
          <span className="sb-pe-hovercard__type">
            {VALUE_TYPE_LABELS[port.type]}
            {port.wholeLoop ? " · whole loop" : port.loop ? " · loop" : ""}
          </span>
        </div>
        {valueLine !== null && (
          <div className="sb-pe-hovercard__value sb-tabular">
            <span className="sb-pe-hovercard__label">{live !== undefined ? "Live" : "Value"}</span>
            <span>{valueLine}</span>
          </div>
        )}
        {port.link && (
          <div className="sb-pe-hovercard__meta">
            From <code>{port.link}</code>
            {conversion ? ` · ${conversion}` : ""}
          </div>
        )}
        {port.description && <p className="sb-pe-hovercard__docs">{port.description}</p>}
        {port.issue && (
          <p className="sb-pe-hovercard__issue" data-severity={port.issue.severity}>
            {port.issue.message}
          </p>
        )}
        <div className="sb-pe-hovercard__hint">{hint}</div>
      </div>
    </Portal>
  );
}
