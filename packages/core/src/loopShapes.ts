/**
 * Loops as the document states them (ARCHITECTURE §4): which values in a component carry loops,
 * how long they are when the document fixes it, and how many copies each layer makes. The running
 * prototype can know more (a filtered list, rows from data); this is what holds before it runs.
 * Diagnostics use it to explain copies, and the engine uses it to keep out of its runtime warnings
 * the loop length mismatches diagnostics already report.
 */

import { parseAddress } from "./address.ts";
import { getOwn } from "./ids.ts";
import { MAX_REPEAT } from "./layerTypes.ts";
import { COMPONENT_INSTANCE_LAYER_TYPE, COMPONENT_PATCH_TYPE, findPort, resolveLayerOutputs, resolveLayerProps, resolveNodePorts, walkLayers, type ResolvedPort } from "./registry.ts";
import type { Id, LayerNode, PatchNode, Registry, SonobeDocument } from "./types.ts";
import { isLayerInput, isLinkInput, isLoopLiteral } from "./values.ts";

/** A value that carries a loop. */
export interface LoopShape {
  /** Items in the loop, or null when only the running prototype knows (a filtered list, a count from data). */
  length: number | null;
  /** The patch or layer the loop comes from: the one whose whole-loop output, stored loop or copies it is. */
  origin: Id;
}

/** How a layer makes copies, as the document says (the rules in ARCHITECTURE §4). */
export type LayerCopies =
  /** One copy: nothing loops it. */
  | { kind: "single" }
  /** One per copy of `ancestor`, the nearest ancestor that makes copies. Its own Repeat is ignored. */
  | { kind: "inherited"; ancestor: Id }
  /** Its Repeat decides: `count` copies (null when only the running prototype knows). */
  | { kind: "repeat"; count: number | null }
  /** Auto: one per item of the longest loop on its own properties (a component's loop inputs too). */
  | { kind: "auto"; count: number | null };

export interface LoopShapes {
  /** What a stored input or property value carries (null: not a loop). `holder` is the item storing it. */
  ofValue(value: unknown, holder: Id): LoopShape | null;
  /** What a source address carries: "names.loop", "@card.textSize". */
  ofLink(address: string): LoopShape | null;
  /** How a layer makes copies. */
  copies(layerId: Id): LayerCopies;
  /** The copy count of a layer that makes copies (Repeat or Auto), or of the ancestor it copies with; undefined for a single copy, null when unknown. */
  count(layerId: Id): number | null | undefined;
}

/** Whole-loop outputs whose length is the length of one whole-loop input: patch type → input key. */
const SAME_LENGTH_AS: Readonly<Record<string, string>> = { loopReverse: "loop", loopShuffle: "loop", runningTotal: "loop" };

/**
 * Whole-loop outputs with one item per item of one whole-loop input: patch type → input key. A
 * single value there picks a single item (Loop Select with one index), and a one-item loop reads
 * like that item: the patches reading it run once and print plain values.
 */
export const ONE_ITEM_PER: Readonly<Record<string, string>> = { loopSelect: "index" };

/** Patch type of Loop (Count → indices) and Loop Builder (one item per row). */
const LOOP_TYPE = "loop";
const LOOP_BUILDER_TYPE = "loopBuilder";

const PENDING = Symbol("pending");

const clampCount = (n: number) => Math.min(MAX_REPEAT, Math.max(0, Math.floor(n)));

