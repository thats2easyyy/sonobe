import type { AssetRef } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createPatchHarness } from "../infra/index.ts";
import { microphonePatch } from "./microphone.ts";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeMedia() {
  const log: unknown[][] = [];
  const opens: { resolve: (ref: AssetRef) => void; reject: (error: unknown) => void }[] = [];
  const recordings: { resolve: (ref: AssetRef | null) => void }[] = [];
  const media = {
    openMicrophone: (key: string) => {
      log.push(["open", key]);
      return new Promise<AssetRef>((resolve, reject) => opens.push({ resolve, reject }));
    },
    close: (key: string) => log.push(["close", key]),
    startRecording: (key: string, options: unknown) => log.push(["record", key, options]),
    stopRecording: (key: string) => {
      log.push(["stopRecording", key]);
      return new Promise<AssetRef | null>((resolve) => recordings.push({ resolve }));
    },
  };
  return { log, opens, recordings, platform: { media } };
}

describe("microphone", () => {
  it("is idle with Enabled off, and logs once where there's no microphone", () => {
    const h = createPatchHarness(microphonePatch);
    expect(h.step().outputs).toEqual({ sound: null, metering: null, available: false });
    h.run(2, { inputs: { enabled: true } });
    expect(h.logs.map((l) => l.message)).toEqual(["microphone: no microphone in this host"]);
  });

  it("listens, exposes the live handle, records, and delivers the recording", async () => {
    const m = fakeMedia();
    const h = createPatchHarness(microphonePatch, { inputs: { enabled: true, recording: true }, services: { platform: m.platform as never } });
    const f0 = h.step();
    expect(f0.outputs.available).toBe(false);
    expect(m.log).toEqual([["open", "main/patch_1"]]);
    m.opens[0]!.resolve({ url: "sonobe-live:microphone/main/patch_1" });
    await flush();
    const live = h.step();
    expect(live.outputs).toMatchObject({ available: true, metering: { url: "sonobe-live:microphone/main/patch_1" } });
    expect(m.log.at(-1)).toEqual(["record", "main/patch_1", { audio: true }]);
    h.step({ inputs: { recording: false } });
    m.recordings[0]!.resolve({ url: "blob:voice" });
    await flush();
    const done = h.step();
    expect(done.pulses.has("recorded")).toBe(true);
    expect(done.outputs.sound).toEqual({ url: "blob:voice" });
  });

  it("a denied permission warns once and doesn't retry until Enabled toggles; disabling releases and keeps Sound", async () => {
    const m = fakeMedia();
    const h = createPatchHarness(microphonePatch, { inputs: { enabled: true }, services: { platform: m.platform as never } });
    h.step();
    m.opens[0]!.reject(new Error("Microphone permission was denied."));
    await flush();
    expect(h.run(3).outputs).toMatchObject({ available: false, metering: null });
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    expect(m.opens).toHaveLength(1);
    h.step({ inputs: { enabled: false } });
    h.step({ inputs: { enabled: true } });
    m.opens[1]!.resolve({ url: "sonobe-live:microphone/x" });
    await flush();
    h.step();
    h.step({ inputs: { enabled: false } });
    expect(m.log.at(-1)).toEqual(["close", "main/patch_1"]);
  });

  it("releases the microphone while muted and on dispose", async () => {
    const m = fakeMedia();
    const h = createPatchHarness(microphonePatch, { inputs: { enabled: true }, services: { platform: m.platform as never } });
    h.step();
    m.opens[0]!.resolve({ url: "sonobe-live:microphone/x" });
    await flush();
    h.step();
    h.node.muted = true;
    expect(h.step().outputs).toEqual({ sound: null, metering: null, available: false });
    expect(m.log.at(-1)).toEqual(["close", "main/patch_1"]);
    h.node.muted = false;
    h.step();
    m.opens[1]!.resolve({ url: "sonobe-live:microphone/y" });
    await flush();
    h.step();
    h.dispose();
    expect(m.log.at(-1)).toEqual(["close", "main/patch_1"]);
  });
});
