/**
 * getDiagnostics (ARCHITECTURE §3.6): a pure pass over a document that reports problems
 * and teaching hints with ready-to-apply suggestions.
 */

import { parseAddress } from "./address.ts";
import { componentDependencies, listComponentIds } from "./document.ts";
import { DELAY_ONE_FRAME_TYPE, feedbackLoops, patchEdges, VARIABLE_RECEIVER_TYPE, type FeedbackEdge, type FeedbackLoop, type PatchEdge } from "./graph.ts";
import { getOwn, isValidId } from "./ids.ts";
import { describePatch, layerDisplayName, patchDisplayName } from "./names.ts";
import { listInputs } from "./ops/references.ts";
import {
  allLayerIds,
  COMPONENT_INSTANCE_LAYER_TYPE,
  COMPONENT_PATCH_TYPE,
  findLayer,
  findPort,
  getInputCountRange,
  getPatchSpec,
  interfacePortToPort,
  resolveNodePorts,
  walkLayers,
} from "./registry.ts";
import { didYouMean, didYouMeanText } from "./suggest.ts";
import type { Component, Diagnostic, Id, LayerNode, PatchNode, PatchSpec, Registry, Severity, SonobeDocument, SonobeError, Suggestion, ValueType } from "./types.ts";
import { fileNameCollisions } from "./serialize.ts";
import { checkInputValue, checkLink, checkLiteral, insertPatchSuggestion, resolveSource, resolveTarget, type PortTarget, type ValidateOptions } from "./validate.ts";
import { isAssetInput, isLayerInput, isLinkInput } from "./values.ts";
import { componentBroadcasters, followingReceivers, type VariableInfo } from "./variables.ts";

export interface DiagnosticsOptions {
  /** Limit the pass to these components (default: all). */
  components?: Id[];
}

function diag(severity: Severity, code: string, message: string, component: Id, itemIds: Id[], extra: { port?: string; hint?: string; suggestions?: Suggestion[] } = {}): Diagnostic {
  const d: Diagnostic = { code, severity, message, component, itemIds };
  if (extra.hint !== undefined) d.hint = extra.hint;
  if (extra.port !== undefined) d.port = extra.port;
  if (extra.suggestions?.length) d.suggestions = extra.suggestions;
  return d;
}

const withHint = (e: SonobeError) => (e.hint ? `${e.message} ${e.hint}` : e.message);

const STATE_TYPES = new Set(["boolean", "number", "index"]);

