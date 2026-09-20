/** Cables: colored by source type, loop tint, conversion and invalid glyphs, orbs for pulses and state changes, state glow. */

import { useStore as useFlowStore, useStoreApi, type ConnectionLineComponentProps, type EdgeProps } from "@xyflow/react";
import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { portColorVar } from "../../../theme/tokens.ts";
import { isTruthyState } from "@sonobe/core/graph";
import { cablePath, cablePoint } from "../model/geometry.ts";
import { addressNode, type CableFlowEdge, type FlowNode } from "../model/types.ts";
import { usePatchEditor, useLiveValue, useUi } from "../state/context.ts";
import { ORB_INSET, ORB_RADIUS, ORB_SLOTS, ORB_TRAILS, type OrbTone } from "./orb.ts";
import { createOrbFlight, type OrbEnds } from "./orbFlight.ts";
import { createOrbQueue, orbRelayFor } from "./orbSchedule.ts";

/** How long a cable keeps its orb elements after the last one lands, so a cable that fires now and then doesn't rebuild them each time. */
const ORB_IDLE_MS = 4000;

const nodeOf = (address: string) => addressNode(address)?.nodeId ?? address;

interface OrbProps extends OrbEnds {
  d: string;
  /** The output's address, and the input's. */
  source: string;
  target: string;
  /** The cable's color, for the landing, which is drawn above the nodes. */
  color: string;
  pulse: boolean;
  reduced: boolean;
}

/**
 * A glowing orb that travels the cable from output to input each time a pulse fires or a boolean
 * turns on, and a dimmer one when it turns off; when it gets there, the input's dot flares. With
 * reduced motion the whole cable flashes instead. Nothing mounts until the first send, a second or
 * third slot mounts only when orbs overlap, the elements unmount once the cable is idle, and each
 * send replays Web Animations on reused elements (orbFlight.ts), so an orb in flight never
 * re-renders React. When one may leave is orbSchedule.ts.
 */
