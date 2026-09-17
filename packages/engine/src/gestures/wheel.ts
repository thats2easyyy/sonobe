/** Mouse wheel and trackpad scroll accumulation per frame. */

import type { InputEvent } from "../types.ts";

export interface WheelSnapshot {
  /** Scroll delta accumulated this frame, in points. */
  delta: [number, number];
  /** Last wheel position in prototype coordinates. */
  position: [number, number];
  /** Delta per second for this frame. */
  velocity: [number, number];
}

export class WheelTracker {
  private dx = 0;
  private dy = 0;
  private x = 0;
  private y = 0;
  private dt = 0;

  /** Apply one frame of events; non-wheel events are ignored. */
  update(events: readonly InputEvent[], dt: number): void {
    this.dt = dt > 0 && Number.isFinite(dt) ? dt : 0;
    for (const event of events) {
      if (event.kind !== "wheel") continue;
      this.dx += event.dx;
      this.dy += event.dy;
      this.x = event.x;
      this.y = event.y;
    }
  }

  snapshot(): WheelSnapshot {
    const inv = this.dt > 0 ? 1 / this.dt : 0;
    return {
      delta: [this.dx, this.dy],
      position: [this.x, this.y],
      velocity: [this.dx * inv, this.dy * inv],
    };
  }

  /** Reset the per-frame delta. */
  endFrame(): void {
    this.dx = 0;
    this.dy = 0;
  }
}
