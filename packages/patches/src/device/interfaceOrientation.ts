/**
 * Interface Orientation: decides which way the interface faces. It applies Start In at launch,
 * then turns only on an event: the device rotating to an allowed direction, or the input for the
 * device's current direction turning on.
 */

import type { DeviceInfo, PatchContext, RuntimeServices } from "@sonobe/engine";
import { definePatch, toBool, toText, warnOnce } from "../infra/index.ts";
import { orientationAngleOf } from "./platform.ts";
import { findPreset, normalizeDegrees, withMutedBehavior } from "./shared.ts";

export type InterfaceOrientation = "portrait" | "landscapeLeft" | "landscapeRight" | "upsideDown";

const ORIENTATIONS: readonly InterfaceOrientation[] = ["portrait", "landscapeLeft", "landscapeRight", "upsideDown"];

const isOrientation = (value: string): value is InterfaceOrientation => (ORIENTATIONS as readonly string[]).includes(value);

/** The device's rotation: the proposed angle (0, 90, 180, 270) when present, else landscape → landscapeLeft. */
export function deviceOrientation(device: DeviceInfo): InterfaceOrientation {
  const angle = orientationAngleOf(device);
  if (angle !== undefined) {
    const quarter = normalizeDegrees(Math.round(normalizeDegrees(angle) / 90) * 90);
    return quarter === 90 ? "landscapeLeft" : quarter === 180 ? "upsideDown" : quarter === 270 ? "landscapeRight" : "portrait";
  }
  return device.orientation === "landscape" ? "landscapeLeft" : "portrait";
}

/** False for Upside Down on phones with an island or notch cutout; true otherwise. */
export function deviceSupports(device: DeviceInfo, orientation: InterfaceOrientation): boolean {
  if (orientation !== "upsideDown") return true;
  const preset = findPreset(device.preset);
  return !(preset?.kind === "phone" && (preset.cutout === "island" || preset.cutout === "notch"));
}

interface OrientationState {
  current: InterfaceOrientation;
  lastDevice: InterfaceOrientation | null;
}

interface Census {
  frame: number;
  current: Set<string>;
  previous: Set<string>;
}

const censuses = new WeakMap<RuntimeServices, Census>();

/** Warn once when this patch isn't the one that drives the viewer (first by id in the root component). */
function noteController(ctx: PatchContext): void {
  if (ctx.loopIndex !== 0) return;
  if (ctx.componentPath.includes("/")) {
    warnOnce(ctx, "controller", "Interface Orientation inside a component doesn't turn the viewer; only the first Interface Orientation patch in the main prototype does.");
    return;
  }
  let census = censuses.get(ctx.services);
  if (!census || ctx.frame < census.frame) censuses.set(ctx.services, (census = { frame: ctx.frame, current: new Set(), previous: new Set() }));
  if (ctx.frame !== census.frame) census = Object.assign(census, { frame: ctx.frame, previous: census.current, current: new Set<string>() });
  census.current.add(ctx.id);
  for (const set of [census.current, census.previous]) {
    for (const other of set) {
      if (other < ctx.id) {
        warnOnce(ctx, "controller", `Interface Orientation "${ctx.id}" doesn't turn the viewer, because "${other}" comes first; remove one of them.`);
        return;
      }
    }
  }
}

export const interfaceOrientationPatch = withMutedBehavior(
  definePatch<OrientationState>("interfaceOrientation", {
    state: () => ({ current: "portrait", lastDevice: null }),
    evaluate(ctx) {
      const s = ctx.state;
      const d = ctx.services.device();
      const device = deviceOrientation(d);
      const allowed = (o: InterfaceOrientation) => toBool(ctx.input(o)) && deviceSupports(d, o);
      if (s.lastDevice === null) {
        const startIn = toText(ctx.input("startIn"));
        let start: InterfaceOrientation = "portrait";
        if (isOrientation(startIn)) start = startIn;
        else warnOnce(ctx, "unknownStart", `Interface Orientation: "${startIn}" isn't an orientation, so it starts in portrait.`);
        s.current = deviceSupports(d, start) ? start : "portrait";
      } else if ((device !== s.lastDevice || ctx.changed(device)) && device !== s.current && allowed(device)) {
        s.current = device;
      }
      s.lastDevice = device;
      noteController(ctx);
      ctx.output("orientation", s.current);
      ctx.output("landscape", s.current === "landscapeLeft" || s.current === "landscapeRight");
    },
  }),
  "zero",
);