/** "a", "a and b", "a, b and c". */
const listText = (items: readonly string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * Inputs a patch reads only on the frame one of its pulse inputs fires: patch type → input key →
 * the pulse input that reads it. A loop that comes back through one of these passes a value once
 * per pulse (the carousel's "next page" jump, a sample-and-hold grab), not every frame.
 */
const PULSE_GATED_INPUTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  sampleAndHold: { value: "sample" },
  counter: { jumpToNumber: "jump" },
  scroll: { jumpPositionX: "jumpToX", jumpPositionY: "jumpToY" },
  loopInsert: { value: "insert", index: "insert" },
  loopAppend: { value: "append" },
  arrayAppend: { item: "append" },
};

/** A cable inside a loop that keeps the loop from feeding itself every frame. */
type LoopBreak =
  | { kind: "delay"; edge: PatchEdge }
  | { kind: "pulse"; edge: PatchEdge; port: string }
  | { kind: "gated"; edge: PatchEdge; gate: string };

/** True when `edges` still connect some of `ids` in a cycle. */
function hasCycle(ids: readonly Id[], edges: readonly PatchEdge[]): boolean {
  const succ = new Map<Id, Id[]>();
  for (const e of edges) succ.set(e.sourceId, [...(succ.get(e.sourceId) ?? []), e.targetId]);
  const state = new Map<Id, 1 | 2>();
  const visit = (v: Id): boolean => {
    state.set(v, 1);
    for (const w of succ.get(v) ?? []) {
      const s = state.get(w);
      if (s === 1 || (s === undefined && visit(w))) return true;
    }
    state.set(v, 2);
    return false;
  };
  return ids.some((id) => state.get(id) === undefined && visit(id));
}

/**
 * Whether a loop is intentional: every cycle through it passes a Delay One Frame, a pulse input, or
 * an input its patch only reads when a pulse fires (`breaks`). `continuous` holds the loop's other
 * cables, which pass values every frame.
 */
function loopBreaks(doc: SonobeDocument, c: Component, registry: Registry, loop: FeedbackLoop, edges: readonly PatchEdge[]): { intentional: boolean; breaks: LoopBreak[]; continuous: PatchEdge[] } {
  const members = new Set(loop.patchIds);
  const inner = edges.filter((e) => members.has(e.sourceId) && members.has(e.targetId));
  const breaks: LoopBreak[] = [];
  const rest: PatchEdge[] = [];
  for (const e of inner) {
    const node = c.patches[e.targetId]!;
    if (node.type === DELAY_ONE_FRAME_TYPE) {
      breaks.push({ kind: "delay", edge: e });
      continue;
    }
    const inputs = resolveNodePorts(doc, node, registry)?.inputs ?? [];
    const port = findPort(inputs, e.targetKey);
    if (port?.type === "pulse") {
      breaks.push({ kind: "pulse", edge: e, port: port.name });
      continue;
    }
    const gate = PULSE_GATED_INPUTS[node.type]?.[e.targetKey];
    const gatePort = gate !== undefined ? findPort(inputs, gate) : undefined;
    if (gatePort) {
      breaks.push({ kind: "gated", edge: e, gate: gatePort.name });
      continue;
    }
    rest.push(e);
  }
  return { intentional: !hasCycle(loop.patchIds, rest), breaks, continuous: rest };
}

/**
 * feedback_loop: names the cables that read the previous frame. Intentional loops (broken by Delay
 * One Frame, or passing values only when a pulse fires) are calm info; loops that feed values back
 * every frame are warnings with ready fixes.
 */
function feedbackDiagnostic(doc: SonobeDocument, c: Component, registry: Registry, loop: FeedbackLoop, edges: readonly PatchEdge[]): Diagnostic {
  const delayName = getPatchSpec(registry, DELAY_ONE_FRAME_TYPE)?.name ?? "Delay One Frame";
  const receiverName = getPatchSpec(registry, VARIABLE_RECEIVER_TYPE)?.name ?? "Variable Receiver";
  const cable = (e: { from: string; to: string }) => `${e.from} → ${e.to}`;
  const connections = (list: readonly FeedbackEdge[]) => `The ${list.length === 1 ? "connection" : "connections"} ${listText(list.map(cable))}`;
  /** The stored link a fix acts on: the target's own link, or a variable broadcaster's Value link. */
  const storedLink = (e: PatchEdge) => (e.via?.kind === "variable" ? { from: e.from, to: `${e.via.broadcasterId}.value`, patchId: e.via.broadcasterId } : { from: e.from, to: e.to, patchId: e.targetId });
  const delayed = loop.feedback.filter((e) => e.reason === "delay1");
  const backwards = loop.feedback.filter((e) => e.reason === "backwards" && !e.via);
  const byOrder = loop.feedback.filter((e) => e.reason === "id" && !e.via);
  // Reads through a layer property or a variable have no cable between the two patches to point at.
  const readsThrough = loop.feedback.filter((e) => e.reason !== "delay1" && e.via);
  const readSentence = (e: FeedbackEdge) =>
    e.via?.kind === "variable"
      ? `${receiverName} "${e.targetId}" reads the variable "${e.via.name}", which ${e.sourceId}.${e.sourceKey} drives, so it reads last frame's value.`
      : `${e.to} reads ${e.from}, which ${e.sourceId}.${e.sourceKey} drives, so it reads last frame's value.`;
  const patches = `Patches ${loop.patchIds.map((x) => `"${x}"`).join(", ")}`;
  const analysis = loopBreaks(doc, c, registry, loop, edges);
  const breaks = analysis.intentional ? analysis.breaks : null;
  const parts: string[] = [];

  const delaySentence = () => {
    const one = delayed.length === 1;
    return `${delayName} ${listText(delayed.map((e) => `"${e.targetId}"`))} ${one ? "gives" : "give"} it one frame of delay, so ${listText(delayed.map(cable))} ${one ? "reads last frame's value" : "read last frame's values"}`;
  };
  const lagSentences = () => {
    const out: string[] = [];
    if (backwards.length) out.push(`${connections(backwards)} ${backwards.length === 1 ? "runs right to left, so it reads last frame's value" : "run right to left, so they read last frame's values"}.`);
    if (byOrder.length) out.push(`${connections(byOrder)} ${byOrder.length === 1 ? "reads last frame's value" : "read last frame's values"}.`);
    out.push(...readsThrough.map(readSentence));
    return out;
  };

  if (breaks) {
    const reasons: string[] = [];
    if (delayed.length) reasons.push(delaySentence());
    const pulses = breaks.filter((b) => b.kind !== "delay");
    for (const b of pulses.slice(0, 3)) {
      reasons.push(b.kind === "pulse" ? `${cable(b.edge)} only triggers ${b.port}` : `${b.edge.to} is only read when ${b.gate} fires`);
    }
    if (!reasons.length) {
      const delays = breaks.filter((b) => b.kind === "delay");
      reasons.push(`${delayName} ${listText(delays.map((b) => `"${b.edge.targetId}"`))} passes last frame's value back`);
    }
    const once = pulses.length ? ", so values go around once per pulse instead of every frame" : "";
    parts.push(`${patches} form a feedback loop. This loop is intentional: ${reasons.join("; ")}${once}.`, ...lagSentences());
    return diag("info", "feedback_loop", parts.join(" "), c.id, loop.patchIds);
  }

  parts.push(`${patches} form a feedback loop that feeds values back every frame, so they can drift or oscillate.`);
  if (delayed.length) parts.push(`${delaySentence()}.`);
  parts.push(...lagSentences());
  // Offer fixes on the cables that keep values going around every frame first.
  const everyFrame = new Set(analysis.continuous.map((e) => e.to));
  const lagging = loop.feedback.filter((e) => e.reason !== "delay1");
  const implicit = [...lagging.filter((e) => everyFrame.has(e.to)), ...lagging.filter((e) => !everyFrame.has(e.to))];
  const validate: ValidateOptions = { registry, lenient: false };
  const suggestions: Suggestion[] = [];
  for (const e of implicit.slice(0, 3)) {
    const link = storedLink(e);
    const src = resolveSource(doc, c, link.from, validate);
    const tgt = resolveTarget(doc, c, link.to, validate);
    const fromType: ValueType = src.ok && src.value.port ? src.value.port.type : "any";
    const toType: ValueType = tgt.ok && tgt.value.port ? tgt.value.port.type : "any";
    const s = insertPatchSuggestion(doc, registry, c.id, DELAY_ONE_FRAME_TYPE, `Insert a ${delayName} on ${cable(link)}`, { address: link.from, type: fromType }, { address: link.to, type: toType });
    if (!s) continue;
    const add = s.ops?.[0];
    const a = c.patches[e.sourceId]?.ui;
    const b = c.patches[link.patchId]?.ui;
    if (add?.op === "addPatch" && a && b && Number.isFinite(a.x + a.y + b.x + b.y)) add.patch.ui = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
    suggestions.push(s);
  }
  const first = implicit[0] ? storedLink(implicit[0]) : undefined;
  if (first) suggestions.push({ description: `Disconnect ${cable(first)}`, ops: [{ op: "disconnect", component: c.id, to: first.to }] });
  const extra: { hint?: string; suggestions: Suggestion[] } = { suggestions };
  if (implicit.length) {
    extra.hint = `If the loop is on purpose, insert a ${delayName} patch on ${implicit.length === 1 ? "that connection" : "one of those connections"} to make the delay explicit. Otherwise disconnect the cable that loops back.`;
  }
  return diag("warning", "feedback_loop", parts.join(" "), c.id, loop.patchIds, extra);
}

const NO_DIAGNOSTICS: readonly Diagnostic[] = Object.freeze([]);

/** What one stored input or layer property was checked with, and what it produced. */
interface InputResult {
  value: unknown;
  list: readonly Diagnostic[];
}

/** One layer or patch: its own checks, then one list per stored input or property (in document order). */
interface ItemResult {
  head: readonly Diagnostic[];
  inputs: ReadonlyMap<string, InputResult>;
}

const NO_INPUTS: ReadonlyMap<string, InputResult> = new Map();

/**
 * A component's diagnostics, kept in the order getDiagnostics reports them so parts can be reused
 * across revisions: ids, then layers (walk order), then patches (key order), then graph-wide checks,
 * then touchability.
 */
interface ComponentResult {
  component: Component;
  ids: readonly Diagnostic[];
  layers: readonly ItemResult[];
  patches: readonly ItemResult[];
  /** Published ports, layers in patch components, variables, feedback loops, unused patches. */
  graph: readonly Diagnostic[];
  /** Layers interactions can't touch. */
  touch: readonly Diagnostic[];
  /** Components shown directly by instance layers and component patches. */
  refs: readonly Id[];
  /** `graph` holds a feedback loop, whose messages and fixes read patch positions. */
  hasFeedback: boolean;
  list?: readonly Diagnostic[];
}

function resultList(r: ComponentResult): readonly Diagnostic[] {
  if (r.list) return r.list;
  const out: Diagnostic[] = [...r.ids];
  for (const items of [r.layers, r.patches]) {
    for (const item of items) {
      for (const d of item.head) out.push(d);
      for (const input of item.inputs.values()) for (const d of input.list) out.push(d);
    }
  }
  for (const d of r.graph) out.push(d);
  for (const d of r.touch) out.push(d);
  r.list = out;
  return out;
}

interface ComponentChecker {
  ids(): readonly Diagnostic[];
  layerHead(layer: LayerNode, parent: LayerNode | null): readonly Diagnostic[];
  layerProp(layer: LayerNode, key: string, value: unknown): readonly Diagnostic[];
  /** `known` is false for a patch of an unknown type, whose inputs aren't checked. */
  patchHead(id: Id, node: PatchNode): { list: readonly Diagnostic[]; known: boolean };
  patchInput(id: Id, key: string, value: unknown): readonly Diagnostic[];
  graph(): readonly Diagnostic[];
  touch(): readonly Diagnostic[];
}

function checkComponent(doc: SonobeDocument, c: Component, registry: Registry): ComponentResult {
  const check = componentChecker(doc, c, registry);
  const ids = check.ids();
  const refs: Id[] = [];
  const layers: ItemResult[] = [];
  walkLayers(c.layers, (layer, info) => {
    if (layer.type === COMPONENT_INSTANCE_LAYER_TYPE && layer.component !== undefined) refs.push(layer.component);
    const head = check.layerHead(layer, info.parent);
    if (!registry.layers.has(layer.type)) {
      layers.push({ head, inputs: NO_INPUTS });
      return;
    }
    const inputs = new Map<string, InputResult>();
    for (const [key, value] of Object.entries(layer.props)) inputs.set(key, { value, list: check.layerProp(layer, key, value) });
    layers.push({ head, inputs });
  });
  const patches: ItemResult[] = [];
  for (const [id, node] of Object.entries(c.patches)) {
    if (node.type === COMPONENT_PATCH_TYPE && node.component !== undefined) refs.push(node.component);
    const head = check.patchHead(id, node);
    if (!head.known) {
      patches.push({ head: head.list, inputs: NO_INPUTS });
      continue;
    }
    const inputs = new Map<string, InputResult>();
    for (const [key, value] of Object.entries(node.inputs)) inputs.set(key, { value, list: check.patchInput(id, key, value) });
    patches.push({ head: head.list, inputs });
  }
  const graph = check.graph();
  return { component: c, ids, layers, patches, graph, touch: check.touch(), refs, hasFeedback: graph.some((d) => d.code === "feedback_loop") };
}

// ---------------------------------------------------------------------------
// Incremental diagnostics
// ---------------------------------------------------------------------------

/** Component fields handled item by item (meta is never read by diagnostics). */
const COMPONENT_CONTENT_KEYS: ReadonlySet<string> = new Set(["layers", "patches", "comments", "meta"]);
/** Layer fields handled separately (locked and collapsed are editor-only). */
const LAYER_CONTENT_KEYS: ReadonlySet<string> = new Set(["props", "children", "locked", "collapsed"]);
const PATCH_CONTENT_KEYS: ReadonlySet<string> = new Set(["inputs", "ui"]);
/** Layer properties the touchability check reads. */
const TOUCH_PROPS: ReadonlySet<string> = new Set(["enabled", "opacity", "hitTest"]);
const NO_KEYS: ReadonlySet<string> = new Set();
const NO_LAYERS: readonly LayerNode[] = Object.freeze([]);

/** Same own keys, and the same values (by identity) outside `skip`. */
function sameFields(a: object, b: object, skip: ReadonlySet<string>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k of ka) {
    if (!Object.hasOwn(rb, k)) return false;
    if (!skip.has(k) && !Object.is(ra[k], rb[k])) return false;
  }
  return true;
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A stored value whose change can't reach other items' diagnostics: anything but a link or a layer reference (or nothing). */
const isPlainLiteral = (value: unknown) => value === undefined || (!isLinkInput(value) && !isLayerInput(value));

/**
 * The input results for `next`, reusing results whose stored value is unchanged. Null when a link or
 * layer reference changed (those reach other items). `flags.touch` is set when a touchability
 * property changed.
 */
function updateInputs(
  next: Record<string, unknown>,
  prev: Record<string, unknown>,
  results: ReadonlyMap<string, InputResult>,
  sensitive: ReadonlySet<string>,
  check: (key: string, value: unknown) => readonly Diagnostic[],
  flags: { touch: boolean },
): ReadonlyMap<string, InputResult> | null {
  if (next === prev) return results;
  const out = new Map<string, InputResult>();
  for (const [key, value] of Object.entries(next)) {
    const old = results.get(key);
    if (old && Object.is(old.value, value)) {
      out.set(key, old);
      continue;
    }
    if (!isPlainLiteral(value) || !isPlainLiteral(Object.hasOwn(prev, key) ? prev[key] : undefined)) return null;
    if (sensitive.has(key)) flags.touch = true;
    out.set(key, { value, list: check(key, value) });
  }
  for (const key of Object.keys(prev)) {
    if (Object.hasOwn(next, key)) continue;
    if (!isPlainLiteral(prev[key])) return null;
    if (sensitive.has(key)) flags.touch = true;
  }
  return out;
}

/**
 * Re-check a changed component from its previous result, recomputing only the inputs and properties
 * whose literal values changed. Null when the change is structural (items added, removed, renamed or
 * retyped, links or layer references changed, patches with dynamic ports edited): check it in full.
 */
function updateComponent(doc: SonobeDocument, c: Component, prev: ComponentResult, registry: Registry): ComponentResult | null {
  const old = prev.component;
  if (!sameFields(c, old, COMPONENT_CONTENT_KEYS)) return null;
  if (c.comments !== old.comments && !sameList(c.comments.map((x) => x.id), old.comments.map((x) => x.id))) return null;
  const patchIds = Object.keys(c.patches);
  if (c.patches !== old.patches && !sameList(patchIds, Object.keys(old.patches))) return null;
  if (patchIds.length !== prev.patches.length) return null;

  const check = componentChecker(doc, c, registry);
  const flags = { touch: false };
  let moved = false;

  const layers: ItemResult[] = [];
  let cursor = 0;
  const walk = (next: readonly LayerNode[], before: readonly LayerNode[], parent: LayerNode | null): boolean => {
    if (next.length !== before.length) return false;
    for (let k = 0; k < next.length; k++) {
      const a = next[k]!;
      const b = before[k]!;
      if (a === b) {
        const n = 1 + (a.children?.length ? countLayerNodes(a.children) : 0);
        for (let i = 0; i < n; i++) layers.push(prev.layers[cursor++]!);
        continue;
      }
      const r = prev.layers[cursor++];
      if (!r || !sameFields(a, b, LAYER_CONTENT_KEYS)) return false;
      if (!registry.layers.has(a.type)) layers.push(r);
      else {
        const inputs = updateInputs(a.props, b.props, r.inputs, TOUCH_PROPS, (key, value) => check.layerProp(a, key, value), flags);
        if (!inputs) return false;
        layers.push(inputs === r.inputs ? r : { head: r.head, inputs });
      }
      if (!walk(a.children ?? NO_LAYERS, b.children ?? NO_LAYERS, a)) return false;
    }
    return true;
  };
  if (c.layers !== old.layers) {
    if (!walk(c.layers, old.layers, null) || cursor !== prev.layers.length) return null;
  } else layers.push(...prev.layers);

  const patches: ItemResult[] = [];
  for (let j = 0; j < patchIds.length; j++) {
    const id = patchIds[j]!;
    const node = c.patches[id]!;
    const b = old.patches[id]!;
    const r = prev.patches[j]!;
    if (node === b) {
      patches.push(r);
      continue;
    }
    if (!sameFields(node, b, PATCH_CONTENT_KEYS)) return null;
    if (node.ui !== b.ui && (node.ui?.x !== b.ui?.x || node.ui?.y !== b.ui?.y)) moved = true;
    const spec = getPatchSpec(registry, node.type);
    if (node.inputs === b.inputs || !spec) {
      patches.push(r);
      continue;
    }
    if (spec.dynamicPorts) return null;
    const inputs = updateInputs(node.inputs, b.inputs, r.inputs, NO_KEYS, (key, value) => check.patchInput(id, key, value), flags);
    if (!inputs) return null;
    patches.push(inputs === r.inputs ? r : { head: r.head, inputs });
  }

  // Feedback loop messages and fixes read patch positions; loops can't appear or vanish when patches only move.
  const graph = moved && prev.hasFeedback ? check.graph() : prev.graph;
  const touch = flags.touch ? check.touch() : prev.touch;
  return { component: c, ids: prev.ids, layers, patches, graph, touch, refs: prev.refs, hasFeedback: graph.some((d) => d.code === "feedback_loop") };
}

function countLayerNodes(layers: readonly LayerNode[]): number {
  let n = layers.length;
  for (const layer of layers) if (layer.children?.length) n += countLayerNodes(layer.children);
  return n;
}

function componentChecker(doc: SonobeDocument, c: Component, registry: Registry): ComponentChecker {
  const validate: ValidateOptions = { registry, lenient: false };
  let out: Diagnostic[] = [];
  const push = (d: Diagnostic) => out.push(d);
  /** Run `fn` with pushes going into a fresh list. */
  const collect = (fn: () => void): readonly Diagnostic[] => {
    const saved = out;
    out = [];
    try {
      fn();
      return out.length ? out : NO_DIAGNOSTICS;
    } finally {
      out = saved;
    }
  };
  /** The name a patch or layer shows, for messages (ids stay in itemIds). */
  const patchName = (id: Id) => {
    const node = getOwn(c.patches, id);
    return node ? patchDisplayName(node, getPatchSpec(registry, node.type)) : id;
  };
  const layerName = (id: Id) => {
    const layer = findLayer(c.layers, id)?.layer;
    return layer ? layerDisplayName(layer) : id;
  };
  const itemName = (id: Id) => (getOwn(c.patches, id) ? patchName(id) : layerName(id));
  const patchPhrase = (id: Id) => {
    const node = getOwn(c.patches, id);
    return node ? describePatch(node, getPatchSpec(registry, node.type)) : `"${id}"`;
  };

  const ids = () =>
    collect(() => {
      const counts = new Map<Id, number>();
      for (const id of [...allLayerIds(c.layers), ...Object.keys(c.patches), ...c.comments.map((x) => x.id)]) counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const [id, n] of counts) {
        if (n > 1) push(diag("error", "duplicate_id", `The id "${id}" is used ${n} times in ${c.id}. Ids must be unique across layers, patches and comments.`, c.id, [id]));
        if (!isValidId(id)) push(diag("error", "invalid_id", `"${id}" isn't a valid id (letters, digits and underscores, not starting with a digit).`, c.id, [id]));
      }
    });

  const componentRef = (itemId: Id, targetId: Id | undefined, expected: Component["kind"], label: string) => {
    if (targetId === undefined) {
      push(diag("error", "missing_component", `${label} "${itemName(itemId)}" doesn't say which component it shows.`, c.id, [itemId]));
      return;
    }
    const target = getOwn(doc.components, targetId);
    if (!target) {
      push(diag("error", "component_not_found", `${label} "${itemName(itemId)}" shows component "${targetId}", which doesn't exist.${didYouMeanText(didYouMean(targetId, Object.keys(doc.components)))}`, c.id, [itemId]));
      return;
    }
    if (target.kind !== expected) push(diag("error", "wrong_component_kind", `${label} "${itemName(itemId)}" shows "${target.name}", which is a ${target.kind}, not a ${expected}.`, c.id, [itemId]));
    if (targetId === c.id || componentDependencies(doc, targetId).has(c.id)) {
      push(diag("error", "component_cycle", `"${target.name}" ends up containing itself through "${itemName(itemId)}" in ${c.name}.`, c.id, [itemId]));
    }
  };

  /** State inputs that take pulses on purpose: ports declared acceptsPulse, and boolean inputs of logic patches (Or and And merge taps). */
  const acceptsPulses = (target: PortTarget): boolean => {
    if (target.port?.acceptsPulse) return true;
    if (target.kind !== "patch" || target.itemId === undefined || target.port?.type !== "boolean") return false;
    const node = getOwn(c.patches, target.itemId);
    return !!node && getPatchSpec(registry, node.type)?.category === "logic";
  };

  const checkValue = (target: PortTarget, value: unknown) => {
    const itemIds = target.itemId ? [target.itemId] : [];
    const r = checkInputValue(doc, c, target, value, validate);
    if (!r.ok) {
      let code = r.error.code;
      const suggestions: Suggestion[] = [...(r.error.suggestions ?? [])];
      if (isLinkInput(value)) {
        if (code === "not_found") code = "dangling_link";
        if (code === "self_edge") code = "self_cycle";
        const source = parseAddress(value.link);
        if (source && (source.kind === "patch" || source.kind === "layer") && !itemIds.includes(source.id)) itemIds.push(source.id);
        suggestions.push({ description: "Disconnect it", ops: [{ op: "disconnect", component: c.id, to: target.address }] });
      } else {
        if (code === "not_found" && isLayerInput(value)) code = "missing_layer";
        if (code === "not_found" && isAssetInput(value)) code = "missing_asset";
        if (target.kind !== "componentOutput") suggestions.push({ description: "Reset it to its default", ops: [{ op: "setInput", component: c.id, target: target.address, value: null }] });
      }
      push(diag("error", code, withHint(r.error), c.id, itemIds, { port: target.key, suggestions }));
      return;
    }
    if (!isLinkInput(value) || !target.port) return;
    const src = resolveSource(doc, c, value.link, validate);
    if (!src.ok || !src.value.port || src.value.port.type !== "pulse" || !STATE_TYPES.has(target.port.type)) return;
    if (acceptsPulses(target)) return;
    const suggestions: Suggestion[] = [];
    const s = insertPatchSuggestion(doc, registry, c.id, "switch", "Insert a Switch: each pulse flips it on or off, and it holds that state.", { address: src.value.address, type: "pulse" }, { address: target.address, type: target.port.type });
    if (s) suggestions.push(s);
    if (src.value.itemId) itemIds.push(src.value.itemId);
    push(
      diag("warning", "pulse_into_state", `${src.value.address} is a pulse, which is on for a single frame, but ${target.address} expects a steady ${target.port.type}. Did you mean to use a Switch?`, c.id, itemIds, {
        port: target.key,
        suggestions,
      }),
    );
  };

  const layerHead = (layer: LayerNode, parent: LayerNode | null) =>
    collect(() => {
      const spec = registry.layers.get(layer.type);
      if (!spec) {
        const types = [...registry.layers.values()].map((t) => ({ value: t.type, aliases: [t.name] }));
        push(diag("error", "unknown_layer_type", `Layer "${layer.id}" has an unknown type "${layer.type}".${didYouMeanText(didYouMean(layer.type, types))}`, c.id, [layer.id]));
        return;
      }
      if (parent) {
        const parentSpec = registry.layers.get(parent.type);
        if (parentSpec && !parentSpec.canHaveChildren) push(diag("error", "cannot_have_children", `"${parent.id}" is a ${parentSpec.name} layer, which can't hold other layers like "${layer.id}".`, c.id, [parent.id, layer.id]));
      }
      if (layer.type === COMPONENT_INSTANCE_LAYER_TYPE) componentRef(layer.id, layer.component, "layerComponent", "Component layer");
    });

  const layerProp = (layer: LayerNode, key: string, value: unknown) =>
    collect(() => {
      const target = resolveTarget(doc, c, `@${layer.id}.${key}`, validate);
      if (!target.ok) {
        push(diag("error", target.error.code, withHint(target.error), c.id, [layer.id], { port: key, suggestions: [{ description: `Remove "${key}"`, ops: [{ op: "setInput", component: c.id, target: `@${layer.id}.${key}`, value: null }] }] }));
        return;
      }
      checkValue(target.value, value);
    });

  const patchHead = (id: Id, node: PatchNode): { list: readonly Diagnostic[]; known: boolean } => {
    const spec = getPatchSpec(registry, node.type);
    if (!spec) {
      const list = collect(() => {
        const types = [...registry.patches.values()].map((s) => ({ value: s.type, aliases: [s.name, ...(s.aliases ?? [])] }));
        const unknown = node.name ? `The patch "${node.name}" has an unknown type "${node.type}".` : `There's no patch type "${node.type}".`;
        push(diag("error", "unknown_patch_type", `${unknown}${didYouMeanText(didYouMean(node.type, types))}`, c.id, [id], {
          suggestions: [{ description: `Remove "${patchName(id)}"`, ops: [{ op: "removePatch", component: c.id, id }] }],
        }));
      });
      return { list, known: false };
    }
    return { list: collect(() => patchChecks(id, node, spec)), known: true };
  };

  const patchChecks = (id: Id, node: PatchNode, spec: PatchSpec) => {
    const ports = resolveNodePorts(doc, node, registry);
    if (node.typeParam !== undefined) {
      const variants = ports?.variants ?? [];
      if (!variants.length) push(diag("warning", "invalid_type_param", `${patchPhrase(id)} sets typeParam "${node.typeParam}", but it has no type options.`, c.id, [id]));
      else if (!(variants as string[]).includes(node.typeParam)) {
        push(diag("error", "invalid_type_param", `${patchPhrase(id)} is set to type "${node.typeParam}", which it doesn't support (${variants.join(", ")}).`, c.id, [id], {
          suggestions: [{ description: `Use "${variants[0]}"`, ops: [{ op: "updatePatch", component: c.id, id, typeParam: variants[0] }] }],
        }));
      }
    }
    const range = getInputCountRange(spec);
    if (node.inputCount !== undefined && range && (node.inputCount < range.min || node.inputCount > range.max)) {
      const message = spec.variadic
        ? `${patchPhrase(id)} has ${node.inputCount} ${spec.variadic.name.toLowerCase()} inputs, but it supports ${range.min}–${range.max}.`
        : `${patchPhrase(id)} has an input count of ${node.inputCount}, but it supports ${range.min}–${range.max}.`;
      push(diag("warning", "input_count_out_of_range", message, c.id, [id]));
    }
    if (node.type === COMPONENT_PATCH_TYPE) componentRef(id, node.component, "patchComponent", "Component patch");
    if (ports?.dynamicPortsError) push(diag("warning", "dynamic_ports_failed", `${patchPhrase(id)} couldn't work out its ports: ${ports.dynamicPortsError}`, c.id, [id]));
  };

  const patchInput = (id: Id, key: string, value: unknown) =>
    collect(() => {
      const target = resolveTarget(doc, c, `${id}.${key}`, validate);
      if (!target.ok) {
        push(diag("error", target.error.code, withHint(target.error), c.id, [id], { port: key, suggestions: [{ description: `Remove "${key}"`, ops: [{ op: "setInput", component: c.id, target: `${id}.${key}`, value: null }] }] }));
        return;
      }
      checkValue(target.value, value);
    });

  const graph = () => collect(graphChecks);

  function graphChecks(): void {
  for (const [key, port] of Object.entries(c.interface.inputs)) {
    if (port.default === undefined) continue;
    const r = checkLiteral(doc, c, port.default, interfacePortToPort(port, "input"), `$in.${key}`, validate);
    if (!r.ok) push(diag("error", r.error.code, withHint(r.error), c.id, [], { port: key }));
  }
  for (const [key, port] of Object.entries(c.interface.outputs)) {
    if (port.link === undefined) {
      push(diag("info", "unconnected_output", `The published output "${key}" of ${c.id} isn't connected to anything inside the component.`, c.id, [], { port: key }));
      continue;
    }
    const target: PortTarget = { kind: "componentOutput", address: `$out.${key}`, key, port: interfacePortToPort(port, "output"), bindable: true };
    const r = checkLink(doc, c, port.link, target, validate);
    if (!r.ok) push(diag("error", r.error.code === "not_found" ? "dangling_link" : r.error.code, withHint(r.error), c.id, [], { port: key, suggestions: r.error.suggestions }));
  }

  // A patch component is never drawn, so layers in it (a hand-edited file, an older version) don't show.
  if (c.kind === "patchComponent" && c.layers.length > 0) {
    const top = c.layers.map((l) => l.id);
    push(
      diag("warning", "layers_in_patch_component", `"${c.name}" is a patch component, and patch components are never drawn, so ${top.length === 1 ? `the layer "${layerName(top[0]!)}" won't show` : `its ${top.length} layers won't show`}.`, c.id, top, {
        hint: "Keep layers in a prototype or a layer component.",
        suggestions: [{ description: top.length === 1 ? `Remove "${layerName(top[0]!)}"` : `Remove the ${top.length} layers`, ops: top.map((id) => ({ op: "removeLayer", component: c.id, id })) }],
      }),
    );
  }

  // Variables: unnamed, duplicate, and unused broadcasters.
  const variables = new Map<string, VariableInfo[]>();
  for (const b of componentBroadcasters(doc, registry, c.id)) {
    if (!b.name) {
      push(diag("warning", "unnamed_variable", `${patchPhrase(b.id)} has no name, so no Variable Receiver can read its value.`, c.id, [b.id], { hint: "Rename the broadcaster: its name is the variable's name." }));
      continue;
    }
    const key = `${b.scope} ${b.type} ${b.name}`;
    variables.set(key, [...(variables.get(key) ?? []), b]);
  }
  for (const group of variables.values()) {
    const first = group[0]!;
    if (group.length > 1) {
      push(
        diag("error", "duplicate_variable", `${group.length} broadcasters in ${c.name} share the ${first.scope} variable "${first.name}", so receivers read only ${describePatch(c.patches[first.id]!, getPatchSpec(registry, c.patches[first.id]!.type))}.`, c.id, group.map((b) => b.id), {
          hint: "Give each broadcaster its own name.",
        }),
      );
    }
    if (followingReceivers(doc, registry, c.id, first.id).length === 0) {
      push(diag("info", "unused_variable", `Nothing reads the variable "${first.name}" yet.`, c.id, [first.id], { hint: "Add a Variable Receiver and choose this variable." }));
    }
  }

  // Graph: feedback loops and unused patches.
  const consumed = new Set<Id>();
  for (const e of listInputs(c)) {
    if (!isLinkInput(e.value)) continue;
    const a = parseAddress(e.value.link);
    if (a && a.kind === "patch") consumed.add(a.id);
  }
  const loops = feedbackLoops(doc, c.id, registry);
  if (loops.length) {
    const edges = patchEdges(doc, c.id, registry);
    for (const loop of loops) push(feedbackDiagnostic(doc, c, registry, loop, edges));
  }
  for (const [id, node] of Object.entries(c.patches)) {
    if (consumed.has(id)) continue;
    const ports = resolveNodePorts(doc, node, registry);
    if (!ports || !ports.outputs.length) continue;
    push(diag("info", "unused_patch", `${describePatch(node, ports.spec)} isn't connected to anything, so its outputs aren't used.`, c.id, [id], {
      suggestions: [{ description: `Remove "${patchDisplayName(node, ports.spec)}"`, ops: [{ op: "removePatch", component: c.id, id }] }],
    }));
  }
  }

  const touch = () => collect(touchChecks);

  function touchChecks(): void {
  // Layers that can't receive touches but have an interaction bound.
  const reported = new Set<string>();
  for (const [id, node] of Object.entries(c.patches)) {
    const spec = getPatchSpec(registry, node.type);
    if (spec?.category !== "interaction") continue;
    const ports = resolveNodePorts(doc, node, registry);
    for (const port of ports?.inputs ?? []) {
      const value = node.inputs[port.key];
      if (port.type !== "layer" || !isLayerInput(value)) continue;
      const loc = findLayer(c.layers, value.layer);
      if (!loc || reported.has(`${id}:${value.layer}`)) continue;
      const reasons: string[] = [];
      const fixes: Suggestion[] = [];
      for (const ancestorId of loc.path) {
        const layer = findLayer(c.layers, ancestorId)!.layer;
        const self = ancestorId === value.layer;
        const name = layerDisplayName(layer);
        if (layer.props.enabled === false) {
          reasons.push(self ? "it's disabled" : `its parent "${name}" is disabled`);
          fixes.push({ description: `Enable "${name}"`, ops: [{ op: "setInput", component: c.id, target: `@${ancestorId}.enabled`, value: null }] });
        }
        if (layer.props.opacity === 0) {
          reasons.push(self ? "its opacity is 0" : `its parent "${name}" has opacity 0`);
          fixes.push({ description: "Use a Hit Area layer as an invisible touch target instead of a transparent layer." });
        }
        if (self && layer.props.hitTest === false) {
          reasons.push("Receives Touches is off");
          fixes.push({ description: `Turn Receives Touches back on for "${name}"`, ops: [{ op: "setInput", component: c.id, target: `@${ancestorId}.hitTest`, value: null }] });
        }
      }
      if (!reasons.length) continue;
      reported.add(`${id}:${value.layer}`);
      push(diag("warning", "untouchable_layer", `Layer "${layerName(value.layer)}" can't receive touches because ${reasons.join(" and ")}, so ${describePatch(node, spec)} will never fire.`, c.id, [value.layer, id], { port: port.key, suggestions: fixes }));
    }
  }
  }

  return { ids, layerHead, layerProp, patchHead, patchInput, graph, touch };
}

