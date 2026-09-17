import type { AssetRef } from "@sonobe/core";
import { buildDoc, createMockRegistry, createTestRuntime, runFrames, tap } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { definitions } from "./index.ts";
import type { MeterSource } from "./platform.ts";

describe("media patches in a runtime document", () => {
  it("tapping a button plays a sound whose live level drives a layer, while an image asset feeds a layer and Image Info", () => {
    const registry = createMockRegistry(definitions);
    const doc = buildDoc(
      {
        ops: [
          { op: "addAsset", asset: { id: "hero", kind: "image", name: "hero@2x.png", file: "hero.png", width: 800, height: 400 } },
          { op: "addAsset", asset: { id: "chime", kind: "sound", name: "chime.mp3", file: "chime.mp3", duration: 0.5 } },
          { op: "setInput", target: "pic.image", value: { asset: "hero" } },
          { op: "setInput", target: "player.sound", value: { asset: "chime" } },
        ],
        layers: [
          { id: "button", type: "rectangle", name: "Button", props: { position: [20, 20], size: [100, 60] } },
          { id: "photo", type: "image", name: "Photo", props: { position: [20, 100], size: [200, 100], image: { link: "pic.output" } } },
          { id: "bar", type: "rectangle", name: "Bar", props: { position: [20, 400], size: [200, 20], opacity: { link: "meter.volume" } } },
        ],
        patches: {
          pic: { type: "imageAsset" },
          info: { type: "imageInfo", inputs: { image: { link: "pic.output" } } },
          touch: { type: "interaction", inputs: { layer: { layer: "button" } } },
          player: { type: "soundPlayer", inputs: { play: { link: "touch.tap" } } },
          meter: { type: "audioMetering", inputs: { source: { link: "player.metering" } } },
        },
      },
      registry,
    );

    const records = doc.assets;
    const voices = new Set<string>();
    const played: unknown[][] = [];
    const platform = {
      audio: {
        play: (key: string, assetId: string, options: unknown) => {
          voices.add(key);
          played.push(["play", key, assetId, options]);
        },
        stop: (key: string) => {
          voices.delete(key);
          played.push(["stop", key]);
        },
        currentTime: () => 0,
        meter: (source: MeterSource, bands: number) =>
          "live" in source && voices.has(source.live.replace(/^audio\//, "")) ? { rms: 1, peak: 1, bands: new Array(bands).fill(-30) } : undefined,
      },
      mediaInfo: (ref: AssetRef) => {
        const record = ref.assetId ? records[ref.assetId] : undefined;
        return record ? { status: "ready", width: record.width ?? 0, height: record.height ?? 0, duration: record.duration ?? 0, name: record.name } : { status: "error", width: 0, height: 0, duration: 0, name: "" };
      },
    };
    const rt = createTestRuntime(doc, registry, { platform: platform as never, resolveAssetUrl: (id) => (records[id] ? `/assets/${records[id]!.file}` : undefined) });

    const [first] = runFrames(rt, 1);
    const photo = first!.roots.find((n) => n.layerId === "photo")!;
    expect(photo.props.image).toEqual({ assetId: "hero" });
    expect(rt.getValue("info.naturalSize")).toEqual([400, 200]);
    expect(rt.getValue("info.scale")).toBe(2);
    expect(rt.getValue("info.name")).toBe("hero");
    expect(rt.getValue("player.isPlaying")).toBe(false);
    expect(rt.getValue("@bar.opacity")).toBe(0);

    runFrames(rt, 2, tap(60, 50));
    expect(rt.getValue("player.isPlaying")).toBe(true);
    expect(played).toEqual([["play", "main/player#0", "chime", { loop: false, volume: 1, rate: 1 }]]);
    expect(rt.getValue("player.metering")).toEqual({ url: "sonobe-live:audio/main/player#0" });
    expect(rt.getValue("meter.volume")).toBe(1);
    expect(rt.getValue("@bar.opacity")).toBe(1);

    let finishedFrames = 0;
    for (let i = 0; i < 40; i++) {
      rt.step();
      if (rt.getValue("player.finished") === true) finishedFrames++;
    }
    expect(finishedFrames).toBe(1);
    expect(rt.getValue("player.isPlaying")).toBe(false);
    expect(rt.getValue("player.progress")).toBe(1);
    expect(played.at(-1)).toEqual(["stop", "main/player#0"]);
    expect(rt.getValue("meter.volume")).toBe(0);
    expect(rt.getValue("@bar.opacity")).toBe(0);
    expect(rt.issues().filter((i) => i.severity === "error")).toEqual([]);
  });
});
