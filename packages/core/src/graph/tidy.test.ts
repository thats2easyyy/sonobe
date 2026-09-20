import { describe, expect, it } from "vitest";
import { emptyDoc, mockRegistry, mustApply } from "../testing/fixtures.ts";
import type { Op, SonobeDocument } from "../types.ts";
import { deriveGraph } from "./deriveGraph.ts";
import { homeFrame } from "./frames.ts";
import { rectContains, rectsOverlap, type Rect } from "./geometry.ts";
import { readNodePositions } from "./graphNodes.ts";
import { componentNodeBoxes } from "./placement.ts";
import { createElkGroupLayout, planTidy, tidyPlanOps, type ElkGraphNode, type ElkLike, type GroupLayout, type TidyFrame, type TidyNode, type TidyRequest } from "./tidy.ts";

/** A stand-in for ELK: one column in the order given (reading order), so the frame rules are what's tested. */
const column: GroupLayout = async (nodes, _edges, options) => {
  const out = new Map<string, { x: number; y: number }>();
  let y = 0;
  for (const n of nodes) {
    out.set(n.id, { x: 0, y });
    y += n.height + options.rowGap;
  }
  return out;
};

const box = (id: string, x: number, y: number, width = 180, height = 80): TidyNode => ({ id, x, y, width, height });
const frame = (id: string, x: number, y: number, width: number, height: number): TidyFrame => ({ id, x, y, width, height });

async function run(request: TidyRequest) {
  const plan = await planTidy(request, column);
  const nodes = request.nodes.map((n) => ({ ...n, ...(plan.nodes.get(n.id) ?? {}) }));
  const frames = (request.frames ?? []).map((f) => ({ ...f, ...(plan.frames.get(f.id) ?? {}) }));
  return { plan, nodes, frames, frame: (id: string) => frames.find((f) => f.id === id)!, node: (id: string) => nodes.find((n) => n.id === id)! };
}

