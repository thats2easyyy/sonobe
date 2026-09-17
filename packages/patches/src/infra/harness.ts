/**
 * A deterministic stand-in for the runtime's PatchContext, for unit-testing evaluators. It follows
 * engine/types.ts: inputs coerce to declared port types and fall back to declared defaults, pulse
 * inputs fire on a pulse or a rising boolean, loop inputs evaluate per index with wrap-around (or
 * once with whole loops when any port is `wholeLoop`), state is per loop index, and services are
 * seeded and silent. Golden tests of full prototypes belong on the real runtime.
 */

import { DEFAULT_DEVICE, coerce, getDevicePreset, inferValueType, resolveInputCount } from "@sonobe/core";
import type { PatchNode, PatchSpec, ResolvedPort, Value, ValueType } from "@sonobe/core";
import type { DeviceInfo, PatchContext, PatchDefinition, PointerSnapshot, RuntimeServices } from "@sonobe/engine";
import { itemAt, loopItems, loopLength, loopOf } from "./loops.ts";
import { nodePorts, resolvePortDefault } from "./ports.ts";
import { equalValues, toBool } from "./values.ts";

/** `services.now()` at time 0 in the harness (2026-01-01T00:00:00Z). */
export const HARNESS_EPOCH_MS = Date.UTC(2026, 0, 1);

export interface HarnessLog {
  level: "log" | "warn" | "error";
  message: string;
  args: unknown[];
}

export interface PatchHarnessOptions {
  /** Patch id (default "patch_1"). */
  id?: string;
  /** Default "main". */
  componentPath?: string;
  typeParam?: string;
  inputCount?: number;
  settings?: PatchNode["settings"];
  /** Held input values (like literals or upstream states). Loop values evaluate per index. */
  inputs?: Record<string, unknown>;
  /** Keys `isConnected` reports as connected. Default: every key that has been set or pulsed. */
  connected?: readonly string[];
  /** Frames per second for the default dt (default 60). */
  fps?: 60 | 120 | number;
  /** Seed for `services.random()` (default 1). */
  seed?: number;
  /** Override individual runtime services. */
  services?: Partial<RuntimeServices>;
}

export interface HarnessStepOptions {
  /** Held input changes applied before this frame; `undefined` removes a value. */
  inputs?: Record<string, unknown>;
  /** Pulse inputs that fire on this frame only. */
  pulses?: readonly string[];
  /** Seconds for this frame (default 1 / fps). */
  dt?: number;
}

export interface HarnessFrame {
  frame: number;
  time: number;
  dt: number;
  /** Output values after this frame: scalars, or Loops when an input looped. Outputs hold until set again. */
  outputs: Record<string, Value>;
  /** Pulse outputs that fired this frame at any loop index. */
  pulses: ReadonlySet<string>;
  /** Per-index pulse flags for each pulse output that fired at least once this frame. */
  pulseItems: Record<string, boolean[]>;
  /** Loop length this frame, or undefined when no input looped. */
  loopCount: number | undefined;
  requestedNextFrame: boolean;
  /** The patch called `services.restart()`. */
  restartRequested: boolean;
}