const Orb = memo(function Orb(props: OrbProps) {
  const { d, tx, ty, source, color, pulse, reduced } = props;
  const { live } = usePatchEditor();
  const flow = useStoreApi();
  const gradient = `sb-pe-orb${useId().replace(/[^\w-]/g, "")}`;
  /** Slots mounted: 0 while idle. */
  const [slots, setSlots] = useState(0);
  const root = useRef<SVGGElement>(null);
  const landing = useRef<SVGSVGElement>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  const [orb] = useState(() => {
    const flight = createOrbFlight();
    const queue = createOrbQueue();
    /** A send waiting for its slot to mount. */
    let unmounted: OrbTone | null = null;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let wait: ReturnType<typeof setTimeout> | undefined;
    /** Unmounted: a send the relay still holds finds nothing to play. */
    let stopped = false;

    const launch = (tone: OrbTone) => {
      const el = root.current;
      const p = latest.current;
      const played = el ? flight.play(el, landing.current, tone, p, p.reduced) : null;
      if (!played) {
        unmounted = tone;
        setSlots((n) => (el ? Math.min(ORB_SLOTS, n + 1) : Math.max(n, 1)));
        return;
      }
      queue.setGap(played.gap);
      clearTimeout(idle);
      idle = setTimeout(() => {
        if (queue.waiting()) return;
        flight.reset();
        setSlots(0);
      }, played.done + ORB_IDLE_MS);
    };

    /** Launch now or once `ready` and the cable's gap allow; returns when it reaches the input. */
    const schedule = (tone: OrbTone, ready: number): number | null => {
      const now = performance.now();
      const p = latest.current;
      const go = stopped ? null : queue.offer(now, tone, { ready, hold: !p.pulse });
      if (!go) return null;
      if (go.timer) {
        // Mount now, so the elements are ready when it leaves.
        clearTimeout(idle);
        setSlots((n) => Math.max(n, 1));
        wait = setTimeout(() => {
          const held = queue.take(performance.now());
          if (held) launch(held);
        }, go.at - now);
      } else if (go.at <= now) launch(tone);
      return p.reduced ? null : go.at + flight.arrival(tone, p);
    };

    return {
      send(tone: OrbTone) {
        const p = latest.current;
        const now = performance.now();
        if (p.reduced) return void schedule(tone, now);
        orbRelayFor(live).send({ from: nodeOf(p.source), to: nodeOf(p.target), event: now, launch: (ready) => schedule(tone, ready) });
      },
      /** Play the send that mounted a slot. */
      mounted() {
        const tone = unmounted;
        unmounted = null;
        if (tone) launch(tone);
      },
      start() {
        stopped = false;
      },
      stop() {
        stopped = true;
        clearTimeout(idle);
        clearTimeout(wait);
        queue.clear();
      },
    };
  });

  useLayoutEffect(() => {
    if (slots > 0) orb.mounted();
  }, [slots, orb]);

  useEffect(() => {
    if (pulse) return live.subscribePulse(source, () => orb.send("full"));
    // Only a change sends an orb: not the first value, and not the value going away (a scope switch).
    let known = live.get(source) !== undefined;
    let on = isTruthyState(live.get(source));
    return live.subscribe(source, () => {
      const value = live.get(source);
      if (value === undefined) return void (known = false);
      const next = isTruthyState(value);
      if (known && next !== on) orb.send(next ? "full" : "dim");
      known = true;
      on = next;
    });
  }, [live, source, pulse, orb]);

  useEffect(() => {
    orb.start();
    return () => orb.stop();
  }, [orb]);

  if (slots === 0) return null;
  if (reduced) {
    return (
      <g ref={root} className="sb-pe-orb" aria-hidden>
        <path className="sb-pe-cable__flash" d={d} />
      </g>
    );
  }
  // The landing goes in React Flow's viewport portal, above the nodes, so its ring spreads around the
  // input's dot instead of under the node.
  const portal = flow.getState().domNode?.querySelector(".react-flow__viewport-portal");
  const dotX = tx + ORB_INSET;
  return (
    <g ref={root} className="sb-pe-orb" aria-hidden>
      <radialGradient id={gradient}>
        <stop offset="0" className="sb-pe-orb__core" />
        <stop offset="0.16" className="sb-pe-orb__hot" />
        <stop offset="0.34" className="sb-pe-orb__color" />
        <stop offset="0.6" className="sb-pe-orb__glow" />
        <stop offset="1" className="sb-pe-orb__fade" />
      </radialGradient>
      {Array.from({ length: slots }, (_, i) => (
        <g key={i} className="sb-pe-orb__slot">
          {ORB_TRAILS.map((name) => (
            <path key={name} className={`sb-pe-orb__${name}`} />
          ))}
          <circle className="sb-pe-orb__head" r={ORB_RADIUS} fill={`url(#${gradient})`} />
        </g>
      ))}
      {portal &&
        createPortal(
          <svg ref={landing} className="sb-pe-orb-landing" style={{ "--sb-cable": color } as CSSProperties} aria-hidden>
            <radialGradient id={`${gradient}-flare`}>
              <stop offset="0" className="sb-pe-orb__flare-core" />
              <stop offset="0.3" className="sb-pe-orb__flare-hot" />
              <stop offset="0.6" className="sb-pe-orb__flare-glow" />
              <stop offset="1" className="sb-pe-orb__fade" />
            </radialGradient>
            {Array.from({ length: slots }, (_, i) => (
              <g key={i} className="sb-pe-orb__land">
                <circle className="sb-pe-orb__flare" cx={dotX} cy={ty} r={8} fill={`url(#${gradient}-flare)`} />
                <circle className="sb-pe-orb__ring" cx={dotX} cy={ty} r={8} />
              </g>
            ))}
          </svg>,
          portal,
        )}
    </g>
  );
});

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
      {stateSource && <Orb d={d} sx={sourceX} sy={sourceY} tx={targetX} ty={targetY} source={stateSource} target={data.to} color={data.invalid ? "var(--danger)" : portColorVar(data.sourceType)} pulse={data.sourceType === "pulse"} reduced={reducedMotion} />}
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
