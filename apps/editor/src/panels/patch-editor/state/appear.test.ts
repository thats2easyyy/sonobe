// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCENT_MS,
  BATCH_MAX_MS,
  BATCH_STEP_MS,
  batchDelays,
  CABLE_LAG_MS,
  CABLE_MS,
  cableStart,
  COMMENT_MS,
  createAppearStore,
  FADE_MS,
  LARGE_REVEAL,
  NODE_LEAD_MS,
  NODE_MS,
  PLACED_MS,
  RING_LIMIT,
  WAVE_MS,
  WAVE_STEP_MS,
  waveDelays,
  type AppearEdgeInput,
  type AppearNodeInput,
  type AppearStore,
} from "./appear.ts";

const node = (id: string, x: number, y = 0, type = "patch"): AppearNodeInput => ({ id, type, position: { x, y } });
const cable = (source: string, target: string, from = `${source}.out`, invalid?: string): AppearEdgeInput => ({ id: `cable:${target}.in`, source, target, data: { from, to: `${target}.in`, ...(invalid ? { invalid } : {}) } });
const human = { byHand: true };
const claude = { byHand: false };

describe("waveDelays", () => {
  it("follows x left to right, spread over at most WAVE_MS", () => {
    const points = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, x: i * 200, y: 0 }));
    const delays = waveDelays(points);
    expect(delays.get("n0")).toBe(0);
    expect(delays.get("n11")).toBe(WAVE_MS);
    const ordered = points.map((p) => delays.get(p.id)!);
    expect([...ordered].sort((a, b) => a - b)).toEqual(ordered);
  });

  it("breaks ties by y, so a column cascades top to bottom", () => {
    const delays = waveDelays([
      { id: "top", x: 0, y: 0 },
      { id: "bottom", x: 0, y: 300 },
      { id: "right", x: 400, y: 0 },
    ]);
    expect(delays.get("top")).toBe(0);
    expect(delays.get("bottom")!).toBeGreaterThan(0);
    expect(delays.get("bottom")!).toBeLessThan(delays.get("right")!);
  });

  it("spreads a few nodes over WAVE_STEP_MS each, and one node starts at once", () => {
    expect(waveDelays([{ id: "a", x: 0, y: 0 }, { id: "b", x: 500, y: 0 }]).get("b")).toBe(WAVE_STEP_MS);
    expect(waveDelays([{ id: "a", x: 40, y: 90 }]).get("a")).toBe(0);
    expect(waveDelays([]).size).toBe(0);
  });
});

describe("batchDelays", () => {
  it("puts nodes BATCH_STEP_MS apart, left to right then top to bottom", () => {
    const delays = batchDelays([
      { id: "c", x: 300, y: 0 },
      { id: "b", x: 0, y: 50 },
      { id: "a", x: 0, y: 0 },
    ]);
    expect([...delays]).toEqual([
      ["a", 0],
      ["b", BATCH_STEP_MS],
      ["c", BATCH_STEP_MS * 2],
    ]);
  });

  it("fits a big batch within BATCH_MAX_MS", () => {
    const delays = batchDelays(Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, x: i, y: 0 })));
    expect(Math.max(...delays.values())).toBe(BATCH_MAX_MS);
  });
});

describe("cableStart", () => {
  it("leaves the output CABLE_LAG_MS into its node's appearance, and not before the input's node starts", () => {
    const early = { mode: "node" as const, start: 100, end: 700 };
    const late = { mode: "node" as const, start: 400, end: 1000 };
    expect(cableStart(early, { mode: "node", start: 140, end: 740 }, 50)).toBe(100 + CABLE_LAG_MS);
    // An input much later in the wave holds the cable until it starts.
    expect(cableStart(early, late, 50)).toBe(400);
    // A backward cable waits for its output.
    expect(cableStart(late, early, 50)).toBe(400 + CABLE_LAG_MS);
    // Only one end arriving (a new node wired to one already shown).
    expect(cableStart(undefined, early, 50)).toBe(100);
    expect(cableStart(early, undefined, 50)).toBe(100 + CABLE_LAG_MS);
    expect(cableStart(undefined, undefined, 50)).toBe(50);
    // An end that finished appearing doesn't hold the cable back.
    expect(cableStart({ mode: "node", start: 0, end: 40 }, undefined, 50)).toBe(50);
  });
});

