// @vitest-environment happy-dom
import { planTidy, type TidyFrame, type TidyNode, type TidyRequest } from "@sonobe/core/graph";
import { describe, expect, it } from "vitest";
import { rectContains, rectsOverlap } from "./geometry.ts";
import { elkGroupLayout } from "./tidy.ts";

const node = (id: string, x: number, y: number, rows = 2): TidyNode => ({
  id,
  x,
  y,
  width: 170,
  height: 28 + 2 + rows * 22 + 6,
  ports: [
    { id: "in:a", side: "in", y: 41 },
    { id: "in:b", side: "in", y: 63 },
    { id: "out:out", side: "out", y: 41 },
  ],
});

const link = (source: string, target: string, input = "in:a") => ({ source, sourceHandle: "out:out", target, targetHandle: input });

async function tidy(request: TidyRequest) {
  const plan = await planTidy(request, await elkGroupLayout());
  const nodes = request.nodes.map((n) => ({ ...n, ...(plan.nodes.get(n.id) ?? {}) }));
  const frames = (request.frames ?? []).map((f) => ({ ...f, ...(plan.frames.get(f.id) ?? {}) }));
  return { plan, nodes, frames, at: (id: string) => nodes.find((n) => n.id === id)!, frame: (id: string) => frames.find((f) => f.id === id)! };
}

function expectNoOverlaps(rects: readonly (TidyNode | TidyFrame)[]) {
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(rectsOverlap(rects[i]!, rects[j]!), `${rects[i]!.id} vs ${rects[j]!.id}`).toBe(false);
}

describe("Tidy Up with ELK", () => {
  it("lays a chain out left to right without overlaps, anchored where it was", async () => {
    const r = await tidy({ nodes: [node("c", 40, 400), node("a", 300, 120), node("b", 100, 250), node("d", 500, 90)], edges: [link("a", "b"), link("b", "c"), link("a", "d", "in:b")] });
    expect(r.at("a").x).toBeLessThan(r.at("b").x);
    expect(r.at("b").x).toBeLessThan(r.at("c").x);
    expect(r.at("a").x).toBeLessThan(r.at("d").x);
    expectNoOverlaps(r.nodes);
    expect(Math.min(...r.nodes.map((n) => n.x))).toBe(40);
    expect(Math.min(...r.nodes.map((n) => n.y))).toBe(90);
    for (const n of r.nodes) expect(Number.isInteger(n.x) && Number.isInteger(n.y)).toBe(true);
  });

  it("lines up a single-input chain on one row", async () => {
    const r = await tidy({ nodes: [node("a", 0, 0), node("b", 0, 300), node("c", 0, 600)], edges: [link("a", "b"), link("b", "c")] });
    const ys = ["a", "b", "c"].map((id) => r.at(id).y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(2);
  });

  it("tidies inside each frame, refits it, and keeps the frames where they are", async () => {
    const nodes = [node("a", 0, 0), node("b", 300, 10), node("x", 0, 400), node("y", 300, 380)];
    const frames = [
      { id: "top", x: -20, y: -40, width: 520, height: 160 },
      { id: "bottom", x: -20, y: 360, width: 520, height: 160 },
    ];
    const r = await tidy({ nodes, edges: [link("a", "b"), link("x", "y")], frames });
    for (const [frame, ids] of [["top", ["a", "b"]], ["bottom", ["x", "y"]]] as const) {
      for (const id of ids) expect(rectContains(r.frame(frame), r.at(id)), `${id} in ${frame}`).toBe(true);
      expect(r.frame(frame).x).toBe(-20);
    }
    expect(r.frame("top").y).toBe(-40);
    expectNoOverlaps(r.nodes);
    expectNoOverlaps(r.frames);
  });

  it("keeps a selection inside its frame and grows the frame instead of leaving it", async () => {
    const nodes = [node("names", 460, 520), node("count", 460, 680), node("last", 460, 780), node("scroll", 840, 520)];
    const frames = [
      { id: "places", x: 440, y: 480, width: 330, height: 520 },
      { id: "chips", x: 820, y: 480, width: 400, height: 300 },
    ];
    const r = await tidy({ nodes, edges: [link("names", "count"), link("count", "last")], frames, scope: { kind: "nodes", ids: ["names", "count", "last"] } });
    for (const id of ["names", "count", "last"]) expect(rectContains(r.frame("places"), r.at(id)), id).toBe(true);
    expect(rectsOverlap(r.frame("places"), r.frame("chips"))).toBe(false);
    expect(rectContains(r.frame("chips"), r.at("scroll"))).toBe(true);
  });

  it("changes nothing the second time", async () => {
    const nodes = [node("a", 0, 0), node("b", 300, 10), node("loose", 900, 300)];
    const frames = [{ id: "top", x: -20, y: -40, width: 520, height: 160 }];
    const first = await tidy({ nodes, edges: [link("a", "b"), link("b", "loose")], frames });
    const second = await tidy({ nodes: first.nodes, edges: [link("a", "b"), link("b", "loose")], frames: first.frames });
    expect(second.plan.nodes.size).toBe(0);
    expect(second.plan.frames.size).toBe(0);
  });

  it("returns nothing for an empty graph", async () => {
    const r = await tidy({ nodes: [], edges: [] });
    expect(r.plan.nodes.size).toBe(0);
  });
});
