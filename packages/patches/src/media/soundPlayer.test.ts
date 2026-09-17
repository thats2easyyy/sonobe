import type { AssetRef } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import type { PatchHarnessOptions } from "../infra/index.ts";
import type { VoiceOptions, VoiceState } from "./platform.ts";
import { MAX_VOICES, soundPlayerPatch } from "./soundPlayer.ts";

const CHIME = { assetId: "chime" };
const resolveAssetUrl = (id: string) => (id === "missing" ? undefined : `blob:${id}`);
const ready = (duration: number) => () => ({ status: "ready" as const, width: 0, height: 0, duration, name: "chime.mp3" });

function harness(options: { duration?: number; platform?: Record<string, unknown>; inputs?: Record<string, unknown> } = {}, extra: PatchHarnessOptions = {}) {
  const platform: Record<string, unknown> = { ...options.platform };
  if (options.duration !== undefined) platform.mediaInfo = ready(options.duration);
  return createPatchHarness(soundPlayerPatch, { inputs: { sound: CHIME, ...options.inputs }, services: { resolveAssetUrl, platform: platform as never }, ...extra });
}

function fakeExtendedAudio() {
  const calls: unknown[][] = [];
  const voices = new Map<string, VoiceState>();
  const audio = {
    play: (key: string, source: AssetRef, opts: VoiceOptions & { from: number }) => {
      calls.push(["play", key, source.assetId ?? source.url, opts.from]);
      voices.set(key, { status: "loading", currentTime: opts.from, duration: 0, ended: false, loops: 0 });
    },
    pause: (key: string) => calls.push(["pause", key]),
    seek: (key: string, t: number) => calls.push(["seek", key, t]),
    update: (key: string, opts: VoiceOptions) => calls.push(["update", key, opts.volume]),
    stop: (key: string) => {
      calls.push(["stop", key]);
      voices.delete(key);
    },
    state: (key: string) => voices.get(key),
    currentTime: () => 0,
  };
  return { calls, voices, audio };
}

