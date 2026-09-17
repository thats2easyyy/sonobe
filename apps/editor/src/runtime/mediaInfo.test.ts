import type { AssetRecord } from "@sonobe/core";
import type { SceneFrame, SceneNode } from "@sonobe/engine";
import { describe, expect, it, vi } from "vitest";
import { createMediaInfoCache, findSceneNode, mediaRefOf } from "./mediaInfo.ts";

const records: Record<string, AssetRecord> = { photo: { id: "photo", kind: "image", name: "Photo", file: "p.png", width: 10, height: 20 } };

const node = (key: string, layerId: string, type: string, props: SceneNode["props"] = {}, children: SceneNode[] = []): SceneNode => ({
  key,
  layerId,
  type,
  parentKey: null,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  transform: [],
  worldTransform: [],
  opacity: 1,
  visible: true,
  clip: false,
  props,
  children,
});

describe("media info", () => {
  it("learns sizes from renderer reports", () => {
    const cache = createMediaInfoCache({ resolveAssetUrl: (id) => (id === "photo" ? "blob:photo" : undefined), assetRecord: (id) => records[id], probe: false });
    expect(cache.info({ assetId: "photo" })).toEqual({ status: "ready", width: 10, height: 20, duration: 0, name: "Photo" });
    cache.report({ assetId: "photo" }, { loading: true });
    expect(cache.info({ assetId: "photo" })).toMatchObject({ status: "loading" });
    cache.report({ assetId: "photo" }, { naturalSize: [640, 480], loading: false });
    expect(cache.info({ assetId: "photo" })).toEqual({ status: "ready", width: 640, height: 480, duration: 0, name: "Photo" });
    cache.report({ url: "https://cdn/clip.mp4" }, { duration: 12, currentTime: 1 });
    expect(cache.info({ url: "https://cdn/clip.mp4" })).toEqual({ status: "ready", width: 0, height: 0, duration: 12, name: "clip.mp4" });
    expect(cache.info({ live: "camera/main/cam#0" })).toBeUndefined();
    expect(cache.info({ url: "https://cdn/unknown.png" })).toBeUndefined();
    cache.clear();
    expect(cache.info({ url: "https://cdn/clip.mp4" })).toBeUndefined();
  });

  it("loads references nobody has drawn yet", async () => {
    const probe = vi.fn((_url: string, kind: string) => (kind === "video" ? Promise.resolve({ width: 1920, height: 1080, duration: 12.5 }) : Promise.reject(new Error("broken"))));
    const cache = createMediaInfoCache({ resolveAssetUrl: () => undefined, probe });
    expect(cache.info({ url: "https://cdn/clip.mp4?v=1" })).toEqual({ status: "loading", width: 0, height: 0, duration: 0, name: "clip.mp4" });
    expect(probe).toHaveBeenCalledWith("https://cdn/clip.mp4?v=1", "video");
    await vi.waitFor(() => expect(cache.info({ url: "https://cdn/clip.mp4?v=1" })).toMatchObject({ status: "ready", width: 1920, duration: 12.5 }));
    cache.info({ url: "https://cdn/broken.png" });
    await vi.waitFor(() => expect(cache.info({ url: "https://cdn/broken.png" })?.status).toBe("error"));
    expect(probe).toHaveBeenCalledTimes(2);
    cache.dispose();
  });

  it("finds which media a scene node shows", () => {
    const hero = node("card/hero", "hero", "image", { image: { assetId: "photo" } });
    const scene: SceneFrame = { frame: 0, time: 0, size: [390, 844], background: { r: 1, g: 1, b: 1, a: 1 }, roots: [node("card", "card", "rectangle", {}, [hero])] };
    expect(findSceneNode(scene, "card/hero")).toBe(hero);
    expect(findSceneNode(scene, "ghost")).toBeUndefined();
    expect(findSceneNode(null, "card")).toBeUndefined();
    const cache = createMediaInfoCache({ resolveAssetUrl: () => "blob:photo", assetRecord: (id) => records[id], probe: false });
    expect(cache.reportForNode(scene, "card/hero", { naturalSize: [5, 6] })).toEqual({ assetId: "photo" });
    expect(cache.info({ assetId: "photo" })).toMatchObject({ width: 5, height: 6 });
    expect(cache.reportForNode(scene, "card", { naturalSize: [1, 1] })).toBeUndefined();
    expect(mediaRefOf("https://a/b.png")).toEqual({ url: "https://a/b.png" });
    expect(mediaRefOf({ asset: "x" })).toEqual({ assetId: "x" });
    expect(mediaRefOf({ live: "camera/k", url: "sonobe-live:camera/k" })).toEqual({ live: "camera/k" });
    expect(mediaRefOf(null)).toBeUndefined();
  });
});
