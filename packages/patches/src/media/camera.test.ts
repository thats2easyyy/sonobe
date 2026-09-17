import type { AssetRef } from "@sonobe/core";
import type { PatchDefinition } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { cameraPatch } from "./camera.ts";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The definition with a switch for `ctx.muted`, so a test can mute a running patch. */
function muteSwitch<S>(definition: PatchDefinition<S>) {
  let muted = false;
  const switched: PatchDefinition<S> = { ...definition, evaluate: (ctx) => definition.evaluate(Object.create(ctx, { muted: { get: () => muted } })) };
  return { definition: switched, mute: (on: boolean) => void (muted = on) };
}

interface Deferred<T> {
  resolve(value: T): void;
  reject(error: unknown): void;
}

function fakeMedia() {
  const log: unknown[][] = [];
  const opens: Deferred<AssetRef>[] = [];
  const captures: Deferred<AssetRef>[] = [];
  const recordings: Deferred<AssetRef | null>[] = [];
  const released: string[] = [];
  const deferred = <T>(list: Deferred<T>[]) => new Promise<T>((resolve, reject) => list.push({ resolve, reject }));
  const media = {
    openCamera: (key: string, options: unknown) => {
      log.push(["open", key, options]);
      return deferred(opens);
    },
    close: (key: string) => log.push(["close", key]),
    captureFrame: (key: string) => {
      log.push(["capture", key]);
      return deferred(captures);
    },
    startRecording: (key: string, options: unknown) => log.push(["record", key, options]),
    stopRecording: (key: string) => {
      log.push(["stopRecording", key]);
      return deferred(recordings);
    },
  };
  const platform = { media, releaseMedia: (ref: AssetRef) => released.push(ref.url ?? "") };
  return { log, opens, captures, recordings, released, platform };
}

async function liveCamera(inputs: Record<string, unknown> = {}) {
  const m = fakeMedia();
  const { definition, mute } = muteSwitch(cameraPatch);
  const h = createPatchHarness(definition, { inputs: { enabled: true, ...inputs }, services: { platform: m.platform as never } });
  h.step();
  m.opens[0]!.resolve({ live: "camera/main/patch_1" });
  await flush();
  h.step();
  return { ...m, h, mute };
}

