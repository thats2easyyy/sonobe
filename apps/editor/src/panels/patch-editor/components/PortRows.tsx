/** Port rows shared by patch, layer, and interface nodes: handles, labels, inline values, live values. */

import { canConnect } from "@sonobe/core";
import { Handle, Position } from "@xyflow/react";
import { memo, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { PortGlyph } from "../../../ui/PortGlyph.tsx";
import { formatValue, isTruthyState } from "../model/format.ts";
import { HEADER_HEIGHT } from "../model/geometry.ts";
import type { PortModel } from "../model/types.ts";
import { usePatchEditor, useLiveValue, usePulseCount, useUi } from "../state/context.ts";
import { InlineValue } from "./InlineValue.tsx";

const HOVER_DELAY_MS = 450;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;

function useHoverCard(nodeId: string, port: PortModel) {
  const { ui, session, componentId } = usePatchEditor();
  return {
    onPointerEnter(event: PointerEvent<HTMLDivElement>) {
      const el = event.currentTarget;
      clearTimeout(hoverTimer);
      session.selection.getState().setHovered({ kind: "port", id: nodeId.replace(/^@/, ""), component: componentId, address: port.address, source: "patchEditor" });
      if (event.buttons !== 0) return;
      hoverTimer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        ui.getState().set({ hoverPort: { nodeId, address: port.address, side: port.side, rect: { x: r.left, y: r.top, width: r.width, height: r.height } } });
      }, HOVER_DELAY_MS);
    },
    onPointerLeave() {
      clearTimeout(hoverTimer);
      if (ui.getState().hoverPort) ui.getState().set({ hoverPort: null });
      const hovered = session.selection.getState().hovered;
      if (hovered?.address === port.address) session.selection.getState().setHovered(null);
    },
    onPointerDown() {
      clearTimeout(hoverTimer);
      if (ui.getState().hoverPort) ui.getState().set({ hoverPort: null });
    },
  };
}

const InputPort = memo(function InputPort({ nodeId, port, editable }: { nodeId: string; port: PortModel; editable: boolean }) {
  const { ui, actions } = usePatchEditor();
  const hover = useHoverCard(nodeId, port);
  const armable = useUi((s) => (s.armed && s.armed.nodeId !== nodeId ? canConnect(s.armed.type, port.type).ok : null));
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const armed = ui.getState().armed;
    if (!armed || !armable) return;
    event.stopPropagation();
    actions.connect(armed.address, port.address);
    if (!event.shiftKey) ui.getState().set({ armed: null });
  };
  return (
    <div className="sb-pe-port sb-pe-port--in" data-connected={port.connected || undefined} data-issue={port.issue?.severity} data-armable={armable ?? undefined} data-advanced={undefined} onClick={onClick} {...hover}>
      <Handle type="target" position={Position.Left} id={port.handleId} className="sb-pe-handle sb-pe-handle--in" aria-label={`${port.name} input`}>
        <PortGlyph type={port.type} connected={port.connected} size={9} />
      </Handle>
      <span className="sb-pe-port__label">{port.name}</span>
      {!port.connected && editable && <InlineValue port={port} />}
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

const OutputPort = memo(function OutputPort({ nodeId, port }: { nodeId: string; port: PortModel }) {
  const { liveEnabled, ui, session, componentId } = usePatchEditor();
  const hover = useHoverCard(nodeId, port);
  const live = useLiveValue(liveEnabled ? port.address : null);
  const armed = useUi((s) => s.armed?.address === port.address);
  const truthy = isTruthyState(live);
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target as Element).closest(".sb-pe-handle")) return;
    event.stopPropagation();
    const label = `${session.document.getState().doc.components[componentId]?.patches[nodeId]?.name ?? nodeId} · ${port.name}`;
    ui.getState().set({ armed: armed ? null : { nodeId, handleId: port.handleId, address: port.address, type: port.type, label } });
  };
  const text = live === undefined || port.type === "pulse" ? "" : formatValue(live, port.type, { maxText: 10, ...(port.enumOptions ? { enumOptions: port.enumOptions } : {}) });
  return (
    <div className="sb-pe-port sb-pe-port--out" data-connected={port.connected || undefined} data-live={truthy || undefined} data-armed={armed || undefined} onClick={onClick} {...hover}>
      {text && <span className="sb-pe-port__live sb-tabular">{text}</span>}
      <span className="sb-pe-port__label">{port.name}</span>
      <Handle type="source" position={Position.Right} id={port.handleId} className="sb-pe-handle sb-pe-handle--out" aria-label={`${port.name} output`}>
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
}

/** Inputs down the left, outputs down the right, one row each. */
export const PortRows = memo(function PortRows({ nodeId, inputs, outputs, editable }: PortRowsProps) {
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
            {output ? <OutputPort nodeId={nodeId} port={output} /> : null}
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
