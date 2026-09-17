import { applyOps, createEmptyDocument } from "@sonobe/core";
import type { SceneFrame, SceneNode } from "@sonobe/engine";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { documentStats, formatMs, frameBudgetShare, patchTimingsOf, pushSample, sceneStats, smoothness, summarizeSamples, type PerfSample } from "./perfModel.ts";

const sample = (t: number, fps: number, frameMs: number, playing = true): PerfSample => ({ t, fps, frameMs, playing });

describe("samples", () => {
  it("keeps the newest samples", () => {
    let samples: PerfSample[] = [];
    for (let i = 0; i < 5; i++) samples = pushSample(samples, sample(i, 60, 1), 3);
    expect(samples.map((s) => s.t)).toEqual([2, 3, 4]);
  });

  it("summarizes frame rate and frame time", () => {
    const summary = summarizeSamples([sample(0, 60, 2), sample(1, 40, 6), sample(2, 0, 0, false), sample(3, 58, 4)]);
    expect(summary.fps).toEqual({ latest: 58, min: 40, avg: (60 + 40 + 58) / 3 });
    expect(summary.frameMs).toEqual({ latest: 4, avg: 3, max: 6 });
    expect(summary.slowSamples).toBe(1);
    expect(summary.playingSamples).toBe(3);
    expect(summarizeSamples([])).toMatchObject({ fps: { latest: 0, min: 0, avg: 0 }, frameMs: { latest: 0, avg: 0, max: 0 } });
  });

  it("describes smoothness in plain language", () => {
    expect(smoothness(60, true)).toEqual({ tone: "success", label: "Smooth" });
    expect(smoothness(45, true).tone).toBe("warn");
    expect(smoothness(20, true).tone).toBe("danger");
    expect(smoothness(60, false)).toEqual({ tone: "neutral", label: "Paused" });
    expect(frameBudgetShare(8.35)).toBeCloseTo(0.5, 2);
    expect(formatMs(12.4)).toBe("12 ms");
    expect(formatMs(4.23)).toBe("4.2 ms");
    expect(formatMs(0.314)).toBe("0.31 ms");
  });
});

describe("document and scene stats", () => {
  it("counts items and unimplemented patch types", () => {
    const registry = createPatchRegistry();
    const r = applyOps(
      createEmptyDocument(),
      [
        { op: "addLayer", layer: { id: "group", type: "group", children: [{ id: "a", type: "rectangle" }, { id: "b", type: "oval" }] } },
        { op: "addPatch", patch: { id: "p1", type: "switch" } },
        { op: "addPatch", patch: { id: "p2", type: "counter" } },
        { op: "addComment", comment: { text: "note", rect: [0, 0, 10, 10] } },
      ],
      { registry },
    );
    expect(r.ok).toBe(true);
    const stats = documentStats(r.doc, (type) => type !== "counter", registry);
    expect(stats).toEqual({ components: 1, layers: 3, patches: 2, comments: 1, unimplemented: [{ type: "counter", count: 1 }] });
  });

  it("counts loop instances in a scene", () => {
    const node = (key: string, layerId: string, children: SceneNode[] = [], visible = true): SceneNode => ({ key, layerId, type: "rectangle", parentKey: null, x: 0, y: 0, width: 1, height: 1, transform: [], worldTransform: [], opacity: 1, visible, clip: false, props: {}, children });
    const scene: SceneFrame = {
      frame: 1,
      time: 0,
      size: [100, 100],
      background: { r: 0, g: 0, b: 0, a: 1 },
      roots: [node("list", "list", [node("row#0", "row"), node("row#1", "row"), node("row#2", "row", [], false)]), node("card_1/dot#0", "dot"), node("card_1/title", "title")],
    };
    expect(sceneStats(scene)).toEqual({ nodes: 6, visible: 5, loopInstances: 4, replicated: [{ layerId: "row", count: 3 }, { layerId: "dot", count: 1 }] });
    expect(sceneStats(null).nodes).toBe(0);
  });
});

describe("patchTimingsOf", () => {
  it("reads optional runtime timings, slowest first", () => {
    expect(patchTimingsOf({})).toBeNull();
    expect(patchTimingsOf(null)).toBeNull();
    const runtime = { patchTimings: () => [{ patchId: "a", ms: 0.2 }, { patchId: "b", ms: 1.4, componentPath: "main" }, { patchId: 3, ms: 9 }, { patchId: "c", ms: Number.NaN }] };
    expect(patchTimingsOf(runtime)).toEqual([{ patchId: "b", ms: 1.4, componentPath: "main" }, { patchId: "a", ms: 0.2 }]);
    expect(patchTimingsOf({ patchTimings: () => { throw new Error("no"); } })).toBeNull();
  });
});
