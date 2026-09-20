/**
 * getDiagnostics (ARCHITECTURE §3.6): a pure pass over a document that reports problems
 * and teaching hints with ready-to-apply suggestions.
 */

import { parseAddress } from "./address.ts";
import { componentDependencies, listComponentIds } from "./document.ts";
import { DELAY_ONE_FRAME_TYPE, feedbackLoops, patchEdges, VARIABLE_BROADCASTER_TYPE, VARIABLE_RECEIVER_TYPE, type FeedbackEdge, type FeedbackLoop, type PatchEdge } from "./graph.ts";
import { getOwn, isValidId } from "./ids.ts";
import {
  checkKnobLiteral,
  componentKnobReads,
  formatKnobValue,
  getKnobPreset,
  hasKnobRange,
  isKnobType,
  knobLabel,
  knobLiteral,
  knobZeroLiteral,
  planVariablesToKnobs,
  uniqueKnobName,
} from "./knobs.ts";
import { loopShapes } from "./loopShapes.ts";
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
  resolveLayerProps,
  resolveNodePorts,
  walkLayers,
  type ResolvedPort,
} from "./registry.ts";
import { didYouMean, didYouMeanText } from "./suggest.ts";
import type { Component, Diagnostic, Id, InputValue, KnobSet, LayerNode, Op, PatchNode, PatchSpec, Registry, Severity, SonobeDocument, SonobeError, Suggestion, ValueType } from "./types.ts";
import { fileNameCollisions } from "./serialize.ts";
import { checkInputValue, checkLink, checkLiteral, insertPatchSuggestion, resolveSource, resolveTarget, type PortTarget, type ValidateOptions } from "./validate.ts";
import { formatNumber, isAssetInput, isLayerInput, isLinkInput, isLiteral, isLoopLiteral, zeroLiteral } from "./values.ts";
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
  /** How many copies layers make, and loops of different lengths meeting. */
  copies: readonly Diagnostic[];
  /** Components shown directly by instance layers and component patches. */
  refs: readonly Id[];
  /** `graph` holds a feedback loop, whose messages and fixes read patch positions. */
  hasFeedback: boolean;
  /** Knob ids its links read: these inputs are checked again when knob ids, types or options change. */
  knobReads: ReadonlySet<Id>;
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
  for (const d of r.copies) out.push(d);
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
  copies(): readonly Diagnostic[];
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
  return { component: c, ids, layers, patches, graph, touch: check.touch(), copies: check.copies(), refs, hasFeedback: graph.some((d) => d.code === "feedback_loop"), knobReads: componentKnobReads(c) };
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
/** Layer properties the copy checks read as literals: Repeat, and whether copies are laid out apart (loops_inside_single_copy). */
const COPY_PROPS: ReadonlySet<string> = new Set(["repeat", "layout", "positioning"]);
/** Literal edits the copy checks read: those properties, a Loop's Count, and loop lengths. */
const layerAffectsCopies = (key: string, before: unknown, after: unknown) => COPY_PROPS.has(key) || isLoopLiteral(before) || isLoopLiteral(after);
const patchAffectsCopies = (type: string) => (key: string, before: unknown, after: unknown) => (type === "loop" && key === "count") || isLoopLiteral(before) || isLoopLiteral(after);
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
 * property changed, and `flags.copies` when an edit can change how many copies or loop items there are.
 */
