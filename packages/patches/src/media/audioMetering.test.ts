import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { audioMeteringPatch, bandPercent, levelPercent, toDb } from "./audioMetering.ts";
import type { AudioMeterReading, MeterSource } from "./platform.ts";

const HANDLE = { url: "sonobe-live:audio/main/player#0" };

function harness(meter: (source: MeterSource, bands: number) => AudioMeterReading | undefined, inputs: Record<string, unknown> = {}, layerType?: string) {
  const calls: MeterSource[] = [];
  const h = createPatchHarness(audioMeteringPatch, {
    inputs,
    services: {
      platform: { audio: { play: () => {}, stop: () => {}, currentTime: () => 0, meter: (s: MeterSource, b: number) => (calls.push(s), meter(s, b)) } } as never,
      layerInfo: () => (layerType ? ({ type: layerType } as never) : undefined),
    },
  });
  return { h, calls };
}

describe("level conversions", () => {
  it("converts amplitudes to decibels and decibels to percent", () => {
    expect(toDb(1)).toBe(0);
    expect(toDb(0.1)).toBeCloseTo(-20, 10);
    expect(toDb(0)).toBe(-160);
    expect(toDb(2)).toBe(0);
    expect(levelPercent(-60)).toBe(0);
    expect(levelPercent(-30)).toBe(0.5);
    expect(levelPercent(0)).toBe(1);
    expect(bandPercent(-100)).toBe(0);
    expect(bandPercent(-65)).toBeCloseTo(0.5, 10);
    expect(bandPercent(-10)).toBe(1);
  });
});

describe("audioMetering", () => {
  it("outputs idle values with Resolution items when nothing is measured", () => {
    const h = createPatchHarness(audioMeteringPatch);
    expect(h.step().outputs).toEqual({ volume: 0, peakVolume: 0, waveformData: loopOf([0, 0, 0]) });
    expect(h.step({ inputs: { format: "decibels", resolution: 2 } }).outputs).toEqual({ volume: -160, peakVolume: -160, waveformData: loopOf([-160, -160]) });
  });

  it("measures a live handle as percent or decibels", () => {
    const { h, calls } = harness((_, bands) => ({ rms: 0.1, peak: 0.5, bands: new Array(bands).fill(-65) }), { source: HANDLE, resolution: 4 });
    const f = h.step();
    expect(calls[0]).toEqual({ live: "audio/main/player#0" });
    expect(f.outputs.volume).toBeCloseTo(levelPercent(-20), 10);
    expect(f.outputs.peakVolume).toBeCloseTo(levelPercent(toDb(0.5)), 10);
    expect((f.outputs.waveformData as { items: number[] }).items.map((v) => Number(v.toFixed(6)))).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(f.requestedNextFrame).toBe(true);
    const db = h.step({ inputs: { format: "decibels" } });
    expect(db.outputs.volume).toBeCloseTo(-20, 10);
    expect(db.outputs.waveformData).toEqual(loopOf([-65, -65, -65, -65]));
  });

  it("holds the loudest peak for half a second", () => {
    let peak = 1;
    const { h } = harness(() => ({ rms: 0, peak, bands: [] }), { source: HANDLE, format: "decibels" });
    h.step({ dt: 0.1 });
    peak = 0.01;
    expect(h.step({ dt: 0.1 }).outputs.peakVolume).toBe(0);
    h.run(3, { dt: 0.1 });
    expect(h.step({ dt: 0.1 }).outputs.peakVolume).toBeCloseTo(-40, 10);
  });

  it("pads or trims host bands to Resolution and clamps levels; Resolution floors, clamps, and defaults to 3", () => {
    const { h } = harness(() => ({ rms: Number.NaN, peak: 0, bands: [5, Number.NaN, -200, -30, -30] }), { source: HANDLE, format: "decibels", resolution: 3.9 });
    expect(h.step().outputs.waveformData).toEqual(loopOf([0, -160, -160]));
    expect((h.step({ inputs: { resolution: 500 } }).outputs.waveformData as { items: number[] }).items).toHaveLength(128);
    expect((h.step({ inputs: { resolution: Number.NaN } }).outputs.waveformData as { items: number[] }).items).toHaveLength(3);
  });

  it("measures a Video layer when Source is empty; Source wins when both are set", () => {
    const { h, calls } = harness(() => ({ rms: 1, peak: 1, bands: [] }), { layer: { layerId: "clip" } }, "video");
    h.step();
    h.step({ inputs: { source: HANDLE } });
    expect(calls).toEqual([{ layer: { layerId: "clip" } }, { live: "audio/main/player#0" }]);
  });

  it("warns once for a plain sound file or a layer that isn't a video", () => {
    const plain = harness(() => ({ rms: 1, peak: 1, bands: [] }), { source: { assetId: "chime" } });
    expect(plain.h.run(3).outputs.volume).toBe(0);
    expect(plain.calls).toEqual([]);
    expect(plain.h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    const notVideo = harness(() => ({ rms: 1, peak: 1, bands: [] }), { layer: { layerId: "box" } }, "rectangle");
    notVideo.h.run(2);
    expect(notVideo.calls).toEqual([]);
    expect(notVideo.h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("outputs idle values while muted and warns once about looped inputs", () => {
    const { h, calls } = harness(() => ({ rms: 1, peak: 1, bands: [] }), { source: HANDLE });
    h.node.muted = true;
    expect(h.step().outputs).toEqual({ volume: 0, peakVolume: 0, waveformData: loopOf([0, 0, 0]) });
    expect(calls).toEqual([]);
    h.node.muted = false;
    h.step({ inputs: { resolution: loopOf([2, 4]) } });
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });
});
