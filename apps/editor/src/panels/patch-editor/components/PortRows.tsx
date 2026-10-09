/** Port rows shared by patch, layer, and interface nodes: handles, labels, inline values, live values. */

import { canConnect, type ValueType } from "@sonobe/core";
import { Handle, Position, useUpdateNodeInternals } from "@xyflow/react";
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { PortGlyph, VALUE_TYPE_LABELS } from "../../../ui/PortGlyph.tsx";
import { isLoopValue, isTruthyState, liveReserve, liveText, pickCopy } from "@sonobe/core/graph";
import { HEADER_HEIGHT } from "../model/geometry.ts";
import { layerIdOfNode, type PortModel } from "../model/types.ts";
import { usePatchEditor, useLiveValue, usePulseCount, useUi } from "../state/context.ts";
import type { UiStore } from "../state/uiStore.ts";
import { useWatchedCopy } from "../state/watch.ts";
import { InlineValue, KnobChip } from "./InlineValue.tsx";

const HOVER_DELAY_MS = 450;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
/** The row whose timer is pending, so an unmounting row only cancels its own. */
let hoverOwner: object | null = null;

function stillHovered(el: Element): boolean {
  try {
    return el.matches(":hover");
  } catch {
    return true;
  }
}

function useHoverCard(nodeId: string, port: PortModel) {
  const { ui, session, componentId, live } = usePatchEditor();
  const token = useRef({});
  useEffect(
    () => () => {
      if (hoverOwner === token.current) {
        clearTimeout(hoverTimer);
        hoverOwner = null;
      }
      const hover = ui.getState().hoverPort;
      if (hover && hover.nodeId === nodeId && hover.address === port.address) ui.getState().set({ hoverPort: null });
    },
    [ui, nodeId, port.address],
  );
  return {
    onPointerEnter(event: PointerEvent<HTMLDivElement>) {
      const el = event.currentTarget;
      clearTimeout(hoverTimer);
      hoverOwner = token.current;
      ui.getState().set({ pointerPort: { nodeId, address: port.address, side: port.side } });
      session.selection.getState().setHovered({ kind: "port", id: nodeId.replace(/^@/, ""), component: componentId, address: port.address, source: "patchEditor" });
      if (event.buttons !== 0) return;
      hoverTimer = setTimeout(() => {
        hoverOwner = null;
        const state = ui.getState();
        // The row may have re-rendered away, or a cable drag started: a detached row measures 0×0 at the page's corner.
        if (!el.isConnected || !stillHovered(el) || state.draggingType || state.detaching || state.knife) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        state.set({ hoverPort: { nodeId, address: port.address, side: port.side, rect: { x: r.left, y: r.top, width: r.width, height: r.height } } });
      }, HOVER_DELAY_MS);
    },
    onPointerLeave() {
      clearTimeout(hoverTimer);
      hoverOwner = null;
      // A card with a loop table stays open so the pointer can move onto it; the card closes itself.
      const value = port.type === "pulse" ? undefined : live.get(port.side === "out" ? port.address : (port.link ?? ""));
      const table = isLoopValue(value) && value.items.length > 0 && ui.getState().hoverPort?.address === port.address;
      if (ui.getState().hoverPort && !table) ui.getState().set({ hoverPort: null });
      const pointer = ui.getState().pointerPort;
      if (pointer && pointer.nodeId === nodeId && pointer.address === port.address) ui.getState().set({ pointerPort: null });
      const hovered = session.selection.getState().hovered;
      if (hovered?.address === port.address) session.selection.getState().setHovered(null);
    },
    onPointerDown() {
      clearTimeout(hoverTimer);
      hoverOwner = null;
      if (ui.getState().hoverPort) ui.getState().set({ hoverPort: null });
    },
    // Keyboard focus shows the same card at once; a click that focuses the row doesn't.
    onFocus(event: FocusEvent<HTMLDivElement>) {
      const el = event.currentTarget;
      if (event.target !== el || !el.matches(":focus-visible")) return;
      const r = el.getBoundingClientRect();
      ui.getState().set({ hoverPort: { nodeId, address: port.address, side: port.side, rect: { x: r.left, y: r.top, width: r.width, height: r.height }, keyboard: true } });
    },
    onBlur(event: FocusEvent<HTMLDivElement>) {
      if (event.target !== event.currentTarget) return;
      const hover = ui.getState().hoverPort;
      if (hover && hover.nodeId === nodeId && hover.address === port.address) ui.getState().set({ hoverPort: null });
    },
  };
}

