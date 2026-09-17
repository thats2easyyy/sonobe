import type { AssetRef } from "@sonobe/core";
import { buildDoc, createMockRegistry, createTestRuntime, runFrames, tap } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import type { AudioMeterSource, AudioServices, AudioVoiceState, MediaInfo, SonobeRuntime } from "@sonobe/engine";
import { definitions } from "./index.ts";

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
    let rt!: SonobeRuntime;
    /** A host voice whose clock follows prototype time from the moment it starts playing. */
    const voices = new Map<string, { from: number; startedAt: number; playing: boolean; duration: number }>();
    const played: unknown[][] = [];
    const audio: AudioServices = {
      play: (key, source, options) => {
        voices.set(key, { from: options.from, startedAt: rt.time, playing: true, duration: records[source.assetId ?? ""]?.duration ?? 0 });
        played.push(["play", key, source.assetId, { from: options.from, loop: options.loop, volume: options.volume, rate: options.rate, pitch: options.pitch, pan: options.pan }]);
      },
      pause: (key) => {
        const voice = voices.get(key);
        if (voice) Object.assign(voice, { from: Math.min(voice.duration, voice.from + rt.time - voice.startedAt), startedAt: rt.time, playing: false });
        played.push(["pause", key]);
      },
      seek: (key, seconds) => played.push(["seek", key, seconds]),
      update: (key) => played.push(["update", key]),
      stop: (key) => {
        voices.delete(key);
        played.push(["stop", key]);
      },
      state: (key): AudioVoiceState | undefined => {
        const voice = voices.get(key);
        if (!voice) return undefined;
        const currentTime = Math.min(voice.duration, voice.from + (voice.playing ? rt.time - voice.startedAt : 0));
        const ended = currentTime >= voice.duration;
        return { status: ended ? "ended" : voice.playing ? "playing" : "paused", currentTime, duration: voice.duration, ended, loops: 0 };
      },
      meter: (source: AudioMeterSource, bands: number) => ("live" in source && voices.get(source.live.replace(/^audio\//, ""))?.playing ? { rms: 1, peak: 1, bands: new Array(bands).fill(-30) } : undefined),
    };
    const mediaInfo = (ref: AssetRef): MediaInfo => {
      const record = ref.assetId ? records[ref.assetId] : undefined;
      return record ? { status: "ready", width: record.width ?? 0, height: record.height ?? 0, duration: record.duration ?? 0, name: record.name } : { status: "error", width: 0, height: 0, duration: 0, name: "" };
    };
    rt = createTestRuntime(doc, registry, { platform: { audio }, mediaInfo, resolveAssetUrl: (id) => (records[id] ? `/assets/${records[id]!.file}` : undefined) });

    const [first] = runFrames(rt, 1);
    const photo = first!.roots.find((n) => n.layerId === "photo")!;
    expect(photo.props.image).toEqual({ assetId: "hero" });
    expect(rt.getValue("info.naturalSize")).toEqual([400, 200]);
    expect(rt.getValue("info.scale")).toBe(2);
    expect(rt.getValue("info.name")).toBe("hero");
    expect(rt.getValue("player.isPlaying")).toBe(false);
    expect(rt.getValue("@bar.opacity")).toBe(0);

    runFrames(rt, 2, tap(60, 50));
    expect(played).toEqual([["play", "main/player#0", "chime", { from: 0, loop: false, volume: 1, rate: 1, pitch: 0, pan: 0 }]]);
    expect(rt.getValue("player.metering")).toEqual({ live: "audio/main/player#0" });
    expect(rt.getValue("meter.volume")).toBe(1);
    runFrames(rt, 1);
    expect(rt.getValue("player.isPlaying")).toBe(true);
    expect(rt.getValue("@bar.opacity")).toBe(1);

    let finishedFrames = 0;
    for (let i = 0; i < 40; i++) {
      rt.step();
      if (rt.getValue("player.finished") === true) finishedFrames++;
    }
    expect(finishedFrames).toBe(1);
    expect(rt.getValue("player.isPlaying")).toBe(false);
    expect(rt.getValue("player.progress")).toBe(1);
    expect(played.at(-1)).toEqual(["pause", "main/player#0"]);
    expect(rt.getValue("meter.volume")).toBe(0);
    runFrames(rt, 1);
    expect(rt.getValue("@bar.opacity")).toBe(0);
    expect(rt.issues().filter((i) => i.severity === "error")).toEqual([]);
  });
});
