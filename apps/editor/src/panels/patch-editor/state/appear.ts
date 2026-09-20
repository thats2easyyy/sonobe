/**
 * How nodes and cables arrive on the patch editor canvas. One store per editor (per component
 * shown) remembers which node ids and cables are on the canvas and when each started to appear, so
 * an appearance plays once: never again when React Flow remounts a node panned back into view
 * (onlyRenderVisibleElements), or on a drag, collapse, rename or re-measure.
 *
 * - The first reveal (mount, entering a component, a replaced document) waits for the first fit.
 *   When the viewport shows, comment frames fade in, then the nodes in view materialize in a wave
 *   that follows the signal flow left to right, and each cable draws from its output as that node
 *   comes in, its tip reaching an input node that's there or arriving. More than LARGE_REVEAL
 *   nodes, or reduced motion, fade in with the viewport.
 * - Later, a node the canvas isn't showing (inserted, pasted, duplicated, brought back by undo,
 *   added by Claude) animates in at once, several in one change in a short wave. New cables that
 *   come with new nodes, or from someone else (Claude, undo and redo), draw in; a cable the person
 *   connected between nodes already on the canvas appears as it is, since they drew it.
 * - What the person already sees before their change lands (`placed`) doesn't arrive again: an
 *   option-drag copy only glows its ring where it was dropped, and the cable they dragged into link
 *   search is simply there, with the node picked for its end fading in without travel.
 *
 * The store styles React Flow's own node and edge wrappers as they mount (a MutationObserver on
 * the node and edge layers): `data-appear` and `--sb-appear-delay`, which the "Appearing" rules in
 * patch-editor.css read, cleared again when the animation is over. Nodes travel with the CSS
 * `translate` property on the wrapper and nothing scales, so the handle positions React Flow
 * measures when a node mounts stay right.
 */

/** A node materializes: fade and travel. */
export const NODE_MS = 360;
/** The category-colored ring glows in and settles, from the same start. */
export const ACCENT_MS = 560;
/** Comment frames fade in first: they're backgrounds. */
export const COMMENT_MS = 300;
/** Nodes start this long after the frames begin, when there are frames. */
export const NODE_LEAD_MS = 50;
/** A cable draws from its output to its input. */
export const CABLE_MS = 320;
/** A cable leaves its output once that node is this far into appearing (mostly faded in, most of its travel done), so the wiring keeps pace with the wave. */
export const CABLE_LAG_MS = Math.round(NODE_MS * 0.25);
/** The first reveal's wave spreads over at most this long... */
export const WAVE_MS = 340;
/** ...and at most this much per node, so a few nodes don't wait on each other. */
export const WAVE_STEP_MS = 40;
/** Several nodes in one later change arrive this far apart... */
export const BATCH_STEP_MS = 30;
/** ...all within this. */
export const BATCH_MAX_MS = 300;
/** More nodes than this revealing at once fade in together, with the viewport or without a wave. */
export const LARGE_REVEAL = 150;
/**
 * More nodes than this in one wave travel without the ring: a ring glowing inside each fading node
 * costs frames. Measured at 1920 × 1200: 65 rings hold 60 fps, 78 already drop a few frames.
 */
export const RING_LIMIT = 64;
/** How long a `placed` hint waits for the change that brings what it names. */
export const PLACED_MS = 1000;
/** The viewport fade (large graphs, reduced motion) and other plain fades. */
export const FADE_MS = 180;
/** How long past its end an animation keeps its attributes, since CSS starts it on the next frame. */
const SWEEP_SLACK_MS = 60;
/** How much the wave weighs y against x, so a column cascades top to bottom. */
const Y_WEIGHT = 0.15;
/** The size assumed for a node React Flow hasn't measured (visibility at the first reveal). */
const DEFAULT_SIZE = { width: 200, height: 120 };

/**
 * node: fade, travel and ring. slide: fade and travel (a wave over RING_LIMIT). still: fade and ring,
 * no travel (the node at the end of a cable the person drew). placed: the ring only (a node the person
 * already sees where it lands). comment: fade. fade: a plain quick fade. draw: a cable drawing from its output.
 */
export type AppearMode = "node" | "slide" | "still" | "placed" | "comment" | "fade" | "draw";

