/**
 * Independent deterministic simulations for MCP sim tools: a fixed timestep, seeded randomness, and
 * no platform side effects, so the same document and input always produce the same values. They
 * never touch the live viewer runtime.
 */

import type { DeviceInfo, EngineRegistry, InputEvent, Loop, RuntimeIssue, SonobeRuntime, TextMeasurer, TraceInput, TraceResult } from "@sonobe/engine";
import { createRuntime } from "@sonobe/engine";
import type { Id, SonobeDocument, Value } from "@sonobe/core";
import { formatConsoleArgs } from "../state/console.ts";

export interface SimulationOptions {
  registry: EngineRegistry;
  document: SonobeDocument;
  /** Default 1. */
  seed?: number;
  /** Default: project fps or 60. */
  fps?: 60 | 120;
  /** Default: approximate metrics (headless determinism). */
  textMeasurer?: TextMeasurer;
  device?: Partial<DeviceInfo>;
  resolveAssetUrl?: (assetId: Id) => string | undefined;
  /** Log lines kept. Default 500. */
  maxLogs?: number;
  id?: string;
}

export interface SimulationLog {
  frame: number;
  level: "log" | "warn" | "error";
  message: string;
}

export interface SimulationSnapshot {
  simId: string;
  frame: number;
  /** Seconds since the simulation started. */
  time: number;
  fps: number;
  seed: number;
  issueCount: number;
}

export interface SimulationStepOptions {
  /** Frames to advance. Default 1 (or derived from durationMs). */
  frames?: number;
  /** Advance by duration instead of frames. */
  durationMs?: number;
  /** Events before the first frame, or a per-frame script (events[i] before frame i). */
  events?: readonly InputEvent[] | readonly (readonly InputEvent[])[];
}

export interface Simulation {
  readonly id: string;
  readonly runtime: SonobeRuntime;
  readonly document: SonobeDocument;
  readonly seed: number;
  readonly fps: number;
  logs(): SimulationLog[];
  /** Start over (optionally with a new document, seed, or fps). */
  reset(options?: { document?: SonobeDocument; seed?: number; fps?: 60 | 120 }): SimulationSnapshot;
  /** Queue events for the next step; returns how many were queued. */
  dispatch(events: readonly InputEvent[]): number;
  step(options?: SimulationStepOptions): SimulationSnapshot;
  /** Current values (whole loops) for addresses like "pop.output" or "@card.scale". */
  values(targets: readonly string[]): { frame: number; time: number; values: Record<string, Value | Loop | null> };
  /** Sample targets every frame for `durationMs` on a clone (the simulation itself doesn't advance). */
  trace(targets: readonly string[], durationMs: number, events?: readonly TraceInput[]): TraceResult;
  issues(): RuntimeIssue[];
  snapshot(): SimulationSnapshot;
  dispose(): void;
}

/** Most frames a single step call may advance (60 s at 120 fps). */
export const MAX_SIM_STEP_FRAMES = 7200;

let simCounter = 0;

const isScript = (events: SimulationStepOptions["events"]): events is readonly (readonly InputEvent[])[] => Array.isArray(events) && events.length > 0 && Array.isArray(events[0]);

export function createSimulation(options: SimulationOptions): Simulation {
  const id = options.id ?? `sim_${++simCounter}`;
  const maxLogs = Math.max(1, options.maxLogs ?? 500);
  let document = options.document;
  let seed = options.seed ?? 1;
  let fpsOverride = options.fps;
  let logs: SimulationLog[] = [];
  let runtime: SonobeRuntime;

  const build = () =>
    createRuntime(document, {
      registry: options.registry,
      deterministic: true,
      seed,
      ...(fpsOverride ? { fps: fpsOverride } : {}),
      ...(options.textMeasurer ? { textMeasurer: options.textMeasurer } : {}),
      ...(options.device ? { device: options.device } : {}),
      ...(options.resolveAssetUrl ? { resolveAssetUrl: options.resolveAssetUrl } : {}),
      platform: {},
      onLog: (level, args) => {
        logs.push({ frame: runtime.frame, level, message: formatConsoleArgs(args) });
        if (logs.length > maxLogs) logs = logs.slice(logs.length - maxLogs);
      },
    });
  runtime = build();

  const snapshot = (): SimulationSnapshot => ({ simId: id, frame: runtime.frame, time: runtime.time, fps: runtime.fps, seed, issueCount: runtime.issues().length });

  const sim: Simulation = {
    id,
    get runtime() {
      return runtime;
    },
    get document() {
      return document;
    },
    get seed() {
      return seed;
    },
    get fps() {
      return runtime.fps;
    },
    logs: () => logs.slice(),
    reset(resetOptions = {}) {
      runtime.dispose();
      if (resetOptions.document) document = resetOptions.document;
      if (resetOptions.seed !== undefined) seed = resetOptions.seed;
      if (resetOptions.fps !== undefined) fpsOverride = resetOptions.fps;
      logs = [];
      runtime = build();
      return snapshot();
    },
    dispatch(events) {
      runtime.dispatch([...events]);
      return events.length;
    },
    step(stepOptions = {}) {
      const byDuration = stepOptions.durationMs !== undefined ? Math.round((Math.max(0, stepOptions.durationMs) / 1000) * runtime.fps) : undefined;
      const frames = Math.min(MAX_SIM_STEP_FRAMES, Math.max(0, Math.floor(stepOptions.frames ?? byDuration ?? 1)));
      const events = stepOptions.events;
      if (events && !isScript(events) && events.length) runtime.dispatch([...(events as readonly InputEvent[])]);
      for (let i = 0; i < frames; i++) {
        if (isScript(events) && events[i]?.length) runtime.dispatch([...events[i]!]);
        runtime.step();
      }
      return snapshot();
    },
    values(targets) {
      const values: Record<string, Value | Loop | null> = {};
      for (const target of targets) {
        const v = runtime.getRawValue(target);
        values[target] = v === undefined ? null : v;
      }
      return { frame: runtime.frame, time: runtime.time, values };
    },
    trace: (targets, durationMs, events) => runtime.trace(targets, durationMs, events),
    issues: () => runtime.issues(),
    snapshot,
    dispose() {
      runtime.dispose();
    },
  };
  return sim;
}
