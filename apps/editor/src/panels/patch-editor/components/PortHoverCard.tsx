/**
 * Hover card for a port: name, type, live value, where it's driven from, and docs. A looped live
 * value gets a table of its copies; hovering (or clicking) a row watches that copy everywhere.
 */

import { canConnect, decodeInput, isColor, isDecodedLoop, type ValueType } from "@sonobe/core";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { Portal } from "../../../ui/Portal.tsx";
import { PortGlyph, VALUE_TYPE_LABELS } from "../../../ui/PortGlyph.tsx";
import { toCssColor } from "../../../ui/lib/colorMath.ts";
import { useFloating } from "../../../ui/lib/useFloating.ts";
import { formatValue, formatValueLong, isLoopValue, pickCopy, type LoopLike } from "@sonobe/core/graph";
import { portKey, type GraphModel } from "../model/types.ts";
import { patchEditorBridge } from "../state/bridge.ts";
import { usePatchEditor, useLiveValue, useUi } from "../state/context.ts";
import { useWatchedCopy } from "../state/watch.ts";

type RectLike = { x: number; y: number; width: number; height: number };

/** How far the pointer may stray from the row (or the card, once it has a loop table) before the card closes. */
const SLOP = 10;
/** Copies listed in a loop table; the watched copy chip reaches the rest. */
const LOOP_ROWS = 100;

export function PortHoverCard({ model }: { model: GraphModel }) {
  const hover = useUi((s) => s.hoverPort);
  if (!hover || (hover.rect.width === 0 && hover.rect.height === 0)) return null;
  const port = model.ports.get(portKey(hover.side, hover.address));
  if (!port) return null;
  return <Card key={hover.address} rect={hover.rect} side={hover.side} address={hover.address} model={model} />;
}

const inside = (r: DOMRect | RectLike, x: number, y: number) => x >= r.x - SLOP && x <= r.x + r.width + SLOP && y >= r.y - SLOP && y <= r.y + r.height + SLOP;

/**
 * Close the card on any press, scroll, window blur, or when the pointer leaves its row (rows can
 * re-render without a pointerleave). A card with a loop table stays open while the pointer is on it.
 */
function useDismiss(rect: RectLike, card: RefObject<HTMLDivElement | null>) {
  const { ui } = usePatchEditor();
  useEffect(() => {
    const close = () => {
      if (ui.getState().hoverPort) ui.getState().set({ hoverPort: null });
    };
    const interactive = () => card.current?.hasAttribute("data-interactive") === true;
    const onCard = (target: EventTarget | null) => interactive() && target instanceof Node && card.current!.contains(target);
    const onMove = (e: PointerEvent) => {
      if (inside(rect, e.clientX, e.clientY)) return;
      if (interactive() && inside(card.current!.getBoundingClientRect(), e.clientX, e.clientY)) return;
      close();
    };
    const onPress = (e: Event) => {
      if (!onCard(e.target)) close();
    };
    window.addEventListener("pointerdown", onPress, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("wheel", onPress, { capture: true, passive: true });
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("wheel", onPress, { capture: true });
      window.removeEventListener("blur", close);
    };
  }, [rect, ui, card]);
}

/** Every copy of a looped value, with the watched one marked; hovering a row watches it. */
function LoopTable({ loop, type, name, format }: { loop: LoopLike; type: ValueType; name: string; format: (v: unknown) => string }) {
  const { session } = usePatchEditor();
  const copy = useWatchedCopy(session);
  const watched = copy === null ? null : pickCopy(loop, copy).index;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (watched === null) return;
    listRef.current?.querySelector(`[data-index="${watched}"]`)?.scrollIntoView({ block: "nearest" });
  }, [watched]);
  const watch = (i: number) => patchEditorBridge(session).getState().watchCopy(i);
  const rows = loop.items.slice(0, LOOP_ROWS);
  return (
    <div ref={listRef} className="sb-pe-hovercard__loop sb-tabular" role="listbox" aria-label={`${name}: ${loop.items.length} copies`}>
      {rows.map((item, i) => (
        <div key={i} role="option" aria-selected={i === watched} data-index={i} className="sb-pe-hovercard__copy" onPointerEnter={() => watch(i)} onClick={() => watch(i)}>
          <span className="sb-pe-hovercard__index">#{i}</span>
          {type === "color" && isColor(item) && (
            <span className="sb-pe-hovercard__swatch sb-checker" aria-hidden>
              <span style={{ background: toCssColor(item) }} />
            </span>
          )}
          <span className="sb-pe-hovercard__item">{format(item)}</span>
        </div>
      ))}
      {loop.items.length > LOOP_ROWS && <div className="sb-pe-hovercard__more">{loop.items.length - LOOP_ROWS} more: step to them with the copy arrows</div>}
    </div>
  );
}

