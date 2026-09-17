/**
 * Video Info: a Video layer's current time, duration, progress, and natural size, as resolved for
 * the previous frame, through the host's layer output reader. Stateless.
 */

import { definePatch, finiteOr, logOnce, warnOnce } from "../infra/index.ts";
import { isLayerRef, layerTypeOf } from "./shared.ts";

function validSize(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const [w, h] = value;
  return typeof w === "number" && typeof h === "number" && Number.isFinite(w) && Number.isFinite(h) && w >= 0 && h >= 0 ? [w, h] : undefined;
}

export const videoInfoPatch = definePatch("videoInfo", {
  mutedBehavior: "zero",
  evaluate(ctx) {
    const raw = ctx.input("layer");
    const ref = isLayerRef(raw) ? raw : null;
    let t = 0;
    let d = 0;
    let size: [number, number] = [0, 0];
    if (ref !== null) {
      const type = layerTypeOf(ctx, ref);
      const read = ctx.services.layerOutput;
      if (type !== undefined && type !== "video") {
        warnOnce(ctx, "notVideo", "videoInfo: Layer isn't a Video layer, so Video Info outputs zeros.");
      } else if (!read) {
        logOnce(ctx, "log", "noLayerOutput", "videoInfo: this host can't read Video layer times yet, so Video Info outputs zeros. Link the layer's Current Time output directly instead.");
      } else {
        const get = (key: string) => {
          try {
            return read.call(ctx.services, ref, key);
          } catch {
            return undefined;
          }
        };
        t = Math.max(0, finiteOr(get("currentTime"), 0));
        d = Math.max(0, finiteOr(get("duration"), 0));
        size = validSize(get("naturalSize")) ?? [0, 0];
      }
    }
    ctx.output("currentTime", t);
    ctx.output("duration", d);
    ctx.output("progress", d > 0 ? Math.min(t / d, 1) : 0);
    ctx.output("naturalSize", size);
  },
});
