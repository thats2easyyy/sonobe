/**
 * Empty-loop explanations (ARCHITECTURE.md §4, §5.2): why a layer or component instance made 0
 * copies. The runtime records, each frame, the per-item evaluations an empty loop erased (collapses)
 * and the patches that explained an empty output (PatchContext.explainEmpty). `traceEmpty` follows an
 * empty loop upstream from where it was read to where it started, and `describeEmpty` turns the trail
 * into the `empty_loop` warning's message, hint and suggestions, or a sim_get_values note.
 */

import { describePatch, getPatchSpec, resolveNodePorts, type Id, type SonobeDocument, type Suggestion, type Value } from "@sonobe/core";
import type { EmptyLoopFix, EngineRegistry, Loop } from "../types.ts";
import type { NodeRecord } from "./evaluate.ts";
import type { Binding, CNode, InstancePath, Scope } from "./graph.ts";
import { isLoop } from "./loop.ts";

/** A per-item evaluation an empty loop erased: input `fullSlot` had `count` items, `emptySlot` had none. */
export interface Collapse {
  emptySlot: number;
  fullSlot: number;
  count: number;
}

/** A patch's own account of its empty output (PatchContext.explainEmpty). */
export interface EmptyExplanation {
  reason: string;
  fixes: readonly EmptyLoopFix[];
}

export interface EmptyLoopEnv {
  readonly doc: SonobeDocument;
  readonly registry: EngineRegistry;
  read(binding: Binding, path: InstancePath, whole: boolean): Value | Loop | undefined;
  instancePaths(scope: Scope, host: InstancePath): { paths: readonly InstancePath[]; replicated: boolean };
  /** This frame's collapse of a record, if any. */
  collapse(record: NodeRecord): Collapse | undefined;
  /** This frame's explanation of a record's empty output, if any. */
  explanation(record: NodeRecord): EmptyExplanation | undefined;
}

/** One hop of an empty loop's trail, from where it was read back to where it started. */
export type EmptyStep =
  /** A component instance with 0 copies; `input` names its empty loop input, `erased` the longest loop that one erased. */
  | { kind: "instance"; scope: Scope; input: string | undefined; erased: number }
  | { kind: "collapse"; node: CNode; collapse: Collapse }
  /** The patch passed on the empty loop it got at input `slot`. */
  | { kind: "passed"; node: CNode; slot: number }
  | { kind: "explained"; node: CNode; record: NodeRecord; explanation: EmptyExplanation }
  /** The patch made the empty loop itself (a Loop with Count 0, a filter that kept nothing). */
  | { kind: "produced"; node: CNode }
  /** A layer that drew 0 copies, read as a whole loop. */
  | { kind: "layer"; layerId: Id }
  | { kind: "literal" };

/** How the site read the empty loop: "its Position" (a layer property) or "its Card Above Gone input". */
export interface EmptyEntry {
  phrase: string;
  port: string;
  /** What the erased items sat on: "properties" or "inputs". */
  noun: string;
  /** The site in a later sentence (`Layer "Card"`); default "it". */
  site?: string;
}

export interface EmptyReport {
  message: string;
  hint: string;
  suggestions: Suggestion[];
  /** See isSuspicious. */
  suspicious: boolean;
}

const MAX_STEPS = 64;

export const EMPTY_LOOP_HINT =
  "An empty loop wins over every other loop: a patch that gets one runs 0 times, and a layer or component bound to one makes no copies. A patch that picks a safe start value (Or with false, Max with 0) doesn't help, because the empty loop stays empty through it.";

/** Follow the empty loop a binding reads at `path` back to where it started. */
export function traceEmpty(env: EmptyLoopEnv, binding: Binding | null, path: InstancePath): EmptyStep[] {
  const steps: EmptyStep[] = [];
  walkBinding(env, binding, path, steps, new Set());
  return steps;
}

/** The trail of a component instance with 0 copies, starting at the instance. */
export function traceEmptyInstance(env: EmptyLoopEnv, scope: Scope, host: InstancePath): EmptyStep[] {
  const steps: EmptyStep[] = [];
  walkInstance(env, scope, host, steps, new Set());
  return steps;
}

function walkBinding(env: EmptyLoopEnv, b: Binding | null, path: InstancePath, steps: EmptyStep[], seen: Set<NodeRecord>): void {
  if (!b || steps.length > MAX_STEPS) return;
  switch (b.kind) {
    case "const":
      if (isLoop(b.value) && b.value.items.length === 0) steps.push({ kind: "literal" });
      return;
    case "input": {
      let own: InstancePath | null = path;
      while (own && own.scope !== b.scope) own = own.parent;
      if (own?.parent) walkBinding(env, b.input.binding, own.parent, steps, seen);
      return;
    }
    case "variable": {
      let ancestor: InstancePath | null = path;
      while (ancestor && ancestor.scope.depth > b.depth) ancestor = ancestor.parent;
      if (ancestor) walkBinding(env, b.source, ancestor, steps, seen);
      return;
    }
    case "instanceOutput": {
      const { paths, replicated } = env.instancePaths(b.scope, path);
      if (replicated && paths.length === 0) walkInstance(env, b.scope, path, steps, seen);
      else if (b.inner && paths[0]) walkBinding(env, b.inner, paths[0], steps, seen);
      return;
    }
    case "layerRef":
    case "layerOutput":
      steps.push({ kind: "layer", layerId: b.layerId });
      return;
    case "output":
      walkNode(env, b.node, path, steps, seen);
      return;
  }
}

