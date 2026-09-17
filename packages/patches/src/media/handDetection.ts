/**
 * Hand Detection: finds hands in an Image or Video layer through the host's hand-landmark detector
 * and outputs loops of boxes, fingertips, pinch distance, handedness, confidence, landmarks, and
 * tracking IDs. Without a detector every output is idle and Available is false.
 */

import type { LayerRef } from "@sonobe/core";
import type { PatchContext } from "@sonobe/engine";
import { clamp01, definePatch, finiteOr, logOnce, loopOf, toBool, warnOnce } from "../infra/index.ts";
import { assignTrackingIds, clearDetection, createDetectionState, finiteBox, finitePoint, largestFirst, maybeStartPass, takePass } from "./detection.ts";
import type { Box, DetectionState, Point } from "./detection.ts";
import { layerTypeOf, mediaPlatform } from "./platform.ts";
import { clampInt, enumOr, isLayerRef, layerKey, warnLoopedInputs, withMutedBehavior } from "./shared.ts";

interface Hand {
  box: Box;
  handedness: "left" | "right";
  confidence: number;
  landmarks: Point[];
  id: number;
}

const LANDMARKS = 21;
const TIPS: readonly [string, number][] = [
  ["wrist", 0],
  ["thumbTip", 4],
  ["indexTip", 8],
  ["middleTip", 12],
  ["ringTip", 16],
  ["pinkyTip", 20],
];
const LOOP_OUTPUTS = ["handPosition", "handSize", ...TIPS.map(([key]) => key), "pinchDistance", "handedness", "confidence", "landmarks", "trackingId"];

/** Detector results as hands with 21 landmarks each; entries without landmarks are dropped. */
export function sanitizeHands(items: readonly unknown[]): Omit<Hand, "id">[] {
  const hands: Omit<Hand, "id">[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const v = item as Record<string, unknown>;
    if (!Array.isArray(v.landmarks) || v.landmarks.length === 0) continue;
    const given = v.landmarks as unknown[];
    const landmarks = Array.from({ length: LANDMARKS }, (_, i) => finitePoint(given[i]));
    let box = finiteBox(v.box);
    if (!box) {
      const present = landmarks.slice(0, Math.min(LANDMARKS, given.length));
      const xs = present.map((p) => p[0]);
      const ys = present.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      box = [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
    }
    hands.push({ box, handedness: v.handedness === "right" ? "right" : "left", confidence: clamp01(finiteOr(v.confidence, 0)), landmarks });
  }
  return hands;
}

function outputIdle(ctx: PatchContext, available: boolean): void {
  ctx.output("handDetected", false);
  ctx.output("count", 0);
  for (const key of LOOP_OUTPUTS) ctx.output(key, loopOf([]));
  ctx.output("available", available);
}

export const handDetectionPatch = withMutedBehavior(
  definePatch<DetectionState<Hand>>("handDetection", {
    state: () => createDetectionState<Hand>(),
    evaluate(ctx) {
      const s = ctx.state;
      warnLoopedInputs(ctx, ["layer", "enabled", "maxHands", "quality", "positioning"], "handDetection");
      const detect = mediaPlatform(ctx.services).detect;
      const raw = ctx.input("layer");
      const ref: LayerRef | null = isLayerRef(raw) ? raw : null;
      if (typeof detect?.hands !== "function") {
        logOnce(ctx, "log", "noDetector", "handDetection: this platform can't detect hands yet, so Hand Detection outputs nothing.");
        outputIdle(ctx, false);
        return;
      }
      const key = layerKey(ref);
      if (key !== s.layerKey) {
        s.layerKey = key;
        clearDetection(s);
      }
      if (!toBool(ctx.input("enabled")) || ref === null) {
        clearDetection(s);
        outputIdle(ctx, true);
        return;
      }
      const type = layerTypeOf(ctx, ref);
      if (type !== undefined && type !== "image" && type !== "video") {
        warnOnce(ctx, "layerType", "handDetection: Layer isn't an Image or Video layer, so there's nothing to search.");
        clearDetection(s);
        outputIdle(ctx, true);
        return;
      }
      const pass = takePass(s);
      if (pass) {
        if (pass.ok) s.results = assignTrackingIds(s, s.results, largestFirst(sanitizeHands(pass.items)));
        else warnOnce(ctx, `pass:${pass.message}`, `handDetection: ${pass.message}`);
      }
      const maxHands = clampInt(ctx.input("maxHands"), 2, 1, 8);
      const high = enumOr(ctx.input("quality"), ["low", "high"] as const, "low") === "high";
      const positioning = enumOr(ctx.input("positioning"), ["relative", "absolute"] as const, "relative");
      maybeStartPass(ctx, s, ref, high, () => detect.hands!(ref, { maxHands, maxDimension: high ? Number.POSITIVE_INFINITY : 640, positioning }));
      ctx.requestNextFrame();
      const hands = s.results.slice(0, maxHands);
      ctx.output("handDetected", hands.length > 0);
      ctx.output("count", hands.length);
      ctx.output("handPosition", loopOf(hands.map((h) => [h.box[0], h.box[1]])));
      ctx.output("handSize", loopOf(hands.map((h) => [h.box[2], h.box[3]])));
      for (const [output, index] of TIPS) ctx.output(output, loopOf(hands.map((h) => [...h.landmarks[index]!])));
      ctx.output("pinchDistance", loopOf(hands.map((h) => Math.hypot(h.landmarks[4]![0] - h.landmarks[8]![0], h.landmarks[4]![1] - h.landmarks[8]![1]))));
      ctx.output("handedness", loopOf(hands.map((h) => h.handedness)));
      ctx.output("confidence", loopOf(hands.map((h) => h.confidence)));
      ctx.output("landmarks", loopOf(hands.map((h) => h.landmarks.map((p) => [...p]))));
      ctx.output("trackingId", loopOf(hands.map((h) => h.id)));
      ctx.output("available", true);
    },
    dispose(state) {
      if (state) clearDetection(state);
    },
  }),
  "zero",
);