describe("the appear store", () => {
  let clock = 0;
  let reduced = false;
  let store: AppearStore;
  const advance = (ms: number) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    clock = 1000;
    reduced = false;
    store = createAppearStore({ now: () => clock, reducedMotion: () => reduced });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("waits for the viewport, then fades frames in first, waves nodes by x and draws cables from their outputs", () => {
    store.sync([node("comment:c", -40, -40, "comment"), node("a", 0), node("b", 400), node("c", 800)], [cable("a", "b"), cable("b", "c")], human);
    expect(store.waiting()).toBe(true);
    expect(store.appearance("node", "a")).toBeUndefined();
    store.start();
    expect(store.waiting()).toBe(false);
    expect(store.appearance("node", "comment:c")).toMatchObject({ mode: "comment", start: 1000, end: 1000 + COMMENT_MS });
    const a = store.appearance("node", "a")!;
    const b = store.appearance("node", "b")!;
    const c = store.appearance("node", "c")!;
    expect(a).toMatchObject({ mode: "node", start: 1000 + NODE_LEAD_MS });
    expect(a.end - a.start).toBe(ACCENT_MS);
    expect(b.start).toBeGreaterThan(a.start);
    expect(c.start).toBeGreaterThan(b.start);
    // The person's changes before the reveal still draw: the reveal is nobody's edit.
    expect(store.appearance("cable", "cable:b.in")).toMatchObject({ mode: "draw", start: a.start + CABLE_LAG_MS, end: a.start + CABLE_LAG_MS + CABLE_MS });
    expect(store.appearance("cable", "cable:c.in")!.start).toBe(b.start + CABLE_LAG_MS);
  });

  it("reveals only the nodes in view, and cables with an end in view", () => {
    store.sync([node("in", 0), node("out", 5000)], [cable("in", "out"), cable("out", "far"), cable("far", "farther")], human);
    store.start({ x: -100, y: -100, width: 800, height: 600 });
    expect(store.appearance("node", "in")).toBeDefined();
    expect(store.appearance("node", "out")).toBeUndefined();
    expect(store.appearance("cable", "cable:out.in")).toBeDefined();
    expect(store.appearance("cable", "cable:far.in")).toBeUndefined();
    expect(store.appearance("cable", "cable:farther.in")).toBeUndefined();
  });

  it("fades a large reveal in with the viewport, without a wave", () => {
    const canvas = document.createElement("div");
    document.body.append(canvas);
    store.observe(canvas);
    store.sync(Array.from({ length: LARGE_REVEAL + 1 }, (_, i) => node(`n${i}`, i * 10)), [], human);
    store.start();
    expect(store.appearance("node", "n0")).toBeUndefined();
    expect(canvas.hasAttribute("data-appear-fade")).toBe(true);
    expect(store.busyFor()).toBe(FADE_MS);
    advance(FADE_MS + 200);
    expect(canvas.hasAttribute("data-appear-fade")).toBe(false);
    expect(store.busyFor()).toBe(0);
  });

  it("fades instead of moving or drawing with reduced motion", () => {
    const canvas = document.createElement("div");
    store.observe(canvas);
    reduced = true;
    store.sync([node("a", 0), node("b", 300)], [cable("a", "b")], human);
    store.start();
    expect(store.appearance("node", "a")).toBeUndefined();
    expect(canvas.hasAttribute("data-appear-fade")).toBe(true);
    store.sync([node("a", 0), node("b", 300), node("c", 600)], [cable("a", "b"), cable("b", "c")], claude);
    expect(store.appearance("node", "c")).toMatchObject({ mode: "fade", start: clock, end: clock + FADE_MS });
    expect(store.appearance("cable", "cable:c.in")!.mode).toBe("fade");
  });

  it("animates later additions at once, several in a short wave", () => {
    store.sync([node("a", 0)], [], human);
    store.start();
    advance(2000);
    store.sync([node("a", 0), node("x", 500, 0), node("y", 500, 100), node("z", 900)], [], human);
    expect(store.appearance("node", "a")).toBeUndefined();
    expect(store.appearance("node", "x")!.start).toBe(clock);
    expect(store.appearance("node", "y")!.start).toBe(clock + BATCH_STEP_MS);
    expect(store.appearance("node", "z")!.start).toBe(clock + BATCH_STEP_MS * 2);
  });

  it("shows the person's own cable between existing nodes as it is, and draws everyone else's", () => {
    store.sync([node("a", 0), node("b", 300), node("c", 600)], [], human);
    store.start();
    advance(2000);
    store.sync([node("a", 0), node("b", 300), node("c", 600)], [cable("a", "b")], human);
    expect(store.appearance("cable", "cable:b.in")).toBeUndefined();
    store.sync([node("a", 0), node("b", 300), node("c", 600)], [cable("a", "b"), cable("b", "c")], claude);
    expect(store.appearance("cable", "cable:c.in")).toMatchObject({ mode: "draw", start: clock });
    // A new node's cables draw even when the person added it: they come with the node.
    store.sync([node("a", 0), node("b", 300), node("c", 600), node("d", 900)], [cable("a", "b"), cable("b", "c"), cable("c", "d")], human);
    expect(store.appearance("cable", "cable:d.in")!.start).toBe(store.appearance("node", "d")!.start);
    store.sync([node("a", 0), node("b", 300), node("c", 600), node("d", 900), node("s", -300)], [cable("a", "b"), cable("b", "c"), cable("c", "d"), cable("s", "a")], human);
    expect(store.appearance("cable", "cable:a.in")!.start).toBe(store.appearance("node", "s")!.start + CABLE_LAG_MS);
    // Invalid cables fade.
    store.sync([node("a", 0), node("b", 300), node("c", 600), node("d", 900), node("e", 1200)], [cable("a", "b"), cable("b", "c"), cable("c", "d"), cable("d", "e", "d.out", "These types don't connect.")], claude);
    expect(store.appearance("cable", "cable:e.in")!.mode).toBe("fade");
  });

  it("shows a cable the person connects to a node still arriving as it is, since they drew it", () => {
    store.sync([node("a", 0)], [], human);
    store.start();
    advance(2000);
    store.sync([node("a", 0), node("b", 300)], [], claude);
    expect(store.appearance("node", "b")).toBeDefined();
    advance(100);
    store.sync([node("a", 0), node("b", 300)], [cable("a", "b")], human);
    expect(store.appearance("cable", "cable:b.in")).toBeUndefined();
    // Claude's cable to the same node still waits for it and draws.
    store.sync([node("a", 0), node("b", 300), node("c", 600)], [cable("a", "b"), cable("b", "c", "b.out")], claude);
    expect(store.appearance("cable", "cable:c.in")).toMatchObject({ mode: "draw" });
  });

  it("keeps an option-drag copy's cable while its source is still in the first reveal", () => {
    store.sync([node("a", 0), node("b", 300)], [cable("a", "b")], human);
    store.start();
    advance(60);
    expect(store.appearance("node", "a")).toBeDefined();
    store.placed({ nodes: ["b2"] });
    store.sync([node("a", 0), node("b", 300), node("b2", 300, 200)], [cable("a", "b"), cable("a", "b2")], human);
    expect(store.appearance("node", "b2")).toMatchObject({ mode: "placed" });
    expect(store.appearance("cable", "cable:b2.in")).toBeUndefined();
  });

  it("travels without the ring in a wave of more than RING_LIMIT nodes", () => {
    store.sync(Array.from({ length: RING_LIMIT + 1 }, (_, i) => node(`n${i}`, i * 10)), [], human);
    store.start();
    expect(store.appearance("node", "n0")).toMatchObject({ mode: "slide" });
    expect(store.appearance("node", "n0")!.end - store.appearance("node", "n0")!.start).toBe(NODE_MS);
    advance(2000);
    const batch = Array.from({ length: RING_LIMIT + 1 }, (_, i) => node(`m${i}`, i * 10, 900));
    store.sync([...Array.from({ length: RING_LIMIT + 1 }, (_, i) => node(`n${i}`, i * 10)), ...batch], [], claude);
    expect(store.appearance("node", "m0")).toMatchObject({ mode: "slide" });
  });

  it("only glows the ring on nodes the person placed, and shows their cables as they are", () => {
    store.sync([node("a", 0), node("b", 300)], [cable("a", "b")], human);
    store.start();
    advance(2000);
    // Option-drag: the copy b2 lands where the person dropped b, with b's input cable.
    store.placed({ nodes: ["b2"] });
    store.sync([node("a", 0), node("b", 300), node("b2", 300, 200)], [cable("a", "b"), cable("a", "b2")], human);
    expect(store.appearance("node", "b2")).toMatchObject({ mode: "placed", start: clock, end: clock + ACCENT_MS });
    expect(store.appearance("cable", "cable:b2.in")).toBeUndefined();
    // The hint is used up: the next copy (⌘D) arrives as usual.
    store.sync([node("a", 0), node("b", 300), node("b2", 300, 200), node("b3", 340, 240)], [cable("a", "b"), cable("a", "b2"), cable("a", "b3")], human);
    expect(store.appearance("node", "b3")).toMatchObject({ mode: "node" });
    expect(store.appearance("cable", "cable:b3.in")).toMatchObject({ mode: "draw" });
  });

  it("keeps the cable the person dragged into link search, and fades the picked node in without travel", () => {
    store.sync([node("a", 0), node("c", 800)], [], human);
    store.start();
    advance(2000);
    store.placed({ ports: ["a.out"] });
    // The picked node b arrives at the cable's end; any other cable it brings still draws.
    store.sync([node("a", 0), node("b", 400), node("c", 800)], [cable("a", "b"), cable("b", "c")], human);
    expect(store.appearance("cable", "cable:b.in")).toBeUndefined();
    expect(store.appearance("node", "b")).toMatchObject({ mode: "still" });
    expect(store.appearance("cable", "cable:c.in")).toMatchObject({ mode: "draw" });
    // An input the person dragged from works the same way.
    store.placed({ ports: ["d.in"] });
    store.sync([node("a", 0), node("b", 400), node("c", 800), node("z", -300), node("d", 1200)], [cable("a", "b"), cable("b", "c"), cable("z", "d")], human);
    expect(store.appearance("cable", "cable:d.in")).toBeUndefined();
    expect(store.appearance("node", "z")).toMatchObject({ mode: "still" });
  });

  it("forgets a placed hint no change used within PLACED_MS, and skips the ring with reduced motion", () => {
    store.sync([node("a", 0)], [], human);
    store.start();
    advance(2000);
    store.placed({ nodes: ["b"] });
    advance(PLACED_MS + 1);
    store.sync([node("a", 0), node("b", 300)], [], human);
    expect(store.appearance("node", "b")).toMatchObject({ mode: "node" });
    reduced = true;
    store.placed({ nodes: ["c"] });
    store.sync([node("a", 0), node("b", 300), node("c", 600)], [], human);
    expect(store.appearance("node", "c")).toBeUndefined();
  });

  it("treats a cable into the same input from another output as new", () => {
    const nodes = [node("a", 0), node("b", 300), node("c", 600)];
    store.sync(nodes, [cable("a", "c")], human);
    store.start();
    advance(2000);
    store.sync(nodes, [cable("b", "c")], claude);
    expect(store.appearance("cable", "cable:c.in")).toMatchObject({ mode: "draw" });
  });

  it("plays each appearance once, and again for a node that left and came back", () => {
    store.sync([node("a", 0), node("b", 300)], [cable("a", "b")], human);
    store.start();
    advance(2000);
    expect(store.busyFor()).toBe(0);
    // Moving, renaming or re-measuring doesn't make a node new.
    store.sync([node("a", 40, 40), node("b", 300)], [cable("a", "b")], human);
    expect(store.appearance("node", "a")).toBeUndefined();
    // Undo removes it, redo brings it back: it animates in again.
    store.sync([node("b", 300)], [], human);
    store.sync([node("a", 40, 40), node("b", 300)], [cable("a", "b")], claude);
    expect(store.appearance("node", "a")).toBeDefined();
    expect(store.appearance("cable", "cable:b.in")).toBeDefined();
  });

  it("reveals the whole graph again after a reset, nodes it already showed too", () => {
    store.sync([node("a", 0)], [], human);
    store.start();
    advance(2000);
    store.reset();
    expect(store.waiting()).toBe(true);
    store.sync([node("a", 0), node("b", 300)], [], human);
    expect(store.appearance("node", "b")).toBeUndefined();
    store.start();
    expect(store.appearance("node", "a")).toBeDefined();
    expect(store.appearance("node", "b")).toBeDefined();
  });

  describe("on React Flow's wrappers", () => {
    function mountCanvas() {
      const canvas = document.createElement("div");
      canvas.innerHTML = `<div class="react-flow__edges"></div><div class="react-flow__nodes"></div>`;
      document.body.append(canvas);
      return { canvas, nodes: canvas.querySelector(".react-flow__nodes")!, edges: canvas.querySelector(".react-flow__edges")! };
    }
    const nodeEl = (id: string) => {
      const el = document.createElement("div");
      el.className = "react-flow__node";
      el.dataset.id = id;
      return el;
    };
    const edgeEl = (id: string) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.innerHTML = `<g class="react-flow__edge" data-id="${id}"><g class="sb-pe-cable"><path class="sb-pe-cable__wire" d="M 0 0 L 10 0"></path></g></g>`;
      return svg;
    };
    const flush = () => new Promise((resolve) => queueMicrotask(() => resolve(undefined)));

    it("paints wrappers already mounted when the reveal starts, and clears them when it's over", () => {
      const { canvas, nodes, edges } = mountCanvas();
      const a = nodeEl("a");
      nodes.append(a);
      edges.append(edgeEl("cable:b.in"));
      store.observe(canvas);
      store.sync([node("a", 0), node("b", 300)], [cable("a", "b")], human);
      store.start();
      expect(a.getAttribute("data-appear")).toBe("node");
      expect(a.style.getPropertyValue("--sb-appear-delay")).toBe("0ms");
      const wrapper = edges.querySelector(".react-flow__edge")!;
      expect(wrapper.getAttribute("data-appear")).toBe("draw");
      expect(wrapper.querySelector(".sb-pe-cable__wire")!.getAttribute("pathLength")).toBe("1");
      advance(3000);
      expect(a.hasAttribute("data-appear")).toBe(false);
      expect(a.style.getPropertyValue("--sb-appear-delay")).toBe("");
      expect(wrapper.hasAttribute("data-appear")).toBe(false);
      expect(wrapper.querySelector(".sb-pe-cable__wire")!.hasAttribute("pathLength")).toBe(false);
    });

    it("stops with the editor: no timer left, and nothing painted or appearing", () => {
      const { canvas, nodes } = mountCanvas();
      const a = nodeEl("a");
      nodes.append(a);
      const stop = store.observe(canvas);
      store.sync([node("a", 0), node("b", 300)], [cable("a", "b")], human);
      store.start();
      expect(a.getAttribute("data-appear")).toBe("node");
      expect(vi.getTimerCount()).toBe(1);
      stop();
      expect(vi.getTimerCount()).toBe(0);
      expect(a.hasAttribute("data-appear")).toBe(false);
      expect(store.busyFor()).toBe(0);
      expect(store.appearance("cable", "cable:b.in")).toBeUndefined();
    });

    it("paints a wrapper mounted partway through with what's left, and nothing once it's over", async () => {
      const { canvas, nodes } = mountCanvas();
      store.observe(canvas);
      store.sync([node("a", 0), node("b", 300)], [], human);
      store.start();
      const b = store.appearance("node", "b")!;
      advance(b.start - clock + 100);
      const early = nodeEl("b");
      nodes.append(early);
      await flush();
      expect(early.getAttribute("data-appear")).toBe("node");
      expect(early.style.getPropertyValue("--sb-appear-delay")).toBe("-100ms");
      // Culled and mounted again after the animation (panning back): no replay.
      early.remove();
      advance(2000);
      const again = nodeEl("b");
      nodes.append(again);
      await flush();
      expect(again.hasAttribute("data-appear")).toBe(false);
    });
  });
});
