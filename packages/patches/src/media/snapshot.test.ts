import type { AssetRef, LayerRef } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { snapshotPatch } from "./snapshot.ts";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function renderer() {
  const requests: { layer: LayerRef | null; options: unknown; resolve: (ref: AssetRef) => void; reject: (error: unknown) => void }[] = [];
  const released: string[] = [];
  const platform = {
    snapshot: (layer: LayerRef | null, options: unknown) => new Promise<AssetRef>((resolve, reject) => requests.push({ layer, options, resolve, reject })),
    releaseMedia: (ref: AssetRef) => released.push(ref.url ?? ""),
  };
  return { requests, released, platform };
}

describe("snapshot", () => {
  it("logs once without a renderer and Image stays null", () => {
    const h = createPatchHarness(snapshotPatch);
    expect(h.step({ pulses: ["capture"] }).outputs.image).toBeNull();
    h.step({ pulses: ["capture"] });
    expect(h.logs.map((l) => l.message)).toEqual(["snapshot: no renderer in simulation"]);
  });

  it("captures at the device scale and pulses Captured when the picture is ready", async () => {
    const r = renderer();
    const h = createPatchHarness(snapshotPatch, { inputs: { layer: { layerId: "card" } }, services: { platform: r.platform as never } });
    const f0 = h.step({ pulses: ["capture"] });
    expect(r.requests[0]!.layer).toEqual({ layerId: "card" });
    expect(r.requests[0]!.options).toEqual({ scale: 3 });
    expect(f0.requestedNextFrame).toBe(true);
    r.requests[0]!.resolve({ url: "blob:shot1" });
    await flush();
    const f1 = h.step();
    expect(f1.pulses.has("captured")).toBe(true);
    expect(f1.outputs.image).toEqual({ url: "blob:shot1" });
  });

  it("a burst applies only the newest capture; a failure keeps the previous picture with one warning", async () => {
    const r = renderer();
    const h = createPatchHarness(snapshotPatch, { services: { platform: r.platform as never } });
    h.step({ pulses: ["capture"] });
    h.step({ pulses: ["capture"] });
    r.requests[1]!.resolve({ url: "blob:new" });
    r.requests[0]!.resolve({ url: "blob:old" });
    await flush();
    expect(h.step().outputs.image).toEqual({ url: "blob:new" });
    expect(r.released).toEqual(["blob:old"]);
    expect(r.requests[0]!.layer).toBeNull();
    h.step({ pulses: ["capture"] });
    r.requests[2]!.reject(new Error("The layer has zero size."));
    await flush();
    const failed = h.run(2);
    expect(failed.outputs.image).toEqual({ url: "blob:new" });
    expect(failed.pulses.has("captured")).toBe(false);
    expect(h.logs.filter((l) => l.level === "warn").map((l) => l.message)).toEqual(["snapshot: The layer has zero size."]);
  });

  it("captures each loop index separately and releases pictures on dispose", async () => {
    const r = renderer();
    const h = createPatchHarness(snapshotPatch, { inputs: { layer: loopOf([{ layerId: "tile", instance: 0 }, { layerId: "tile", instance: 1 }]) }, services: { platform: r.platform as never } });
    h.step({ pulses: ["capture"] });
    expect(r.requests.map((q) => q.layer?.instance)).toEqual([0, 1]);
    r.requests[0]!.resolve({ url: "blob:t0" });
    r.requests[1]!.resolve({ url: "blob:t1" });
    await flush();
    expect(h.step().outputs.image).toEqual(loopOf([{ url: "blob:t0" }, { url: "blob:t1" }]));
    h.dispose();
    expect(r.released).toEqual(["blob:t0", "blob:t1"]);
  });
});