function walkNode(env: EmptyLoopEnv, node: CNode, path: InstancePath, steps: EmptyStep[], seen: Set<NodeRecord>): void {
  const record = node.records.get(path.stateKey);
  // Not evaluated, or around a feedback loop and back again.
  if (!record || seen.has(record)) return;
  seen.add(record);
  const explanation = env.explanation(record);
  if (explanation) {
    steps.push({ kind: "explained", node, record, explanation });
    return;
  }
  const collapse = env.collapse(record);
  if (collapse) {
    steps.push({ kind: "collapse", node, collapse });
    walkBinding(env, node.bindings[collapse.emptySlot] ?? null, path, steps, seen);
    return;
  }
  for (let i = 0; i < node.inputs.length; i++) {
    const v = record.cur[i];
    if (!isLoop(v) || v.items.length > 0) continue;
    steps.push({ kind: "passed", node, slot: i });
    walkBinding(env, node.bindings[i] ?? null, path, steps, seen);
    return;
  }
  steps.push({ kind: "produced", node });
}

function walkInstance(env: EmptyLoopEnv, scope: Scope, host: InstancePath, steps: EmptyStep[], seen: Set<NodeRecord>): void {
  const found = emptyInstanceInput(env, scope, host);
  steps.push({ kind: "instance", scope, input: found?.name, erased: found?.erased ?? 0 });
  if (found) walkBinding(env, found.binding, host, steps, seen);
}

/**
 * The loop input (or looped layer property) that gave a component instance 0 copies, read the way
 * its copies node reads it, and the longest non-empty loop it erased.
 */
export function emptyInstanceInput(env: EmptyLoopEnv, scope: Scope, host: InstancePath): { binding: Binding; name: string; erased: number } | null {
  const node = scope.copies;
  if (!node) return null;
  const layer = scope.kind === "layerInstance" ? scope.parent?.layerIndex.get(scope.instanceId!) : undefined;
  const propName = (r: Binding) => {
    const key = layer ? [...layer.propBindings].find(([, b]) => b === r)?.[0] : undefined;
    return (key && layer?.props.get(key)?.name) || key || "a looped property";
  };
  const candidates: { binding: Binding; name: () => string; feedback: boolean }[] = [];
  for (const input of scope.inputs) if (input.loop) candidates.push({ binding: input.binding, name: () => input.port.name || input.key, feedback: input.feedback });
  scope.replicators.forEach((r, j) => candidates.push({ binding: r, name: () => propName(r), feedback: node.feedback[scope.inputs.length + j] === true }));
  let found: { binding: Binding; name: string } | null = null;
  let erased = 0;
  for (const c of candidates) {
    const v = c.binding.kind === "const" ? c.binding.value : env.read(c.binding, host, false);
    // An empty loop read through a back-edge doesn't count toward the copies (see evaluateCopies).
    if (!isLoop(v) || (c.feedback && v.items.length === 0)) continue;
    if (v.items.length > 0) erased = Math.max(erased, v.items.length);
    else if (!found) found = { binding: c.binding, name: c.name() };
  }
  return found ? { ...found, erased } : null;
}

/** A patch in a sentence: `"Card Above: Gone" (Loop Select)`. */
export function patchLabel(env: EmptyLoopEnv, node: CNode): string {
  return describePatch(node.node, getPatchSpec(env.registry, node.node.type));
}

/** A component instance in a sentence: `"Card Swipe" (Component)` or `Layer "Card"`. */
export function instanceLabel(scope: Scope): string {
  const id = scope.instanceId ?? scope.component.id;
  if (scope.kind === "layerInstance") return `Layer "${scope.parent?.layerIndex.get(id)?.node.name || id}"`;
  const node = scope.parent?.component.patches[id];
  return `"${node?.name || scope.component.name || id}" (Component)`;
}

/** An input's display name ("If False"); a Variable Receiver's input is its variable. */
export function inputName(env: EmptyLoopEnv, node: CNode, slot: number): string {
  if (node.kind === "receiver") return "Variable";
  const key = node.inputs[slot]?.key ?? "";
  const ports = resolveNodePorts(env.doc, node.node, env.registry);
  return ports?.inputs.find((p) => p.key === key)?.name || key;
}

function shortValue(v: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(v) ?? String(v);
  } catch {
    text = String(v);
  }
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

