/**
 * Per-node evaluation: loop expansion (max length, wrap, broadcast), per-index state, pulses and
 * rising edges, changed(), sticky outputs, muting, and the PatchContext handed to evaluators.
 * Shared by the runtime and the isolated `runPatch` test harness.
 */

import type { Id, PatchNode, Value, ValueType } from "@sonobe/core";
import type { Loop, PatchContext, PatchDefinition, RuntimeServices } from "../types.ts";
import { isLoop, makeLoop, MAX_LOOP_LENGTH, toLoop } from "./loop.ts";
import { truthy, valuesEqual } from "./values.ts";

/**
 * What happens while a patch is muted:
 * - "bypass" (default): evaluate is skipped; each output passes the first input of the same type,
 *   other outputs emit zero values and pulses never fire.
 * - "zero": evaluate is skipped and every output emits its zero value.
 * - "evaluate": evaluate runs as usual and the patch checks `ctx.node.muted` itself.
 */
export type MutedBehavior = "bypass" | "zero" | "evaluate";

/** A PatchDefinition may declare its muted behavior (engine extension, see README). */
export type RuntimePatchDefinition<S = any> = PatchDefinition<S> & { mutedBehavior?: MutedBehavior };

export interface InputSlot {
  key: string;
  type: ValueType;
  wholeLoop: boolean;
  /** The driver is a pulse-typed output: true means "fired this frame" (consecutive frames count). */
  pulseSource: boolean;
  connected: boolean;
  /** Value used when nothing drives the port (decoded default or literal). */
  default: Value | Loop;
  zero: Value;
}

export interface OutputSlot {
  key: string;
  type: ValueType;
  wholeLoop: boolean;
  pulse: boolean;
  /** Value before the first write. */
  initial: Value | Loop;
  zero: Value | Loop;
}

/** The static description of one evaluable patch. */
export interface NodeSpec {
  id: Id;
  node: PatchNode;
  def: RuntimePatchDefinition | null;
  inputs: InputSlot[];
  outputs: OutputSlot[];
  inputIndex: Map<string, number>;
  outputIndex: Map<string, number>;
  /** Any port is wholeLoop: evaluate once per frame with whole loops. */
  wholeLoop: boolean;
  muted: boolean;
  mutedBehavior: MutedBehavior;
  /** Input slot passed through by each output while muted (-1 = zero value). */
  bypass: number[];
  typeParam: string | undefined;
  inputCount: number;
  context?: PatchCtx;
}

/** Runtime storage for one node at one instance path. */
export interface NodeRecord {
  key: string;
  /** Last evaluated frame (-1 = never). */
  frame: number;
  states: unknown[];
  /** Sticky per-index outputs. */
  outs: (Value | Loop)[][];
  /** Assembled outputs (Loops when the loop count isn't 1). */
  values: (Value | Loop | undefined)[];
  cur: (Value | Loop)[];
  prev: (Value | Loop)[];
  hasPrev: boolean;
  /** Loop count of the previous evaluation. */
  prevCount: number;
}

export interface EvalEnv {
  frame: number;
  time: number;
  dt: number;
  services: RuntimeServices;
  requestFrame(): void;
  issue(code: string, severity: "error" | "warning", message: string, patchId?: Id): void;
}

/** Output slot per input slot map for the default mute bypass. */
export function bypassMap(inputs: readonly InputSlot[], outputs: readonly OutputSlot[]): number[] {
  return outputs.map((o) => (o.pulse ? -1 : inputs.findIndex((i) => i.type === o.type && i.type !== "pulse")));
}

export function createRecord(spec: NodeSpec, key: string): NodeRecord {
  const n = spec.inputs.length;
  return {
    key,
    frame: -1,
    states: [],
    outs: [],
    values: spec.outputs.map((o) => o.initial),
    cur: new Array<Value | Loop>(n),
    prev: new Array<Value | Loop>(n),
    hasPrev: false,
    prevCount: 0,
  };
}