/** The port rows of a node, by side, for arrow-key travel. */
function nodePorts(row: HTMLElement) {
  const node = row.closest<HTMLElement>(".react-flow__node");
  const rows = [...(node?.querySelectorAll<HTMLElement>(".sb-pe-row") ?? [])];
  const side = (which: "in" | "out") => [...(node?.querySelectorAll<HTMLElement>(`.sb-pe-port--${which}[tabindex]`) ?? [])];
  return { node, rows, in: side("in"), out: side("out") };
}

/**
 * Keys on a focused port row: Up and Down move along its side, Left and Right cross to the other side,
 * Enter or Space acts, and Escape cancels an armed output or closes a refusal, then returns to the node. Keys aimed at a
 * control inside the row are its own.
 */
function onPortKeyDown(event: KeyboardEvent<HTMLDivElement>, ui: UiStore, activate: (shift: boolean, row: HTMLElement) => void) {
  const row = event.currentTarget;
  if (event.target !== row || event.altKey || event.metaKey || event.ctrlKey) return;
  const { node, rows, ...sides } = nodePorts(row);
  const mine = row.classList.contains("sb-pe-port--in") ? "in" : "out";
  const along = sides[mine];
  const at = along.indexOf(row);
  let next: HTMLElement | undefined;
  switch (event.key) {
    case "Enter":
    case " ":
      activate(event.shiftKey, row);
      break;
    case "ArrowDown":
      next = along[Math.min(at + 1, along.length - 1)];
      break;
    case "ArrowUp":
      next = along[Math.max(at - 1, 0)];
      break;
    case "Home":
      next = along[0];
      break;
    case "End":
      next = along.at(-1);
      break;
    case "ArrowLeft":
    case "ArrowRight": {
      const other = sides[mine === "in" ? "out" : "in"];
      const here = rows.indexOf(row.parentElement!);
      next = other.slice().sort((a, b) => Math.abs(rows.indexOf(a.parentElement!) - here) - Math.abs(rows.indexOf(b.parentElement!) - here))[0];
      break;
    }
    case "Escape":
      if (ui.getState().armed) ui.getState().set({ armed: null });
      else if (ui.getState().connectHint) ui.getState().set({ connectHint: null });
      else node?.focus();
      break;
    default:
      return;
  }
  event.preventDefault();
  event.stopPropagation();
  next?.focus();
}

/** A press on a port row leaves focus on the node: rows are for keyboard travel, so Enter still renames and the arrows still nudge. */
function keepFocusOnNode(event: MouseEvent<HTMLDivElement>) {
  if ((event.target as Element).closest("input, textarea, select, button, [contenteditable]")) return;
  const node = event.currentTarget.closest<HTMLElement>(".react-flow__node");
  if (!node) return;
  event.preventDefault();
  node.focus({ preventScroll: true });
}

/** Right-click on a port row: the port's menu instead of the node's. */
function usePortMenu(nodeId: string, port: PortModel) {
  const { openPortMenu } = usePatchEditor();
  return (event: MouseEvent<HTMLDivElement>) => {
    if (!openPortMenu) return;
    event.preventDefault();
    event.stopPropagation();
    openPortMenu(event, nodeId, port);
  };
}

/** Whether a cable from an output of type `from` can end at an input of type `to`: "convert" when the wire converts the value. */
function dropFit(from: ValueType, to: ValueType): "true" | "convert" | "false" {
  const check = canConnect(from, to);
  return !check.ok ? "false" : check.conversion ? "convert" : "true";
}