describe("camera", () => {
  it("stays idle with Enabled off, and logs once where there's no camera", () => {
    const h = createPatchHarness(cameraPatch);
    expect(h.step().outputs).toEqual({ stream: null, image: null, video: null, available: false });
    expect(h.logs).toEqual([]);
    h.run(3, { inputs: { enabled: true } });
    expect(h.logs.map((l) => [l.level, l.message])).toEqual([["log", "camera: no camera in this host"]]);
    expect(h.output("available")).toBe(false);
  });

  it("opens the camera on frame 0, then goes live with a stream", async () => {
    const m = fakeMedia();
    const h = createPatchHarness(cameraPatch, { inputs: { enabled: true, camera: "front", quality: "high" }, services: { platform: m.platform as never } });
    const f0 = h.step();
    expect(m.log).toEqual([["open", "main/patch_1", { facing: "front", quality: "high" }]]);
    expect(f0.outputs).toMatchObject({ available: false, stream: null });
    expect(f0.requestedNextFrame).toBe(true);
    m.opens[0]!.resolve({ live: "camera/main/patch_1" });
    await flush();
    expect(h.step().outputs).toMatchObject({ available: true, stream: { live: "camera/main/patch_1" } });
  });

  it("captures photos while live and warns once when Capture arrives before the camera runs", async () => {
    const m = fakeMedia();
    const h = createPatchHarness(cameraPatch, { inputs: { enabled: true }, services: { platform: m.platform as never } });
    h.step({ pulses: ["capture"] });
    h.step({ pulses: ["capture"] });
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    m.opens[0]!.resolve({ live: "camera/x" });
    await flush();
    h.step({ pulses: ["capture"] });
    m.captures[0]!.resolve({ url: "blob:photo1" });
    await flush();
    const f = h.step();
    expect(f.pulses.has("captured")).toBe(true);
    expect(f.outputs.image).toEqual({ url: "blob:photo1" });
    h.step({ pulses: ["capture"] });
    m.captures[1]!.resolve({ url: "blob:photo2" });
    await flush();
    h.step();
    expect(m.released).toEqual(["blob:photo1"]);
  });

  it("records while Recording is on and delivers the clip with Recorded", async () => {
    const { h, log, recordings } = await liveCamera({ recordAudio: true });
    h.step({ inputs: { recording: true } });
    expect(log.at(-1)).toEqual(["record", "main/patch_1", { audio: true }]);
    h.step({ inputs: { recording: false } });
    expect(log.at(-1)).toEqual(["stopRecording", "main/patch_1"]);
    recordings[0]!.resolve({ url: "blob:clip" });
    await flush();
    const f = h.step();
    expect(f.pulses.has("recorded")).toBe(true);
    expect(f.outputs.video).toEqual({ url: "blob:clip" });
    h.step({ inputs: { recording: true } });
    h.step({ inputs: { recording: false } });
    recordings[1]!.resolve(null);
    await flush();
    expect(h.step().pulses.has("recorded")).toBe(false);
  });

  it("switching cameras finishes the recording and reopens, keeping the previous feed until the new one is live", async () => {
    const { h, log, opens } = await liveCamera({ recording: true });
    const f = h.step({ inputs: { camera: "front" } });
    expect(log.slice(-2)).toEqual([["stopRecording", "main/patch_1"], ["open", "main/patch_1", { facing: "front", quality: "medium" }]]);
    expect(f.outputs).toMatchObject({ available: false, stream: { live: "camera/main/patch_1" } });
    opens[1]!.resolve({ live: "camera/front" });
    await flush();
    expect(h.step().outputs).toMatchObject({ available: true, stream: { live: "camera/front" } });
    expect(log.at(-1)).toEqual(["record", "main/patch_1", { audio: false }]);
  });

  it("a failed session warns once, doesn't retry until Enabled toggles, and drops superseded sessions", async () => {
    const m = fakeMedia();
    const h = createPatchHarness(cameraPatch, { inputs: { enabled: true }, services: { platform: m.platform as never } });
    h.step();
    h.step({ inputs: { quality: "low" } });
    m.opens[0]!.resolve({ live: "camera/old" });
    m.opens[1]!.reject(new Error("Camera permission was denied."));
    await flush();
    const f = h.run(3);
    expect(f.outputs).toMatchObject({ available: false, stream: null });
    expect(h.logs.filter((l) => l.level === "warn").map((l) => l.message)).toEqual(["camera: Camera permission was denied."]);
    expect(m.opens).toHaveLength(2);
    h.step({ inputs: { enabled: false } });
    h.step({ inputs: { enabled: true } });
    expect(m.opens).toHaveLength(3);
  });

  it("disabling releases the camera and keeps the latest photo", async () => {
    const { h, log, captures } = await liveCamera();
    h.step({ pulses: ["capture"] });
    captures[0]!.resolve({ url: "blob:photo" });
    await flush();
    h.step();
    const off = h.step({ inputs: { enabled: false } });
    expect(log.at(-1)).toEqual(["close", "main/patch_1"]);
    expect(off.outputs).toEqual({ stream: null, image: { url: "blob:photo" }, video: null, available: false });
  });

  it("releases the camera while muted and on dispose", async () => {
    const muted = await liveCamera();
    muted.mute(true);
    expect(muted.h.step().outputs).toEqual({ stream: null, image: null, video: null, available: false });
    expect(muted.log.at(-1)).toEqual(["close", "main/patch_1"]);

    const disposed = await liveCamera({ recording: true });
    disposed.h.step();
    disposed.h.dispose();
    expect(disposed.log.slice(-2)).toEqual([["stopRecording", "main/patch_1"], ["close", "main/patch_1"]]);
  });

  it("runs one camera per instance: a looped input uses its first item and every index mirrors it", async () => {
    const m = fakeMedia();
    const h = createPatchHarness(cameraPatch, { inputs: { enabled: loopOf([true, false, true]) }, services: { platform: m.platform as never } });
    h.step();
    expect(m.opens).toHaveLength(1);
    m.opens[0]!.resolve({ live: "camera/one" });
    await flush();
    const f = h.step();
    expect(f.outputs.available).toEqual(loopOf([true, true, true]));
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });
});
