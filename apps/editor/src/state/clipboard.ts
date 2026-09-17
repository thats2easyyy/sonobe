/**
 * Clipboard fragments: layers and patches copied out of a component, with the assets they use.
 * Pasting turns a fragment into one atomic applyOps batch that recreates every item with fresh ids
 * (through "$ref" names) and rewires links between copied items to the copies. Links to items that
 * don't exist where you paste are dropped.
 */

import {
  componentItemIds,
  findLayer,
  formatAddress,
  isAssetInput,
  isLayerInput,
  isLinkInput,
  isValidId,
  parseAddress,
  slugify,
  uniqueId,
  walkLayers,
  type ApplyOpsResult,
  type AssetRecord,
  type Component,
  type Id,
  type InputValue,
  type LayerNode,
  type NewLayer,
  type NewPatch,
  type Op,
  type PatchNode,
  type SonobeDocument,
} from "@sonobe/core";

export const CLIPBOARD_TYPE = "sonobe/clipboard";
export const CLIPBOARD_FORMAT_VERSION = 1;
/** Custom clipboard MIME type written next to text/plain. */
export const CLIPBOARD_MIME = "application/x-sonobe-clipboard+json";

export interface ClipboardFragment {
  type: typeof CLIPBOARD_TYPE;
  formatVersion: typeof CLIPBOARD_FORMAT_VERSION;
  /** Where the items came from (used to offset pasted patches). */
  source?: { component: Id };
  /** Top-level copied layers (back → front) with their subtrees. */
  layers: LayerNode[];
  patches: Record<Id, PatchNode>;
  assets: Record<Id, AssetRecord>;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Selected layers without any whose ancestor is also selected, in walk (back → front) order. */
export function topLevelLayerIds(component: Component, ids: readonly Id[]): Id[] {
  const wanted = new Set(ids);
  const out: Id[] = [];
  walkLayers(component.layers, (layer) => {
    if (!wanted.has(layer.id)) return;
    out.push(layer.id);
    return "skip";
  });
  return out;
}

function collectAssets(values: Iterable<InputValue>, doc: SonobeDocument, into: Record<Id, AssetRecord>): void {
  for (const v of values) {
    if (isAssetInput(v)) {
      const record = doc.assets[v.asset];
      if (record) into[record.id] = clone(record);
    }
  }
}

/** Copy layers (with subtrees) and patches out of a component. Null when nothing matches. */
export function createClipboardFragment(doc: SonobeDocument, componentId: Id, items: { layers?: readonly Id[]; patches?: readonly Id[] }): ClipboardFragment | null {
  const component = doc.components[componentId];
  if (!component) return null;
  const layers = topLevelLayerIds(component, items.layers ?? []).map((id) => clone(findLayer(component.layers, id)!.layer));
  const patches: Record<Id, PatchNode> = {};
  for (const id of items.patches ?? []) {
    const node = component.patches[id];
    if (node) patches[id] = clone(node);
  }
  if (layers.length === 0 && Object.keys(patches).length === 0) return null;
  const assets: Record<Id, AssetRecord> = {};
  walkLayers(layers, (layer) => collectAssets(Object.values(layer.props), doc, assets));
  for (const node of Object.values(patches)) collectAssets(Object.values(node.inputs), doc, assets);
  return { type: CLIPBOARD_TYPE, formatVersion: CLIPBOARD_FORMAT_VERSION, source: { component: componentId }, layers, patches, assets };
}

export function serializeClipboardFragment(fragment: ClipboardFragment): string {
  return JSON.stringify(fragment);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function isLayerNodeShape(v: unknown): v is LayerNode {
  if (!isObject(v) || typeof v.id !== "string" || typeof v.type !== "string" || typeof v.name !== "string" || !isObject(v.props)) return false;
  return v.children === undefined || (Array.isArray(v.children) && v.children.every(isLayerNodeShape));
}

function isPatchNodeShape(v: unknown): v is PatchNode {
  return isObject(v) && typeof v.type === "string" && isObject(v.inputs) && isObject(v.ui) && typeof v.ui.x === "number" && typeof v.ui.y === "number";
}

/** Parse clipboard text (or an object) into a fragment; null when it isn't one. */
export function parseClipboardFragment(input: unknown): ClipboardFragment | null {
  let value = input;
  if (typeof input === "string") {
    const text = input.trim();
    if (!text.startsWith("{")) return null;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!isObject(value) || value.type !== CLIPBOARD_TYPE || value.formatVersion !== CLIPBOARD_FORMAT_VERSION) return null;
  const layers = value.layers ?? [];
  const patches = value.patches ?? {};
  const assets = value.assets ?? {};
  if (!Array.isArray(layers) || !layers.every(isLayerNodeShape) || !isObject(patches) || !Object.values(patches).every(isPatchNodeShape) || !isObject(assets)) return null;
  const fragment: ClipboardFragment = { type: CLIPBOARD_TYPE, formatVersion: CLIPBOARD_FORMAT_VERSION, layers: clone(layers), patches: clone(patches as Record<Id, PatchNode>), assets: clone(assets as Record<Id, AssetRecord>) };
  if (isObject(value.source) && typeof value.source.component === "string") fragment.source = { component: value.source.component };
  return fragment;
}

export interface PasteOptions {
  /** Parent layer for pasted layers (null: component root). */
  parent?: Id | null;
  /** Insertion index among the parent's children (default: in front). */
  index?: number;
  /** Added to pasted patch positions. */
  patchOffset?: readonly [number, number];
  /** Ids that can't be used even though they're free (removed earlier this session). */
  isReserved?: (id: Id) => boolean;
}

export interface PastePlan {
  ops: Op[];
  /** Ops from this index on only restore links; they may be dropped if they fail. */
  linkStart: number;
  /** Original top-level layer id → batch ref name. */
  layerRefs: Map<Id, string>;
  /** Original patch id → batch ref name. */
  patchRefs: Map<Id, string>;
  /** Original id → the id the copy gets ("card" → "card_2"), for every pasted layer and patch. */
  ids: Map<Id, Id>;
}

const layerRef = (id: Id) => `l_${id}`;
const patchRef = (id: Id) => `p_${id}`;

/** Build the ops that paste a fragment into a component. */
export function planPaste(doc: SonobeDocument, componentId: Id, fragment: ClipboardFragment, options: PasteOptions = {}): PastePlan {
  const target = doc.components[componentId];
  const fragmentLayerIds = new Set<Id>();
  walkLayers(fragment.layers, (layer) => {
    fragmentLayerIds.add(layer.id);
  });
  const existsPatch = (id: Id) => !!target && id in target.patches;
  const existsLayer = (id: Id) => !!target && !!findLayer(target.layers, id);

  const remapLink = (link: string): string | undefined => {
    const parsed = parseAddress(link);
    if (!parsed) return undefined;
    switch (parsed.kind) {
      case "patch":
        if (fragment.patches[parsed.id]) return formatAddress({ ...parsed, id: `$${patchRef(parsed.id)}` });
        return existsPatch(parsed.id) ? link : undefined;
      case "layer":
        if (fragmentLayerIds.has(parsed.id)) return formatAddress({ ...parsed, id: `$${layerRef(parsed.id)}` });
        return existsLayer(parsed.id) ? link : undefined;
      case "componentInput":
        return target?.interface.inputs[parsed.key] ? link : undefined;
      case "componentOutput":
        return undefined;
    }
  };
  const remap = (value: InputValue): InputValue | undefined => {
    if (isLinkInput(value)) {
      const link = remapLink(value.link);
      return link === undefined ? undefined : { link };
    }
    if (isLayerInput(value)) {
      if (fragmentLayerIds.has(value.layer)) return { layer: `$${layerRef(value.layer)}` };
      return existsLayer(value.layer) ? value : undefined;
    }
    return value;
  };
  const deferred = (value: InputValue) => isLinkInput(value) || isLayerInput(value);

  const ops: Op[] = [];
  const later: Op[] = [];
  const layerRefs = new Map<Id, string>();
  const patchRefs = new Map<Id, string>();

  // Copies keep their original ids when free, else get the next suffix ("card" → "card_2").
  const taken = new Set<Id>(target ? componentItemIds(target) : []);
  const ids = new Map<Id, Id>();
  const assign = (original: Id): Id => {
    const base = isValidId(original) ? original : slugify(original);
    const id = uniqueId(base, (candidate) => taken.has(candidate) || !!options.isReserved?.(candidate));
    taken.add(id);
    ids.set(original, id);
    return id;
  };

  for (const [id, record] of Object.entries(fragment.assets)) {
    if (!doc.assets[id]) ops.push({ op: "addAsset", asset: clone(record) });
  }

  const toNewLayer = (layer: LayerNode): NewLayer => {
    const props: Record<string, InputValue> = {};
    for (const [key, value] of Object.entries(layer.props)) {
      if (!deferred(value)) props[key] = clone(value);
      else {
        const next = remap(value);
        if (next !== undefined) later.push({ op: "setInput", component: componentId, target: `@$${layerRef(layer.id)}.${key}`, value: next });
      }
    }
    const nl: NewLayer = { ref: layerRef(layer.id), id: assign(layer.id), type: layer.type, name: layer.name, props };
    if (layer.component !== undefined) nl.component = layer.component;
    if (layer.children?.length) nl.children = layer.children.map(toNewLayer);
    return nl;
  };

  fragment.layers.forEach((layer, i) => {
    layerRefs.set(layer.id, layerRef(layer.id));
    const op: Op = { op: "addLayer", component: componentId, parent: options.parent ?? null, layer: toNewLayer(layer) };
    if (options.index !== undefined) op.index = options.index + i;
    ops.push(op);
  });

  const [dx, dy] = options.patchOffset ?? [0, 0];
  for (const [id, node] of Object.entries(fragment.patches)) {
    patchRefs.set(id, patchRef(id));
    const inputs: Record<string, InputValue> = {};
    for (const [key, value] of Object.entries(node.inputs)) {
      if (!deferred(value)) inputs[key] = clone(value);
      else {
        const next = remap(value);
        if (next !== undefined) later.push({ op: "setInput", component: componentId, target: `$${patchRef(id)}.${key}`, value: next });
      }
    }
    const np: NewPatch = { ref: patchRef(id), id: assign(id), type: node.type, inputs, ui: { x: node.ui.x + dx, y: node.ui.y + dy } };
    if (node.name !== undefined) np.name = node.name;
    if (node.typeParam !== undefined) np.typeParam = node.typeParam;
    if (node.inputCount !== undefined) np.inputCount = node.inputCount;
    if (node.settings !== undefined) np.settings = clone(node.settings);
    if (node.component !== undefined) np.component = node.component;
    ops.push({ op: "addPatch", component: componentId, patch: np });
    if (node.muted || node.ui.collapsed || node.ui.color !== undefined) {
      const update: Op = { op: "updatePatch", component: componentId, id: `$${patchRef(id)}` };
      if (node.muted) update.muted = true;
      if (node.ui.collapsed || node.ui.color !== undefined) update.ui = { ...(node.ui.collapsed ? { collapsed: true } : {}), ...(node.ui.color !== undefined ? { color: node.ui.color } : {}) };
      ops.push(update);
    }
  }

  const linkStart = ops.length;
  ops.push(...later);
  return { ops, linkStart, layerRefs, patchRefs, ids };
}

export interface PasteOutcome {
  result: ApplyOpsResult;
  /** New ids of pasted top-level layers. */
  layers: Id[];
  patches: Id[];
  /** Links that couldn't be restored where the items were pasted. */
  droppedLinks: number;
}

/** Apply a paste plan, dropping link ops that fail validation (e.g. a type mismatch in another component). */
export function applyPastePlan(plan: PastePlan, apply: (ops: Op[]) => ApplyOpsResult): PasteOutcome {
  let ops = plan.ops;
  let dropped = 0;
  for (;;) {
    const result = apply(ops);
    if (result.ok) {
      const layers = [...plan.layerRefs.values()].map((ref) => result.idMap[ref]).filter((id): id is Id => id !== undefined);
      const patches = [...plan.patchRefs.values()].map((ref) => result.idMap[ref]).filter((id): id is Id => id !== undefined);
      return { result, layers, patches, droppedLinks: dropped };
    }
    const failed = result.results.find((r) => !r.ok && r.error?.code !== "skipped");
    const index = failed?.index ?? result.errors[0]?.opIndex;
    if (index === undefined || index < plan.linkStart || index >= ops.length) return { result, layers: [], patches: [], droppedLinks: dropped };
    ops = ops.filter((_, i) => i !== index);
    dropped++;
  }
}
