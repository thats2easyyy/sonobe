import type { LayerRef } from "@sonobe/core";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { assignTrackingIds, finiteBox, iou, largestFirst } from "./detection.ts";
import type { Box } from "./detection.ts";
import { faceDetectionPatch, sanitizeFaces } from "./faceDetection.ts";
import { handDetectionPatch, sanitizeHands } from "./handDetection.ts";
import { qrCodeDetectionPatch, readingOrder } from "./qrCodeDetection.ts";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("detection helpers", () => {
  it("computes intersection over union", () => {
    expect(iou([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
    expect(iou([0, 0, 10, 10], [5, 0, 10, 10])).toBeCloseTo(50 / 150, 10);
    expect(iou([0, 0, 10, 10], [20, 20, 5, 5])).toBe(0);
    expect(iou([0, 0, 0, 0], [0, 0, 0, 0])).toBe(0);
  });

  it("keeps tracking ids for overlapping results and never reuses ids", () => {
    const state = { nextId: 0 };
    const first = assignTrackingIds(state, [], largestFirst([{ box: [0, 0, 10, 10] as Box }, { box: [100, 100, 20, 20] as Box }]));
    expect(first.map((f) => f.id)).toEqual([0, 1]);
    expect(first[0]!.box).toEqual([100, 100, 20, 20]);
    const second = assignTrackingIds(state, first, largestFirst([{ box: [2, 1, 10, 10] as Box }, { box: [300, 0, 10, 10] as Box }]));
    expect(second.map((f) => f.id)).toEqual([1, 2]);
    expect(assignTrackingIds(state, second, [{ box: [500, 500, 5, 5] as Box }]).map((f) => f.id)).toEqual([3]);
  });

  it("sanitizes boxes", () => {
    expect(finiteBox([1, 2, -3, 4])).toEqual([1, 2, 0, 4]);
    expect(finiteBox([1, Number.NaN, 3, 4])).toBeUndefined();
    expect(finiteBox("x")).toBeUndefined();
  });
});

function detector<T>() {
  const requests: { layer: LayerRef; options: unknown; resolve: (items: T[]) => void; reject: (error: unknown) => void }[] = [];
  let frameId: number | undefined = 1;
  const run = (layer: LayerRef, options: unknown) => new Promise<T[]>((resolve, reject) => requests.push({ layer, options, resolve, reject }));
  const media = { close: () => {}, startRecording: () => {}, stopRecording: async () => null, frameId: () => frameId };
  return { requests, run, media, setFrame: (id: number | undefined) => (frameId = id) };
}

describe("faceDetection", () => {
  it("is idle with Available false where there's no detector, and logs once", () => {
    const h = createPatchHarness(faceDetectionPatch, { inputs: { layer: { layerId: "cam" } } });
    const f = h.run(2);
    expect(f.outputs).toMatchObject({ faceDetected: false, count: 0, facePosition: loopOf([]), trackingId: loopOf([]), available: false });
    expect(h.logs.filter((l) => l.level === "log")).toHaveLength(1);
  });

  it("runs passes on new frames at the quality's cadence and outputs faces largest first", async () => {
    const d = detector<unknown>();
    const h = createPatchHarness(faceDetectionPatch, { inputs: { layer: { layerId: "cam" }, maxFaces: 1.9 }, services: { platform: { detect: { faces: d.run }, media: d.media } as never } });
    expect(h.step({ dt: 0.05 }).outputs).toMatchObject({ available: true, count: 0 });
    expect(d.requests).toHaveLength(1);
    expect(d.requests[0]!.options).toEqual({ maxDimension: 640, positioning: "relative" });
    d.requests[0]!.resolve([
      { box: [0, 0, 10, 10], angle: 190 },
      { box: [50, 60, 40, 30], leftEye: [60, 70], mouth: [70, 80] },
    ]);
    await flush();
    d.setFrame(2);
    const f = h.step({ dt: 0.05 });
    expect(f.outputs).toMatchObject({
      faceDetected: true,
      count: 1,
      facePosition: loopOf([[50, 60]]),
      faceSize: loopOf([[40, 30]]),
      faceAngle: loopOf([0]),
      leftEyeDetected: loopOf([true]),
      leftEyePosition: loopOf([[60, 70]]),
      rightEyeDetected: loopOf([false]),
      rightEyePosition: loopOf([[0, 0]]),
      mouthPosition: loopOf([[70, 80]]),
      trackingId: loopOf([0]),
    });
    expect(d.requests).toHaveLength(1);
    h.step({ dt: 0.05 });
    expect(d.requests).toHaveLength(2);
    h.step({ dt: 0.05, inputs: { maxFaces: 5 } });
    expect(h.output("count")).toBe(2);
    expect(h.output("faceAngle")).toEqual(loopOf([0, -170]));
  });

  it("High quality runs on every new frame; no new frame means no pass", async () => {
    const d = detector<unknown>();
    const h = createPatchHarness(faceDetectionPatch, { inputs: { layer: { layerId: "cam" }, quality: "high" }, services: { platform: { detect: { faces: d.run }, media: d.media } as never } });
    h.step();
    d.requests[0]!.resolve([]);
    await flush();
    h.step();
    expect(d.requests).toHaveLength(1);
    d.setFrame(2);
    h.step();
    expect(d.requests).toHaveLength(2);
    expect(d.requests[1]!.options).toMatchObject({ maxDimension: Number.POSITIVE_INFINITY });
  });

  it("changing Layer or disabling drops the in-flight pass and clears outputs; failures keep results and warn once", async () => {
    const d = detector<unknown>();
    const h = createPatchHarness(faceDetectionPatch, { inputs: { layer: { layerId: "cam" }, quality: "high" }, services: { platform: { detect: { faces: d.run }, media: d.media } as never } });
    h.step();
    d.requests[0]!.resolve([{ box: [0, 0, 10, 10] }]);
    await flush();
    d.setFrame(2);
    expect(h.step().outputs.count).toBe(1);
    const moved = h.step({ inputs: { layer: { layerId: "photo" } } });
    expect(moved.outputs.count).toBe(0);
    d.requests[1]!.resolve([{ box: [0, 0, 1, 1] }]);
    d.requests[2]!.reject(new Error("The media blocks reading (CORS)."));
    await flush();
    d.setFrame(3);
    expect(h.step().outputs.count).toBe(0);
    expect(h.logs.filter((l) => l.level === "warn").map((l) => l.message)).toEqual(["faceDetection: The media blocks reading (CORS)."]);
    const off = h.step({ inputs: { enabled: false } });
    expect(off.outputs).toMatchObject({ count: 0, available: true });
  });

  it("warns once for a layer that isn't an image or video, sanitizes results, and outputs idle values while muted", () => {
    const d = detector<unknown>();
    const h = createPatchHarness(faceDetectionPatch, { inputs: { layer: { layerId: "box" } }, services: { platform: { detect: { faces: d.run }, media: d.media } as never, layerInfo: () => ({ type: "rectangle" }) as never } });
    h.run(2);
    expect(d.requests).toHaveLength(0);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    expect(sanitizeFaces([{ box: [1, 2, 3] }, null, { box: [0, 0, 5, 5], angle: -540, rightEye: [Number.NaN, 4] }])).toEqual([{ box: [0, 0, 5, 5], angle: -180, rightEye: [0, 4] }]);
    const muted = runPatch(faceDetectionPatch, [{ enabled: true, maxFaces: 10 }], { muted: true });
    expect(muted.frames[0]!.outputs).toMatchObject({ faceDetected: false, count: 0, available: false, facePosition: loopOf([]) });
  });
});

describe("handDetection", () => {
  it("sanitizes hands: 21 landmarks, a box from the landmarks, handedness, and confidence", () => {
    const [hand] = sanitizeHands([{ landmarks: [[10, 20], [30, 5], [20, 40]], confidence: 3 }, { box: [0, 0, 1, 1] }]);
    expect(hand!.landmarks).toHaveLength(21);
    expect(hand!.box).toEqual([10, 5, 20, 35]);
    expect(hand!.handedness).toBe("left");
    expect(hand!.confidence).toBe(1);
  });

  it("outputs fingertips, pinch distance, handedness, and landmarks per hand", async () => {
    const d = detector<unknown>();
    const landmarks = Array.from({ length: 21 }, (_, i) => [i, i * 2]);
    landmarks[4] = [0, 0];
    landmarks[8] = [3, 4];
    const h = createPatchHarness(handDetectionPatch, { inputs: { layer: { layerId: "cam" } }, services: { platform: { detect: { hands: d.run }, media: d.media } as never } });
    h.step();
    expect(d.requests[0]!.options).toEqual({ maxHands: 2, maxDimension: 640, positioning: "relative" });
    d.requests[0]!.resolve([{ box: [1, 2, 30, 40], handedness: "right", confidence: 0.9, landmarks }]);
    await flush();
    const f = h.step();
    expect(f.outputs).toMatchObject({
      handDetected: true,
      count: 1,
      handPosition: loopOf([[1, 2]]),
      handSize: loopOf([[30, 40]]),
      wrist: loopOf([[0, 0]]),
      thumbTip: loopOf([[0, 0]]),
      indexTip: loopOf([[3, 4]]),
      pinkyTip: loopOf([[20, 40]]),
      pinchDistance: loopOf([5]),
      handedness: loopOf(["right"]),
      confidence: loopOf([0.9]),
      trackingId: loopOf([0]),
      available: true,
    });
    expect((f.outputs.landmarks as { items: unknown[][] }).items[0]).toHaveLength(21);
  });

  it("is idle without a detector", () => {
    const h = createPatchHarness(handDetectionPatch, { inputs: { layer: { layerId: "cam" } } });
    expect(h.step().outputs).toMatchObject({ handDetected: false, count: 0, landmarks: loopOf([]), available: false });
  });
});

describe("qrCodeDetection", () => {
  it("sorts codes in reading order", () => {
    const codes = readingOrder([
      { message: "b", corners: [[50, 10], [60, 10], [60, 20], [50, 20]] },
      { message: "c", corners: [[0, 100], [10, 100], [10, 110], [0, 110]] },
      { message: "a", corners: [[5, 10], [15, 10], [15, 20], [5, 20]] },
      { corners: [[1, 200]] },
    ]);
    expect(codes.map((c) => c.message)).toEqual(["a", "b", "c", ""]);
    expect(codes[3]!.corners).toEqual([[1, 200], [0, 0], [0, 0], [0, 0]]);
  });

  it("outputs messages and corners, mapping the clockwise corner list to each output", async () => {
    const d = detector<unknown>();
    const h = createPatchHarness(qrCodeDetectionPatch, { inputs: { layer: { layerId: "cam" } }, services: { platform: { detect: { qrCodes: d.run }, media: d.media } as never } });
    h.step();
    d.requests[0]!.resolve([{ message: "https://sonobe.dev", corners: [[0, 0], [10, 0], [10, 10], [0, 10]] }]);
    await flush();
    expect(h.step().outputs).toEqual({
      qrDetected: true,
      count: 1,
      message: loopOf(["https://sonobe.dev"]),
      topLeft: loopOf([[0, 0]]),
      topRight: loopOf([[10, 0]]),
      bottomLeft: loopOf([[0, 10]]),
      bottomRight: loopOf([[10, 10]]),
      available: true,
    });
  });

  it("is idle with Available false without a detector, and while muted", () => {
    const h = createPatchHarness(qrCodeDetectionPatch, { inputs: { layer: { layerId: "cam" } } });
    expect(h.step().outputs).toMatchObject({ qrDetected: false, message: loopOf([]), available: false });
    const muted = runPatch(qrCodeDetectionPatch, [{ enabled: true }], { muted: true });
    expect(muted.frames[0]!.outputs).toMatchObject({ qrDetected: false, available: false });
  });
});
