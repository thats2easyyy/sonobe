/**
 * Face Detection: finds faces in an Image or Video layer through the host's detector and outputs
 * loops of boxes, tilt, eyes, mouth, and tracking IDs. Without a detector every output is idle and
 * Available is false.
 */

import type { LayerRef } from "@sonobe/core";
import type { PatchContext } from "@sonobe/engine";
import { clamp, definePatch, finiteOr, logOnce, loopOf, toBool, warnOnce } from "../infra/index.ts";
import { assignTrackingIds, clearDetection, createDetectionState, finiteBox, finitePoint, largestFirst, maybeStartPass, takePass } from "./detection.ts";
import type { Box, DetectionState, Point } from "./detection.ts";
import { clampInt, enumOr, isLayerRef, layerKey, layerTypeOf, warnLoopedInputs } from "./shared.ts";

interface Face {
  box: Box;
  angle: number;
  leftEye?: Point;
  rightEye?: Point;
  mouth?: Point;
  id: number;
}

const PARTS = ["leftEye", "rightEye", "mouth"] as const;
const LOOP_OUTPUTS = ["facePosition", "faceSize", "faceAngle", "leftEyeDetected", "leftEyePosition", "rightEyeDetected", "rightEyePosition", "mouthDetected", "mouthPosition", "trackingId"];

/** Detector results as faces; malformed entries are dropped. */
export function sanitizeFaces(items: readonly unknown[]): Omit<Face, "id">[] {
  const faces: Omit<Face, "id">[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const v = item as Record<string, unknown>;
    const box = finiteBox(v.box);
    if (!box) continue;
    const rawAngle = finiteOr(v.angle, 0);
    const face: Omit<Face, "id"> = { box, angle: clamp(((((rawAngle + 180) % 360) + 360) % 360) - 180, -180, 180) };
    for (const part of PARTS) if (Array.isArray(v[part])) face[part] = finitePoint(v[part]);
    faces.push(face);
  }
  return faces;
}

function outputIdle(ctx: PatchContext, available: boolean): void {
  ctx.output("faceDetected", false);
  ctx.output("count", 0);
  for (const key of LOOP_OUTPUTS) ctx.output(key, loopOf([]));
  ctx.output("available", available);
}

export const faceDetectionPatch = definePatch<DetectionState<Face>>("faceDetection", {
  mutedBehavior: "zero",
  state: () => createDetectionState<Face>(),
  evaluate(ctx) {
    const s = ctx.state;
    warnLoopedInputs(ctx, ["layer", "enabled", "maxFaces", "quality", "positioning"], "faceDetection");
    const detect = ctx.services.platform.detect;
    const raw = ctx.input("layer");
    const ref: LayerRef | null = isLayerRef(raw) ? raw : null;
    if (typeof detect?.faces !== "function") {
      logOnce(ctx, "log", "noDetector", "faceDetection: this platform can't detect faces yet, so Face Detection outputs nothing.");
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
      warnOnce(ctx, "layerType", "faceDetection: Layer isn't an Image or Video layer, so there's nothing to search.");
      clearDetection(s);
      outputIdle(ctx, true);
      return;
    }
    const pass = takePass(s);
    if (pass) {
      if (pass.ok) s.results = assignTrackingIds(s, s.results, largestFirst(sanitizeFaces(pass.items)));
      else warnOnce(ctx, `pass:${pass.message}`, `faceDetection: ${pass.message}`);
    }
    const maxFaces = clampInt(ctx.input("maxFaces"), 10, 1, 32);
    const high = enumOr(ctx.input("quality"), ["low", "high"] as const, "low") === "high";
    const positioning = enumOr(ctx.input("positioning"), ["relative", "absolute"] as const, "relative");
    maybeStartPass(ctx, s, ref, high, () => detect.faces!(ref, { maxDimension: high ? Number.POSITIVE_INFINITY : 640, positioning }));
    ctx.requestNextFrame();
    const faces = s.results.slice(0, maxFaces);
    ctx.output("faceDetected", faces.length > 0);
    ctx.output("count", faces.length);
    ctx.output("facePosition", loopOf(faces.map((f) => [f.box[0], f.box[1]])));
    ctx.output("faceSize", loopOf(faces.map((f) => [f.box[2], f.box[3]])));
    ctx.output("faceAngle", loopOf(faces.map((f) => f.angle)));
    for (const part of PARTS) {
      ctx.output(`${part}Detected`, loopOf(faces.map((f) => f[part] !== undefined)));
      ctx.output(`${part}Position`, loopOf(faces.map((f) => f[part] ?? [0, 0])));
    }
    ctx.output("trackingId", loopOf(faces.map((f) => f.id)));
    ctx.output("available", true);
  },
  dispose(state) {
    if (state) clearDetection(state);
  },
});