function overlaps(rects: readonly (Rect & { id: string })[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (rectsOverlap(rects[i]!, rects[j]!)) out.push(`${rects[i]!.id}×${rects[j]!.id}`);
  return out;
}

/** The sectioned graph from the retro: knobs, the deck, places and category chips, and one loose patch. */
const sectioned = (): TidyRequest => ({
  nodes: [
    box("k_resp", 20, 40, 250),
    box("k_damp", 20, 130, 250),
    box("k_fly", 20, 220, 250),
    box("k_tilt", 20, 310, 250),
    box("drag", 460, 40),
    box("feel", 700, 40),
    box("fly", 700, 220),
    box("tilt", 940, 220),
    box("spring", 1180, 40),
    box("names", 460, 520, 290, 124),
    box("count", 460, 680),
    box("last", 460, 780),
    box("scroll", 840, 520),
    box("loose", 1700, 600),
  ],
  edges: [
    { source: "k_resp", target: "feel" },
    { source: "k_fly", target: "fly" },
    { source: "fly", target: "spring" },
    { source: "names", target: "count" },
    { source: "count", target: "last" },
    { source: "spring", target: "loose" },
  ],
  frames: [frame("knobs", 0, 0, 380, 420), frame("deck", 440, 0, 1100, 420), frame("places", 440, 480, 330, 520), frame("chips", 820, 480, 400, 300)],
});

describe("planTidy", () => {
  it("tidies inside every frame, refits the frames, and keeps the sections apart", async () => {
    const request = sectioned();
    const r = await run(request);
    expect(overlaps(r.nodes)).toEqual([]);
    expect(overlaps(r.frames)).toEqual([]);
    for (const n of request.nodes) {
      const home = homeFrame(n, request.frames!);
      const moved = r.node(n.id);
      if (home) expect(rectContains(r.frame(home.id), moved), `${n.id} stays in ${home.id}`).toBe(true);
      else for (const f of r.frames) expect(rectsOverlap(f, moved), `${n.id} is clear of ${f.id}`).toBe(false);
    }
    // Frames keep their top-left unless something pushed them, and a frame pushed by one above it stays below it.
    expect(r.frame("knobs")).toMatchObject({ x: 0, y: 0 });
    expect(r.frame("deck")).toMatchObject({ x: 440, y: 0 });
    expect(r.frame("places").y).toBe(r.frame("deck").y + r.frame("deck").height + 40);
    expect(r.plan.pushed).toContainEqual(expect.objectContaining({ id: "places", by: "deck", dx: 0 }));
    // The knobs column keeps its order.
    const knobs = ["k_resp", "k_damp", "k_fly", "k_tilt"].map((id) => r.node(id).y);
    expect([...knobs].sort((a, b) => a - b)).toEqual(knobs);
  });

  it("changes nothing the second time", async () => {
    const first = await run(sectioned());
    const second = await run({ ...sectioned(), nodes: first.nodes, frames: first.frames });
    expect(second.plan.nodes.size).toBe(0);
    expect(second.plan.frames.size).toBe(0);
  });

  it("changes nothing the second time when the layout's result depends on the order it's given", async () => {
    // ELK keeps the order it's given. Were that where the last tidy left the nodes, each tidy could flip it: a column in reverse order.
    const flipping: GroupLayout = (nodes, edges, options) => column([...nodes].reverse(), edges, options);
    const request: TidyRequest = { nodes: [box("a", 0, 0), box("b", 0, 300), box("c", 400, 100)], edges: [], frames: [frame("f", 600, 0, 300, 400)] };
    request.nodes = [...request.nodes, box("x", 620, 60), box("y", 620, 200)];
    const tidied = async (r: TidyRequest) => {
      const plan = await planTidy(r, flipping);
      return { plan, next: { ...r, nodes: r.nodes.map((n) => ({ ...n, ...(plan.nodes.get(n.id) ?? {}) })), frames: (r.frames ?? []).map((f) => ({ ...f, ...(plan.frames.get(f.id) ?? {}) })) } };
    };
    const first = await tidied(request);
    expect(first.plan.nodes.size).toBeGreaterThan(0);
    for (let pass = 2; pass <= 3; pass++) {
      const again = await tidied(first.next);
      expect([...again.plan.nodes.keys()], `pass ${pass}`).toEqual([]);
      expect([...again.plan.frames.keys()], `pass ${pass}`).toEqual([]);
    }
  });

  it("keeps a selection inside its frame, growing the frame and pushing the next one clear", async () => {
    const r = await run({ ...sectioned(), scope: { kind: "nodes", ids: ["names", "count", "last", "scroll"] } });
    for (const id of ["names", "count", "last"]) expect(rectContains(r.frame("places"), r.node(id)), id).toBe(true);
    expect(rectContains(r.frame("chips"), r.node("scroll"))).toBe(true);
    expect(overlaps(r.frames)).toEqual([]);
    // Nodes outside the selection's frames don't move.
    for (const id of ["k_resp", "drag", "spring"]) expect(r.plan.nodes.has(id), id).toBe(false);
  });

  it("tidies only the named frames, refitting them and pushing neighbours clear", async () => {
    const request = sectioned();
    request.nodes = request.nodes.map((n) => (n.id === "scroll" ? { ...n, height: 400 } : n));
    const r = await run({ ...request, scope: { kind: "frames", ids: ["chips"] } });
    expect(r.frame("chips").height).toBe(44 + 400 + 20);
    expect(r.plan.frames.has("knobs")).toBe(false);
    for (const id of ["k_resp", "names", "drag"]) expect(r.plan.nodes.has(id), id).toBe(false);
    expect(overlaps(r.frames)).toEqual([]);
    expect(r.plan.pushed).toEqual([]);
    // A frame below the one that grew moves down, along with what's in it.
    const below = await run({ ...request, frames: [...request.frames!, frame("below", 820, 820, 300, 140)], nodes: [...request.nodes, box("inside", 840, 860)], scope: { kind: "frames", ids: ["chips"] } });
    expect(overlaps(below.frames)).toEqual([]);
    expect(below.plan.pushed).toEqual([{ id: "below", by: "chips", dx: 0, dy: 480 + 464 + 40 - 820 }]);
    expect(below.node("inside").y).toBe(860 + 480 + 464 + 40 - 820);
  });

  it("arranges frames as blocks with frameMode arrange", async () => {
    const r = await run({ ...sectioned(), frameMode: "arrange" });
    expect(overlaps(r.nodes)).toEqual([]);
    expect(overlaps(r.frames)).toEqual([]);
    for (const n of sectioned().nodes) {
      const home = homeFrame(n, sectioned().frames!);
      if (home) expect(rectContains(r.frame(home.id), r.node(n.id)), n.id).toBe(true);
    }
    // The column layout stacks the blocks: the frames moved.
    expect(r.plan.frames.size).toBeGreaterThan(0);
  });

  it("keeps nested frames inside their parent", async () => {
    const r = await run({
      nodes: [box("a", 40, 60), box("b", 40, 400), box("c", 600, 60)],
      edges: [],
      frames: [frame("outer", 0, 0, 900, 700), frame("inner", 20, 340, 400, 200)],
    });
    expect(rectContains(r.frame("inner"), r.node("b"))).toBe(true);
    expect(rectContains(r.frame("outer"), r.frame("inner"))).toBe(true);
    for (const id of ["a", "c"]) expect(rectContains(r.frame("outer"), r.node(id)), id).toBe(true);
    expect(overlaps([...r.nodes, r.frame("inner")].filter((x) => x.id !== "b"))).toEqual([]);
  });

  it("changes nothing the second time when a nested frame reaches past its parent's padding", async () => {
    // The inner frame sits at the outer one's left edge, so the refit outer frame reaches 20 pt further left than its padding.
    const request: TidyRequest = { nodes: [box("a", 40, 60), box("b", 40, 400), box("c", 600, 60)], edges: [], frames: [frame("outer", 0, 0, 900, 700), frame("inner", 0, 340, 400, 200)] };
    const first = await run(request);
    expect(first.frame("outer").x).toBe(-20);
    expect(first.node("a").x).toBe(first.frame("inner").x);
    const second = await run({ ...request, nodes: first.nodes, frames: first.frames });
    expect([...second.plan.nodes.keys(), ...second.plan.frames.keys()]).toEqual([]);
  });

  it("changes nothing the second time when the layout never leaves the order it was given", async () => {
    // Each layout moves the first node to the bottom, so the reading order goes through all twelve rotations.
    const rotating: GroupLayout = (nodes, edges, options) => column([...nodes.slice(1), nodes[0]!], edges, options);
    let r: TidyRequest = { nodes: Array.from({ length: 12 }, (_, i) => box(`n${String(i).padStart(2, "0")}`, (i * 7) % 5, i * 200)), edges: [] };
    const plans = [];
    for (let pass = 0; pass < 3; pass++) {
      const plan = await planTidy(r, rotating);
      plans.push(plan.nodes.size);
      r = { ...r, nodes: r.nodes.map((n) => ({ ...n, ...(plan.nodes.get(n.id) ?? {}) })) };
    }
    expect(plans[0]).toBeGreaterThan(0);
    expect(plans.slice(1)).toEqual([0, 0]);
  });
});

describe("createElkGroupLayout", () => {
  it("fixes ports at their rows, gives a layer node's inputs its rows in id order, and sorts the cables", async () => {
    let graph: ElkGraphNode | undefined;
    const elk: ElkLike = { layout: async (g) => ((graph = g), { ...g, children: g.children?.map((c) => ({ ...c, x: 0, y: 0 })) }) };
    const ports = (...ids: string[]) => ids.map((id, i) => ({ id, side: id.startsWith("in:") ? ("in" as const) : ("out" as const), y: 41 + 22 * i }));
    // The editor lists @card's driven properties in the order of their drivers (scale's is higher), which this tidy is about to change.
    const nodes = [{ ...box("t", 0, 0), ports: ports("in:progress", "in:end", "out:output") }, { ...box("@card", 300, 0), ports: ports("in:scale", "in:opacity", "out:position") }];
    const edges = [
      { source: "t", sourceHandle: "out:output", target: "@card", targetHandle: "in:scale" },
      { source: "t", sourceHandle: "out:output", target: "@card", targetHandle: "in:opacity" },
      { source: "@card", sourceHandle: "out:position", target: "t", targetHandle: "in:progress" },
    ];
    await createElkGroupLayout(elk)(nodes, edges, { direction: "LR", columnGap: 72, rowGap: 28 });
    expect(graph!.children!.map((c) => [c.id, c.ports!.map((p) => `${p.id}@${p.y}`)])).toEqual([
      ["t", ["t::in:progress@41", "t::in:end@63", "t::out:output@85"]],
      ["@card", ["@card::in:opacity@41", "@card::in:scale@63", "@card::out:position@85"]],
    ]);
    // Cables in id order, not the document's.
    expect(graph!.edges).toEqual([
      { id: "e0", sources: ["t::out:output"], targets: ["@card::in:opacity"] },
      { id: "e1", sources: ["t::out:output"], targets: ["@card::in:scale"] },
      { id: "e2", sources: ["@card::out:position"], targets: ["t::in:progress"] },
    ]);
  });
});

describe("tidyPlanOps", () => {
  const build = (ops: Op[]): SonobeDocument => mustApply(emptyDoc(), ops).doc;

  it("moves patches, refits comments, saves layer node positions, and is idempotent", async () => {
    const doc = build([
      { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
      { op: "addPatch", patch: { id: "pop", type: "popAnimation", ui: { x: 30, y: 60 } } },
      { op: "addPatch", patch: { id: "grow", type: "transition", ui: { x: 30, y: 400 }, inputs: { progress: { link: "pop.output" } } } },
      { op: "connect", from: "grow.output", to: "@card.scale" },
      { op: "addComment", comment: { id: "section", text: "Grow", rect: [0, 0, 300, 200] } },
    ]);
    const request = (d: SonobeDocument): TidyRequest => {
      const c = d.components.main!;
      return {
        nodes: [...componentNodeBoxes(d, mockRegistry, "main")].map(([id, r]) => ({ id, ...r })),
        edges: [{ source: "pop", target: "grow" }, { source: "grow", target: "@card" }],
        frames: c.comments.map((m) => ({ id: m.id, x: m.rect[0], y: m.rect[1], width: m.rect[2], height: m.rect[3] })),
      };
    };
    const ops = tidyPlanOps(doc.components.main!, await planTidy(request(doc), column));
    // pop moves to the frame's top-left; grow leads the unframed group, which stays anchored; the layer node is saved.
    expect(ops).toContainEqual({ op: "updatePatch", component: "main", id: "pop", ui: { x: 20, y: 44 } });
    expect(ops.some((op) => op.op === "updatePatch" && op.id === "grow")).toBe(false);
    // The frame hugs pop with 20 of padding each side.
    const popWidth = componentNodeBoxes(doc, mockRegistry, "main").get("pop")!.width;
    expect(ops).toContainEqual({ op: "updateComment", component: "main", id: "section", rect: [0, 0, popWidth + 40, 44 + 102 + 20] });
    expect(ops).toContainEqual({ op: "setNodePositions", component: "main", positions: { "@card": [30, 400 + 102 + 28] } });
    const tidied = mustApply(doc, ops).doc;
    expect(tidyPlanOps(tidied.components.main!, await planTidy(request(tidied), column))).toEqual([]);
  });

  /** Tidies main twice through the document, the way tidy_graph does: boxes and cables from deriveGraph each time. */
  async function tidyTwice(setup: Op[], component = "main") {
    const request = (d: SonobeDocument): TidyRequest => {
      const graph = deriveGraph({ doc: d, componentId: component, registry: mockRegistry });
      return { nodes: [...componentNodeBoxes(d, mockRegistry, component)].map(([id, r]) => ({ id, ...r })), edges: graph.edges.map((e) => ({ source: e.source, target: e.target })) };
    };
    const doc = build(setup);
    const first = tidyPlanOps(doc.components[component]!, await planTidy(request(doc), column));
    const tidied = mustApply(doc, first).doc;
    const second = tidyPlanOps(tidied.components[component]!, await planTidy(request(tidied), column));
    return { first, second, tidied };
  }

  it("saves a read-only layer node that leads the layout, so the next tidy doesn't move its reader again", async () => {
    // The layer node is placed left of its reader and anchors the group: the tidy leaves it where it is and moves the reader.
    const { first, second, tidied } = await tidyTwice([
      { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } },
      { op: "addPatch", patch: { id: "t", type: "transition", ui: { x: 400, y: 100 }, inputs: { progress: { link: "@card.opacity" } } } },
    ]);
    expect(first.some((op) => op.op === "updatePatch" && op.id === "t")).toBe(true);
    expect(readNodePositions(tidied.components.main)["@card"]).toBeDefined();
    expect(second).toEqual([]);
  });

  it("saves the component inputs node that leads the layout", async () => {
    const { second, tidied } = await tidyTwice(
      [
        { op: "addComponent", ref: "fader", component: { name: "Fader", kind: "patchComponent" } },
        { op: "updateInterface", component: "$fader", inputs: { amount: { type: "number", default: 0 } } },
        { op: "addPatch", component: "$fader", patch: { id: "t", type: "transition", ui: { x: 400, y: 100 }, inputs: { progress: { link: "$in.amount" } } } },
      ],
      "fader",
    );
    expect(readNodePositions(tidied.components.fader)["$in"]).toBeDefined();
    expect(second).toEqual([]);
  });
});
