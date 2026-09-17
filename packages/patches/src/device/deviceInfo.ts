/**
 * Device Info: the host's device snapshot (screen size, safe area, scale, orientation, input style,
 * appearance, name), read fresh every frame. Stateless.
 */

import type { DeviceInfo } from "@sonobe/engine";
import { definePatch } from "../infra/index.ts";
import { findPreset, finiteVector, normalizeDegrees, orientationAngleOf } from "./shared.ts";

/** Physical rotation in degrees: the host's `orientationAngle`, else portrait 0 and landscape 90. */
export function orientationAngle(device: DeviceInfo): number {
  const angle = orientationAngleOf(device);
  if (angle !== undefined) return normalizeDegrees(angle);
  return device.orientation === "landscape" ? 90 : 0;
}

export const deviceInfoPatch = definePatch("deviceInfo", {
  evaluate(ctx) {
    const d = ctx.services.device();
    const preset = findPreset(d.preset);
    const nonFinite = "Device Info: the host reported a screen size or safe area that isn't a finite number, so it reads 0.";
    const [w, h] = finiteVector(ctx, d.screenSize, 2, "nonFinite", nonFinite) as [number, number];
    ctx.output("screenSize", [w, h]);
    ctx.output("safeArea", finiteVector(ctx, d.safeArea, 4, "nonFinite", nonFinite));
    ctx.output("screenScale", typeof d.screenScale === "number" && Number.isFinite(d.screenScale) && d.screenScale > 0 ? d.screenScale : 1);
    ctx.output("orientation", orientationAngle(d));
    ctx.output("landscape", w > h);
    ctx.output("usesMouse", preset?.kind === "computer");
    ctx.output("darkMode", d.darkMode === true);
    ctx.output("deviceName", preset?.name ?? (typeof d.preset === "string" ? d.preset : ""));
  },
});