/** Loop shapes of one component. Results are memoized, so build one per document revision. */
export function loopShapes(doc: SonobeDocument, componentId: Id, registry: Registry): LoopShapes {
  const c = getOwn(doc.components, componentId);
  const layers = new Map<Id, { layer: LayerNode; parent: Id | null }>();
  if (c) walkLayers(c.layers, (layer, info) => void layers.set(layer.id, { layer, parent: info.parent?.id ?? null }));
  const outputs = new Map<string, LoopShape | null | typeof PENDING>();
  const copiesMemo = new Map<Id, LayerCopies | typeof PENDING>();
  const SINGLE: LayerCopies = { kind: "single" };
  // A cycle (a drag on the layer it moves, feedback cables) reads as "not a loop" where it closes, so
  // values inside it can miss a loop: diagnostics then say less, never something false.
  const memoized = <K, V>(memo: Map<K, V | typeof PENDING>, key: K, cycle: V, compute: () => V): V => {
    const known = memo.get(key);
    if (known === PENDING) return cycle;
    if (known !== undefined) return known;
    memo.set(key, PENDING);
    const result = compute();
    memo.set(key, result);
    return result;
  };

  /** The longest of some loops; an empty loop wins, and unknown lengths stay unknown. */
  const longest = (shapes: readonly LoopShape[]): LoopShape | null => {
    if (!shapes.length) return null;
    const empty = shapes.find((s) => s.length === 0);
    if (empty) return empty;
    const unknown = shapes.find((s) => s.length === null);
    if (unknown) return unknown;
    return shapes.reduce((a, b) => (b.length! > a.length! ? b : a));
  };

  /** Per-item evaluation: the longest loop at a per-item input decides, and a one-item loop comes out a plain value. */
  const perItem = (holder: Id, stored: Record<string, unknown>, ports: readonly ResolvedPort[], include: (port: ResolvedPort) => boolean): LoopShape | null => {
    const shapes: LoopShape[] = [];
    for (const port of ports) {
      if (port.wholeLoop || !include(port) || !Object.hasOwn(stored, port.key)) continue;
      const shape = ofValue(stored[port.key], holder);
      if (shape) shapes.push(shape);
    }
    const shape = longest(shapes);
    return shape && shape.length === 1 ? null : shape;
  };

  const wholeLoopLength = (node: PatchNode, inputCount: number | undefined): number | null => {
    if (node.type === LOOP_BUILDER_TYPE) return inputCount ?? null;
    if (node.type === LOOP_TYPE) {
      const count = Object.hasOwn(node.inputs, "count") ? node.inputs.count : 3;
      return typeof count === "number" && Number.isFinite(count) ? clampCount(count) : null;
    }
    const from = getOwn(SAME_LENGTH_AS, node.type);
    if (from !== undefined && Object.hasOwn(node.inputs, from)) return ofValue(node.inputs[from], "")?.length ?? null;
    // One index picks one item; a loop of them can pick fewer (Skip), so only the running prototype knows.
    const picks = getOwn(ONE_ITEM_PER, node.type);
    if (picks !== undefined) {
      const shape = Object.hasOwn(node.inputs, picks) ? ofValue(node.inputs[picks], "") : null;
      return !shape || shape.length === 1 ? 1 : null;
    }
    return null;
  };

  const patchOutput = (id: Id, key: string): LoopShape | null =>
    memoized(outputs, `${id}.${key}`, null, () => {
      const node = c ? getOwn(c.patches, id) : undefined;
      const ports = node ? resolveNodePorts(doc, node, registry) : undefined;
      const out = ports ? findPort(ports.outputs, key) : undefined;
      if (!node || !ports || !out) return null;
      if (node.type === COMPONENT_PATCH_TYPE) {
        // A component patch makes one copy per item of its loop inputs; what loops inside it is its own business.
        const declared = node.component === undefined ? undefined : getOwn(doc.components, node.component)?.interface.inputs;
        return perItem(id, node.inputs, ports.inputs, (port) => getOwn(declared ?? {}, port.key)?.loopBehavior !== "pass");
      }
      if (out.wholeLoop) return { length: wholeLoopLength(node, ports.inputCount), origin: id };
      return perItem(id, node.inputs, ports.inputs, () => true);
    });

  /** A layer's copies as a loop of references, the way patches reading the layer see them. */
  const layerLoop = (layerId: Id): LoopShape | null => {
    const n = count(layerId);
    if (n === undefined) return null;
    const own = copies(layerId);
    return { length: n, origin: own.kind === "inherited" ? own.ancestor : layerId };
  };

  const layerSource = (layerId: Id, key: string): LoopShape | null => {
    const entry = layers.get(layerId);
    if (!entry || !c) return null;
    const layer = entry.layer;
    if (resolveLayerOutputs(doc, c.id, layer, registry).some((o) => o.key === key)) return layerLoop(layerId);
    // A layer property read as a source carries whatever drives it, except Repeat: that reads as the copy count, one number.
    if (key === "repeat") return null;
    return Object.hasOwn(layer.props, key) ? ofValue(layer.props[key], layerId) : null;
  };

  function ofLink(address: string): LoopShape | null {
    const a = parseAddress(address);
    if (!a || a.index !== undefined) return null;
    switch (a.kind) {
      case "patch":
        return patchOutput(a.id, a.key);
      case "layer":
        return layerSource(a.id, a.key);
      // Published inputs come from outside the component, so only the running prototype knows them.
      // A knob is one constant for every copy, so it never loops.
      case "componentInput":
      case "componentOutput":
      case "knob":
        return null;
      default: {
        const unhandled: never = a;
        return unhandled;
      }
    }
  }

  function ofValue(value: unknown, holder: Id): LoopShape | null {
    if (isLinkInput(value)) return ofLink(value.link);
    if (isLoopLiteral(value)) return { length: value.loop.length, origin: holder };
    if (isLayerInput(value)) return layerLoop(value.layer);
    return null;
  }

  function copies(layerId: Id): LayerCopies {
    return memoized(copiesMemo, layerId, SINGLE, () => computeCopies(layerId));
  }

  function computeCopies(layerId: Id): LayerCopies {
    const entry = layers.get(layerId);
    if (!entry || !c) return SINGLE;
    if (entry.parent !== null) {
      const up = copies(entry.parent);
      if (up.kind === "inherited") return up;
      if (up.kind !== "single") return { kind: "inherited", ancestor: entry.parent };
    }
    const layer = entry.layer;
    const repeat = layer.props.repeat;
    if (repeat !== undefined && repeat !== null) {
      if (typeof repeat === "number") return { kind: "repeat", count: Number.isFinite(repeat) ? clampCount(repeat) : null };
      const shape = ofValue(repeat, layerId);
      return { kind: "repeat", count: shape ? shape.length : null };
    }
    const props = resolveLayerProps(doc, c.id, layer, registry) ?? [];
    const declared = layer.type === COMPONENT_INSTANCE_LAYER_TYPE && layer.component !== undefined ? getOwn(doc.components, layer.component)?.interface.inputs : undefined;
    const shapes: LoopShape[] = [];
    for (const [key, value] of Object.entries(layer.props)) {
      const prop = findPort(props, key);
      if (!prop || prop.wholeLoop || (declared && getOwn(declared, key)?.loopBehavior === "pass")) continue;
      const shape = ofValue(value, layerId);
      if (shape) shapes.push(shape);
    }
    const shape = longest(shapes);
    return shape ? { kind: "auto", count: shape.length } : SINGLE;
  }

  function count(layerId: Id): number | null | undefined {
    const own = copies(layerId);
    const root = own.kind === "inherited" ? copies(own.ancestor) : own;
    return root.kind === "repeat" || root.kind === "auto" ? root.count : undefined;
  }

  return { ofValue, ofLink, copies, count };
}