describe("soundPlayer", () => {
  it("an empty or missing sound is silent, outputs 0, false, and null, and ignores Play", () => {
    for (const sound of [null, { assetId: "missing" }]) {
      const h = harness({ inputs: { sound, playing: true } });
      const f = h.step({ pulses: ["play"] });
      expect(f.outputs).toEqual({ currentTime: 0, duration: 0, progress: 0, isPlaying: false, metering: null });
      expect(f.requestedNextFrame).toBe(false);
    }
  });

  it("plays while Playing is on: Is Playing on frame 0, the playhead advances by dt × rate from the next frame, and Finished fires at the end", () => {
    const h = harness({ duration: 1, inputs: { playing: true } });
    const f0 = h.step({ dt: 0.25 });
    expect(f0.outputs).toMatchObject({ currentTime: 0, duration: 1, progress: 0, isPlaying: true, metering: { url: "sonobe-live:audio/main/patch_1#0" } });
    expect(f0.requestedNextFrame).toBe(true);
    expect(h.step({ dt: 0.25 }).outputs.currentTime).toBe(0.25);
    h.step({ dt: 0.25 });
    expect(h.step({ dt: 0.25 }).outputs.progress).toBe(0.75);
    const end = h.step({ dt: 0.25 });
    expect(end.pulses.has("finished")).toBe(true);
    expect(end.outputs).toMatchObject({ currentTime: 1, progress: 1, isPlaying: false });
    expect(h.step({ dt: 0.25 }).pulses.has("finished")).toBe(false);
    expect(h.logs.map((l) => l.message)).toEqual(["soundPlayer: audio is silent in simulation"]);
  });

  it("turning Playing off pauses and keeps the position; turning it on resumes, or replays from 0 after the end", () => {
    const h = harness({ duration: 1, inputs: { playing: true } });
    h.run(3, { dt: 0.25 });
    // The playhead advances for the time since the previous frame before commands apply.
    const paused = h.step({ dt: 0.25, inputs: { playing: false } });
    expect(paused.outputs).toMatchObject({ currentTime: 0.75, isPlaying: false });
    expect(h.run(3, { dt: 0.25 }).outputs.currentTime).toBe(0.75);
    h.step({ dt: 0.25, inputs: { playing: true } });
    const end = h.run(2, { dt: 0.25 });
    expect(end.outputs.currentTime).toBe(1);
    h.step({ dt: 0.25, inputs: { playing: false } });
    const replay = h.step({ dt: 0.25, inputs: { playing: true } });
    expect(replay.outputs).toMatchObject({ currentTime: 0, isPlaying: true });
  });

  it("Play starts a one-shot from the beginning even while Playing is off, and pulses on consecutive frames each restart", () => {
    const h = harness({ duration: 0.5 });
    expect(h.step({ dt: 0.25 }).outputs.isPlaying).toBe(false);
    expect(h.step({ dt: 0.25, pulses: ["play"] }).outputs).toMatchObject({ isPlaying: true, currentTime: 0 });
    expect(h.step({ dt: 0.25 }).outputs.currentTime).toBe(0.25);
    expect(h.step({ dt: 0.25, pulses: ["play"] }).outputs.currentTime).toBe(0);
    h.step({ dt: 0.25 });
    const done = h.step({ dt: 0.25 });
    expect(done.pulses.has("finished")).toBe(true);
    expect(done.outputs.isPlaying).toBe(false);
    expect(h.run(4, { dt: 0.25 }).outputs.isPlaying).toBe(false);
  });

  it("Reset beats Play, stops a one-shot, and while Playing is on continues from the start", () => {
    const h = harness({ duration: 2 });
    h.step({ dt: 0.25, pulses: ["play"] });
    h.step({ dt: 0.25 });
    const reset = h.step({ dt: 0.25, pulses: ["reset", "play"] });
    expect(reset.outputs).toMatchObject({ currentTime: 0, isPlaying: false });
    h.set({ playing: true });
    h.run(3, { dt: 0.25 });
    const again = h.step({ dt: 0.25, pulses: ["reset"] });
    expect(again.outputs).toMatchObject({ currentTime: 0, isPlaying: true });
  });

  it("with Loop on, starts over at the end and pulses Finished each time", () => {
    const h = harness({ duration: 0.5, inputs: { playing: true, loop: true, rate: 2 } });
    h.step({ dt: 0.1 });
    let finishes = 0;
    for (let i = 0; i < 10; i++) if (h.step({ dt: 0.1 }).pulses.has("finished")) finishes++;
    expect(finishes).toBe(4);
    expect(h.output("isPlaying")).toBe(true);
    expect(h.output("currentTime") as number).toBeLessThan(0.5);
  });

  it("while Duration is unknown, the playhead advances but never finishes and Progress is 0", () => {
    const h = harness({ inputs: { playing: true } });
    const f = h.run(120);
    expect(f.outputs).toMatchObject({ duration: 0, progress: 0, isPlaying: true });
    expect(f.outputs.currentTime as number).toBeCloseTo(119 / 60, 9);
  });

  it("a new Sound starts over at 0 and a finished one-shot doesn't replay", () => {
    const h = harness({ duration: 0.25 });
    h.step({ dt: 0.25, pulses: ["play"] });
    h.step({ dt: 0.25 });
    const next = h.step({ dt: 0.25, inputs: { sound: { assetId: "ding" } } });
    expect(next.outputs).toMatchObject({ currentTime: 0, isPlaying: false });
  });

  it("treats a Metering handle as empty with one warning, and bad options use their defaults with one warning each", () => {
    const live = harness({ inputs: { sound: { url: "sonobe-live:microphone/main/mic" }, playing: true } });
    expect(live.run(3).outputs.isPlaying).toBe(false);
    expect(live.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    const bad = harness({ inputs: { playing: true, rate: Number.NaN, volume: Number.POSITIVE_INFINITY } });
    bad.run(3);
    expect(bad.logs.filter((l) => l.level === "warn")).toHaveLength(2);
  });

  it("drives the contract audio service with play and stop on audible edges", () => {
    const calls: unknown[][] = [];
    const audio = { play: (key: string, id: string, o: unknown) => calls.push(["play", key, id, o]), stop: (key: string) => calls.push(["stop", key]), currentTime: () => 0 };
    const h = harness({ duration: 1, platform: { audio } });
    h.step({ pulses: ["play"], inputs: { volume: 0.5 } });
    h.step();
    h.step({ pulses: ["play"] });
    h.step({ pulses: ["reset"] });
    expect(calls).toEqual([
      ["play", "main/patch_1#0", "chime", { loop: false, volume: 0.5, rate: 1 }],
      ["stop", "main/patch_1#0"],
      ["play", "main/patch_1#0", "chime", { loop: false, volume: 0.5, rate: 1 }],
      ["stop", "main/patch_1#0"],
    ]);
    expect(h.logs).toEqual([]);
  });

  it("drives the proposed audio service: resume from position, seek, live updates, and the platform clock", () => {
    const { calls, voices, audio } = fakeExtendedAudio();
    const key = "main/patch_1#0";
    const h = harness({ platform: { audio }, inputs: { playing: true } });
    const start = h.step();
    expect(calls).toEqual([["play", key, "chime", 0]]);
    expect(start.outputs.isPlaying).toBe(false);
    voices.set(key, { status: "playing", currentTime: 0.4, duration: 2, ended: false, loops: 0 });
    expect(h.step().outputs).toMatchObject({ isPlaying: true, currentTime: 0.4, duration: 2, progress: 0.2 });
    h.step({ inputs: { volume: 0.3 } });
    expect(calls.at(-1)).toEqual(["update", key, 0.3]);
    h.step({ pulses: ["reset"] });
    expect(calls.at(-1)).toEqual(["seek", key, 0]);
    voices.set(key, { status: "paused", currentTime: 1.2, duration: 2, ended: false, loops: 0 });
    h.step({ inputs: { playing: false } });
    expect(calls.at(-1)).toEqual(["pause", key]);
    h.step({ inputs: { playing: true } });
    expect(calls.at(-1)).toEqual(["play", key, "chime", 1.2]);
    voices.set(key, { status: "ended", currentTime: 2, duration: 2, ended: true, loops: 0 });
    const done = h.step();
    expect(done.pulses.has("finished")).toBe(true);
    expect(done.outputs).toMatchObject({ currentTime: 2, progress: 1, isPlaying: false });
  });

  it("a voice that fails to load warns once and behaves as empty", () => {
    const { voices, audio } = fakeExtendedAudio();
    const h = harness({ platform: { audio }, inputs: { playing: true } });
    h.step();
    voices.set("main/patch_1#0", { status: "error", currentTime: 0, duration: 0, ended: false, loops: 0 });
    const f = h.run(3);
    expect(f.outputs).toMatchObject({ isPlaying: false, metering: null, currentTime: 0 });
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("plays one voice per loop index, at most 32 at once", () => {
    const calls: string[] = [];
    const audio = { play: (key: string) => calls.push(key), stop: () => {}, currentTime: () => 0 };
    const sounds = loopOf(Array.from({ length: MAX_VOICES + 2 }, (_, i) => ({ assetId: `s${i}` })));
    const h = harness({ platform: { audio }, inputs: { sound: sounds, playing: true } });
    const f = h.step();
    expect(calls).toHaveLength(MAX_VOICES);
    expect(new Set(calls).size).toBe(MAX_VOICES);
    expect((f.outputs.isPlaying as { items: boolean[] }).items.every(Boolean)).toBe(true);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("stops every voice while muted and on dispose", () => {
    const stops: string[] = [];
    const audio = { play: () => {}, stop: (key: string) => stops.push(key), currentTime: () => 0 };
    const h = harness({ platform: { audio }, inputs: { playing: true } });
    h.step();
    h.node.muted = true;
    expect(h.step().outputs).toEqual({ currentTime: 0, duration: 0, progress: 0, isPlaying: false, metering: null });
    expect(stops).toEqual(["main/patch_1#0"]);
    h.node.muted = false;
    h.step();
    h.dispose();
    expect(stops).toEqual(["main/patch_1#0", "main/patch_1#0"]);
  });
});
