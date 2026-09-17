/**
 * Pointer tracking for Interaction, Drag, Scroll, Hover, and Long Press patches.
 * Feed one frame of InputEvents plus a hit test over the previous frame's scene, read
 * per-layer snapshots, then call endFrame(). See ARCHITECTURE.md §5.5 and
 * docs/research/gap-fill.md R5, R6, R9.
 */

import { transformPoint } from "../math/matrix.ts";
import type { InputEvent, PointerSnapshot } from "../types.ts";

/** One entry of a hit chain (front-most first, then ancestors). */
export interface HitTarget {
  readonly key: string;
  readonly layerId: string;
}

export type HitTestFunction = (x: number, y: number) => readonly HitTarget[];

/** A touch that moves less than this (points) can still be a tap or a long press. */
export const TAP_SLOP = 10;
/** Time constant (seconds) of the velocity moving average. */
export const DEFAULT_VELOCITY_SMOOTHING = 0.025;

const IDLE_DECAY_DELAY = 0.05;
const MIN_SAMPLE_DT = 1 / 480;
const MAX_SAMPLE_DT = 0.1;
const RECENT_LIMIT = 8;

export interface PointerTrackerOptions {
  /** Movement allowed for taps and long presses, in points. */
  tapSlop: number;
  /** Velocity smoothing time constant in seconds. */
  velocitySmoothing: number;
  /**
   * After a release the pointer keeps hovering at its last position (mouse behavior).
   * Renderers send `cancel` for a pointer that leaves or a touch that lifts.
   */
  hoverOnRelease: boolean;
}

interface PointerRecord {
  id: number;
  pressed: boolean;
  /** Hit chain captured at press. */
  chain: readonly HitTarget[];
  /** Hit chain at release (empty when cancelled). */
  releaseChain: readonly HitTarget[];
  /** Current hit chain for hovering pointers. */
  hoverChain: readonly HitTarget[];
  position: [number, number];
  startPosition: [number, number];
  startTime: number;
  maxDistance: number;
  velocity: [number, number];
  samplePosition: [number, number];
  sampleTime: number;
  lastMoveTime: number;
  began: boolean;
  cancelled: boolean;
}

function matches(chain: readonly HitTarget[], target: string | null): boolean {
  if (target === null) return true;
  for (const entry of chain) if (entry.key === target || entry.layerId === target) return true;
  return false;
}

function createRecord(
  id: number,
  position: [number, number],
  time: number,
  pressed: boolean,
): PointerRecord {
  return {
    id,
    pressed,
    chain: [],
    releaseChain: [],
    hoverChain: [],
    position: [position[0], position[1]],
    startPosition: [position[0], position[1]],
    startTime: time,
    maxDistance: 0,
    velocity: [0, 0],
    samplePosition: [position[0], position[1]],
    sampleTime: time,
    lastMoveTime: time,
    began: pressed,
    cancelled: false,
  };
}

/** Tracks pressed and hovering pointers across frames. Deterministic given events and dt. */
export class PointerTracker {
  readonly options: PointerTrackerOptions;
  /** Seconds accumulated from update() deltas. */
  time = 0;

  private active = new Map<number, PointerRecord>();
  private hovers = new Map<number, PointerRecord>();
  private endedThisFrame: PointerRecord[] = [];
  private recent: PointerRecord[] = [];

  constructor(options: Partial<PointerTrackerOptions> = {}) {
    this.options = {
      tapSlop: options.tapSlop ?? TAP_SLOP,
      velocitySmoothing: options.velocitySmoothing ?? DEFAULT_VELOCITY_SMOOTHING,
      hoverOnRelease: options.hoverOnRelease ?? true,
    };
  }

  /** Number of pointers currently pressed. */
  get pressedCount(): number {
    return this.active.size;
  }

  /**
   * Process one frame: advance time by `dt`, apply pointer events in order, update velocity
   * estimates, and re-hit-test hovering pointers. Non-pointer events are ignored.
   */
  update(events: readonly InputEvent[], hitTest: HitTestFunction, dt: number): void {
    const h = dt > 0 && Number.isFinite(dt) ? dt : 0;
    this.time += h;
    for (const event of events) {
      if (event.kind !== "pointer") continue;
      const position: [number, number] = [event.x, event.y];
      switch (event.phase) {
        case "down":
          this.press(event.pointerId, position, hitTest);
          break;
        case "move":
          this.move(event.pointerId, position);
          break;
        case "up":
          this.release(event.pointerId, position, hitTest, false);
          break;
        case "cancel":
          this.release(event.pointerId, position, hitTest, true);
          break;
      }
    }
    for (const record of this.active.values()) this.sampleVelocity(record, h, false);
    for (const record of this.endedThisFrame) this.sampleVelocity(record, h, true);
    for (const record of this.hovers.values())
      record.hoverChain = [...hitTest(record.position[0], record.position[1])];
  }