const InputPort = memo(function InputPort({ nodeId, port, editable }: { nodeId: string; port: PortModel; editable: boolean }) {
  const { ui, actions } = usePatchEditor();
  const onContextMenu = usePortMenu(nodeId, port);
  const hover = useHoverCard(nodeId, port);
  const armable = useUi((s) => {
    const from = s.armed ? { type: s.armed.type, node: s.armed.nodeId } : s.draggingType && s.draggingSide === "out" ? { type: s.draggingType, node: s.draggingFrom } : null;
    return from && from.node !== nodeId ? dropFit(from.type, port.type) : null;
  });
  const highlighted = useUi((s) => s.highlightPort === port.address);
  const layerId = layerIdOfNode(nodeId);
  const undriven = layerId !== undefined && !port.connected;
  const connectArmed = (keepArmed: boolean, row?: HTMLElement) => {
    const armed = ui.getState().armed;
    if (!armed) return;
    const at = row?.getBoundingClientRect();
    actions.connect(armed.address, port.address, at && { x: at.left, y: at.bottom });
    if (!keepArmed) ui.getState().set({ armed: null });
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!ui.getState().armed || !armable || armable === "false") return;
    event.stopPropagation();
    connectArmed(event.shiftKey);
  };
  const armedLabel = useUi((s) => s.armed?.label);
  const fit = armedLabel && armable ? (armable === "false" ? `. Can't connect ${armedLabel} here` : `. Enter connects ${armedLabel}`) : "";
  return (
    <div
      className="sb-pe-port sb-pe-port--in"
      role="group"
      aria-roledescription="port"
      aria-label={`${port.name} input, ${VALUE_TYPE_LABELS[port.type].toLowerCase()}${port.connected ? ", connected" : ""}${fit}`}
      tabIndex={-1}
      data-connected={port.connected || undefined}
      data-issue={port.issue?.severity}
      data-armable={armable ?? undefined}
      data-highlight={highlighted || undefined}
      data-undriven={undriven || undefined}
      onClick={onClick}
      onMouseDownCapture={keepFocusOnNode}
      onKeyDown={(event) => onPortKeyDown(event, ui, connectArmed)}
      onContextMenu={onContextMenu}
      {...hover}
    >
      <Handle type="target" position={Position.Left} id={port.handleId} className="sb-pe-handle sb-pe-handle--in" aria-hidden>
        <PortGlyph type={port.type} connected={port.connected} size={9} />
      </Handle>
      <span className="sb-pe-port__label">{port.name}</span>
      {port.knob && <KnobChip knob={port.knob} />}
      {!port.connected && editable && <InlineValue port={port} />}
      {undriven && (
        <button
          type="button"
          className="sb-pe-port__drive nodrag nopan"
          aria-label={`Choose what drives ${port.name}`}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            actions.driveLayerProp(layerId, port.key);
          }}
        >
          Drive…
        </button>
      )}
    </div>
  );
});

function PulseRing({ address }: { address: string }) {
  const count = usePulseCount(address);
  const [shown, setShown] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    if (count === 0) return;
    const now = performance.now();
    if (now - last.current < 120) return;
    last.current = now;
    setShown(count);
  }, [count]);
  return shown > 0 ? <span key={shown} className="sb-pe-pulse-ring" aria-hidden /> : null;
}

/** The value is on, for the port dot's glow: true, or true in the watched copy of a loop. */
const isOn = (value: unknown, copy: number | null) => (copy === null ? isTruthyState(value) : pickCopy(value, copy).value === true);

const OutputPort = memo(function OutputPort({ nodeId, port, showsLive, far }: { nodeId: string; port: PortModel; showsLive: boolean; far: boolean }) {
  const { liveEnabled, ui, session, componentId } = usePatchEditor();
  const hover = useHoverCard(nodeId, port);
  const onContextMenu = usePortMenu(nodeId, port);
  const copy = useWatchedCopy(session);
  // Zoomed far out, the value's text isn't painted (patch-editor.css, data-lod). The row then follows
  // only what still shows, whether the value is on and how wide its slot is, so it renders when one of
  // those changes (or its first value arrives) and not with every value. Its text is the value as it
  // was at that render, and zooming back in reads the value as it is by then.
  const live = useLiveValue(liveEnabled && showsLive ? port.address : null, far ? (value) => `${value === undefined}|${isOn(value, copy)}|${liveReserve(port, value)}` : undefined);
  const armed = useUi((s) => s.armed?.address === port.address);
  const armable = useUi((s) => (s.draggingType && s.draggingSide === "in" && s.draggingFrom !== nodeId ? dropFit(port.type, s.draggingType) : null));
  const truthy = isOn(live, copy);
  const toggleArmed = () => {
    const label = `${session.document.getState().doc.components[componentId]?.patches[nodeId]?.name ?? nodeId} · ${port.name}`;
    ui.getState().set({ armed: armed ? null : { nodeId, handleId: port.handleId, address: port.address, type: port.type, label } });
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target as Element).closest(".sb-pe-handle")) return;
    event.stopPropagation();
    toggleArmed();
  };
  const text = liveText(port, live, copy);
  // The slot is as wide as the longest value its type prints, whichever loop copy is watched, and is
  // there before the first value, so the node mounts at the width it keeps and holds still while the
  // value changes (a longer one ends in "…"). It's no wider than a long row has room for, so its
  // labels stay whole.
  const reserve = showsLive ? liveReserve(port, live) : 0;
  const slot = reserve ? ({ "--sb-pe-live-reserve": `${reserve}ch`, ...(port.liveRoom !== undefined ? { "--sb-pe-live-room": `${port.liveRoom}px` } : {}) } as CSSProperties) : undefined;
  return (
    <div
      className="sb-pe-port sb-pe-port--out"
      role="group"
      aria-roledescription="port"
      aria-label={`${port.name} output, ${VALUE_TYPE_LABELS[port.type].toLowerCase()}${port.connected ? ", connected" : ""}${armed ? ", armed. Select an input to connect it" : ""}`}
      tabIndex={-1}
      data-connected={port.connected || undefined}
      data-live={truthy || undefined}
      data-armed={armed || undefined}
      data-armable={armable ?? undefined}
      onClick={onClick}
      onMouseDownCapture={keepFocusOnNode}
      onKeyDown={(event) => onPortKeyDown(event, ui, toggleArmed)}
      onContextMenu={onContextMenu}
      {...hover}
    >
      {(text || reserve > 0) && (
        <span className="sb-pe-port__live sb-tabular" style={slot}>
          {text}
        </span>
      )}
      <span className="sb-pe-port__label">{port.name}</span>
      <Handle type="source" position={Position.Right} id={port.handleId} className="sb-pe-handle sb-pe-handle--out" aria-hidden>
        <PortGlyph type={port.type} connected={port.connected || armed} live={truthy} size={9} />
        {liveEnabled && port.type === "pulse" && <PulseRing address={port.address} />}
      </Handle>
    </div>
  );
});