function documentDiagnostics(doc: SonobeDocument, out: Diagnostic[], files: boolean): void {
  const root = getOwn(doc.components, doc.project.root);
  if (!root) out.push(diag("error", "missing_root", `The project's root component "${doc.project.root}" doesn't exist.`, doc.project.root, []));
  else if (root.kind !== "prototype") out.push(diag("warning", "root_not_prototype", `The root component "${root.id}" is a ${root.kind}; the root should be a prototype.`, root.id, []));
  if (files) fileNameDiagnostics(doc, out);
}

/** Diagnose a whole document (or selected components). */
export function getDiagnostics(doc: SonobeDocument, registry: Registry, options: DiagnosticsOptions = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  documentDiagnostics(doc, out, !options.components);
  const ids = options.components ?? listComponentIds(doc);
  for (const id of ids) {
    const c = getOwn(doc.components, id);
    if (c) for (const d of resultList(checkComponent(doc, c, registry))) out.push(d);
  }
  return out;
}

/** getDiagnostics for a sequence of documents, reusing what didn't change. */
export interface DiagnosticsCache {
  /** Same result as getDiagnostics(doc, registry). Documents must not be changed in place after they're diagnosed. */
  get(doc: SonobeDocument): Diagnostic[];
}

/**
 * A getDiagnostics that remembers the last document it diagnosed. Documents share structure across
 * edits, so the next one re-checks only components that changed or that show a changed component,
 * and inside a changed component only the inputs and layer properties whose literal values changed
 * (a scrub, a canvas drag). Structural edits re-check the component in full. Results equal
 * getDiagnostics, in the same order.
 */
