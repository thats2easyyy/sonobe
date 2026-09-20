/** Cables: colored by source type, loop tint, conversion and invalid glyphs, pulse sparks, state glow. */

import { useStore as useFlowStore, type ConnectionLineComponentProps, type EdgeProps } from "@xyflow/react";
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { portColorVar } from "../../../theme/tokens.ts";
import { isTruthyState } from "@sonobe/core/graph";
import { cablePath, cablePoint } from "../model/geometry.ts";
import type { CableFlowEdge, FlowNode } from "../model/types.ts";
import { usePatchEditor, useLiveValue, useUi } from "../state/context.ts";
import { ORB_RADIUS, ORB_SLOTS, ORB_TRAILS, type OrbTone } from "./orb.ts";
import { createOrbFlight, type OrbEnds } from "./orbFlight.ts";

/** How long a cable keeps its orb elements after the last one lands, so a steady ticker doesn't remount them each time. */
const ORB_IDLE_MS = 1500;

interface OrbProps extends OrbEnds {
  d: string;
  source: string;
  pulse: boolean;
  reduced: boolean;
}

/**
 * A glowing orb that travels the cable from output to input each time a pulse fires or a boolean
 * turns on, and a dimmer one when it turns off. With reduced motion the whole cable flashes instead.
 * Nothing mounts until the first send, the elements unmount once the cable is idle, and each send
 * replays Web Animations on reused elements (orbFlight.ts), so an orb in flight never re-renders React.
 */
function Orb(props: OrbProps) {
  const { d, tx, ty, source, pulse, reduced } = props;
  const { live } = usePatchEditor();
  const gradient = `sb-pe-orb${useId().replace(/[^\w-]/g, "")}`;
  const [shown, setShown] = useState(false);
  const root = useRef<SVGGElement>(null);
  const latest = useRef(props);
  const [flight] = useState(createOrbFlight);
  const state = useRef({ pending: null as OrbTone | null, idle: undefined as ReturnType<typeof setTimeout> | undefined });
  useLayoutEffect(() => {
    latest.current = props;
  });

  const play = useRef((el: SVGGElement, tone: OrbTone) => {
    const s = state.current;
    const ms = flight.play(el, tone, latest.current, latest.current.reduced);
    clearTimeout(s.idle);
    s.idle = setTimeout(() => {
      flight.reset();
      setShown(false);
    }, ms + ORB_IDLE_MS);
  }).current;

  const send = useRef((tone: OrbTone) => {
    const s = state.current;
    if (!flight.admit(performance.now())) return;
    if (root.current) play(root.current, tone);
    else {
      s.pending = tone;
      setShown(true);
    }
  }).current;

  useLayoutEffect(() => {
    const s = state.current;
    if (!shown || !root.current || !s.pending) return;
    play(root.current, s.pending);
    s.pending = null;
  }, [shown, play]);

  useEffect(() => {
    if (pulse) return live.subscribePulse(source, () => send("full"));
    // Only a change sends an orb: not the first value, and not the value going away (a scope switch).
    let known = live.get(source) !== undefined;
    let on = isTruthyState(live.get(source));
    return live.subscribe(source, () => {
      const value = live.get(source);
      if (value === undefined) return void (known = false);
      const next = isTruthyState(value);
      if (known && next !== on) send(next ? "full" : "dim");
      known = true;
      on = next;
    });
  }, [live, source, pulse, send]);

  useEffect(() => () => clearTimeout(state.current.idle), []);

  if (!shown) return null;
  return (
    <g ref={root} className="sb-pe-orb" aria-hidden>
      {reduced ? (
        <path className="sb-pe-cable__flash" d={d} />
      ) : (
        <>
          <radialGradient id={gradient}>
            <stop offset="0" className="sb-pe-orb__core" />
            <stop offset="0.14" className="sb-pe-orb__hot" />
            <stop offset="0.32" className="sb-pe-orb__color" />
            <stop offset="0.58" className="sb-pe-orb__glow" />
            <stop offset="1" className="sb-pe-orb__fade" />
          </radialGradient>
          <radialGradient id={`${gradient}-bloom`}>
            <stop offset="0" className="sb-pe-orb__bloom-center" />
            <stop offset="0.5" className="sb-pe-orb__bloom-mid" />
            <stop offset="1" className="sb-pe-orb__fade" />
          </radialGradient>
          {Array.from({ length: ORB_SLOTS }, (_, i) => (
            <g key={i} className="sb-pe-orb__slot">
              {ORB_TRAILS.map((name) => (
                <path key={name} className={`sb-pe-orb__${name}`} />
              ))}
              <circle className="sb-pe-orb__head" r={ORB_RADIUS} fill={`url(#${gradient})`} />
              <circle className="sb-pe-orb__bloom" cx={tx} cy={ty} r={ORB_RADIUS} fill={`url(#${gradient}-bloom)`} />
              <circle className="sb-pe-orb__ring" cx={tx} cy={ty} r={ORB_RADIUS} />
            </g>
          ))}
        </>
      )}
    </g>
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
      {stateSource && <Orb d={d} sx={sourceX} sy={sourceY} tx={targetX} ty={targetY} source={stateSource} pulse={data.sourceType === "pulse"} reduced={reducedMotion} />}
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
