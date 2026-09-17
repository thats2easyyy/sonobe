import type { LayerRef, Value } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { videoInfoPatch } from "./videoInfo.ts";

const ZEROS = { currentTime: 0, duration: 0, progress: 0, naturalSize: [0, 0] };

function harness(values: (ref: LayerRef) => Record<string, Value>, inputs: Record<string, unknown> = { layer: { layerId: "clip" } }, layerType?: string) {
  return createPatchHarness(videoInfoPatch, {
    inputs,
    services: {
      platform: { layerOutput: (ref: LayerRef, key: string) => values(ref)[key] } as never,
      layerInfo: () => (layerType ? ({ type: layerType } as never) : undefined),
    },
  });
}

describe("videoInfo", () => {
  it("outputs zeros without a layer", () => {
    expect(createPatchHarness(videoInfoPatch).step().outputs).toEqual(ZEROS);
  });

  it("logs once and outputs zeros when the host can't read layer outputs", () => {
    const h = createPatchHarness(videoInfoPatch, { inputs: { layer: { layerId: "clip" } } });
    expect(h.run(3).outputs).toEqual(ZEROS);
    expect(h.logs.filter((l) => l.level === "log")).toHaveLength(1);
  });

  it("reads the video layer's time, duration, and natural size", () => {
    const h = harness(() => ({ currentTime: 3, duration: 12, naturalSize: [1920, 1080] }), undefined, "video");
    expect(h.step().outputs).toEqual({ currentTime: 3, duration: 12, progress: 0.25, naturalSize: [1920, 1080] });
  });

  it("clamps progress and never outputs NaN", () => {
    expect(harness(() => ({ currentTime: 15, duration: 12 })).step().outputs.progress).toBe(1);
    expect(harness(() => ({ currentTime: 4, duration: 0 })).step().outputs).toEqual({ currentTime: 4, duration: 0, progress: 0, naturalSize: [0, 0] });
    expect(harness(() => ({ currentTime: Number.NaN, duration: -3, naturalSize: [Number.NaN, 2] })).step().outputs).toEqual(ZEROS);
  });

  it("warns once for a layer that isn't a Video layer", () => {
    const h = harness(() => ({ currentTime: 3, duration: 12 }), undefined, "rectangle");
    expect(h.run(2).outputs).toEqual(ZEROS);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("gives one reading per layer reference in a loop", () => {
    const h = harness((ref) => ({ currentTime: ref.instance ?? 0, duration: 4 }), { layer: loopOf([{ layerId: "clip", instance: 0 }, { layerId: "clip", instance: 2 }]) });
    expect(h.step().outputs.progress).toEqual(loopOf([0, 0.5]));
  });
});
