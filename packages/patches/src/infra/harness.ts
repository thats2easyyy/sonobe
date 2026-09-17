/**
 * A deterministic stand-in for the runtime's PatchContext, for unit-testing evaluators. It follows
 * engine/types.ts: ports resolve through core `resolveNodePorts` (static, variadic, and dynamic
 * ports with document-encoded defaults), inputs coerce to declared port types and fall back to
 * declared defaults, pulse inputs fire on a pulse or a rising boolean, loop inputs evaluate per index
 * with wrap-around (or once with whole loops when any port is `wholeLoop`), state is per loop index,
 * muting follows the definition's `mutedBehavior`, and services are seeded and silent. Golden tests
 * of full prototypes belong on the real runtime.
 */

import { DEFAULT_DEVICE, coerce, createEmptyDocument, createRegistry, getDevicePreset, inferValueType, resolveNodePorts } from "@sonobe/core";
import type { PatchNode, PatchSpec, ResolvedPort, SonobeDocument, Value, ValueType } from "@sonobe/core";
import { approximateTextMeasurer } from "@sonobe/engine";
import type { DeviceInfo, PatchContext, PatchDefinition, PointerSnapshot, RuntimeServices } from "@sonobe/engine";
import { itemAt, loopItems, loopLength, loopOf } from "./loops.ts";
import { decodeDefault, nodePorts } from "./ports.ts";
import { equalValues, toBool, zeroValue } from "./values.ts";

/** `services.now()` at time 0 in the harness (2026-01-01T00:00:00Z). */
export const HARNESS_EPOCH_MS = Date.UTC(2026, 0, 1);

export interface HarnessLog {
  level: "log" | "warn" | "error";
  message: string;
  args: unknown[];
}

/** A runtime issue raised through `services.issue`, deduplicated by code and message until restart. */
export interface HarnessIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
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
  /**
   * Keys `isPulseSource` reports as driven by a pulse output. Default: pulse-typed ports, plus any
   * input that has received a one-frame pulse through `step({ pulses })`.
   */
  pulseSources?: readonly string[];
  /** Keys `isFeedback` reports as back-edge reads. Default: none. */
  feedback?: readonly string[];
  /** The patch node is muted: the definition's `mutedBehavior` applies ("bypass" by default). */
  muted?: boolean;
  /** Frames per second for the default dt (default 60). */
  fps?: 60 | 120 | number;
  /** Seed for `services.random()` (default 1). */
  seed?: number;
  /** Document for dynamicPorts and `services.readScript` (default: an empty document). */
  doc?: SonobeDocument;
  /** Override individual runtime services. */
  services?: Partial<RuntimeServices>;
}

