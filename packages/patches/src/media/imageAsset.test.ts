import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { imageAssetPatch } from "./imageAsset.ts";
import { isLoadableUrl } from "./shared.ts";
import { videoAssetPatch } from "./videoAsset.ts";

const resolveAssetUrl = (id: string) => (id === "missing" ? undefined : `/assets/${id}`);

describe("isLoadableUrl", () => {
  it("accepts http, https, blob, and data URLs of the right kind", () => {
    expect(isLoadableUrl("https://example.com/a.png", "image")).toBe(true);
    expect(isLoadableUrl("HTTP://example.com/a.png", "image")).toBe(true);
    expect(isLoadableUrl("blob:https://example.com/123", "video")).toBe(true);
    expect(isLoadableUrl("data:image/png;base64,AAAA", "image")).toBe(true);
    expect(isLoadableUrl("data:image/png;base64,AAAA", "video")).toBe(false);
    expect(isLoadableUrl("file:///Users/me/a.png", "image")).toBe(false);
    expect(isLoadableUrl("javascript:alert(1)", "image")).toBe(false);
    expect(isLoadableUrl("photos/a.png", "image")).toBe(false);
  });
});

describe("imageAsset", () => {
  it("outputs an existing asset reference on frame 0, and null for a missing one", () => {
    const h = createPatchHarness(imageAssetPatch, { inputs: { image: { assetId: "hero" } }, services: { resolveAssetUrl } });
    expect(h.step().outputs.output).toEqual({ assetId: "hero" });
    expect(h.step({ inputs: { image: { assetId: "missing" } } }).outputs.output).toBeNull();
    expect(h.step({ inputs: { image: null } }).outputs.output).toBeNull();
  });

  it("a non-empty URL replaces Image on the same frame; other schemes output null with one warning", () => {
    const h = createPatchHarness(imageAssetPatch, { inputs: { image: { assetId: "hero" } }, services: { resolveAssetUrl } });
    expect(h.step({ inputs: { url: " https://example.com/cat.jpg " } }).outputs.output).toEqual({ url: "https://example.com/cat.jpg" });
    expect(h.step({ inputs: { url: "file:///tmp/cat.jpg" } }).outputs.output).toBeNull();
    h.step({ inputs: { url: "javascript:void 0" } });
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    expect(h.step({ inputs: { url: "   " } }).outputs.output).toEqual({ assetId: "hero" });
  });

  it("gives a loop of pictures for a loop of URLs", () => {
    const h = createPatchHarness(imageAssetPatch, { inputs: { url: loopOf(["https://a.test/1.png", "", "https://a.test/3.png"]) }, services: { resolveAssetUrl } });
    expect(h.step().outputs.output).toEqual(loopOf([{ url: "https://a.test/1.png" }, null, { url: "https://a.test/3.png" }]));
  });

  it("passes Image through while muted", () => {
    const result = runPatch(imageAssetPatch, [{ image: { assetId: "hero" } }], { muted: true });
    expect(result.frames[0]!.outputs.output).toEqual({ assetId: "hero" });
  });
});

describe("videoAsset", () => {
  it("outputs clip references from assets or video URLs", () => {
    const h = createPatchHarness(videoAssetPatch, { inputs: { video: { assetId: "clip" } }, services: { resolveAssetUrl } });
    expect(h.step().outputs.output).toEqual({ assetId: "clip" });
    expect(h.step({ inputs: { url: "data:video/mp4;base64,AAAA" } }).outputs.output).toEqual({ url: "data:video/mp4;base64,AAAA" });
    expect(h.step({ inputs: { url: "data:image/png;base64,AAAA" } }).outputs.output).toBeNull();
    expect(h.step({ inputs: { url: "", video: { assetId: "missing" } } }).outputs.output).toBeNull();
  });
});