function Card({ rect, side, address, model }: { rect: RectLike; side: "in" | "out"; address: string; model: GraphModel }) {
  const { liveEnabled, session } = usePatchEditor();
  const cardRef = useRef<HTMLDivElement | null>(null);
  useDismiss(rect, cardRef);
  const port = model.ports.get(portKey(side, address))!;
  const floating = useFloating<HTMLDivElement>({ open: true, anchor: rect, placement: side === "in" ? "left-start" : "right-start", offset: 12 });
  const liveAddress = side === "out" ? port.address : port.link;
  const live = useLiveValue(liveEnabled ? liveAddress : null);
  const copy = useWatchedCopy(session);
  const source = port.link ? model.ports.get(portKey("out", port.link)) : undefined;
  const conversion = source && canConnect(source.type, port.type).conversion;
  const literal = port.literal !== undefined ? decodeInput(port.literal, port.type) : undefined;
  const enumOptions = port.enumOptions ? { enumOptions: port.enumOptions } : {};
  const format = (v: unknown, type: ValueType) => formatValueLong(isDecodedLoop(v) ? { __loop: true, items: v.items } : v, type, enumOptions);
  const layerTarget = address.startsWith("@");
  const loop = live !== undefined && port.type !== "pulse" && isLoopValue(live) && live.items.length > 0 ? live : null;
  let valueLine: string | null = null;
  if (loop) valueLine = copy === null ? `Loop of ${loop.items.length}` : formatValueLong(loop, port.type, { ...enumOptions, copy });
  else if (live !== undefined) valueLine = port.type === "pulse" ? "Fires for one frame at a time" : format(live, port.type);
  else if (side === "in" && !port.connected && port.type !== "pulse" && !layerTarget) valueLine = literal !== undefined ? format(literal, port.type) : port.defaultValue !== undefined ? `${format(port.defaultValue, port.type)} (default)` : null;
  const hint = loop
    ? "Hover a copy to watch it here, in every patch, and in the inspector"
    : side === "out"
      ? "Drag to connect · click, then ⇧-click inputs"
      : port.knob
        ? "Click the chip to tune it in Knobs"
        : port.connected
          ? "Drag the cable end to move or remove it"
          : layerTarget
            ? "Drag a cable here, or click Drive… to pick a patch"
            : port.literal !== undefined
              ? "Drag to scrub · ⌥-click to reset"
              : "Drag onto the canvas to add a patch";
  const placeRef = floating.ref;
  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      cardRef.current = el;
      placeRef(el);
    },
    [placeRef],
  );
  return (
    <Portal>
      <div ref={setRefs} className="sb-pe-hovercard" style={floating.style} {...(loop ? { role: "dialog", "aria-label": `${port.name}: live copies`, "data-interactive": "" } : { role: "tooltip" })}>
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
        {loop && <LoopTable loop={loop} type={port.type} name={port.name} format={(v) => formatValue(v, port.type, { ...enumOptions, maxText: 28 })} />}
        {port.link && port.knob ? (
          <div className="sb-pe-hovercard__meta">
            From the knob {port.knob.name}
            {port.knob.valueText ? ` · ${port.knob.valueText} in the running preset` : ""}
          </div>
        ) : port.link ? (
          <div className="sb-pe-hovercard__meta">
            From <code>{port.link}</code>
            {conversion ? ` · ${conversion}` : ""}
          </div>
        ) : null}
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