export interface HarnessStepOptions {
  /** Held input changes applied before this frame; `undefined` removes a value. */
  inputs?: Record<string, unknown>;
  /**
   * Inputs that receive a one-frame pulse on this frame. A pulse port fires; any other port reads
   * `true` (coerced to its type) for this frame, like a pulse wired into a state input.
   */
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
  /** Issues raised through `services.issue` since the last restart. */
  readonly issues: HarnessIssue[];
  readonly node: PatchNode;
  /** The resolved ports the harness evaluates against. */
  readonly ports: { readonly inputs: readonly ResolvedPort[]; readonly outputs: readonly ResolvedPort[] };
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
  /** Dispose state and start again at frame 0 (held inputs stay); `services.restartCount` goes up by one. */
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
    cancelled: false,
    tapped: false,
    position: [0, 0],
    localPosition: [0, 0],
    startPosition: [0, 0],
    translation: [0, 0],
    velocity: [0, 0],
    pressure: 0,
    buttons: 0,
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
    timeZone: "UTC",
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

/** True when `key` is declared variant on `side` of the spec (static port or expanded variadic key). */
function declaredVariant(spec: PatchSpec, key: string, side: "inputs" | "outputs"): boolean {
  const own = spec[side].find((p) => p.key === key);
  if (own) return own.type === "variant";
  const v = spec.variadic;
  return v !== undefined && (v.direction ?? "inputs") === side && key.startsWith(v.key) && /^\d+$/.test(key.slice(v.key.length)) && v.type === "variant";
}

/** Ports for a node the way the runtime resolves them; falls back to static and variadic ports when core can't resolve the spec. */
function resolvePorts(spec: PatchSpec, node: PatchNode, doc: SonobeDocument): { inputs: ResolvedPort[]; outputs: ResolvedPort[]; inputCount: number | undefined } {
  const resolved = resolveNodePorts(doc, node, createRegistry([spec], []));
  if (resolved) return { inputs: resolved.inputs, outputs: resolved.outputs, inputCount: resolved.inputCount };
  const fallback = nodePorts(spec, node.typeParam, node.inputCount);
  return { ...fallback, inputCount: undefined };
}

/** Create a harness that evaluates `definition` frame by frame. */
export function createPatchHarness<S = any>(definition: PatchDefinition<S>, options: PatchHarnessOptions = {}): PatchHarness<S> {
  const spec: PatchSpec = definition;
  const id = options.id ?? "patch_1";
  const componentPath = options.componentPath ?? "main";
  const fps = options.fps !== undefined && options.fps > 0 ? options.fps : 60;
  const typeParam = options.typeParam;
  const doc = options.doc ?? createEmptyDocument({ name: "Patch harness" });
  const logs: HarnessLog[] = [];
  const issues: HarnessIssue[] = [];
  const held = new Map<string, unknown>(Object.entries(options.inputs ?? {}).filter(([, v]) => v !== undefined));
  const touched = new Set<string>(held.keys());
  const explicitConnected = options.connected ? new Set(options.connected) : undefined;
  const explicitPulseSources = options.pulseSources ? new Set(options.pulseSources) : undefined;
  const pulsedKeys = new Set<string>();
  const feedback = new Set(options.feedback ?? []);
  const muted = options.muted === true;
  const mutedBehavior = definition.mutedBehavior ?? "bypass";

  const node: PatchNode = { type: spec.type, inputs: {}, ui: { x: 0, y: 0 } };
  if (typeParam !== undefined) node.typeParam = typeParam;
  if (options.inputCount !== undefined) node.inputCount = options.inputCount;
  if (options.settings !== undefined) node.settings = options.settings;
  if (muted) node.muted = true;

  const { inputs: inputPorts, outputs: outputPorts, inputCount: resolvedCount } = resolvePorts(spec, node, doc);
  const inputCount = resolvedCount ?? (typeof options.inputCount === "number" && Number.isFinite(options.inputCount) ? options.inputCount : 0);
  const portByKey = new Map<string, ResolvedPort>();
  for (const port of [...inputPorts, ...outputPorts]) portByKey.set(port.key, port);
  const wholeMode = [...inputPorts, ...outputPorts].some((p) => p.wholeLoop);
  const defaults = new Map<string, unknown>();
  for (const port of inputPorts) {
    defaults.set(port.key, port.wholeLoop && port.default === undefined ? loopOf([]) : decodeDefault(port.default, port.type, port.enumOptions));
  }

  let frame = 0;
  let time = 0;
  let restarts = 0;
  let restartRequested = false;
  const once = new Set<string>();
  const services: RuntimeServices = {
    random: mulberry32(options.seed ?? 1),
    now: () => HARNESS_EPOCH_MS + time * 1000,
    deterministic: true,
    get restartCount() {
      return restarts;
    },
    pointer: () => idlePointer(),
    pointers: () => [],
    keyboard: () => ({ pressed: new Set(), downThisFrame: new Set(), upThisFrame: new Set(), text: "" }),
    wheel: () => ({ delta: [0, 0], position: [0, 0], velocity: [0, 0] }),
    layerInfo: () => undefined,
    device: () => defaultDevice(),
    measureText: (text, style, maxWidth) => approximateTextMeasurer.measure(String(text), style, maxWidth),
    readScript: (file) => {
      const scripts = doc.scripts;
      if (typeof file !== "string" || !scripts) return undefined;
      const name = file.startsWith("scripts/") ? file.slice("scripts/".length) : file;
      return Object.hasOwn(scripts, name) ? scripts[name] : undefined;
    },
    log: (level, ...args) => {
      logs.push({ level, message: args.map(logText).join(" "), args });
    },
    issue: (code, severity, message) => {
      if (issues.some((i) => i.code === code && i.message === message)) return;
      issues.push({ code, severity, message });
    },
    restart: () => {
      restartRequested = true;
    },
    resolveAssetUrl: () => undefined,
    platform: {},
    ...options.services,
  };

  let states: S[] = [];
  const outputsHeld = new Map<string, unknown[]>();
  const previousInputs = new Map<string, unknown[]>();
  const previousBooleans = new Map<string, boolean[]>();
  let last: HarnessFrame | undefined;

  const coerceTo = (value: unknown, type: ValueType): unknown =>
    type === "any" || value === undefined ? value : coerce(value as Value, inferValueType(value as Value), type);
  const itemFor = (raw: unknown, index: number) => itemAt(raw, wholeMode ? 0 : index);
  /** A held value on a pulse port is a boolean state driving it (rising edges), not a pulse output. */
  const isPulseSource = (key: string): boolean =>
    explicitPulseSources ? explicitPulseSources.has(key) : pulsedKeys.has(key) || (portByKey.get(key)?.type === "pulse" && !held.has(key));

  function readItems(key: string, pulses: ReadonlySet<string>): unknown[] {
    const port = portByKey.get(key);
    if (port && port.type !== "pulse" && pulses.has(key)) return [coerceTo(true, port.type)];
    const raw = held.has(key) ? held.get(key) : port ? defaults.get(key) : undefined;
    if (raw === undefined) return [];
    const items = loopItems(raw);
    return port ? items.map((v) => coerceTo(v, port.type)) : [...items];
  }

  function readInput(key: string, index: number, pulses: ReadonlySet<string>): unknown {
    const port = portByKey.get(key);
    if (port?.wholeLoop) return loopOf(readItems(key, pulses));
    if (port?.type === "pulse") return pulses.has(key) || (held.has(key) && toBool(itemFor(held.get(key), index)));
    if (port && pulses.has(key)) return coerceTo(true, port.type);
    if (!held.has(key)) return port ? defaults.get(key) : undefined;
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

  /** The runtime's muted bypass: variant outputs pass the first variant input, others the first input of the same type. */
  const bypassInputs = outputPorts.map((o) => {
    if (o.type === "pulse") return -1;
    const variant = declaredVariant(spec, o.key, "outputs");
    const preferred = inputPorts.findIndex((i) => i.type !== "pulse" && (variant ? declaredVariant(spec, i.key, "inputs") : !declaredVariant(spec, i.key, "inputs") && i.type === o.type));
    return preferred >= 0 ? preferred : inputPorts.findIndex((i) => i.type !== "pulse" && i.type === o.type);
  });

  function writeOutput(key: string, index: number, value: unknown): void {
    const port = portByKey.get(key);
    let values = outputsHeld.get(key);
    if (!values) outputsHeld.set(key, (values = []));
    values[index] = port?.wholeLoop && Array.isArray(value) ? loopOf(value) : value;
  }

  function writeMuted(index: number, pulses: ReadonlySet<string>): void {
    outputPorts.forEach((o, j) => {
      if (o.type === "pulse") return;
      const source = mutedBehavior === "bypass" ? bypassInputs[j]! : -1;
      if (source >= 0) {
        const input = inputPorts[source]!;
        const value = readInput(input.key, index, pulses);
        writeOutput(o.key, index, o.type === input.type ? value : coerceTo(value, o.type));
      } else {
        writeOutput(o.key, index, o.wholeLoop ? loopOf([]) : zeroValue(o.type, o.enumOptions));
      }
    });
  }

  function step(stepOptions: HarnessStepOptions = {}): HarnessFrame {
    if (stepOptions.inputs) set(stepOptions.inputs);
    const pulses = new Set(stepOptions.pulses ?? []);
    for (const key of pulses) {
      touched.add(key);
      pulsedKeys.add(key);
    }
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
      if (muted && mutedBehavior !== "evaluate") {
        writeMuted(index, pulses);
        continue;
      }
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
        muted,
        services,
        get state(): S {
          return states[index]!;
        },
        set state(value: S) {
          states[index] = value;
        },
        input: <T>(key: string): T => readInput(key, index, pulses) as T,
        inputItems: <T>(key: string): readonly T[] => readItems(key, pulses) as T[],
        isConnected: (key) => (explicitConnected ? explicitConnected.has(key) : held.has(key) || touched.has(key)),
        isPulseSource,
        isFeedback: (key) => feedback.has(key),
        pulsed: (key) => {
          if (pulses.has(key)) return true;
          if (!held.has(key) || !toBool(itemFor(held.get(key), index))) return false;
          const heldSource = explicitPulseSources?.has(key) === true && portByKey.get(key)?.type !== "pulse";
          return heldSource || !(previousBooleans.get(key)?.[index] ?? false);
        },
        changed: (key) => {
          const previous = previousInputs.get(key);
          return previous !== undefined && index < previous.length && !equalValues(readInput(key, index, pulses), previous[index]);
        },
        output: (key, value) => writeOutput(key, index, value),
        pulse: (key) => {
          let flags = fired.get(key);
          if (!flags) fired.set(key, (flags = []));
          flags[index] = true;
        },
        requestNextFrame: () => {
          requested = true;
        },
        warnOnce: (key, message) => {
          const entry = `${componentPath}/${id}#${key}`;
          if (once.has(entry)) return;
          once.add(entry);
          services.log("warn", message);
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
    issues,
    node,
    ports: { inputs: inputPorts, outputs: outputPorts },
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
      once.clear();
      issues.length = 0;
      restarts += 1;
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
