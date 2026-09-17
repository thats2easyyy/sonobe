/**
 * Object Detection: finds standout regions in an Image or Video layer by running spectral residual
 * saliency on the layer's pixels (at most 10 passes per second, only on new frames), and maps them
 * into the layer's parent space.
 */

import type { LayerRef } from "@sonobe/core";
import type { PatchContext } from "@sonobe/engine";
import { definePatch, finiteOr, logOnce, loopOf, toBool, warnOnce } from "../infra/index.ts";
import { layerTypeOf, mediaPlatform } from "./platform.ts";
import type { PixelReading } from "./platform.ts";
import { grayGrid, saliencyMap, saliencyRegions } from "./saliency.ts";
import type { Region } from "./saliency.ts";
import { enumOr, isLayerRef, layerKey, warnLoopedInputs, withMutedBehavior } from "./shared.ts";

interface ObjectState {
  regions: Region[];
  lastRun: number;
  lastFrame: number | null;
  lastMode: string | null;
  error: string;
  layerKey: string;
}

const pair = (value: unknown, fallback: [number, number]): [number, number] => {
  if (!Array.isArray(value)) return fallback;
  return [finiteOr(value[0], fallback[0]), finiteOr(value[1], fallback[1])];
};

/**
 * Picture-pixel regions in the layer's parent space: `local = contentRect.origin + p × contentRect.size / contentSize`,
 * then `parent = position − anchor × size × scale + local × scale` with previous-frame geometry.
 */
export function toParentSpace(ctx: PatchContext, layer: LayerRef, px: PixelReading, regions: readonly Region[]): Region[] {
  const [cw, ch] = pair(px.contentSize, [0, 0]);
  if (!(cw > 0 && ch > 0)) return [];
  const rect = Array.isArray(px.contentRect) ? px.contentRect : [0, 0, cw, ch];
  const [rx, ry, rw, rh] = [finiteOr(rect[0], 0), finiteOr(rect[1], 0), finiteOr(rect[2], cw), finiteOr(rect[3], ch)];
  const sx = rw / cw;
  const sy = rh / ch;
  let info;
  try {
    info = ctx.services.layerInfo(layer);
  } catch {
    info = undefined;
  }
  const [x0, y0] = pair(info?.position, [0, 0]);
  const [ax, ay] = pair(info?.anchor, [0, 0]);
  const [w, h] = pair(info?.size, [rw, rh]);
  const [kx, ky] = pair(info?.scale, [1, 1]);
  const ox = x0 - ax * w * kx;
  const oy = y0 - ay * h * ky;
  return regions.map(([x, y, rwidth, rheight]) => [ox + (rx + x * sx) * kx, oy + (ry + y * sy) * ky, rwidth * sx * kx, rheight * sy * ky].map((n) => finiteOr(n, 0)) as Region);
}

function outputIdle(ctx: PatchContext, available: boolean, error: string): void {
  ctx.output("regionDetected", false);
  ctx.output("count", 0);
  ctx.output("position", loopOf([]));
  ctx.output("size", loopOf([]));
  ctx.output("available", available);
  ctx.output("error", error !== "");
  ctx.output("errorMessage", error);
}

export const objectDetectionPatch = withMutedBehavior(
  definePatch<ObjectState>("objectDetection", {
    state: () => ({ regions: [], lastRun: Number.NEGATIVE_INFINITY, lastFrame: null, lastMode: null, error: "", layerKey: "" }),
    evaluate(ctx) {
      const s = ctx.state;
      warnLoopedInputs(ctx, ["layer", "enabled", "mode"], "objectDetection");
      const media = mediaPlatform(ctx.services).media;
      const canRead = typeof media?.readPixels === "function";
      const raw = ctx.input("layer");
      const ref: LayerRef | null = isLayerRef(raw) ? raw : null;
      const mode = enumOr(ctx.input("mode"), ["objects", "attention"] as const, "objects");
      const key = layerKey(ref);
      if (key !== s.layerKey) {
        s.layerKey = key;
        s.regions = [];
        s.lastFrame = null;
        s.lastRun = Number.NEGATIVE_INFINITY;
      }
      if (ctx.node.muted || !toBool(ctx.input("enabled")) || ref === null) {
        s.regions = [];
        s.lastFrame = null;
        s.error = "";
        outputIdle(ctx, canRead, "");
        return;
      }
      if (!canRead) {
        logOnce(ctx, "log", "noPixels", "objectDetection: this host can't read pixels, so Object Detection outputs nothing.");
        outputIdle(ctx, false, "This host can't read pixels.");
        return;
      }
      const type = layerTypeOf(ctx, ref);
      if (type !== undefined && type !== "image" && type !== "video") {
        warnOnce(ctx, "layerType", "objectDetection: Layer isn't an Image or Video layer, so there's nothing to search.");
        s.regions = [];
        s.lastFrame = null;
        outputIdle(ctx, true, "");
        return;
      }
      if (mode !== s.lastMode) {
        s.lastMode = mode;
        s.lastFrame = null;
      }
      if (ctx.time - s.lastRun >= 0.1) {
        let px: PixelReading | undefined;
        try {
          px = media!.readPixels!(ref, 256);
        } catch {
          px = undefined;
        }
        if (!px) {
          s.error = "The layer's pixels can't be read yet, or the media blocks reading (CORS).";
        } else if (px.frameId !== s.lastFrame) {
          s.lastRun = ctx.time;
          s.lastFrame = px.frameId;
          s.error = "";
          const contentSize = pair(px.contentSize, [0, 0]);
          s.regions = toParentSpace(ctx, ref, px, saliencyRegions(saliencyMap(grayGrid(px)), mode, contentSize));
        }
      }
      ctx.requestNextFrame();
      ctx.output("regionDetected", s.regions.length > 0);
      ctx.output("count", s.regions.length);
      ctx.output("position", loopOf(s.regions.map((r) => [r[0], r[1]])));
      ctx.output("size", loopOf(s.regions.map((r) => [r[2], r[3]])));
      ctx.output("available", true);
      ctx.output("error", s.error !== "");
      ctx.output("errorMessage", s.error);
    },
  }),
  "evaluate",
);
