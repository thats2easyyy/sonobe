/** Test runtimes, frame runners, and the isolated patch harness. */

import {
  coerce,
  createEmptyDocument,
  deviceScreenSize,
  getDevicePreset,
  inferValueType,
  isInputValue,
  isLinkInput,
  resolveNodePorts,
  type Id,
  type InputValue,
  type PatchNode,
  type SonobeDocument,
  type Value,
  type ValueType,
} from "@sonobe/core";
import { KeyboardTracker } from "../gestures/keyboard.ts";
import { PointerTracker } from "../gestures/pointer.ts";
import { approximateTextMeasurer } from "../layout/textMeasurer.ts";
import { createEngineRegistry } from "../runtime/builtins.ts";
import { declaredVariant, effectiveInputCount } from "../runtime/compile.ts";
import {
  beginInputs,
  bypassMap,
  createRecord,
  disposeRecord,
  evaluateRecord,
  type EvalEnv,
  type InputSlot,
  type NodeSpec,
  type OutputSlot,
} from "../runtime/evaluate.ts";
import { isLoop, makeLoop } from "../runtime/loop.ts";
import { mulberry32 } from "../runtime/random.ts";
import { createRuntime, DETERMINISTIC_EPOCH_MS, type SonobeRuntime } from "../runtime/runtime.ts";
import { coerceValue, decodeStored, normalizeDefault, portDefault, zeroValue } from "../runtime/values.ts";
import type { EngineRegistry, InputEvent, Loop, PatchDefinition, Runtime, RuntimeIssue, RuntimeOptions, RuntimeServices, SceneFrame } from "../types.ts";
import { createMockRegistry } from "./mockDefinitions.ts";

function isEngineRegistry(value: unknown): value is EngineRegistry {
  return !!value && typeof value === "object" && (value as EngineRegistry).definitions instanceof Map;
}

/**
 * A deterministic runtime (seed 1) for tests. `definitions` may be an EngineRegistry, or a list
 * of definitions added to (and replacing) the mocks.
 */
export function createTestRuntime(
  doc: SonobeDocument,
  definitions?: EngineRegistry | readonly PatchDefinition[],
  options: Partial<Omit<RuntimeOptions, "registry">> = {},
): SonobeRuntime {
  const registry = isEngineRegistry(definitions) ? definitions : createMockRegistry(definitions ?? []);
  return createRuntime(doc, { deterministic: true, seed: 1, ...options, registry });
}

export type EventsByFrame =
  | readonly (readonly InputEvent[] | undefined)[]
  | Readonly<Record<number, readonly InputEvent[]>>
  | ((index: number) => readonly InputEvent[] | undefined);

/** Step `n` frames, dispatching `events[i]` before the i-th step. Returns the produced frames. */
export function runFrames(runtime: Runtime, n: number, events?: EventsByFrame): SceneFrame[] {
  const frames: SceneFrame[] = [];
  for (let i = 0; i < n; i++) {
    const batch = typeof events === "function" ? events(i) : (events as Record<number, readonly InputEvent[] | undefined> | undefined)?.[i];
    if (batch?.length) runtime.dispatch([...batch]);
    frames.push(runtime.step());
  }
  return frames;
}

export interface RunPatchOptions {
  id?: Id;
  typeParam?: string;
  inputCount?: number;
  settings?: PatchNode["settings"];
  muted?: boolean;
  component?: Id;
  componentPath?: string;
  /** Frame rate for dt (frame 0 has dt 0). Default 60. */
  fps?: 60 | 120;
  seed?: number;
  /** Inputs reported as connected (default: every key that appears in any frame). */
  connected?: readonly string[];
  /** Pulse inputs driven by a boolean state (fire on rising edges) instead of upstream pulses. */
  edgeInputs?: readonly string[];
  services?: Partial<RuntimeServices>;
  /** Document for dynamicPorts (javascript, component) and device info. */
  doc?: SonobeDocument;
}

export interface RunPatchFrame {
  frame: number;
  time: number;
  outputs: Record<string, Value | Loop>;
  /** Pulse outputs that fired this frame (at any loop index). */
  pulses: string[];
  requestedNextFrame: boolean;
}