function updateInputs(
  next: Record<string, unknown>,
  prev: Record<string, unknown>,
  results: ReadonlyMap<string, InputResult>,
  sensitive: ReadonlySet<string>,
  check: (key: string, value: unknown) => readonly Diagnostic[],
  flags: { touch: boolean; copies: boolean },
  affectsCopies: (key: string, before: unknown, after: unknown) => boolean,
): ReadonlyMap<string, InputResult> | null {
  if (next === prev) return results;
  const out = new Map<string, InputResult>();
  for (const [key, value] of Object.entries(next)) {
    const old = results.get(key);
    if (old && Object.is(old.value, value)) {
      out.set(key, old);
      continue;
    }
    const before = Object.hasOwn(prev, key) ? prev[key] : undefined;
    if (!isPlainLiteral(value) || !isPlainLiteral(before)) return null;
    if (sensitive.has(key)) flags.touch = true;
    if (affectsCopies(key, before, value)) flags.copies = true;
    out.set(key, { value, list: check(key, value) });
  }
  for (const key of Object.keys(prev)) {
    if (Object.hasOwn(next, key)) continue;
    if (!isPlainLiteral(prev[key])) return null;
    if (sensitive.has(key)) flags.touch = true;
    if (affectsCopies(key, prev[key], undefined)) flags.copies = true;
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
  const flags = { touch: false, copies: false };
  let moved = false;
  let broadcasterEdited = false;

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
        const inputs = updateInputs(a.props, b.props, r.inputs, TOUCH_PROPS, (key, value) => check.layerProp(a, key, value), flags, layerAffectsCopies);
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
    // A broadcaster's value decides whether it could be a knob (variables_could_be_knobs).
    if (node.type === VARIABLE_BROADCASTER_TYPE && node.inputs !== b.inputs) broadcasterEdited = true;
    const spec = getPatchSpec(registry, node.type);
    if (node.inputs === b.inputs || !spec) {
      patches.push(r);
      continue;
    }
    if (spec.dynamicPorts) return null;
    const inputs = updateInputs(node.inputs, b.inputs, r.inputs, NO_KEYS, (key, value) => check.patchInput(id, key, value), flags, patchAffectsCopies(node.type));
    if (!inputs) return null;
    patches.push(inputs === r.inputs ? r : { head: r.head, inputs });
  }

  // Feedback loop messages and fixes read patch positions; loops can't appear or vanish when patches only move.
  const graph = (moved && prev.hasFeedback) || broadcasterEdited ? check.graph() : prev.graph;
  const touch = flags.touch ? check.touch() : prev.touch;
  const copies = flags.copies ? check.copies() : prev.copies;
  return { component: c, ids: prev.ids, layers, patches, graph, touch, copies, refs: prev.refs, hasFeedback: graph.some((d) => d.code === "feedback_loop"), knobReads: prev.knobReads };
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
        if (code === "unknown_knob" && source?.kind === "knob") suggestions.push(...missingKnobSuggestions(doc, c, target, source.key));
        suggestions.push({ description: "Disconnect it", ops: [{ op: "disconnect", component: c.id, to: target.address }] });
      } else {
        if (code === "not_found" && isLayerInput(value)) code = "missing_layer";
        if (code === "not_found" && isAssetInput(value)) code = "missing_asset";
        if (target.kind !== "componentOutput") suggestions.push({ description: "Reset it to its default", ops: [{ op: "setInput", component: c.id, target: target.address, value: null }] });
      }
      push(diag("error", code, withHint(r.error), c.id, itemIds, { port: target.key, suggestions }));
      return;
    }
    if (!isLinkInput(value)) return;
    undrivenOutput(target, value.link, itemIds);
    if (!target.port) return;
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

  /** undriven_output: a link reads an instance's published output that its component doesn't drive inside. */
  const undrivenOutput = (target: PortTarget, link: string, itemIds: readonly Id[]) => {
    const source = parseAddress(link);
    if (!source || (source.kind !== "patch" && source.kind !== "layer")) return;
    let componentId: Id | undefined;
    let instanceName: string;
    if (source.kind === "patch") {
      const node = getOwn(c.patches, source.id);
      if (node?.type !== COMPONENT_PATCH_TYPE) return;
      componentId = node.component;
      instanceName = patchName(source.id);
    } else {
      const layer = findLayer(c.layers, source.id)?.layer;
      if (layer?.type !== COMPONENT_INSTANCE_LAYER_TYPE) return;
      componentId = layer.component;
      instanceName = layerDisplayName(layer);
    }
    const shown = componentId === undefined ? undefined : getOwn(doc.components, componentId);
    const port = shown ? getOwn(shown.interface.outputs, source.key) : undefined;
    if (!shown || !port || port.link !== undefined) return;
    const reader = target.kind === "componentOutput" ? `The published output "${target.port?.name ?? target.key}"` : `The ${target.port?.name ?? target.key} of "${itemName(target.itemId!)}"`;
    push(
      diag("warning", "undriven_output", `${reader} reads "${port.name}" from "${instanceName}", but ${shown.name} doesn't drive that output inside, so it stays at its default.`, c.id, [...itemIds, source.id], {
        port: target.key,
        hint: `Inside ${shown.name}, connect a patch output to "$out.${source.key}", or disconnect this cable.`,
        suggestions: [{ description: "Disconnect it", ops: [{ op: "disconnect", component: c.id, to: target.address }] }, unpublishSuggestion(shown, "outputs", source.key, port.name)],
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
  const readInputs = new Set<string>();
  for (const e of listInputs(c)) {
    if (!isLinkInput(e.value)) continue;
    const a = parseAddress(e.value.link);
    if (a?.kind === "componentInput") readInputs.add(a.key);
  }
  for (const [key, port] of Object.entries(c.interface.inputs)) {
    if (readInputs.has(key)) continue;
    push(
      diag("info", "unused_input", `The published input "${port.name}" of ${c.name} isn't read inside the component, so values sent to it do nothing.`, c.id, [], {
        port: key,
        hint: `Read it inside with { "link": "$in.${key}" }, or unpublish it.`,
        suggestions: [unpublishSuggestion(c, "inputs", key, port.name)],
      }),
    );
  }
  // An instance layer's own properties win over published inputs with the same key.
  if (c.kind === "layerComponent") {
    const layerProps = registry.layers.get(COMPONENT_INSTANCE_LAYER_TYPE)?.props ?? [];
    for (const [key, port] of Object.entries(c.interface.inputs)) {
      const prop = layerProps.find((p) => p.key === key);
      if (!prop) continue;
      push(
        diag("warning", "input_shadowed_by_prop", `The published input "${port.name}" of ${c.name} has the key "${key}", which every layer already uses for its ${prop.name} property, so instances set their own ${prop.name} and nothing reaches the input.`, c.id, [], {
          port: key,
          hint: `Publish it under another key, like "${key}Value", and read "$in.${key}Value" inside instead.`,
        }),
      );
    }
  }
  for (const [key, port] of Object.entries(c.interface.outputs)) {
    if (port.link === undefined) {
      push(
        diag("info", "unconnected_output", `The published output "${port.name}" of ${c.name} isn't connected to anything inside the component.`, c.id, [], {
          port: key,
          hint: `Connect a patch output to "$out.${key}" inside, or unpublish it.`,
          suggestions: [unpublishSuggestion(c, "outputs", key, port.name)],
        }),
      );
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
  if (variables.size) {
    const convertible = planVariablesToKnobs(doc, registry, { component: c.id }).knobs;
    if (convertible.length) {
      const n = convertible.length;
      push(
        diag("info", "variables_could_be_knobs", `${n === 1 ? "1 Variable Broadcaster shares a constant" : `${n} Variable Broadcasters share constants`} in ${c.name}. Knobs would let you tune ${n === 1 ? "it" : "them"} in one panel and compare presets.`, c.id, convertible.map((k) => k.from), {
          hint: `Convert them with set_knobs({ "convertVariables": { "component": "${c.id}" } }), or Convert Variables to Knobs in the Knobs tab. Every input they drive reads the knob instead, and the broadcasters and receivers go.`,
          suggestions: [{ description: `Convert ${n === 1 ? "it" : `the ${n} broadcasters`} to knobs: set_knobs({ "convertVariables": { "component": "${c.id}" } })` }],
        }),
      );
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

  const copies = () => collect(copyChecks);

  /**
   * How many copies layers make (ARCHITECTURE §4): children that repeat inside one copy of a layer
   * people touch, a Repeat that follows a gesture on its own copies or sits inside another repeat,
   * and loops of different lengths meeting at a patch or at a layer's copies. Only what the document
   * fixes is checked; the running prototype reports mismatches it finds with other lengths.
   */
  function copyChecks(): void {
  const shapes = loopShapes(doc, c.id, registry);
  const quoted = (layers: readonly LayerNode[]) => {
    const names = layers.slice(0, 3).map((l) => `"${layerDisplayName(l)}"`);
    return layers.length > 3 ? `${names.join(", ")} and ${layers.length - 3} more` : listText(names);
  };
  /** Published inputs of an instance's component whose loops pass in whole (they don't make copies). */
  const passes = (componentId: Id | undefined) => {
    const inputs = componentId === undefined ? undefined : getOwn(doc.components, componentId)?.interface.inputs;
    return (key: string) => getOwn(inputs ?? {}, key)?.loopBehavior === "pass";
  };
  type LoopedProp = { key: string; name: string; value: unknown; length: number | null; origin: Id };
  /** The properties that loop per item on a layer (whole-loop ones like Repeat aside). */
  const loopedProps = (layer: LayerNode): LoopedProp[] => {
    const props = resolveLayerProps(doc, c.id, layer, registry) ?? [];
    const pass = passes(layer.type === COMPONENT_INSTANCE_LAYER_TYPE ? layer.component : undefined);
    const out: LoopedProp[] = [];
    for (const [key, value] of Object.entries(layer.props)) {
      const prop = findPort(props, key);
      if (!prop || prop.wholeLoop || pass(key)) continue;
      const shape = shapes.ofValue(value, layer.id);
      if (shape) out.push({ key, name: prop.name, value, length: shape.length, origin: shape.origin });
    }
    return out;
  };
  /** Ids that name items of this component, for itemIds. */
  const items = (ids: readonly Id[]) => [...new Set(ids.filter((id) => getOwn(c.patches, id) || findLayer(c.layers, id)))];

  const gestures = new Map<Id, Id>();
  for (const [id, node] of Object.entries(c.patches)) {
    if (getPatchSpec(registry, node.type)?.category !== "interaction") continue;
    for (const value of Object.values(node.inputs)) if (isLayerInput(value) && !gestures.has(value.layer)) gestures.set(value.layer, id);
  }

  const repeatInsideRepeat = (layer: LayerNode, ancestorId: Id) => {
    const name = layerDisplayName(layer);
    const ancestor = layerName(ancestorId);
    push(
      diag("warning", "repeat_inside_repeat", `"${name}" has its own Repeat, but it's inside "${ancestor}", which already makes copies, so each copy of "${ancestor}" shows one "${name}" and this Repeat is ignored.`, c.id, [layer.id, ancestorId], {
        port: "repeat",
        hint: `Loops of loops need a component: put the inner list in a layer component and loop the layers inside it (guide 08), or move "${name}" out of "${ancestor}".`,
        suggestions: [{ description: `Clear the Repeat of "${name}"`, ops: [{ op: "setInput", component: c.id, target: `@${layer.id}.repeat`, value: null }] }],
      }),
    );
  };

  /** Repeat reaches, through per-item inputs only, a patch that runs once per copy of the layer (or of a layer inside it). */
  const repeatFromOwnGesture = (layer: LayerNode, link: string) => {
    const inside = new Set(allLayerIds([layer]));
    const seen = new Set<string>();
    const find = (address: string): Id | undefined => {
      if (seen.has(address)) return undefined;
      seen.add(address);
      const a = parseAddress(address);
      if (a?.kind === "layer") {
        const stored = findLayer(c.layers, a.id)?.layer.props[a.key];
        return isLinkInput(stored) ? find(stored.link) : undefined;
      }
      if (a?.kind !== "patch") return undefined;
      const node = getOwn(c.patches, a.id);
      const ports = node ? resolveNodePorts(doc, node, registry) : undefined;
      const out = ports ? findPort(ports.outputs, a.key) : undefined;
      // A whole-loop output (a Loop Builder, a filter) decides its own length.
      if (!node || !ports || !out || out.wholeLoop) return undefined;
      for (const port of ports.inputs) {
        if (port.wholeLoop || !Object.hasOwn(node.inputs, port.key)) continue;
        const value = node.inputs[port.key];
        if (isLayerInput(value) && inside.has(value.layer)) return a.id;
        const found = isLinkInput(value) ? find(value.link) : undefined;
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const gesture = find(link);
    if (gesture === undefined) return;
    const name = layerDisplayName(layer);
    push(
      diag("warning", "repeat_from_own_gesture", `The Repeat of "${name}" follows ${patchPhrase(gesture)}, which runs once per copy of "${name}", so the number of copies decides itself: it keeps what it had last frame and can get stuck at 0 or 1.`, c.id, [layer.id, gesture], {
        port: "repeat",
        hint: "Link Repeat to the data the copies show, like a Loop Builder's Loop or a Loop's Index, and keep gestures for moving the copies.",
        suggestions: [{ description: `Disconnect the Repeat of "${name}"`, ops: [{ op: "setInput", component: c.id, target: `@${layer.id}.repeat`, value: null }] }],
      }),
    );
  };

  /**
   * A layer people touch makes one copy while two or more layers side by side inside it repeat on
   * their own, stacked in one spot. Copies placed apart (a looped Position, a parent with layout) are
   * a list, not a stuck card.
   */
  const loopsInsideSingleCopy = (layer: LayerNode, gestureId: Id) => {
    const byParent = new Map<Id, LayerNode[]>();
    const visit = (parent: LayerNode) => {
      const flows = parent.props.layout === "row" || parent.props.layout === "column" || parent.props.layout === "grid" || isLinkInput(parent.props.layout);
      for (const child of parent.children ?? []) {
        if (shapes.copies(child.id).kind !== "auto") {
          visit(child);
          continue;
        }
        const count = shapes.count(child.id);
        if (typeof count === "number" && count < 2) continue;
        const placed = (flows && child.props.positioning !== "absolute") || loopedProps(child).some((p) => p.key === "position");
        if (placed) continue;
        byParent.set(parent.id, [...(byParent.get(parent.id) ?? []), child]);
      }
    };
    visit(layer);
    const group = [...byParent.values()].find((g) => g.length >= 2);
    if (!group) return;
    // Repeat the layer once per item of the longest loop its children show.
    let pick: { value: InputValue; length: number; text: string } | undefined;
    for (const child of group) {
      for (const p of loopedProps(child)) {
        const value: InputValue | undefined = isLinkInput(p.value) ? { link: p.value.link } : isLoopLiteral(p.value) ? p.value.loop.length : undefined;
        const length = p.length ?? 0;
        if (value === undefined || (pick && length <= pick.length)) continue;
        pick = { value, length, text: isLinkInput(p.value) ? p.value.link : `${length}` };
      }
    }
    const name = layerDisplayName(layer);
    const suggestions: Suggestion[] = pick
      ? [{ description: typeof pick.value === "number" ? `Repeat "${name}" ${pick.value} times` : `Repeat "${name}" once per item of ${pick.text}`, ops: [{ op: "setInput", component: c.id, target: `@${layer.id}.repeat`, value: pick.value }] }]
      : [];
    push(
      diag("info", "loops_inside_single_copy", `${quoted(group)} repeat inside one "${name}": "${name}" itself makes 1 copy, so ${patchPhrase(gestureId)} moves all of them together.`, c.id, [layer.id, ...group.map((l) => l.id), gestureId], {
        port: "repeat",
        hint: `To make one "${name}" per item, link the loop to the Repeat of "${name}". Its children then follow its copies.`,
        suggestions,
      }),
    );
  };

  /** A layer's copies meet loops of other lengths: on its own properties, or inside it (children read their copy's item). */
  const layerLengths = (root: LayerNode, count: number, typed: boolean) => {
    if (count < 1) return;
    const found: (LoopedProp & { layer: LayerNode; length: number })[] = [];
    const collectFrom = (layer: LayerNode) => {
      for (const p of loopedProps(layer)) if (p.length !== null && p.length > 1 && p.length !== count) found.push({ ...p, layer, length: p.length });
      for (const child of layer.children ?? []) collectFrom(child);
    };
    collectFrom(root);
    if (!found.length) return;
    const deliberate = (f: { length: number }) => (f.length < count ? count % f.length === 0 : typed);
    const first = found.find((f) => !deliberate(f)) ?? found[0]!;
    const warn = !deliberate(first);
    const what = `the ${first.name} of "${layerDisplayName(first.layer)}"`;
    const makes = `"${layerDisplayName(root)}" makes ${count} ${count === 1 ? "copy" : "copies"}${typed ? " (its Repeat)" : ""}`;
    let message: string;
    if (first.length < count) {
      message = warn
        ? `${makes}, but ${what} is a loop of ${first.length}, so copy #${first.length} shows item #0 again.`
        : `${makes} and ${what} is a loop of ${first.length}, so its items repeat every ${first.length} copies.`;
    } else {
      const lost = first.length - count === 1 ? `item #${count} never shows` : `items #${count} to #${first.length - 1} never show`;
      message = warn ? `${makes}, but ${what} is a loop of ${first.length}, so ${lost}.` : `${makes}, so only the first ${count} of the ${first.length} items in ${what} show.`;
    }
    if (found.length > 1) message += ` ${found.length - 1} more ${found.length === 2 ? "property has" : "properties have"} other lengths.`;
    const hint = warn
      ? "A shorter loop starts over from its first item, and items past the last copy don't show. Give the loops the same number of items, or link Repeat to the loop the copies should follow."
      : first.length > count
        ? "To show every item, link Repeat to the loop instead of typing a number."
        : "That's how alternating patterns like stripes are made. If you didn't mean it, give the loops the same number of items.";
    push(diag(warn ? "warning" : "info", "loop_length_mismatch", message, c.id, items([root.id, first.layer.id, first.origin]), { port: first.key, hint }));
  };

  /** A patch's per-item inputs get loops of different lengths, so the shorter ones wrap. */
  const patchLengths = (id: Id, node: PatchNode) => {
    const ports = resolveNodePorts(doc, node, registry);
    if (!ports) return;
    const pass = passes(node.type === COMPONENT_PATCH_TYPE ? node.component : undefined);
    const loops: { port: ResolvedPort; length: number; origin: Id }[] = [];
    for (const port of ports.inputs) {
      if (port.wholeLoop || pass(port.key) || !Object.hasOwn(node.inputs, port.key)) continue;
      const shape = shapes.ofValue(node.inputs[port.key], id);
      if (shape && shape.length !== null && shape.length > 1) loops.push({ port, length: shape.length, origin: shape.origin });
    }
    const lengths = [...new Set(loops.map((l) => l.length))];
    if (lengths.length < 2) return;
    const max = Math.max(...lengths);
    const warn = lengths.some((n) => max % n !== 0);
    const parts = loops.map((l, i) => `${l.port.name} has ${l.length}${i === 0 ? " items" : ""}`);
    const shorter = lengths.length > 2 ? "the shorter loops start over from their first item" : "the shorter loop starts over from its first item";
    const extra: { port?: string; hint: string } = {
      hint: warn ? "If each item should pair with one item of the other loop, give the loops the same number of items." : "That's how alternating patterns like stripes are made. If you didn't mean it, give the loops the same number of items.",
    };
    const short = loops.find((l) => l.length !== max);
    if (short) extra.port = short.port.key;
    push(diag(warn ? "warning" : "info", "loop_length_mismatch", `${patchPhrase(id)} gets loops of different lengths (${listText(parts)}), so it runs ${max} times and ${shorter}.`, c.id, items([id, ...loops.map((l) => l.origin)]), extra));
  };

  walkLayers(c.layers, (layer) => {
    const own = shapes.copies(layer.id);
    const repeat = layer.props.repeat;
    if (own.kind === "inherited" && repeat !== undefined && repeat !== null) repeatInsideRepeat(layer, own.ancestor);
    if (own.kind === "repeat" && isLinkInput(repeat)) repeatFromOwnGesture(layer, repeat.link);
    const gesture = gestures.get(layer.id);
    if (own.kind === "single" && gesture !== undefined) loopsInsideSingleCopy(layer, gesture);
    if ((own.kind === "repeat" || own.kind === "auto") && own.count !== null) layerLengths(layer, own.count, own.kind === "repeat" && typeof repeat === "number");
  });
  for (const [id, node] of Object.entries(c.patches)) patchLengths(id, node);
  }

  return { ids, layerHead, layerProp, patchHead, patchInput, graph, touch, copies };
}

/** Unpublish a port (updateInterface with null), which disconnects its cables everywhere. */
function unpublishSuggestion(c: Component, side: "inputs" | "outputs", key: string, name: string): Suggestion {
  return { description: `Unpublish "${name}" from ${c.name} (disconnects its cables)`, ops: [{ op: "updateInterface", component: c.id, [side]: { [key]: null } }] };
}

/** "commit_distance" → "Commit Distance". */
const nameFromId = (id: Id) => id.replace(/_+/g, " ").trim().replace(/(^|\s)\S/g, (s) => s.toUpperCase()) || id;

/** Fixes for a link to a knob that isn't there: read the knob it probably meant, or make it. */
function missingKnobSuggestions(doc: SonobeDocument, c: Component, target: PortTarget, key: Id): Suggestion[] {
  const out: Suggestion[] = [];
  const knobs = doc.knobs?.knobs ?? [];
  const [guess] = didYouMean(key, knobs.map((k) => ({ value: k.id, aliases: [k.name] })));
  const match = guess === undefined ? undefined : knobs.find((k) => k.id === guess);
  if (match) out.push({ description: `Read ${knobLabel(match)} instead`, ops: [{ op: "setInput", component: c.id, target: target.address, value: { link: `$knob.${match.id}` } }] });
  const port = target.port;
  if (port && isKnobType(port.type) && (port.type !== "enum" || (port.enumOptions?.length ?? 0) >= 2)) {
    const knob: Extract<Op, { op: "addKnob" }> = { op: "addKnob", knob: { id: key, name: uniqueKnobName(knobs.map((k) => k.name), nameFromId(key)), type: port.type } };
    const value = port.default === undefined || port.default === null ? zeroLiteral(port.type, port.enumOptions) : port.default;
    if (isLiteral(value) && value !== null) knob.knob.value = value;
    if (port.type === "enum") knob.knob.options = port.enumOptions!.map((o) => ({ key: o.key, name: o.name }));
    out.push({ description: `Make the knob "${key}"`, ops: [knob] });
  }
  return out;
}

/** What reader diagnostics depend on in the knob table: ids, names (messages name knobs), types and enum options, not values. */
function knobDeclarations(set: KnobSet | undefined): string {
  return set ? JSON.stringify(set.knobs.map((k) => [k.id, k.name, k.type, k.options?.map((o) => o.key)])) : "";
}

/**
 * The knob table's own diagnostics (they point at the root component, with `knob` and `preset`): bad
 * or missing values, references to presets that don't exist, values outside a knob's range, and knobs
 * nothing reads. `read` holds the ids some link reads.
 */
function knobDiagnostics(doc: SonobeDocument, read: ReadonlySet<Id>, out: Diagnostic[]): void {
  const set = doc.knobs;
  if (!set) return;
  const root = doc.project.root;
  const at = (d: Diagnostic, knob?: Id, preset?: Id): Diagnostic => {
    if (knob !== undefined) d.knob = knob;
    if (preset !== undefined) d.preset = preset;
    return d;
  };
  const first = set.presets[0];
  if (!getKnobPreset(set, set.active) && first) {
    out.push(
      at(
        diag("warning", "unknown_knob_preset", `The running preset "${set.active}" doesn't exist, so the prototype runs ${first.name}.`, root, [], {
          suggestions: [{ description: `Run ${first.name}`, ops: [{ op: "applyKnobPreset", id: first.id }] }],
        }),
        undefined,
        set.active,
      ),
    );
  }
  for (const knob of set.knobs) {
    for (const preset of Object.keys(knob.values)) {
      if (getKnobPreset(set, preset)) continue;
      out.push(at(diag("warning", "unknown_knob_preset", `Knob "${knob.name}" has a value for "${preset}", which isn't a preset, so nothing uses it.`, root, [], { hint: `Remove "${preset}" from its values in knobs.json, or add a preset with that id.` }), knob.id, preset));
    }
    for (const preset of set.presets) {
      if (!Object.hasOwn(knob.values, preset.id)) {
        const running = knobLiteral(set, knob, preset.id);
        out.push(
          at(
            diag("warning", "knob_missing_value", `Knob "${knob.name}" has no value in ${preset.name}, so it runs ${formatKnobValue(knob, running)} there.`, root, [], {
              suggestions: [{ description: `Set it to ${formatKnobValue(knob, running)} in ${preset.name}`, ops: [{ op: "setKnobValue", id: knob.id, preset: preset.id, value: running }] }],
            }),
            knob.id,
            preset.id,
          ),
        );
        continue;
      }
      const value = knob.values[preset.id]!;
      const check = checkKnobLiteral(knob, value, `Knob "${knob.name}" in ${preset.name}`);
      if (!check.ok) {
        const fallback = first && first.id !== preset.id && checkKnobLiteral(knob, knob.values[first.id]).ok ? knob.values[first.id]! : knobZeroLiteral(knob);
        out.push(
          at(
            diag("error", "invalid_knob_value", `${check.error.message}${check.error.hint ? ` ${check.error.hint}` : ""}`, root, [], {
              suggestions: [{ description: `Set it to ${formatKnobValue(knob, fallback)}`, ops: [{ op: "setKnobValue", id: knob.id, preset: preset.id, value: fallback }] }],
            }),
            knob.id,
            preset.id,
          ),
        );
        continue;
      }
      if (!hasKnobRange(knob.type)) continue;
      const numbers = typeof value === "number" ? [value] : Array.isArray(value) ? value : [];
      const low = knob.min !== undefined ? numbers.find((n) => n < knob.min!) : undefined;
      const high = knob.max !== undefined ? numbers.find((n) => n > knob.max!) : undefined;
      if (low === undefined && high === undefined) continue;
      const range = knob.min !== undefined && knob.max !== undefined ? `${formatNumber(knob.min)}–${formatNumber(knob.max)}` : knob.min !== undefined ? `from ${formatNumber(knob.min)}` : `up to ${formatNumber(knob.max!)}`;
      const widen: Extract<Op, { op: "updateKnob" }> = { op: "updateKnob", id: knob.id };
      if (low !== undefined) widen.min = low;
      if (high !== undefined) widen.max = high;
      out.push(
        at(
          diag("info", "knob_out_of_range", `${knob.name} is ${formatKnobValue(knob, value)} in ${preset.name}, ${high !== undefined ? "above" : "below"} its range ${range}.`, root, [], {
            hint: "Ranges are soft: the value runs as typed, and the slider stops at the ends.",
            suggestions: [{ description: "Widen the range", ops: [widen] }],
          }),
          knob.id,
          preset.id,
        ),
      );
    }
    if (!read.has(knob.id)) {
      out.push(
        at(
          diag("info", "unused_knob", `Knob "${knob.name}" isn't used by anything, so moving it changes nothing.`, root, [], {
            hint: `Drive an input with it: { "link": "$knob.${knob.id}" }, or remove it.`,
            suggestions: [{ description: `Remove "${knob.name}"`, ops: [{ op: "removeKnob", id: knob.id }] }],
          }),
          knob.id,
        ),
      );
    }
  }
}

function documentDiagnostics(doc: SonobeDocument, out: Diagnostic[], files: boolean): void {
  const root = getOwn(doc.components, doc.project.root);
  if (!root) out.push(diag("error", "missing_root", `The project's root component "${doc.project.root}" doesn't exist.`, doc.project.root, []));
  else if (root.kind !== "prototype") out.push(diag("warning", "root_not_prototype", `The root component "${root.id}" is a ${root.kind}; the root should be a prototype.`, root.id, []));
  if (files) fileNameDiagnostics(doc, out);
}

/** Diagnose a whole document (or selected components; the knob table is checked only with the whole document). */
export function getDiagnostics(doc: SonobeDocument, registry: Registry, options: DiagnosticsOptions = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  documentDiagnostics(doc, out, !options.components);
  const ids = options.components ?? listComponentIds(doc);
  const read = new Set<Id>();
  for (const id of ids) {
    const c = getOwn(doc.components, id);
    if (!c) continue;
    const result = checkComponent(doc, c, registry);
    for (const d of resultList(result)) out.push(d);
    for (const knob of result.knobReads) read.add(knob);
  }
  if (!options.components) knobDiagnostics(doc, read, out);
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

    // A knob's id, name, type or options reach every input that reads it; values and the running preset don't.
    const knobsChanged = previous !== null && doc.knobs !== previous.doc.knobs && knobDeclarations(doc.knobs) !== knobDeclarations(previous.doc.knobs);

    const out: Diagnostic[] = [];
    documentDiagnostics(doc, out, true);
    const read = new Set<Id>();
    for (const id of ids) {
      const c = doc.components[id]!;
      const prev = reusable ? previous.results.get(id) : undefined;
      let result: ComponentResult | null = null;
      if (prev && !reachesChanged(id, new Set()) && !(knobsChanged && prev.knobReads.size)) {
        if (!changed.has(id)) result = prev;
        else result = updateComponent(doc, c, prev, registry);
      }
      result ??= checkComponent(doc, c, registry);
      results.set(id, result);
      for (const d of resultList(result)) out.push(d);
      for (const knob of result.knobReads) read.add(knob);
    }
    knobDiagnostics(doc, read, out);
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