export function createDiagnosticsCache(registry: Registry): DiagnosticsCache {
  const lists = new WeakMap<SonobeDocument, Diagnostic[]>();
  let last: { doc: SonobeDocument; results: Map<Id, ComponentResult> } | null = null;

  const diagnose = (doc: SonobeDocument): Diagnostic[] => {
    const previous = last;
    const results = new Map<Id, ComponentResult>();
    const ids = listComponentIds(doc);
    const reusable =
      previous !== null &&
      doc.project === previous.doc.project &&
      doc.scripts === previous.doc.scripts &&
      doc.assets === previous.doc.assets &&
      sameList(ids, listComponentIds(previous.doc));
    const changed = new Set<Id>();
    if (reusable) for (const id of ids) if (doc.components[id] !== previous.doc.components[id]) changed.add(id);
    // A component shows others (instances, component patches): their changes reach its diagnostics.
    const reaches = new Map<Id, boolean>();
    const reachesChanged = (id: Id, visiting: Set<Id>): boolean => {
      const known = reaches.get(id);
      if (known !== undefined) return known;
      if (visiting.has(id)) return false;
      visiting.add(id);
      let result = false;
      for (const ref of previous?.results.get(id)?.refs ?? []) {
        if (changed.has(ref) || reachesChanged(ref, visiting)) {
          result = true;
          break;
        }
      }
      visiting.delete(id);
      reaches.set(id, result);
      return result;
    };

    const out: Diagnostic[] = [];
    documentDiagnostics(doc, out, true);
    for (const id of ids) {
      const c = doc.components[id]!;
      const prev = reusable ? previous.results.get(id) : undefined;
      let result: ComponentResult | null = null;
      if (prev && !reachesChanged(id, new Set())) {
        if (!changed.has(id)) result = prev;
        else result = updateComponent(doc, c, prev, registry);
      }
      result ??= checkComponent(doc, c, registry);
      results.set(id, result);
      for (const d of resultList(result)) out.push(d);
    }
    last = { doc, results };
    return out;
  };

  return {
    get(doc) {
      let list = lists.get(doc);
      if (!list) lists.set(doc, (list = diagnose(doc)));
      return list;
    },
  };
}