/** Swap input buffers and return the buffer to fill with this frame's coerced inputs. */
export function beginInputs(record: NodeRecord): (Value | Loop)[] {
  const t = record.prev;
  record.prev = record.cur;
  record.cur = t;
  record.hasPrev = record.frame >= 0;
  return record.cur;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Dispose one state, reporting (never throwing) failures. */
export function disposeState(spec: NodeSpec, state: unknown, env: Pick<EvalEnv, "services" | "issue">): void {
  const dispose = spec.def?.dispose;
  if (!dispose) return;
  try {
    dispose(state, env.services);
  } catch (err) {
    env.issue("patch_threw", "error", `${spec.id} (${spec.node.type}) failed to dispose: ${errorMessage(err)}`, spec.id);
  }
}

/** Dispose every state in a record. */
export function disposeRecord(spec: NodeSpec, record: NodeRecord, env: Pick<EvalEnv, "services" | "issue">): void {
  for (const state of record.states) disposeState(spec, state, env);
  record.states.length = 0;
  record.outs.length = 0;
}

/**
 * Evaluate a node for one instance path. `record.cur` must hold this frame's coerced inputs
 * (see beginInputs). Outputs land in `record.values`.
 */
export function evaluateRecord(spec: NodeSpec, record: NodeRecord, env: EvalEnv, componentPath: string): void {
  const inputs = spec.inputs;
  const cur = record.cur;
  let count = 1;
  let looping = false;
  if (!spec.wholeLoop) {
    let max = 0;
    let empty = false;
    for (let i = 0; i < inputs.length; i++) {
      const v = cur[i];
      if (inputs[i]!.wholeLoop || !isLoop(v)) continue;
      looping = true;
      const n = v.items.length;
      if (n === 0) empty = true;
      else if (n > max) max = n;
    }
    if (looping) {
      count = empty ? 0 : max;
      if (count > MAX_LOOP_LENGTH) {
        env.issue("loop_limit", "warning", `${spec.id} received a loop of ${count} items; loops are capped at ${MAX_LOOP_LENGTH}.`, spec.id);
        count = MAX_LOOP_LENGTH;
      }
    }
  }
  record.frame = env.frame;

  const def = spec.def;
  if (!def || (spec.muted && spec.mutedBehavior !== "evaluate")) {
    if (spec.muted) applyMuted(spec, record);
    record.prevCount = count;
    return;
  }

  const states = record.states;
  const outs = record.outs;
  while (states.length > count) {
    disposeState(spec, states.pop(), env);
    outs.pop();
  }
  while (states.length < count) {
    let state: unknown;
    try {
      state = def.state ? def.state() : undefined;
    } catch (err) {
      env.issue("patch_threw", "error", `${spec.id} (${spec.node.type}) failed to create state: ${errorMessage(err)}`, spec.id);
    }
    states.push(state);
    outs.push(spec.outputs.map((o) => o.initial));
  }

  const ctx = (spec.context ??= new PatchCtx(spec));
  ctx.record = record;
  ctx.env = env;
  ctx.services = env.services;
  ctx.componentPath = componentPath;
  ctx.frame = env.frame;
  ctx.time = env.time;
  ctx.dt = env.dt;
  ctx.loopCount = looping ? count : 1;
  const outputs = spec.outputs;
  for (let i = 0; i < count; i++) {
    const o = outs[i]!;
    for (let j = 0; j < outputs.length; j++) if (outputs[j]!.pulse) o[j] = false;
    ctx.loopIndex = i;
    ctx.state = states[i];
    try {
      def.evaluate(ctx);
    } catch (err) {
      env.issue("patch_threw", "error", `${spec.id} (${spec.node.type}) threw: ${errorMessage(err)}`, spec.id);
    }
    states[i] = ctx.state;
  }

  const values = record.values;
  for (let j = 0; j < outputs.length; j++) {
    if (count === 1) {
      values[j] = outs[0]![j];
    } else {
      const items = new Array<Value>(count);
      for (let i = 0; i < count; i++) items[i] = outs[i]![j];
      values[j] = makeLoop(items);
    }
  }
  record.prevCount = count;
}

function applyMuted(spec: NodeSpec, record: NodeRecord): void {
  const outputs = spec.outputs;
  for (let j = 0; j < outputs.length; j++) {
    const o = outputs[j]!;
    const source = spec.mutedBehavior === "zero" ? -1 : spec.bypass[j]!;
    record.values[j] = o.pulse ? false : source >= 0 ? record.cur[source] : o.zero;
  }
}

/** The PatchContext implementation: one per node, reused across paths, indices and frames. */
export class PatchCtx implements PatchContext {
  id: Id;
  node: PatchNode;
  componentPath = "";
  frame = 0;
  time = 0;
  dt = 0;
  loopIndex = 0;
  loopCount = 1;
  typeParam: string | undefined;
  inputCount: number;
  state: any;
  services!: RuntimeServices;
  readonly spec: NodeSpec;
  record!: NodeRecord;
  env!: EvalEnv;

  constructor(spec: NodeSpec) {
    this.spec = spec;
    this.id = spec.id;
    this.node = spec.node;
    this.typeParam = spec.typeParam;
    this.inputCount = spec.inputCount;
  }

  private slot(key: string): number {
    const slot = this.spec.inputIndex.get(key);
    if (slot === undefined) {
      this.env.issue("unknown_port", "warning", `${this.id} (${this.node.type}) read an input "${key}" that it doesn't declare.`, this.id);
      return -1;
    }
    return slot;
  }

  private item(buffer: readonly (Value | Loop)[], slot: number): Value {
    const v = buffer[slot];
    if (!isLoop(v)) return v;
    const s = this.spec.inputs[slot]!;
    const n = v.items.length;
    if (n === 0) return s.zero;
    if (this.spec.wholeLoop || s.wholeLoop) return v.items[0];
    return v.items[this.loopIndex % n];
  }

  private pulsedSlot(slot: number): boolean {
    if (!truthy(this.item(this.record.cur, slot))) return false;
    if (this.spec.inputs[slot]!.pulseSource) return true;
    if (!this.record.hasPrev || this.loopIndex >= this.record.prevCount) return true;
    return !truthy(this.item(this.record.prev, slot));
  }

  input<T = Value>(key: string): T {
    const slot = this.slot(key);
    if (slot < 0) return undefined as T;
    if (this.spec.inputs[slot]!.type === "pulse") return this.pulsedSlot(slot) as T;
    return this.item(this.record.cur, slot) as T;
  }

  inputItems<T = Value>(key: string): readonly T[] {
    const slot = this.slot(key);
    if (slot < 0) return [];
    const v = this.record.cur[slot];
    return (isLoop(v) ? v.items : [v]) as readonly T[];
  }

  isConnected(key: string): boolean {
    const slot = this.spec.inputIndex.get(key);
    return slot !== undefined && this.spec.inputs[slot]!.connected;
  }

  pulsed(key: string): boolean {
    const slot = this.slot(key);
    return slot >= 0 && this.pulsedSlot(slot);
  }

  changed(key: string): boolean {
    const slot = this.slot(key);
    if (slot < 0 || !this.record.hasPrev || this.loopIndex >= this.record.prevCount) return false;
    if (this.spec.inputs[slot]!.wholeLoop) return !valuesEqual(this.record.prev[slot], this.record.cur[slot]);
    return !valuesEqual(this.item(this.record.prev, slot), this.item(this.record.cur, slot));
  }

  private outputSlot(key: string): number {
    const slot = this.spec.outputIndex.get(key);
    if (slot === undefined) {
      this.env.issue("unknown_port", "warning", `${this.id} (${this.node.type}) wrote an output "${key}" that it doesn't declare.`, this.id);
      return -1;
    }
    return slot;
  }

  output(key: string, value: Value): void {
    const slot = this.outputSlot(key);
    if (slot < 0) return;
    const o = this.spec.outputs[slot]!;
    this.record.outs[this.loopIndex]![slot] = o.wholeLoop ? toLoop(value) : value;
  }

  pulse(key: string): void {
    const slot = this.outputSlot(key);
    if (slot >= 0) this.record.outs[this.loopIndex]![slot] = true;
  }

  requestNextFrame(): void {
    this.env.requestFrame();
  }
}
