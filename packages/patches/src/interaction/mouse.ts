/** Mouse: pointer position, buttons, and wheel scrolling across the whole prototype. */

import type { PointerSnapshot } from "@sonobe/engine";
import { definePatch } from "../infra/index.ts";
import { finitePoint, type Vec2 } from "./shared.ts";

interface MouseState {
  position: Vec2;
}

/** DOM `buttons` bits: left (primary) 1, right (secondary) 2, middle 4. */
const BUTTON_BITS = { 0: 1, 1: 4, 2: 2 } as const;

/** Whether DOM button `button` (0 left, 1 middle, 2 right) is held, from the snapshot's `buttons` bitmask. Touch and pen presses count as Left. */
export function buttonHeld(snap: Pick<PointerSnapshot, "down" | "buttons">, button: 0 | 1 | 2): boolean {
  const buttons = typeof snap.buttons === "number" && Number.isFinite(snap.buttons) ? snap.buttons : 0;
  return snap.down && (buttons & BUTTON_BITS[button]) !== 0;
}

export const mouse = definePatch<MouseState>("mouse", {
  state: () => ({ position: [0, 0] }),
  evaluate(ctx) {
    const state = ctx.state;
    const snap = ctx.services.pointer(null);
    if (snap.down || snap.hovering || snap.ended) state.position = finitePoint(snap.position) ?? state.position;
    const wheel = ctx.services.wheel();
    const delta = finitePoint(wheel.delta) ?? [0, 0];
    ctx.output("position", state.position);
    ctx.output("left", buttonHeld(snap, 0));
    ctx.output("right", buttonHeld(snap, 2));
    ctx.output("middle", buttonHeld(snap, 1));
    ctx.output("scrollDelta", delta);
    ctx.output("scrollVelocity", ctx.dt > 0 ? [delta[0] / ctx.dt, delta[1] / ctx.dt] : [0, 0]);
  },
  mutedBehavior: "zero",
});
