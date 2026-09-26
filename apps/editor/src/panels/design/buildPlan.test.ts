import { describe, expect, it } from "vitest";
import { addPageBoxes, BUILD, buildReadyAt, createBuild, finalSweepAt, planFinalSweep, readPageBoxes, upSweepMs, type PageBox } from "./buildPlan.ts";

const box = (key: string, y = 0): PageBox => ({ key, shape: "box", rect: { x: 0, y, width: 100, height: 20 }, lines: 1, radius: 0 });

describe("addPageBoxes", () => {
  it("queues a burst box by box, spread over about burstMs", () => {
    const state = createBuild();
    addPageBoxes(state, Array.from({ length: 40 }, (_, i) => box(`/${i}`, i * 20)), 1000);
    const starts = [...state.boxes.values()].map((b) => b.at);
    expect(starts[0]).toBe(1000);
    expect(starts[1]! - starts[0]!).toBe(BUILD.burstMs / 40);
    expect(buildReadyAt(state)).toBe(1000 + (BUILD.burstMs / 40) * 39 + BUILD.traceMs);
  });

  it("keeps a box's start as the page grows, moves it, queues new ones after, and drops what's gone", () => {
    const state = createBuild();
    addPageBoxes(state, [box("/0"), box("/1")], 0);
    const first = state.boxes.get("/0")!.at;
    const last = state.lastAt;
    addPageBoxes(state, [box("/0", 50), box("/2")], 100);
    expect(state.boxes.get("/0")).toMatchObject({ at: first, rect: { y: 50 } });
    expect(state.boxes.has("/1")).toBe(false);
    expect(state.boxes.get("/2")!.at).toBeGreaterThan(last);
  });

  it("spaces a lone box no further than maxGapMs after the last", () => {
    const state = createBuild();
    addPageBoxes(state, [box("/0")], 0);
    addPageBoxes(state, [box("/0"), box("/1")], 0);
    expect(state.boxes.get("/1")!.at).toBe(BUILD.maxGapMs);
  });
});

describe("readPageBoxes", () => {
  it("reads the preview's tuples and refuses anything else", () => {
    expect(readPageBoxes([["/0", 2, 1, 2, 30, 40, 5, 0]])).toEqual([{ key: "/0", shape: "text", rect: { x: 1, y: 2, width: 30, height: 40 }, lines: 3, radius: 0 }]);
    expect(readPageBoxes([["/0", 9, 1, 2, 30, 40, 1, 0]])).toBeNull();
    expect(readPageBoxes([["/0", 0, 1, 2, 0, 40, 1, 0]])).toBeNull();
    expect(readPageBoxes([[0, 0, 1, 2, 30, 40, 1, 0]])).toBeNull();
    expect(readPageBoxes("boxes")).toBeNull();
  });
});

describe("the final sweep", () => {
  it("runs the laser to the bottom, sweeps up revealing the page, then glows", () => {
    const f = planFinalSweep(0, 0.5, 874, false);
    expect(f.downEnd).toBe(BUILD.finalDownMs / 2);
    expect(f.upEnd - f.downEnd).toBe(upSweepMs(874));
    expect(finalSweepAt(f, f.downEnd / 2)).toMatchObject({ direction: 1, reveal: 1, laser: true });
    const mid = finalSweepAt(f, (f.downEnd + f.upEnd) / 2);
    expect(mid.direction).toBe(-1);
    expect(mid.reveal).toBe(mid.y);
    expect(mid.reveal).toBeGreaterThan(0);
    expect(mid.reveal).toBeLessThan(1);
    expect(finalSweepAt(f, f.upEnd + BUILD.glowMs / 2)).toMatchObject({ reveal: 0, laser: false, glow: 1 });
  });

  it("crossfades under reduced motion", () => {
    const f = planFinalSweep(0, 0.3, 874, true);
    expect(f.end).toBe(BUILD.fadeMs);
    expect(finalSweepAt(f, 10)).toMatchObject({ laser: false });
  });
});