export interface Appearance {
  mode: AppearMode;
  /** Clock time the animation starts, after its delay. */
  start: number;
  /** Clock time it's over, the accent included. */
  end: number;
}

export interface AppearPoint {
  id: string;
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the store reads of a graph node (FlowNode fits). */
export interface AppearNodeInput {
  id: string;
  type?: string | undefined;
  position: { x: number; y: number };
}

/** What the store reads of a cable (CableFlowEdge fits). */
export interface AppearEdgeInput {
  id: string;
  source: string;
  target: string;
  data?: { from: string; to?: string; invalid?: string | undefined } | undefined;
}

export interface AppearChange {
  /** The person made the change in this editor (not Claude, not undo or redo): their new cables between nodes already shown appear at once. */
  byHand: boolean;
}

/** What the person's next change brings that they already see (AppearStore.placed). */
export interface AppearPlaced {
  /** Node ids that land where the person sees them already: option-drag copies. */
  nodes?: readonly string[];
  /** Ports the person dragged a cable from (an output) or to (an input), into link search: the new cable at that port. */
  ports?: readonly string[];
}

/**
 * Delays for a first reveal: a wave across the nodes' x, with y as a slight diagonal so a column
 * cascades top to bottom. It spreads over at most `spread` ms, and over less for a few nodes.
 */
export function waveDelays(points: readonly AppearPoint[], spread = WAVE_MS): Map<string, number> {
  const out = new Map<string, number>();
  if (points.length === 0) return out;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const range = maxX - minX + (maxY - minY) * Y_WEIGHT;
  const total = Math.min(spread, WAVE_STEP_MS * (points.length - 1));
  for (const p of points) out.set(p.id, range > 0 ? Math.round(((p.x - minX + (p.y - minY) * Y_WEIGHT) / range) * total) : 0);
  return out;
}

/** Delays for several nodes arriving in one change: left to right, then top to bottom, BATCH_STEP_MS apart and all within BATCH_MAX_MS. */
export function batchDelays(points: readonly AppearPoint[]): Map<string, number> {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const step = sorted.length > 1 ? Math.min(BATCH_STEP_MS, BATCH_MAX_MS / (sorted.length - 1)) : 0;
  return new Map(sorted.map((p, i) => [p.id, Math.round(i * step)]));
}

/**
 * When a cable starts drawing from its output: CABLE_LAG_MS after its output's node starts appearing,
 * and not before its input's node starts, so the drawing tip (CABLE_MS long) meets a node that's
 * already there or materializing. `now` when neither end is appearing.
 */
export function cableStart(output: Appearance | undefined, input: Appearance | undefined, now: number): number {
  let start = now;
  if (output && output.end > now) start = Math.max(start, output.start + CABLE_LAG_MS);
  if (input && input.end > now) start = Math.max(start, input.start);
  return start;
}

/** True when a node at `point` with `size` overlaps `view` (flow coordinates). */
export function inView(point: { x: number; y: number }, size: { width: number; height: number }, view: Rect): boolean {
  return point.x < view.x + view.width && point.x + size.width > view.x && point.y < view.y + view.height && point.y + size.height > view.y;
}

/** How long an appearance of `mode` lasts from its start. */
export function durationOf(mode: AppearMode): number {
  if (mode === "node" || mode === "still" || mode === "placed") return Math.max(NODE_MS, ACCENT_MS);
  if (mode === "slide") return NODE_MS;
  if (mode === "comment") return COMMENT_MS;
  if (mode === "draw") return CABLE_MS;
  return FADE_MS;
}

const nodeKey = (id: string) => `n:${id}`;
const cableKey = (id: string) => `c:${id}`;

export interface AppearStoreOptions {
  /** Milliseconds clock. Default performance.now. */
  now?: () => number;
  /** Reduced motion is on (the OS or the app). Default never. */
  reducedMotion?: () => boolean;
}

export interface AppearStore {
  /** Compare the graph with what's on the canvas; call with every derived graph. New nodes and cables get their appearance. */
  sync(nodes: readonly AppearNodeInput[], edges: readonly AppearEdgeInput[], change: AppearChange): void;
  /** The viewport is visible: reveal what's in `view` (flow coordinates; everything when omitted). `size` gives measured node sizes. */
  start(view?: Rect | null, size?: (id: string) => { width: number; height: number } | undefined): void;
  /** Wait for the next start, which reveals the whole graph again (another document replaced this one). */
  reset(): void;
  /** The person already sees what their next change brings; call just before making it. The hint lasts until a change adds something, or PLACED_MS. */
  placed(what: AppearPlaced): void;
  /** Style the node and edge wrappers under `canvas` as React Flow mounts them. Returns a function that stops and clears every timer, appearance and attribute (the editor unmounted). */
  observe(canvas: HTMLElement): () => void;
  /** A node's or cable's appearance, while it lasts. */
  appearance(kind: "node" | "cable", id: string): Appearance | undefined;
  /** Milliseconds until nothing is appearing (0 when idle). */
  busyFor(): number;
  /** True until the first start, and again after a reset. */
  waiting(): boolean;
}

interface NodeEntry {
  x: number;
  y: number;
  comment: boolean;
  gen: number;
}

interface CableEntry {
  from: string;
  to: string;
  source: string;
  target: string;
  invalid: boolean;
  gen: number;
}

export function createAppearStore(options: AppearStoreOptions = {}): AppearStore {
  const now = options.now ?? (() => performance.now());
  const reduced = options.reducedMotion ?? (() => false);
  let waiting = true;
  let gen = 0;
  /** Nodes on the canvas, with where they are (a batch waves by position). */
  const nodes = new Map<string, NodeEntry>();
  /** Cables on the canvas by edge id (the input). A different `from` into the same input is a new cable. */
  const cables = new Map<string, CableEntry>();
  const shown = new Map<string, Appearance>();
  /** Wrappers carrying data-appear, with the key of the appearance they show. */
  const styled = new Map<Element, string>();
  let canvas: HTMLElement | null = null;
  let fadeUntil = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerAt = Infinity;
  let hint: { nodes: Set<string>; ports: Set<string>; until: number } | null = null;

  const layers = () => [canvas?.querySelector(".react-flow__nodes"), canvas?.querySelector(".react-flow__edges")].filter((l): l is Element => !!l);
  /** The wrapper for a child of the node or edge layer: nodes are children, each cable is an <svg> around its wrapper <g>. */
  const wrapperOf = (child: Element) => (child.classList.contains("react-flow__node") ? child : child.firstElementChild);
  const keyOf = (el: Element): string | null => {
    const id = el.getAttribute("data-id");
    if (id === null) return null;
    if (el.classList.contains("react-flow__node")) return nodeKey(id);
    if (el.classList.contains("react-flow__edge")) return cableKey(id);
    return null;
  };

  const unpaint = (el: Element) => {
    el.removeAttribute("data-appear");
    (el as HTMLElement).style.removeProperty("--sb-appear-delay");
    el.querySelector(".sb-pe-cable__wire")?.removeAttribute("pathLength");
  };

  /** Put an appearance on a mounted wrapper. A negative delay picks it up partway, after a remount. */
  const paint = (el: Element, key: string, a: Appearance) => {
    const t = now();
    if (t >= a.end) return;
    el.setAttribute("data-appear", a.mode);
    (el as HTMLElement).style.setProperty("--sb-appear-delay", `${Math.round(a.start - t)}ms`);
    if (a.mode === "draw") el.querySelector(".sb-pe-cable__wire")?.setAttribute("pathLength", "1");
    styled.set(el, key);
  };

  /** Paint appearances that begin now on wrappers already mounted (a first reveal, a rerouted cable). */
  const paintMounted = (keys: ReadonlySet<string>) => {
    if (keys.size === 0) return;
    for (const layer of layers()) {
      for (const child of layer.children) {
        const el = wrapperOf(child);
        const key = el && keyOf(el);
        const a = key && keys.has(key) ? shown.get(key) : undefined;
        if (el && key && a) paint(el, key, a);
      }
    }
  };

  function schedule(at: number) {
    if (timer !== null && timerAt <= at) return;
    if (timer !== null) clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(sweep, Math.max(0, at - now()) + SWEEP_SLACK_MS);
  }

  /** Drop finished appearances and their attributes, then wake again for the next one to finish. */
  function sweep() {
    timer = null;
    timerAt = Infinity;
    const t = now();
    for (const [key, a] of shown) if (a.end + SWEEP_SLACK_MS <= t) shown.delete(key);
    for (const [el, key] of styled) {
      if (shown.has(key)) continue;
      unpaint(el);
      styled.delete(el);
    }
    if (fadeUntil && fadeUntil + SWEEP_SLACK_MS <= t) {
      canvas?.removeAttribute("data-appear-fade");
      fadeUntil = 0;
    }
    let next = fadeUntil || Infinity;
    for (const a of shown.values()) next = Math.min(next, a.end);
    if (next < Infinity) schedule(next);
  }

  /** An end that's arriving: a node the person already saw where it is (placed) isn't. */
  const arriving = (nodeId: string, t: number) => {
    const a = shown.get(nodeKey(nodeId));
    return a && a.mode !== "placed" && a.end > t ? a : undefined;
  };

  /**
   * Plan cables' appearances. For the person's own change, `broughtByHand` holds the nodes it brings
   * (not those they placed), and only new cables that come with one of them draw in: a cable they
   * connected themselves is there already, even to a node still arriving from an earlier change.
   */
  const planCables = (entries: Iterable<[string, CableEntry]>, t: number, broughtByHand: ReadonlySet<string> | null, keys: Set<string>) => {
    for (const [id, c] of entries) {
      if (broughtByHand && !broughtByHand.has(c.source) && !broughtByHand.has(c.target)) continue;
      const ends = [arriving(c.source, t), arriving(c.target, t)] as const;
      const start = cableStart(ends[0], ends[1], t);
      const mode: AppearMode = c.invalid || reduced() || ends.some((a) => a?.mode === "fade") ? "fade" : "draw";
      shown.set(cableKey(id), { mode, start, end: start + durationOf(mode) });
      keys.add(cableKey(id));
    }
  };

  return {
    sync(nextNodes, nextEdges, change) {
      const t = now();
      const g = ++gen;
      const added: AppearPoint[] = [];
      const addedComments = new Set<string>();
      for (const n of nextNodes) {
        const entry = nodes.get(n.id);
        if (entry) {
          entry.x = n.position.x;
          entry.y = n.position.y;
          entry.gen = g;
          continue;
        }
        const comment = n.type === "comment";
        nodes.set(n.id, { x: n.position.x, y: n.position.y, comment, gen: g });
        if (waiting) continue;
        added.push({ id: n.id, x: n.position.x, y: n.position.y });
        if (comment) addedComments.add(n.id);
      }
      if (nodes.size > nextNodes.length) {
        for (const [id, entry] of nodes) {
          if (entry.gen === g) continue;
          nodes.delete(id);
          shown.delete(nodeKey(id));
        }
      }

      const addedCables: [string, CableEntry][] = [];
      for (const e of nextEdges) {
        const from = e.data?.from ?? e.source;
        const entry = cables.get(e.id);
        if (entry && entry.from === from) {
          entry.gen = g;
          entry.source = e.source;
          entry.target = e.target;
          entry.invalid = !!e.data?.invalid;
          continue;
        }
        const next: CableEntry = { from, to: e.data?.to ?? e.target, source: e.source, target: e.target, invalid: !!e.data?.invalid, gen: g };
        cables.set(e.id, next);
        if (!waiting) addedCables.push([e.id, next]);
      }
      if (cables.size > nextEdges.length) {
        for (const [id, entry] of cables) {
          if (entry.gen === g) continue;
          cables.delete(id);
          shown.delete(cableKey(id));
        }
      }
      if (waiting || (added.length === 0 && addedCables.length === 0)) return;
      const placed = hint && hint.until > t ? hint : null;
      hint = null;

      // The cable the person dragged into link search is there already; the node picked for its other end fades in without travel.
      const drawn = new Set<string>();
      const still = new Set<string>();
      if (placed?.ports.size) {
        for (const [id, c] of addedCables) {
          if (!placed.ports.has(c.from) && !placed.ports.has(c.to)) continue;
          drawn.add(id);
          still.add(c.source).add(c.target);
        }
      }

      const keys = new Set<string>();
      const arrivals = added.filter((p) => !placed?.nodes.has(p.id));
      const plain = reduced() || arrivals.length > LARGE_REVEAL;
      const delays = plain ? null : batchDelays(arrivals);
      for (const p of added) {
        let mode: AppearMode;
        if (placed?.nodes.has(p.id)) {
          if (reduced()) continue;
          mode = "placed";
        } else if (plain) mode = "fade";
        else if (addedComments.has(p.id)) mode = "comment";
        else if (still.has(p.id)) mode = "still";
        else mode = arrivals.length > RING_LIMIT ? "slide" : "node";
        const start = t + (delays?.get(p.id) ?? 0);
        shown.set(nodeKey(p.id), { mode, start, end: start + durationOf(mode) });
      }
      planCables(
        addedCables.filter(([id]) => !drawn.has(id)),
        t,
        change.byHand ? new Set(arrivals.map((p) => p.id)) : null,
        keys,
      );
      // New nodes and cables mount after this and get painted then; a rerouted cable keeps its wrapper.
      paintMounted(keys);
      sweep();
    },

    start(view, size) {
      if (!waiting) return;
      waiting = false;
      const t = now();
      const revealed: AppearPoint[] = [];
      const comments: string[] = [];
      for (const [id, n] of nodes) {
        if (view && !inView(n, size?.(id) ?? DEFAULT_SIZE, view)) continue;
        if (n.comment) comments.push(id);
        else revealed.push({ id, x: n.x, y: n.y });
      }
      if (revealed.length + comments.length === 0) return;
      if (reduced() || revealed.length > LARGE_REVEAL) {
        if (!canvas) return;
        fadeUntil = t + FADE_MS;
        canvas.setAttribute("data-appear-fade", "");
        sweep();
        return;
      }
      const keys = new Set<string>();
      for (const id of comments) {
        shown.set(nodeKey(id), { mode: "comment", start: t, end: t + COMMENT_MS });
        keys.add(nodeKey(id));
      }
      const lead = comments.length ? NODE_LEAD_MS : 0;
      const mode: AppearMode = revealed.length > RING_LIMIT ? "slide" : "node";
      for (const [id, delay] of waveDelays(revealed)) {
        const start = t + lead + delay;
        shown.set(nodeKey(id), { mode, start, end: start + durationOf(mode) });
        keys.add(nodeKey(id));
      }
      // A cable with neither end in view stays as it is: nobody sees it arrive.
      planCables(
        [...cables].filter(([, c]) => shown.has(nodeKey(c.source)) || shown.has(nodeKey(c.target))),
        t,
        null,
        keys,
      );
      paintMounted(keys);
      sweep();
    },

    reset() {
      // What's on the canvas stays known (the next graph may share it), and all of it reveals at the next start.
      waiting = true;
      shown.clear();
      hint = null;
      sweep();
    },

    placed(what) {
      hint = { nodes: new Set(what.nodes), ports: new Set(what.ports), until: now() + PLACED_MS };
    },

    observe(el) {
      canvas = el;
      const stop = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        timerAt = Infinity;
        for (const wrapper of styled.keys()) unpaint(wrapper);
        styled.clear();
        shown.clear();
        fadeUntil = 0;
        el.removeAttribute("data-appear-fade");
        if (canvas === el) canvas = null;
      };
      const targets = layers();
      if (typeof MutationObserver === "undefined" || targets.length === 0) return stop;
      const observer = new MutationObserver((records) => {
        if (shown.size === 0 && styled.size === 0) return;
        for (const record of records) {
          for (const node of record.removedNodes) {
            const wrapper = node instanceof Element ? wrapperOf(node) : null;
            if (wrapper) styled.delete(wrapper);
          }
          for (const node of record.addedNodes) {
            const wrapper = node instanceof Element ? wrapperOf(node) : null;
            const key = wrapper && keyOf(wrapper);
            const a = key ? shown.get(key) : undefined;
            if (wrapper && key && a) paint(wrapper, key, a);
          }
        }
      });
      for (const target of targets) observer.observe(target, { childList: true });
      return () => {
        observer.disconnect();
        stop();
      };
    },

    appearance(kind, id) {
      const a = shown.get(kind === "node" ? nodeKey(id) : cableKey(id));
      return a && a.end > now() ? a : undefined;
    },

    busyFor() {
      let end = fadeUntil;
      for (const a of shown.values()) end = Math.max(end, a.end);
      return Math.max(0, end - now());
    },

    waiting: () => waiting,
  };
}
