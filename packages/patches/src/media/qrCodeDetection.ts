/**
 * QR Code Detection: finds QR codes in an Image or Video layer through the host's barcode detector
 * and outputs loops of messages and corners in reading order. Without a detector every output is
 * idle and Available is false.
 */

import type { LayerRef } from "@sonobe/core";
import type { PatchContext } from "@sonobe/engine";
import { definePatch, logOnce, loopOf, toBool, warnOnce } from "../infra/index.ts";
import { clearDetection, createDetectionState, finitePoint, maybeStartPass, takePass } from "./detection.ts";
import type { DetectionState, Point } from "./detection.ts";
import { enumOr, isLayerRef, layerKey, layerTypeOf, warnLoopedInputs } from "./shared.ts";

interface QrCode {
  message: string;
  /** Clockwise from the code's own top-left: top-left, top-right, bottom-right, bottom-left. */
  corners: [Point, Point, Point, Point];
}

const LOOP_OUTPUTS = ["message", "topLeft", "topRight", "bottomLeft", "bottomRight"];

/** Detector results as codes sorted in reading order (Top Left y, then x). */
export function readingOrder(items: readonly unknown[]): QrCode[] {
  const codes: QrCode[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const v = item as Record<string, unknown>;
    const corners = Array.isArray(v.corners) ? v.corners : [];
    codes.push({
      message: typeof v.message === "string" ? v.message : "",
      corners: [finitePoint(corners[0]), finitePoint(corners[1]), finitePoint(corners[2]), finitePoint(corners[3])],
    });
  }
  return codes.sort((a, b) => a.corners[0][1] - b.corners[0][1] || a.corners[0][0] - b.corners[0][0]);
}

function outputIdle(ctx: PatchContext, available: boolean): void {
  ctx.output("qrDetected", false);
  ctx.output("count", 0);
  for (const key of LOOP_OUTPUTS) ctx.output(key, loopOf([]));
  ctx.output("available", available);
}

export const qrCodeDetectionPatch = definePatch<DetectionState<QrCode>>("qrCodeDetection", {
  mutedBehavior: "zero",
  state: () => createDetectionState<QrCode>(),
  evaluate(ctx) {
    const s = ctx.state;
    warnLoopedInputs(ctx, ["layer", "enabled", "quality"], "qrCodeDetection");
    const detect = ctx.services.platform.detect;
    const raw = ctx.input("layer");
    const ref: LayerRef | null = isLayerRef(raw) ? raw : null;
    if (typeof detect?.qrCodes !== "function") {
      logOnce(ctx, "log", "noDetector", "qrCodeDetection: this platform can't detect QR codes, so QR Code Detection outputs nothing.");
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
      warnOnce(ctx, "layerType", "qrCodeDetection: Layer isn't an Image or Video layer, so there's nothing to scan.");
      clearDetection(s);
      outputIdle(ctx, true);
      return;
    }
    const pass = takePass(s);
    if (pass) {
      if (pass.ok) s.results = readingOrder(pass.items);
      else warnOnce(ctx, `pass:${pass.message}`, `qrCodeDetection: ${pass.message}`);
    }
    const high = enumOr(ctx.input("quality"), ["low", "high"] as const, "low") === "high";
    maybeStartPass(ctx, s, ref, high, () => detect.qrCodes!(ref, { maxDimension: high ? Number.POSITIVE_INFINITY : 640 }));
    ctx.requestNextFrame();
    const codes = s.results;
    ctx.output("qrDetected", codes.length > 0);
    ctx.output("count", codes.length);
    ctx.output("message", loopOf(codes.map((c) => c.message)));
    ctx.output("topLeft", loopOf(codes.map((c) => [...c.corners[0]])));
    ctx.output("topRight", loopOf(codes.map((c) => [...c.corners[1]])));
    ctx.output("bottomLeft", loopOf(codes.map((c) => [...c.corners[3]])));
    ctx.output("bottomRight", loopOf(codes.map((c) => [...c.corners[2]])));
    ctx.output("available", true);
  },
  dispose(state) {
    if (state) clearDetection(state);
  },
});
