/** Mouse: pointer position, buttons, and wheel scrolling across the whole prototype. */

import type { PointerSnapshot } from "@sonobe/engine";
import { definePatch } from "../infra/index.ts";
import { finitePoint, withMutedBehavior, type Vec2 } from "./shared.ts";

interface MouseState {
  position: Vec2;
}

/**
 * Whether DOM button `button` (0 left, 1 middle, 2 right) is held. Uses a `buttons` bitmask when the
 * snapshot has one (not yet in the contract); otherwise any press counts as Left.
 */
function buttonHeld(snap: PointerSnapshot, button: 0 | 1 | 2): boolean {
  const buttons = (snap as { buttons?: unknown }).buttons;
  if (typeof buttons === "number" && Number.isFinite(buttons)) {
    const bit = button === 0 ? 1 : button === 1 ? 4 : 2; // DOM bitmask: left 1, right 2, middle 4
    return snap.down && (buttons & bit) !== 0;
  }
  return button === 0 && snap.down;
}

export const mouse = withMutedBehavior(
  definePatch<MouseState>("mouse", {
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
  }),
  "zero",
);