/**
 * file_name_collision: component ids or script names that differ only by case (made on Linux, or
 * merged in from git). macOS and Windows store them as one file, so Sonobe refuses to save them.
 */
function fileNameDiagnostics(doc: SonobeDocument, out: Diagnostic[]): void {
  const quoted = (items: readonly string[]) => listText(items.map((x) => `"${x}"`));
  for (const group of fileNameCollisions(Object.keys(doc.components))) {
    const later = group.at(-1)!;
    out.push(
      diag("error", "file_name_collision", `The components ${quoted(group)} have ids that differ only by capitalization. On macOS and Windows their files (${listText(group.map((id) => `components/${id}.json`))}) are one file, so Sonobe can't save this project until one has a different id.`, later, [], {
        hint: "Component ids can't be renamed. Make a new component, move the layers and patches over, and remove the old one.",
        suggestions: [{ description: `Recreate "${later}" under a different id: create a new component, move its layers and patches into it, point its instances at it, then remove "${later}".` }],
      }),
    );
  }
  for (const group of fileNameCollisions(Object.keys(doc.scripts))) {
    out.push(
      diag("error", "file_name_collision", `The scripts ${quoted(group)} have names that differ only by capitalization. On macOS and Windows they're one file in scripts/, so Sonobe can't save this project until one is renamed.`, doc.project.root, [], {
        hint: "Copy one script's source into a file with a different name (setScript), point its JavaScript patches at it, then remove the old file (setScript with source null).",
      }),
    );
  }
}
