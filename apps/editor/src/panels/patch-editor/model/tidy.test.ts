// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { rectsOverlap } from "./geometry.ts";
import { tidyLayout, type TidyNodeInput } from "./tidy.ts";

const node = (id: string, x: number, y: number, rows = 2): TidyNodeInput => ({
  id,
  x,
  y,
  width: 170,
  height: 28 + rows * 22 + 6,
  ports: [
    { id: "in:a", side: "in", y: 39 },
    { id: "in:b", side: "in", y: 61 },
    { id: "out:out", side: "out", y: 39 },
  ],
});

describe("tidyLayout", () => {
  it("lays a chain out left to right without overlaps, anchored where it was", async () => {
    const nodes = [node("c", 40, 400), node("a", 300, 120), node("b", 100, 250), node("d", 500, 90)];
    const edges = [
      { source: "a", sourceHandle: "out:out", target: "b", targetHandle: "in:a" },
      { source: "b", sourceHandle: "out:out", target: "c", targetHandle: "in:a" },
      { source: "a", sourceHandle: "out:out", target: "d", targetHandle: "in:b" },
    ];
    const result = await tidyLayout({ nodes, edges });
    expect(result.nodes.size).toBe(4);
    const pos = (id: string) => result.nodes.get(id)!;
    expect(pos("a").x).toBeLessThan(pos("b").x);
    expect(pos("b").x).toBeLessThan(pos("c").x);
    expect(pos("a").x).toBeLessThan(pos("d").x);
    const rects = nodes.map((n) => ({ ...n, ...pos(n.id) }));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(rectsOverlap(rects[i]!, rects[j]!), `${rects[i]!.id} vs ${rects[j]!.id}`).toBe(false);
    expect(Math.min(...rects.map((r) => r.x))).toBe(40);
    expect(Math.min(...rects.map((r) => r.y))).toBe(90);
    for (const r of rects) {
      expect(Number.isInteger(r.x)).toBe(true);
      expect(Number.isInteger(r.y)).toBe(true);
    }
  });

  it("lines up a single-input chain on one row", async () => {
    const nodes = [node("a", 0, 0), node("b", 0, 300), node("c", 0, 600)];
    const edges = [
      { source: "a", sourceHandle: "out:out", target: "b", targetHandle: "in:a" },
      { source: "b", sourceHandle: "out:out", target: "c", targetHandle: "in:a" },
    ];
    const result = await tidyLayout({ nodes, edges });
    const ys = ["a", "b", "c"].map((id) => result.nodes.get(id)!.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(2);
  });

  it("keeps comment frames around their patches and resizes them", async () => {
    const nodes = [node("a", 0, 0), node("b", 300, 0), node("x", 0, 400), node("y", 300, 400)];
    const edges = [
      { source: "a", sourceHandle: "out:out", target: "b", targetHandle: "in:a" },
      { source: "x", sourceHandle: "out:out", target: "y", targetHandle: "in:a" },
    ];
    const groups = [
      { id: "top", x: -20, y: -40, width: 520, height: 160, children: ["a", "b"] },
      { id: "bottom", x: -20, y: 360, width: 520, height: 160, children: ["x", "y"] },
    ];
    const result = await tidyLayout({ nodes, edges, groups });
    for (const g of groups) {
      const frame = result.groups.get(g.id)!;
      for (const id of g.children) {
        const n = nodes.find((m) => m.id === id)!;
        const p = result.nodes.get(id)!;
        expect(p.x).toBeGreaterThanOrEqual(frame.x);
        expect(p.y).toBeGreaterThanOrEqual(frame.y + 30);
        expect(p.x + n.width).toBeLessThanOrEqual(frame.x + frame.width);
        expect(p.y + n.height).toBeLessThanOrEqual(frame.y + frame.height);
      }
    }
    expect(rectsOverlap(result.groups.get("top")!, result.groups.get("bottom")!)).toBe(false);
  });

  it("handles cables that leave a comment frame", async () => {
    const nodes = [node("a", 0, 0), node("b", 300, 0), node("outside", 700, 0), node("loner", 900, 400)];
    const edges = [
      { source: "a", sourceHandle: "out:out", target: "b", targetHandle: "in:a" },
      { source: "b", sourceHandle: "out:out", target: "outside", targetHandle: "in:a" },
    ];
    const groups = [{ id: "frame", x: -20, y: -40, width: 520, height: 160, children: ["a", "b"] }];
    const result = await tidyLayout({ nodes, edges, groups });
    expect(result.nodes.get("b")!.x).toBeLessThan(result.nodes.get("outside")!.x);
    const frame = result.groups.get("frame")!;
    expect(result.nodes.get("outside")!.x).toBeGreaterThanOrEqual(frame.x + frame.width);
    expect(result.nodes.size).toBe(4);
  });

  it("lays out a frame of unconnected patches (the demo's shape)", async () => {
    const nodes = [node("tap", 40, 60, 5), node("flip", 260, 60), node("spring", 480, 60), node("scale", 720, 20), node("shadow", 720, 150), node("layer", 1000, 20, 1)];
    const edges = [
      { source: "tap", sourceHandle: "out:out", target: "flip", targetHandle: "in:a" },
      { source: "scale", sourceHandle: "out:out", target: "layer", targetHandle: "in:a" },
    ];
    const groups = [{ id: "comment:zoom_note", x: 20, y: 0, width: 940, height: 290, children: ["tap", "flip", "spring", "scale", "shadow"] }];
    const result = await tidyLayout({ nodes, edges, groups });
    expect(result.nodes.size).toBe(6);
    expect(result.groups.has("comment:zoom_note")).toBe(true);
  });

  it("returns nothing for an empty graph", async () => {
    const result = await tidyLayout({ nodes: [], edges: [] });
    expect(result.nodes.size).toBe(0);
  });
});
