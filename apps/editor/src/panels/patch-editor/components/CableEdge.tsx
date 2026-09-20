/** Cables: colored by source type, loop tint, conversion and invalid glyphs, pulse sparks, state glow. */

import { useStore as useFlowStore, type ConnectionLineComponentProps, type EdgeProps } from "@xyflow/react";
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { portColorVar } from "../../../theme/tokens.ts";
import { isTruthyState } from "@sonobe/core/graph";
import { cablePath, cablePoint } from "../model/geometry.ts";
import type { CableFlowEdge, FlowNode } from "../model/types.ts";
import { usePatchEditor, useLiveValue, usePulseCount, useUi } from "../state/context.ts";

const SPARK_MS = 460;

function Spark({ d, source, reduced }: { d: string; source: string; reduced: boolean }) {
  const count = usePulseCount(source);
  const motion = useRef<SVGAnimateMotionElement>(null);
  const fade = useRef<SVGAnimateElement>(null);
  const lastBegin = useRef(-Infinity);
  const [flash, setFlash] = useState(0);
  useLayoutEffect(() => {
    if (count === 0) return;
    const now = performance.now();
    if (now - lastBegin.current < SPARK_MS * 0.75) return;
    lastBegin.current = now;
    if (reduced) setFlash(count);
    else {
      motion.current?.beginElement?.();
      fade.current?.beginElement?.();
    }
  }, [count, reduced]);
  if (count === 0) return null;
  if (reduced) return flash ? <path key={flash} className="sb-pe-cable__flash" d={d} /> : null;
  return (
    <circle r={3.5} className="sb-pe-cable__spark" opacity={0}>
      <animateMotion ref={motion} dur={`${SPARK_MS}ms`} begin="indefinite" fill="freeze" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.35 0 0.25 1" />
      <animate ref={fade} attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.8;1" dur={`${SPARK_MS}ms`} begin="indefinite" fill="freeze" />
    </circle>
  );
}

export const CableEdgeView = memo(function CableEdgeView({ id, sourceX, sourceY, targetX, targetY, selected, data }: EdgeProps<CableFlowEdge>) {
  const { geometry, liveEnabled, reducedMotion } = usePatchEditor();
  const detaching = useUi((s) => s.detaching?.edgeId === id);
  const splicing = useUi((s) => s.spliceEdge === id);
  const stateSource = data && (data.sourceType === "boolean" || data.sourceType === "pulse") && liveEnabled ? data.from : null;
  const live = isTruthyState(useLiveValue(data?.sourceType === "boolean" ? stateSource : null));

  useLayoutEffect(() => {
    geometry.set(id, { id, sx: sourceX, sy: sourceY, tx: targetX, ty: targetY });
  }, [geometry, id, sourceX, sourceY, targetX, targetY]);
  useEffect(() => () => void geometry.delete(id), [geometry, id]);

  if (!data || detaching) return null;
  const d = cablePath(sourceX, sourceY, targetX, targetY);
  const [mx, my] = cablePoint(0.5, sourceX, sourceY, targetX, targetY);
  const glyph = data.invalid ? "invalid" : data.conversion ? "conversion" : null;
  return (
    <g
      className="sb-pe-cable"
      data-selected={selected || undefined}
      data-invalid={data.invalid ? true : undefined}
      data-loop={data.loop || undefined}
      data-live={live || undefined}
      data-splice={splicing || undefined}
      data-pulse={data.sourceType === "pulse" || undefined}
      style={{ "--sb-cable": data.invalid ? "var(--danger)" : portColorVar(data.sourceType) } as CSSProperties}
    >
      {data.loop && <path className="sb-pe-cable__loop" d={d} />}
      {(live || selected || splicing) && <path className="sb-pe-cable__glow" d={d} />}
      <path className="sb-pe-cable__wire" d={d} />
      <path className="sb-pe-cable__hit react-flow__edge-interaction" d={d} />
      {stateSource && data.sourceType === "pulse" && <Spark d={d} source={data.from} reduced={reducedMotion} />}
      {glyph && (
        <g className="sb-pe-cable__glyph" data-kind={glyph} transform={`translate(${mx} ${my})`}>
          <title>{data.invalid ?? `Converted: ${data.conversion}`}</title>
          <circle r={6.5} />
          {glyph === "invalid" ? (
            <>
              <rect x={-0.9} y={-3.6} width={1.8} height={4} rx={0.9} />
              <circle cy={2.7} r={1} />
            </>
          ) : (
            <path d="M -3.2 0.9 Q -1.6 -2.2 0 0 T 3.2 -0.9" />
          )}
        </g>
      )}
    </g>
  );
});

/** The cable being dragged, colored by its type and drawn output → input whichever end you grabbed. */
export function ConnectionLineView({ fromX, fromY, toX, toY, fromHandle, connectionStatus }: ConnectionLineComponentProps<FlowNode>) {
  const detaching = useUi((s) => s.detaching);
  const type = useUi((s) => s.detaching?.sourceType ?? s.draggingType);
  const source = useFlowStore((s) => (detaching ? s.nodeLookup.get(detaching.sourceNode) : undefined));
  let sx = fromX;
  let sy = fromY;
  let tx = toX;
  let ty = toY;
  if (detaching && source) {
    const handle = source.internals.handleBounds?.source?.find((h) => h.id === detaching.sourceHandle);
    if (handle) {
      sx = source.internals.positionAbsolute.x + handle.x + handle.width / 2;
      sy = source.internals.positionAbsolute.y + handle.y + handle.height / 2;
    }
  } else if (fromHandle.type === "target") {
    sx = toX;
    sy = toY;
    tx = fromX;
    ty = fromY;
  }
  return (
    <g className="sb-pe-connection" data-status={connectionStatus ?? undefined} style={{ "--sb-cable": type ? portColorVar(type) : "var(--text-secondary)" } as CSSProperties}>
      <path className="sb-pe-connection__wire" d={cablePath(sx, sy, tx, ty)} />
      <circle className="sb-pe-connection__tip" cx={toX} cy={toY} r={3.5} />
    </g>
  );
}