export interface PatchHarness<S = unknown> {
  readonly services: RuntimeServices;
  readonly logs: HarnessLog[];
  readonly node: PatchNode;
  /** The next frame number (frames evaluated so far). */
  readonly frame: number;
  readonly time: number;
  set(inputs: Record<string, unknown>): void;
  disconnect(key: string): void;
  step(options?: HarnessStepOptions): HarnessFrame;
  /** Step `frames` times; inputs and pulses apply to the first frame only. */
  run(frames: number, options?: HarnessStepOptions): HarnessFrame;
  /** Output from the last frame. */
  output(key: string): Value;
  /** Whether a pulse output fired on the last frame. */
  pulsed(key: string): boolean;
  state(loopIndex?: number): S | undefined;
  /** Dispose state and start again at frame 0 (held inputs stay). */
  restart(): void;
  dispose(): void;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function idlePointer(): PointerSnapshot {
  return {
    down: false,
    began: false,
    ended: false,
    tapped: false,
    position: [0, 0],
    localPosition: [0, 0],
    startPosition: [0, 0],
    translation: [0, 0],
    velocity: [0, 0],
    hovering: false,
    pointerCount: 0,
  };
}

function defaultDevice(): DeviceInfo {
  const preset = getDevicePreset(DEFAULT_DEVICE);
  return {
    preset: preset.id,
    screenSize: [preset.size[0], preset.size[1]],
    screenScale: preset.scale,
    safeArea: [preset.safeArea[0], preset.safeArea[1], preset.safeArea[2], preset.safeArea[3]],
    orientation: "portrait",
    darkMode: false,
    platform: "web",
  };
}

function logText(arg: unknown): string {
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

/** Create a harness that evaluates `definition` frame by frame. */
export function createPatchHarness<S = any>(definition: PatchDefinition<S>, options: PatchHarnessOptions = {}): PatchHarness<S> {
  const spec: PatchSpec = definition;
  const id = options.id ?? "patch_1";
  const componentPath = options.componentPath ?? "main";
  const fps = options.fps !== undefined && options.fps > 0 ? options.fps : 60;
  const typeParam = options.typeParam;
  const inputCount = spec.variadic ? (resolveInputCount(spec, options.inputCount) ?? 0) : (options.inputCount ?? 0);
  const logs: HarnessLog[] = [];
  const held = new Map<string, unknown>(Object.entries(options.inputs ?? {}).filter(([, v]) => v !== undefined));
  const touched = new Set<string>(held.keys());
  const explicitConnected = options.connected ? new Set(options.connected) : undefined;

  const node: PatchNode = { type: spec.type, inputs: {}, ui: { x: 0, y: 0 } };
  if (typeParam !== undefined) node.typeParam = typeParam;
  if (options.inputCount !== undefined) node.inputCount = options.inputCount;
  if (options.settings !== undefined) node.settings = options.settings;

  let frame = 0;
  let time = 0;
  let restartRequested = false;
  const services: RuntimeServices = {
    random: mulberry32(options.seed ?? 1),
    now: () => HARNESS_EPOCH_MS + time * 1000,
    pointer: () => idlePointer(),
    keyboard: () => ({ pressed: new Set(), downThisFrame: new Set(), upThisFrame: new Set(), text: "" }),
    wheel: () => ({ delta: [0, 0], position: [0, 0], velocity: [0, 0] }),
    layerInfo: () => undefined,
    device: () => defaultDevice(),
    log: (level, ...args) => {
      logs.push({ level, message: args.map(logText).join(" "), args });
    },
    restart: () => {
      restartRequested = true;
    },
    resolveAssetUrl: () => undefined,
    platform: {},
    ...options.services,
  };

  const { inputs: inputPorts, outputs: outputPorts } = nodePorts(spec, typeParam, options.inputCount);
  const portByKey = new Map<string, ResolvedPort>();
  for (const port of [...inputPorts, ...outputPorts]) portByKey.set(port.key, port);
  const wholeMode = [...inputPorts, ...outputPorts].some((p) => p.wholeLoop);

  let states: S[] = [];
  const outputsHeld = new Map<string, unknown[]>();
  const previousInputs = new Map<string, unknown[]>();
  const previousBooleans = new Map<string, boolean[]>();
  let last: HarnessFrame | undefined;

  const coerceTo = (value: unknown, type: ValueType): unknown =>
    type === "any" || value === undefined ? value : coerce(value as Value, inferValueType(value as Value), type);
  const itemFor = (raw: unknown, index: number) => itemAt(raw, wholeMode ? 0 : index);

  function readItems(key: string): unknown[] {
    const port = portByKey.get(key);
    const raw = held.has(key) ? held.get(key) : port ? resolvePortDefault(spec, key, typeParam) : undefined;
    if (raw === undefined) return [];
    const items = loopItems(raw);
    return port ? items.map((v) => coerceTo(v, port.type)) : [...items];
  }

  function readInput(key: string, index: number, pulses: ReadonlySet<string>): unknown {
    const port = portByKey.get(key);
    if (port?.wholeLoop) return loopOf(readItems(key));
    if (port?.type === "pulse") return pulses.has(key) || (held.has(key) && toBool(itemFor(held.get(key), index)));
    if (!held.has(key)) return port ? resolvePortDefault(spec, key, typeParam) : undefined;
    const item = itemFor(held.get(key), index);
    return port ? coerceTo(item, port.type) : item;
  }

  function disposeStates(from: number): void {
    for (let i = from; i < states.length; i++) definition.dispose?.(states[i]!, services);
    states.length = Math.min(states.length, from);
  }

  function set(inputs: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(inputs)) {
      if (value === undefined) {
        held.delete(key);
      } else {
        held.set(key, value);
        touched.add(key);
      }
    }
  }

  function step(stepOptions: HarnessStepOptions = {}): HarnessFrame {
    if (stepOptions.inputs) set(stepOptions.inputs);
    const pulses = new Set(stepOptions.pulses ?? []);
    for (const key of pulses) touched.add(key);
    const dt = stepOptions.dt ?? 1 / fps;
    if (frame > 0) time += dt;
    restartRequested = false;

    const perIndex = [...held].filter(([key]) => !portByKey.get(key)?.wholeLoop).map(([, v]) => v);
    const loopCount = wholeMode ? undefined : loopLength(perIndex);
    const count = loopCount ?? 1;
    const fired = new Map<string, boolean[]>();
    let requested = false;

    for (let i = 0; i < count; i++) {
      if (i >= states.length) states[i] = definition.state ? definition.state() : (undefined as S);
      const index = i;
      const ctx: PatchContext<S> = {
        id,
        node,
        componentPath,
        frame,
        time,
        dt,
        loopIndex: index,
        loopCount: count,
        typeParam,
        inputCount,
        services,
        get state(): S {
          return states[index]!;
        },
        set state(value: S) {
          states[index] = value;
        },
        input: <T>(key: string): T => readInput(key, index, pulses) as T,
        inputItems: <T>(key: string): readonly T[] => readItems(key) as T[],
        isConnected: (key) => (explicitConnected ? explicitConnected.has(key) : held.has(key) || touched.has(key)),
        pulsed: (key) =>
          pulses.has(key) || (held.has(key) && toBool(itemFor(held.get(key), index)) && !(previousBooleans.get(key)?.[index] ?? false)),
        changed: (key) => {
          const previous = previousInputs.get(key);
          return previous !== undefined && index < previous.length && !equalValues(readInput(key, index, pulses), previous[index]);
        },
        output: (key, value) => {
          const port = portByKey.get(key);
          let values = outputsHeld.get(key);
          if (!values) outputsHeld.set(key, (values = []));
          values[index] = port?.wholeLoop && Array.isArray(value) ? loopOf(value) : value;
        },
        pulse: (key) => {
          let flags = fired.get(key);
          if (!flags) fired.set(key, (flags = []));
          flags[index] = true;
        },
        requestNextFrame: () => {
          requested = true;
        },
      };
      definition.evaluate(ctx);
    }

    disposeStates(count);
    for (const values of outputsHeld.values()) values.length = Math.min(values.length, count);
    const historyKeys = new Set<string>([...inputPorts.map((p) => p.key), ...held.keys()]);
    for (const key of historyKeys) {
      previousInputs.set(key, Array.from({ length: count }, (_, i) => readInput(key, i, pulses)));
      if (held.has(key)) previousBooleans.set(key, Array.from({ length: count }, (_, i) => toBool(itemFor(held.get(key), i))));
      else previousBooleans.delete(key);
    }

    const outputs: Record<string, Value> = {};
    for (const [key, values] of outputsHeld) {
      outputs[key] = loopCount === undefined ? values[0] : loopOf(Array.from({ length: count }, (_, i) => values[i]));
    }
    const firedKeys = new Set<string>();
    const pulseItems: Record<string, boolean[]> = {};
    for (const [key, flags] of fired) {
      firedKeys.add(key);
      pulseItems[key] = Array.from({ length: count }, (_, i) => flags[i] === true);
    }
    last = { frame, time, dt, outputs, pulses: firedKeys, pulseItems, loopCount, requestedNextFrame: requested, restartRequested };
    frame += 1;
    return last;
  }

  return {
    services,
    logs,
    node,
    get frame() {
      return frame;
    },
    get time() {
      return time;
    },
    set,
    disconnect(key) {
      held.delete(key);
      touched.delete(key);
    },
    step,
    run(frames, runOptions = {}) {
      let result = step(runOptions);
      for (let i = 1; i < frames; i++) result = step(runOptions.dt !== undefined ? { dt: runOptions.dt } : {});
      return result;
    },
    output: (key) => last?.outputs[key],
    pulsed: (key) => last?.pulses.has(key) ?? false,
    state: (loopIndex = 0) => states[loopIndex],
    restart() {
      disposeStates(0);
      states = [];
      outputsHeld.clear();
      previousInputs.clear();
      previousBooleans.clear();
      frame = 0;
      time = 0;
      last = undefined;
    },
    dispose() {
      disposeStates(0);
      states = [];
    },
  };
}
