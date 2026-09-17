import type { AssetRef } from "@sonobe/core";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import type { PickedMedia } from "@sonobe/engine";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { photoPickerPatch, toPickedMedia } from "./photoPicker.ts";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const photo = (n: number): PickedMedia => ({ kind: "image", image: { url: `blob:photo${n}` }, video: null, width: 400 + n, height: 300, name: `IMG_${n}.jpg` });
const clip = (n: number): PickedMedia => ({ kind: "video", image: { url: `blob:still${n}` }, video: { url: `blob:clip${n}` }, width: 1080, height: 1920, name: `VID_${n}.mov` });

function picker() {
  const requests: { options: unknown; resolve: (files: PickedMedia[]) => void; reject: (error: unknown) => void }[] = [];
  const released: string[] = [];
  const platform = {
    pickMedia: (options: unknown) => new Promise<PickedMedia[]>((resolve, reject) => requests.push({ options, resolve, reject })),
    releaseMedia: (ref: AssetRef) => released.push(ref.url ?? ""),
  };
  const h = createPatchHarness(photoPickerPatch, { services: { platform: platform as never } });
  return { h, requests, released };
}

describe("toPickedMedia", () => {
  it("accepts well-formed items and drops others", () => {
    expect(toPickedMedia(photo(1))).toEqual(photo(1));
    expect(toPickedMedia({ kind: "image", image: null, video: null })).toBeUndefined();
    expect(toPickedMedia({ kind: "audio", image: { url: "x" } })).toBeUndefined();
    expect(toPickedMedia({ kind: "image", image: { url: "x" }, video: { url: "y" }, width: Number.NaN })).toEqual({ kind: "image", image: { url: "x" }, video: null, width: 0, height: 0, name: "" });
  });
});

describe("photoPicker", () => {
  it("starts empty, and logs once where there's no picker", () => {
    const h = createPatchHarness(photoPickerPatch);
    expect(h.step({ pulses: ["open"] }).outputs).toEqual({ image: null, video: null, isVideo: false, naturalSize: [0, 0], images: loopOf([]), videos: loopOf([]), count: 0, loading: false, error: false, errorMessage: "" });
    h.step({ pulses: ["open"] });
    expect(h.logs.map((l) => l.message)).toEqual(["photoPicker: no file picker in simulation"]);
  });

  it("opens once while pending and applies the choice on a later frame with one Picked pulse", async () => {
    const { h, requests } = picker();
    const open = h.step({ pulses: ["open"], inputs: { mediaType: "all", multiple: true } });
    expect(open.outputs.loading).toBe(true);
    expect(open.requestedNextFrame).toBe(true);
    h.step({ pulses: ["open"] });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.options).toEqual({ accept: "all", multiple: true });
    requests[0]!.resolve([clip(1), photo(2)]);
    await flush();
    const f = h.step();
    expect(f.pulses.has("picked")).toBe(true);
    expect(f.outputs).toMatchObject({ image: { url: "blob:still1" }, video: { url: "blob:clip1" }, isVideo: true, naturalSize: [1080, 1920], count: 2, loading: false, error: false });
    expect(f.outputs.images).toEqual(loopOf([{ url: "blob:still1" }, { url: "blob:photo2" }]));
    expect(f.outputs.videos).toEqual(loopOf([{ url: "blob:clip1" }, null]));
    expect(h.step().pulses.has("picked")).toBe(false);
  });

  it("canceling changes nothing; a failure keeps the previous items and turns Error on", async () => {
    const { h, requests } = picker();
    h.step({ pulses: ["open"] });
    requests[0]!.resolve([photo(1)]);
    await flush();
    h.step();
    h.step({ pulses: ["open"] });
    requests[1]!.resolve([]);
    await flush();
    const canceled = h.step();
    expect(canceled.pulses.has("picked")).toBe(false);
    expect(canceled.outputs).toMatchObject({ count: 1, error: false });
    h.step({ pulses: ["open"] });
    requests[2]!.reject(new Error("The picker can only open right after a tap or click."));
    await flush();
    expect(h.step().outputs).toMatchObject({ count: 1, error: true, errorMessage: "The picker can only open right after a tap or click." });
  });

  it("drops files that don't match Media Type, honors Max Count only while Multiple is on, and warns once about extras", async () => {
    const { h, requests, released } = picker();
    h.step({ pulses: ["open"], inputs: { mediaType: "photos", multiple: true, maxCount: 2.9 } });
    requests[0]!.resolve([photo(1), clip(2), photo(3), photo(4)]);
    await flush();
    const f = h.step();
    expect(f.outputs.count).toBe(2);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    expect(released).toEqual(expect.arrayContaining(["blob:still2", "blob:clip2", "blob:photo4"]));
    h.step({ pulses: ["open"], inputs: { mediaType: "videos" } });
    requests[1]!.resolve([photo(9)]);
    await flush();
    expect(h.step().outputs).toMatchObject({ count: 2, error: true, errorMessage: "That file isn't a kind this picker accepts." });
    h.step({ pulses: ["open"], inputs: { mediaType: "all", multiple: false } });
    requests[2]!.resolve([photo(5), photo(6)]);
    await flush();
    expect(h.step().outputs.count).toBe(1);
  });

  it("Reset beats Open, clears everything, ignores a pending choice, and releases media", async () => {
    const { h, requests, released } = picker();
    h.step({ pulses: ["open"] });
    requests[0]!.resolve([photo(1)]);
    await flush();
    h.step();
    h.step({ pulses: ["open"] });
    const reset = h.step({ pulses: ["reset", "open"] });
    expect(reset.outputs).toMatchObject({ count: 0, loading: false, image: null });
    expect(requests).toHaveLength(2);
    expect(released).toContain("blob:photo1");
    requests[1]!.resolve([photo(7)]);
    await flush();
    expect(h.step().outputs.count).toBe(0);
    expect(released).toContain("blob:photo7");
  });

  it("warns once about looped inputs, releases on dispose, and outputs the frame 0 values while muted", async () => {
    const { h, requests, released } = picker();
    h.step({ pulses: ["open"], inputs: { multiple: loopOf([true, false]) } });
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    requests[0]!.resolve([photo(1)]);
    await flush();
    h.step();
    h.dispose();
    expect(released).toContain("blob:photo1");
    const muted = runPatch(photoPickerPatch, [{ maxCount: 50, multiple: true }], { muted: true });
    expect(muted.frames[0]!.outputs).toMatchObject({ count: 0, isVideo: false, images: loopOf([]), naturalSize: [0, 0] });
  });
});