/** Why the trail's origin got a single value where a loop was expected, when a feedback cable is the reason. */
function feedbackNote(env: EmptyLoopEnv, step: Extract<EmptyStep, { kind: "explained" }>): string | null {
  const { node, record } = step;
  for (let i = 0; i < node.inputs.length; i++) {
    const v = record.cur[i];
    if (isLoop(v)) continue;
    const b = node.bindings[i];
    if (node.feedback[i]) {
      return `Its ${inputName(env, node, i)} reads a feedback cable: on the first frame, and while the loop is empty, that cable has no list yet, so it got one value (${shortValue(v)}), not a loop.`;
    }
    if (b?.kind === "output" && b.node.kind === "delay1" && b.node.feedback[0]) {
      return `${patchLabel(env, b.node)} closes a feedback loop: on the first frame, and while the loop is empty, it passes one value (${shortValue(v)}), not a loop.`;
    }
  }
  return null;
}

const isOrigin = (s: EmptyStep) => s.kind === "explained" || s.kind === "produced" || s.kind === "layer" || s.kind === "literal";

/** "<entry> comes from X, which ..." down the trail to the first origin. */
function clause(env: EmptyLoopEnv, steps: readonly EmptyStep[], entry: string): string {
  const k = steps.findIndex((s) => s.kind === "instance" || isOrigin(s));
  const s = steps[k];
  if (!s) return `${entry} is an empty loop`;
  switch (s.kind) {
    case "instance":
      return `${entry} comes from ${instanceLabel(s.scope)}, which has 0 copies because ${clause(env, steps.slice(k + 1), s.input ? `its ${s.input} input` : "one of its loop inputs")}`;
    case "explained":
      return `${patchLabel(env, s.node)} returned an empty loop: ${s.explanation.reason.replace(/[.\s]+$/, "")}`;
    case "produced":
      return `${entry} comes from ${patchLabel(env, s.node)}, which outputs an empty loop`;
    case "layer":
      return `${entry} comes from layer "${s.layerId}", which drew 0 copies last frame`;
    default: {
      // An empty literal loop: name the patch input it's typed into.
      const by = steps[k - 1];
      if (by?.kind === "passed") return `${entry} comes from ${patchLabel(env, by.node)}, whose ${inputName(env, by.node, by.slot)} is set to an empty loop`;
      if (by?.kind === "collapse") return `${entry} comes from ${patchLabel(env, by.node)}, whose ${inputName(env, by.node, by.collapse.emptySlot)} is set to an empty loop`;
      return `${entry} is set to an empty loop`;
    }
  }
}

/**
 * The warning for a site with 0 copies (or a note about an empty value): `head` ("Layer "Card" has 0
 * copies"), how the site read the empty loop, the longest loop it erased there, and the trail.
 */
export function describeEmpty(env: EmptyLoopEnv, head: string, entry: EmptyEntry, erased: number, steps: readonly EmptyStep[]): EmptyReport {
  const sentences = [`${head} because ${clause(env, steps, entry.phrase)}.`];
  const reached: string[] = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (s.kind === "collapse") {
      const { emptySlot, fullSlot, count } = s.collapse;
      reached.push(`reached ${patchLabel(env, s.node)} on ${inputName(env, s.node, emptySlot)} and erased the ${count} ${count === 1 ? "item" : "items"} on ${fullSlot >= 0 ? inputName(env, s.node, fullSlot) : "its other inputs"}`);
    } else if (s.kind === "instance" && s.erased > 0) {
      reached.push(`reached ${instanceLabel(s.scope)} on ${s.input ?? "a loop input"} and erased the ${s.erased} items on its other inputs`);
    }
  }
  if (erased > 0) reached.push(`reached ${entry.site ?? "it"} on ${entry.port} and erased the ${erased} ${erased === 1 ? "item" : "items"} on its other ${entry.noun}`);
  if (reached.length) sentences.push(`The empty loop ${reached.join(", then ")}.`);
  const explained = steps.find((s): s is Extract<EmptyStep, { kind: "explained" }> => s.kind === "explained");
  const note = explained ? feedbackNote(env, explained) : null;
  if (note) sentences.push(note);

  const suggestions: Suggestion[] = [];
  if (explained) {
    const { node } = explained;
    for (const fix of explained.explanation.fixes) {
      // The editor labels a fix button with the text before the first ": " or ". ", so the patch name goes last.
      suggestions.push({
        description: `${fix.description.replace(/[.\s]+$/, "")}. It changes ${patchLabel(env, node)}.`,
        ops: [{ op: "setInput", component: node.scope.component.id, target: `${node.id}.${fix.input}`, value: fix.value }],
      });
    }
  }
  return { message: sentences.join(" "), hint: EMPTY_LOOP_HINT, suggestions, suspicious: isSuspicious(steps, erased) };
}

/**
 * The trail looks like a mistake: an empty loop erased a non-empty one on the way (or at the site),
 * or a patch explained its empty output. A list that is simply empty (a filter that matched
 * nothing) does not.
 */
export function isSuspicious(steps: readonly EmptyStep[], erased: number): boolean {
  return erased > 0 || steps.some((s) => s.kind === "collapse" || s.kind === "explained" || (s.kind === "instance" && s.erased > 0));
}