export interface PortRowsProps {
  nodeId: string;
  inputs: readonly PortModel[];
  outputs: readonly PortModel[];
  editable: boolean;
  /** Outputs show live values in their slots (all but Component Inputs, whose ports never have one). */
  showsLive?: boolean;
}

/**
 * React Flow measures a node's handles when it mounts or resizes. When the set of handles changes
 * without a resize (a port swapped for another), ask it to measure again so cables find their handles.
 */
function useRemeasureOnHandleChange(nodeId: string, inputs: readonly PortModel[], outputs: readonly PortModel[]) {
  const updateNodeInternals = useUpdateNodeInternals();
  const signature = `${inputs.map((p) => p.handleId).join(",")}|${outputs.map((p) => p.handleId).join(",")}`;
  const previous = useRef(signature);
  useLayoutEffect(() => {
    if (previous.current === signature) return;
    previous.current = signature;
    updateNodeInternals(nodeId);
  }, [nodeId, signature, updateNodeInternals]);
}

/** Inputs down the left, outputs down the right, one row each. */
export const PortRows = memo(function PortRows({ nodeId, inputs, outputs, editable, showsLive = true }: PortRowsProps) {
  useRemeasureOnHandleChange(nodeId, inputs, outputs);
  // Read once per node, not per row: rows render with every value they follow.
  const far = useUi((s) => s.farZoom);
  const rows = Math.max(inputs.length, outputs.length);
  if (rows === 0) return <div className="sb-pe-rows sb-pe-rows--empty" />;
  return (
    <div className="sb-pe-rows">
      {Array.from({ length: rows }, (_, i) => {
        const input = inputs[i];
        const output = outputs[i];
        return (
          <div key={i} className="sb-pe-row">
            {input ? <InputPort nodeId={nodeId} port={input} editable={editable} /> : <span className="sb-pe-port sb-pe-port--spacer" />}
            {output ? <OutputPort nodeId={nodeId} port={output} showsLive={showsLive} far={far} /> : null}
          </div>
        );
      })}
    </div>
  );
});

/** Collapsed nodes keep every handle, stacked on the header, so cables still attach. */
export const CollapsedPorts = memo(function CollapsedPorts({ inputs, outputs }: { inputs: readonly PortModel[]; outputs: readonly PortModel[] }) {
  const style = { top: HEADER_HEIGHT / 2 };
  const anyIn = inputs.some((p) => p.connected);
  const anyOut = outputs.some((p) => p.connected);
  return (
    <>
      {inputs.map((p) => (
        <Handle key={p.handleId} type="target" position={Position.Left} id={p.handleId} className="sb-pe-handle sb-pe-handle--in sb-pe-handle--collapsed" style={style} />
      ))}
      {outputs.map((p) => (
        <Handle key={p.handleId} type="source" position={Position.Right} id={p.handleId} className="sb-pe-handle sb-pe-handle--out sb-pe-handle--collapsed" style={style} />
      ))}
      {inputs.length > 0 && <span className="sb-pe-collapsed-glyph sb-pe-collapsed-glyph--in" data-connected={anyIn || undefined} aria-hidden />}
      {outputs.length > 0 && <span className="sb-pe-collapsed-glyph sb-pe-collapsed-glyph--out" data-connected={anyOut || undefined} aria-hidden />}
    </>
  );
});
