import type { Component } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { alignOps, alignPatchRects, estimatePatchSize, patchRects } from "./alignPatches.ts";

const rects = [
  { id: "a", x: 40, y: 100, width: 160, height: 80 },
  { id: "b", x: 300, y: 120, width: 200, height: 60 },
  { id: "c", x: 120, y: 400, width: 120, height: 100 },
];

describe("alignPatchRects", () => {
  it("aligns right edges into a column, spreading overlaps downward", () => {
    const out = alignPatchRects(rects, "right");
    expect(out.get("a")).toEqual({ x: 340, y: 100 });
    expect(out.get("b")).toEqual({ x: 300, y: 196 });
    expect(out.get("c")).toEqual({ x: 380, y: 400 });
  });

  it("aligns bottom edges into a row, spreading overlaps rightward", () => {
    const out = alignPatchRects(rects, "bottom");
    expect(out.get("a")).toEqual({ x: 40, y: 420 });
    expect(out.get("c")).toEqual({ x: 224, y: 400 });
    expect(out.get("b")).toEqual({ x: 368, y: 440 });
  });

  it("aligns left and top edges", () => {
    expect(alignPatchRects(rects, "left").get("b")).toEqual({ x: 40, y: 196 });
    expect(alignPatchRects(rects, "top").get("c")).toEqual({ x: 224, y: 100 });
    expect(alignPatchRects([], "left").size).toBe(0);
  });
});

describe("alignOps and measuring", () => {
  const component = {
    id: "main",
    patches: { a: { type: "switch", inputs: {}, ui: { x: 40, y: 100 } }, b: { type: "switch", inputs: {}, ui: { x: 300, y: 120 } } },
  } as unknown as Component;

  it("moves only patches whose position changes", () => {
    const ops = alignOps(component, new Map([["a", { x: 40, y: 100 }], ["b", { x: 40, y: 200 }], ["missing", { x: 0, y: 0 }]]));
    expect(ops).toEqual([{ op: "updatePatch", component: "main", id: "b", ui: { x: 40, y: 200 } }]);
  });

  it("estimates sizes for patches that aren't rendered", () => {
    expect(estimatePatchSize(3, 1)).toEqual({ width: 168, height: 104 });
    expect(patchRects(component, ["a", "nope"], () => ({ inputs: 3, outputs: 1 }), null)).toEqual([{ id: "a", x: 40, y: 100, width: 168, height: 104 }]);
  });
});
