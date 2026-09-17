/**
 * Game Controller: polls one controller slot from the host's gamepad snapshot every frame and
 * reports buttons, triggers, D-pad, and thumbsticks (W3C "standard" layout, radial dead zone).
 * Stateless.
 */

import type { GamepadSnapshot, PatchContext } from "@sonobe/engine";
import { clamp, definePatch, finiteOr, toNumber, warnOnce } from "../infra/index.ts";


const BOOLEAN_OUTPUTS = [
  "connected",
  "buttonA",
  "buttonB",
  "buttonX",
  "buttonY",
  "leftShoulder",
  "rightShoulder",
  "home",
  "menu",
  "options",
  "leftThumbstickButton",
  "rightThumbstickButton",
] as const;

/** Radial dead zone: [0, 0] inside `dz`, rescaled so the edge of the dead zone reads 0 and full tilt 1. */
export function applyDeadZone(axes: readonly unknown[], dz: number): [number, number] {
  const x = finiteOr(axes[0], 0);
  const y = finiteOr(axes[1], 0);
  const n = Math.hypot(x, y);
  if (n <= dz || n === 0) return [0, 0];
  const scale = Math.min(1, (n - dz) / (1 - dz)) / n;
  return [x * scale || 0, y * scale || 0];
}

function finite3(value: unknown): number[] {
  const v = Array.isArray(value) ? value : [];
  return [finiteOr(v[0], 0), finiteOr(v[1], 0), finiteOr(v[2], 0)];
}

function outputIdle(ctx: PatchContext): void {
  for (const key of BOOLEAN_OUTPUTS) ctx.output(key, false);
  ctx.output("leftTrigger", 0);
  ctx.output("rightTrigger", 0);
  ctx.output("dpad", [0, 0]);
  ctx.output("leftThumbstick", [0, 0]);
  ctx.output("rightThumbstick", [0, 0]);
  ctx.output("acceleration", [0, 0, 0]);
  ctx.output("rotationRate", [0, 0, 0]);
}

export const gameControllerPatch = definePatch("gameController", {
  mutedBehavior: "zero",
  evaluate(ctx) {
    const slot = Math.max(0, Math.floor(finiteOr(toNumber(ctx.input("controller"), 0), 0)));
    let pad: GamepadSnapshot | null | undefined;
    try {
      pad = ctx.services.platform.gamepads?.()?.[slot];
    } catch {
      pad = undefined;
    }
    if (!pad?.connected) {
      outputIdle(ctx);
      return;
    }
    if (pad.mapping !== "standard") {
      warnOnce(ctx, "mapping", "Game Controller: this controller doesn't use the standard layout, so its buttons may not match the outputs.");
    }
    const buttons = Array.isArray(pad.buttons) ? pad.buttons : [];
    const axes = Array.isArray(pad.axes) ? pad.axes : [];
    const pressed = (i: number) => buttons[i]?.pressed === true;
    const amount = (i: number) => clamp(finiteOr(buttons[i]?.value, 0), 0, 1);
    const dz = clamp(finiteOr(toNumber(ctx.input("deadZone"), 0.1), 0.1), 0, 0.99);
    ctx.output("connected", true);
    ctx.output("buttonA", pressed(0));
    ctx.output("buttonB", pressed(1));
    ctx.output("buttonX", pressed(2));
    ctx.output("buttonY", pressed(3));
    ctx.output("leftShoulder", pressed(4));
    ctx.output("rightShoulder", pressed(5));
    ctx.output("leftTrigger", amount(6));
    ctx.output("rightTrigger", amount(7));
    ctx.output("dpad", [(pressed(15) ? 1 : 0) - (pressed(14) ? 1 : 0), (pressed(13) ? 1 : 0) - (pressed(12) ? 1 : 0)]);
    ctx.output("leftThumbstick", applyDeadZone([axes[0], axes[1]], dz));
    ctx.output("rightThumbstick", applyDeadZone([axes[2], axes[3]], dz));
    ctx.output("home", pressed(16));
    ctx.output("menu", pressed(9));
    ctx.output("options", pressed(8));
    ctx.output("leftThumbstickButton", pressed(10));
    ctx.output("rightThumbstickButton", pressed(11));
    ctx.output("acceleration", finite3(pad.motion?.acceleration));
    ctx.output("rotationRate", finite3(pad.motion?.rotationRate));
  },
});