export interface RunPatchResult {
  frames: RunPatchFrame[];
  logs: { level: "log" | "warn" | "error"; args: unknown[] }[];
  issues: RuntimeIssue[];
  restarts: number;
  /** Per-loop-index states after the last frame. */
  states: unknown[];
  /** Dispose every state. */
  dispose(): void;
}

function toRuntimeValue(raw: unknown, type: ValueType): Value | Loop | undefined {
  if (isLoop(raw)) return coerceValue(raw, raw.items.length ? inferValueType(raw.items[0]) : type, type);
  if (isInputValue(raw)) return isLinkInput(raw) ? undefined : decodeStored(raw as InputValue, type);
  return coerce(raw as Value, inferValueType(raw as Value), type);
}

/**
 * Run one definition in isolation with scripted inputs, using the runtime's own evaluation
 * (loops, per-index state, pulses, changed(), muting). `framesOfInputs[i]` sets inputs for
 * frame i: values hold until changed, except pulse inputs, which fire only on frames that set
 * them true (edgeInputs hold like states and fire on rising edges). Values may be runtime values,
 * document literals (`{ "loop": [...] }`, "#RRGGBBAA"), or Loops.
 */
export function runPatch(definition: PatchDefinition, framesOfInputs: readonly Readonly<Record<string, unknown>>[], options: RunPatchOptions = {}): RunPatchResult {
  const doc = options.doc ?? createEmptyDocument({ name: "runPatch", device: "custom" });
  const registry = createEngineRegistry([definition]);
  const node: PatchNode = { type: definition.type, inputs: {}, ui: { x: 0, y: 0 } };
  if (options.typeParam !== undefined) node.typeParam = options.typeParam;
  if (options.inputCount !== undefined) node.inputCount = options.inputCount;
  if (options.settings !== undefined) node.settings = options.settings;
  if (options.muted) node.muted = true;
  if (options.component !== undefined) node.component = options.component;
  const ports = resolveNodePorts(doc, node, registry);
  if (!ports) throw new Error(`runPatch: "${definition.type}" has no spec.`);

  const seen = new Set<string>();
  for (const frame of framesOfInputs) for (const key of Object.keys(frame)) seen.add(key);
  const connected = new Set(options.connected ?? seen);
  const edges = new Set(options.edgeInputs ?? []);
  const variantDefaults = ports.typeParam ? ports.spec.variantDefaults?.[ports.typeParam] : undefined;
  const inputs: InputSlot[] = ports.inputs.map((p) => {
    const raw = variantDefaults?.[p.key] ?? p.default;
    const wholeLoop = p.wholeLoop === true;
    const value = normalizeDefault(raw, p.type) ?? (wholeLoop && raw === undefined ? makeLoop([]) : portDefault(p));
    return {
      key: p.key,
      type: p.type,
      variant: declaredVariant(ports.spec, p.key, "inputs"),
      wholeLoop,
      pulseSource: p.type === "pulse" && !edges.has(p.key),
      connected: connected.has(p.key),
      default: value,
      zero: zeroValue(p.type, p.enumOptions),
    };
  });
  const outputs: OutputSlot[] = ports.outputs.map((p) => {
    const wholeLoop = p.wholeLoop === true;
    const zero = wholeLoop ? makeLoop([]) : zeroValue(p.type, p.enumOptions);
    return { key: p.key, type: p.type, variant: declaredVariant(ports.spec, p.key, "outputs"), wholeLoop, pulse: p.type === "pulse", initial: p.type === "pulse" ? false : (normalizeDefault(p.default, p.type) ?? zero), zero };
  });
  const spec: NodeSpec = {
    id: options.id ?? "patch",
    node,
    def: definition,
    inputs,
    outputs,
    inputIndex: new Map(inputs.map((s, i) => [s.key, i])),
    outputIndex: new Map(outputs.map((s, i) => [s.key, i])),
    wholeLoop: inputs.some((s) => s.wholeLoop) || outputs.some((s) => s.wholeLoop),
    muted: node.muted === true,
    mutedBehavior: definition.mutedBehavior ?? "bypass",
    bypass: bypassMap(inputs, outputs),
    typeParam: ports.typeParam,
    inputCount: effectiveInputCount(ports.spec, node, ports.inputCount),
  };

  const logs: RunPatchResult["logs"] = [];
  const issues = new Map<string, RuntimeIssue>();
  let restarts = 0;
  let time = 0;
  const rng = mulberry32(options.seed ?? 1);
  const pointer = new PointerTracker();
  const keyboard = new KeyboardTracker();
  const preset = getDevicePreset(doc.project.device.preset);
  const addIssue = (code: string, severity: RuntimeIssue["severity"], message: string, patchId?: Id) => {
    const item: RuntimeIssue = { code, severity, message };
    if (patchId !== undefined) item.patchId = patchId;
    issues.set(`${code}|${message}`, item);
  };
  const services: RuntimeServices = {
    random: () => rng(),
    now: () => DETERMINISTIC_EPOCH_MS + time * 1000,
    deterministic: true,
    restartCount: 0,
    pointer: () => pointer.snapshot(null),
    pointers: () => pointer.pointers(null),
    keyboard: () => keyboard.snapshot(),
    wheel: () => ({ delta: [0, 0], position: [0, 0], velocity: [0, 0] }),
    layerInfo: () => undefined,
    device: () => ({
      preset: preset.id,
      screenSize: deviceScreenSize(doc.project.device),
      screenScale: preset.scale,
      safeArea: [...preset.safeArea],
      orientation: doc.project.device.orientation ?? "portrait",
      darkMode: false,
      platform: "desktop",
      timeZone: "UTC",
    }),
    measureText: (text, style, maxWidth) => approximateTextMeasurer.measure(String(text), style, maxWidth),
    readScript: (file) => (Object.prototype.hasOwnProperty.call(doc.scripts ?? {}, file) ? doc.scripts[file] : undefined),
    log: (level, ...args) => {
      logs.push({ level, args });
    },
    issue: (code, severity, message) => addIssue(code, severity, message, spec.id),
    restart: () => {
      restarts++;
    },
    resolveAssetUrl: () => undefined,
    platform: {},
    ...options.services,
  };

  const record = createRecord(spec, options.componentPath ?? "main");
  const held: Record<string, unknown> = {};
  const fps = options.fps ?? 60;
  const env: EvalEnv = {
    frame: 0,
    time: 0,
    dt: 0,
    services,
    requestFrame: () => {
      requested = true;
    },
    issue: addIssue,
    once: new Set(),
  };
  let requested = false;
  const frames: RunPatchFrame[] = [];
  for (let f = 0; f < framesOfInputs.length; f++) {
    const given = framesOfInputs[f]!;
    Object.assign(held, given);
    const dt = f === 0 ? 0 : 1 / fps;
    time += dt;
    const cur = beginInputs(record);
    inputs.forEach((s, i) => {
      const raw = s.type === "pulse" && !edges.has(s.key) ? given[s.key] : held[s.key];
      const v = raw === undefined ? undefined : toRuntimeValue(raw, s.type);
      cur[i] = v === undefined ? (s.type === "pulse" ? false : s.default) : v;
    });
    requested = false;
    env.frame = f;
    env.time = time;
    env.dt = dt;
    evaluateRecord(spec, record, env, options.componentPath ?? "main");
    const out: Record<string, Value | Loop> = {};
    const pulses: string[] = [];
    outputs.forEach((o, j) => {
      const v = record.values[j];
      out[o.key] = v;
      if (o.pulse && (v === true || (isLoop(v) && v.items.some((x) => x === true)))) pulses.push(o.key);
    });
    frames.push({ frame: f, time, outputs: out, pulses, requestedNextFrame: requested });
  }
  return {
    frames,
    logs,
    issues: [...issues.values()],
    restarts,
    states: record.states,
    dispose: () => disposeRecord(spec, record, env),
  };
}
