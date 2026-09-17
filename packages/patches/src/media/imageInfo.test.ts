import type { AssetRef } from "@sonobe/core";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { baseName, densityFromName, imageInfoPatch, rawNameOf } from "./imageInfo.ts";
import type { MediaInfo } from "./platform.ts";

const EMPTY = { naturalSize: [0, 0], scale: 1, name: "", aspectRatio: 0, loading: false };

function harness(mediaInfo: (ref: AssetRef) => MediaInfo | undefined, inputs: Record<string, unknown> = {}) {
  return createPatchHarness(imageInfoPatch, { inputs, services: { platform: { mediaInfo } as never } });
}

describe("file names", () => {
  it("derives density and base names", () => {
    expect(densityFromName("hero@2x.png")).toBe(2);
    expect(densityFromName("hero@3x")).toBe(3);
    expect(densityFromName("hero@4x.png")).toBeUndefined();
    expect(baseName("hero@2x.png")).toBe("hero");
    expect(baseName("hero.final@3x.jpg")).toBe("hero.final");
    expect(baseName("photo")).toBe("photo");
    expect(rawNameOf({ url: "https://cdn.test/photos/My%20Cat@3x.jpg?w=200#top" })).toBe("My Cat@3x.jpg");
    expect(rawNameOf({ url: "data:image/png;base64,AAAA" })).toBe("");
    expect(rawNameOf({ url: "blob:https://site.test/1234" })).toBe("");
    expect(rawNameOf({ assetId: "a" }, { status: "ready", width: 1, height: 1, duration: 0, name: "cover.png" })).toBe("cover.png");
  });
});

describe("imageInfo", () => {
  it("describes no picture with the empty values", () => {
    const h = createPatchHarness(imageInfoPatch);
    expect(h.step().outputs).toEqual(EMPTY);
  });

  it("logs once and outputs empty values when the host can't describe pictures", () => {
    const h = createPatchHarness(imageInfoPatch, { inputs: { image: { assetId: "hero" } } });
    expect(h.run(3).outputs).toEqual(EMPTY);
    expect(h.logs.map((l) => [l.level, l.message])).toEqual([["log", "imageInfo: this host can't describe pictures yet, so Image Info outputs empty values."]]);
  });

  it("describes an asset picture on frame 0: points, density, name, and aspect ratio", () => {
    const h = harness(() => ({ status: "ready", width: 600, height: 400, duration: 0, name: "hero@2x.png" }), { image: { assetId: "hero" } });
    expect(h.step().outputs).toEqual({ naturalSize: [300, 200], scale: 2, name: "hero", aspectRatio: 1.5, loading: false });
  });

  it("keeps describing the previous picture while a new one loads, then changes everything together", () => {
    let status: MediaInfo["status"] = "loading";
    const h = harness((ref) => (ref.assetId ? { status: "ready", width: 100, height: 100, duration: 0, name: "a.png" } : { status, width: 800, height: 200, duration: 0, name: "" }), { image: { assetId: "a" } });
    h.step();
    const loading = h.step({ inputs: { image: { url: "https://cdn.test/wide.jpg" } } });
    expect(loading.outputs).toEqual({ naturalSize: [100, 100], scale: 1, name: "a", aspectRatio: 1, loading: true });
    expect(loading.requestedNextFrame).toBe(true);
    status = "ready";
    expect(h.step().outputs).toEqual({ naturalSize: [800, 200], scale: 1, name: "wide", aspectRatio: 4, loading: false });
    expect(h.step({ inputs: { image: null } }).outputs).toEqual(EMPTY);
  });

  it("a load failure gives the empty values with the name from the reference and one warning", () => {
    const h = harness(() => ({ status: "error", width: 0, height: 0, duration: 0, name: "" }), { image: { url: "https://cdn.test/photos/My%20Cat@3x.jpg" } });
    expect(h.run(3).outputs).toEqual({ ...EMPTY, name: "My Cat" });
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("never outputs NaN for zero or non-finite sizes", () => {
    const h = harness(() => ({ status: "ready", width: Number.NaN, height: 0, duration: 0, name: "x.png" }), { image: { assetId: "x" } });
    expect(h.step().outputs).toEqual({ naturalSize: [0, 0], scale: 1, name: "x", aspectRatio: 0, loading: false });
  });

  it("describes a loop of pictures per index, and outputs the empty values while muted", () => {
    const sizes: Record<string, [number, number]> = { a: [10, 20], b: [30, 10] };
    const h = harness((ref) => ({ status: "ready", width: sizes[ref.assetId!]![0], height: sizes[ref.assetId!]![1], duration: 0, name: `${ref.assetId}.png` }), { image: loopOf([{ assetId: "a" }, { assetId: "b" }]) });
    expect(h.step().outputs.aspectRatio).toEqual(loopOf([0.5, 3]));
    const muted = runPatch(imageInfoPatch, [{ image: { assetId: "a" } }], { muted: true });
    expect(muted.frames[0]!.outputs).toEqual(EMPTY);
  });
});