  /**
   * Pointer state for a layer (`target` matches a hit-chain key or layer id; null means the
   * whole screen). `worldInverse` maps prototype coordinates to the layer's local space for
   * `localPosition` (use `planeInverse(worldTransform)`).
   */
  snapshot(target: string | null, worldInverse?: readonly number[] | null): PointerSnapshot {
    const pressed: PointerRecord[] = [];
    for (const record of this.active.values())
      if (matches(record.chain, target)) pressed.push(record);
    const ended = this.endedThisFrame.filter((r) => matches(r.chain, target));
    let hover: PointerRecord | undefined;
    for (const record of this.hovers.values()) {
      if (matches(record.hoverChain, target)) {
        hover = record;
        break;
      }
    }
    const current = pressed[0] ?? ended[ended.length - 1];
    const press = current ?? this.recent.find((r) => matches(r.chain, target));
    const position = current?.position ?? hover?.position ?? press?.position ?? [0, 0];
    const startPosition = press ? press.startPosition : position;
    const translation: [number, number] = press
      ? [press.position[0] - press.startPosition[0], press.position[1] - press.startPosition[1]]
      : [0, 0];
    const slop = this.options.tapSlop;

    let localPosition: [number, number] = [position[0], position[1]];
    if (worldInverse && worldInverse.length === 16) {
      const [lx, ly] = transformPoint(worldInverse, [position[0], position[1], 0]);
      if (Number.isFinite(lx) && Number.isFinite(ly)) localPosition = [lx, ly];
    }

    return {
      down: pressed.length > 0,
      began: pressed.some((r) => r.began) || ended.some((r) => r.began),
      ended: ended.length > 0,
      tapped: ended.some(
        (r) => !r.cancelled && r.maxDistance < slop && matches(r.releaseChain, target),
      ),
      position: [position[0], position[1]],
      localPosition,
      startPosition: [startPosition[0], startPosition[1]],
      translation,
      velocity: current ? [current.velocity[0], current.velocity[1]] : [0, 0],
      hovering: hover !== undefined,
      pointerCount: pressed.length,
    };
  }

  /** True while a pointer on `target` has been held and stationary (within slop) for `duration` seconds. */
  longPress(target: string | null, duration: number): boolean {
    for (const record of this.active.values()) {
      if (!matches(record.chain, target)) continue;
      if (
        record.maxDistance <= this.options.tapSlop &&
        this.time - record.startTime >= duration - 1e-9
      )
        return true;
    }
    return false;
  }

  /** Clear one-frame flags (began, ended, tapped) and retire released pointers. */
  endFrame(): void {
    for (const record of this.active.values()) record.began = false;
    for (const record of this.endedThisFrame) this.recent.unshift(record);
    if (this.recent.length > RECENT_LIMIT) this.recent.length = RECENT_LIMIT;
    this.endedThisFrame = [];
  }

  /** Forget all pointers and restart the clock (prototype restart). */
  reset(): void {
    this.active.clear();
    this.hovers.clear();
    this.endedThisFrame = [];
    this.recent = [];
    this.time = 0;
  }

  private press(id: number, position: [number, number], hitTest: HitTestFunction): void {
    const existing = this.active.get(id);
    if (existing) this.finish(existing, existing.position, [], true);
    this.hovers.delete(id);
    const record = createRecord(id, position, this.time, true);
    record.chain = [...hitTest(position[0], position[1])];
    this.active.set(id, record);
  }

  private move(id: number, position: [number, number]): void {
    const record = this.active.get(id);
    if (record) {
      record.position = position;
      this.updateDistance(record);
      return;
    }
    const hover = this.hovers.get(id);
    if (hover) hover.position = position;
    else this.hovers.set(id, createRecord(id, position, this.time, false));
  }

  private release(
    id: number,
    position: [number, number],
    hitTest: HitTestFunction,
    cancelled: boolean,
  ): void {
    const record = this.active.get(id);
    if (!record) {
      if (cancelled) this.hovers.delete(id);
      else this.move(id, position);
      return;
    }
    record.position = position;
    this.updateDistance(record);
    this.finish(
      record,
      position,
      cancelled ? [] : [...hitTest(position[0], position[1])],
      cancelled,
    );
    if (!cancelled && this.options.hoverOnRelease)
      this.hovers.set(id, createRecord(id, position, this.time, false));
  }

  private finish(
    record: PointerRecord,
    position: [number, number],
    releaseChain: readonly HitTarget[],
    cancelled: boolean,
  ): void {
    record.pressed = false;
    record.position = position;
    record.releaseChain = releaseChain;
    record.cancelled = cancelled;
    this.active.delete(record.id);
    this.endedThisFrame.push(record);
  }

  private updateDistance(record: PointerRecord): void {
    const d = Math.hypot(
      record.position[0] - record.startPosition[0],
      record.position[1] - record.startPosition[1],
    );
    if (d > record.maxDistance) record.maxDistance = d;
  }

  /**
   * Exponential moving average of displacement / time between move frames. The press frame
   * contributes no sample (no first-frame jump); frames without movement hold the estimate
   * briefly (input can arrive slower than frames) and then decay it; a release with no
   * displacement holds the last velocity for the release frame.
   */
  private sampleVelocity(record: PointerRecord, h: number, releasing: boolean): void {
    const tau = this.options.velocitySmoothing;
    const dx = record.position[0] - record.samplePosition[0];
    const dy = record.position[1] - record.samplePosition[1];
    if (dx !== 0 || dy !== 0) {
      const elapsed = this.time - record.sampleTime;
      if (elapsed <= 0) return;
      const sdt = Math.min(MAX_SAMPLE_DT, Math.max(MIN_SAMPLE_DT, elapsed));
      const alpha = tau > 0 ? 1 - Math.exp(-sdt / tau) : 1;
      record.velocity[0] += (dx / sdt - record.velocity[0]) * alpha;
      record.velocity[1] += (dy / sdt - record.velocity[1]) * alpha;
      record.samplePosition = [record.position[0], record.position[1]];
      record.sampleTime = this.time;
      record.lastMoveTime = this.time;
      return;
    }
    if (releasing || h <= 0) return;
    if (this.time - record.lastMoveTime > IDLE_DECAY_DELAY) {
      const decay = tau > 0 ? Math.exp(-h / tau) : 0;
      record.velocity[0] *= decay;
      record.velocity[1] *= decay;
      record.sampleTime = this.time;
    }
  }
}
