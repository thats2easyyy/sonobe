/**
 * Clipboard fragments: layers, patches, and comments copied out of a component, with the assets
 * they use (records plus bytes when the host holds them), the script files their JavaScript
 * patches run, and the definitions of the components their instances show. Pasting turns a
 * fragment into one atomic applyOps batch that recreates every item with fresh ids (through "$ref"
 * names) and rewires links between copied items to the copies. Links to items that don't exist where
 * you paste are dropped, and so are instances of components that can't be used there.
 */

import {
  COMPONENT_INSTANCE_LAYER_TYPE,
  COMPONENT_PATCH_TYPE,
  componentDependencies,
  componentItemIds,
  findLayer,
  formatAddress,
  getOwn,
  isAssetInput,
  isFileNameTaken,
  isLayerInput,
  isLinkInput,
  isValidId,
  parseAddress,
  slugify,
  uniqueId,
  walkLayers,
  wouldCreateComponentCycle,
  type ApplyOpsResult,
  type AssetRecord,
  type CommentNode,
  type Component,
  type ComponentKind,
  type Id,
  type InputValue,
  type LayerNode,
  type NewLayer,
  type NewPatch,
  type Op,
  type PatchNode,
  type SonobeDocument,
} from "@sonobe/core";
import { base64ToBytes, bytesToBase64 } from "./bytes.ts";

export const CLIPBOARD_TYPE = "sonobe/clipboard";
export const CLIPBOARD_FORMAT_VERSION = 1;
/** Custom clipboard MIME type written next to text/plain. */
export const CLIPBOARD_MIME = "application/x-sonobe-clipboard+json";
/** Patch type whose `settings.script` names a file in `doc.scripts`. */
export const SCRIPT_PATCH_TYPE = "javascript";
/** Asset bytes larger than this (in total) stay out of the clipboard; records still copy. */
export const MAX_CLIPBOARD_ASSET_BYTES = 16 * 1024 * 1024;

export interface ClipboardFragment {
  type: typeof CLIPBOARD_TYPE;
  formatVersion: typeof CLIPBOARD_FORMAT_VERSION;
  /** Where the items came from (used to offset pasted patches). */
  source?: { component: Id };
  /** Top-level copied layers (back → front) with their subtrees. */
  layers: LayerNode[];
  patches: Record<Id, PatchNode>;
  assets: Record<Id, AssetRecord>;
  /** Comment frames (patch-editor space). */
  comments?: CommentNode[];
  /** Sources of the script files copied JavaScript patches use, by file name. */
  scripts?: Record<string, string>;
  /** Asset bytes as base64, by asset id (when the host held them). */
  assetData?: Record<Id, string>;
  /** Definitions of the components copied instances show, and of the components those contain, by id. */
  components?: Record<Id, Component>;
}

export interface ClipboardItems {
  layers?: readonly Id[];
  patches?: readonly Id[];
  comments?: readonly Id[];
}

export interface ClipboardCopyOptions {
  /** Bytes of an asset file, when available synchronously (host memory). */
  readAssetBytes?: (record: AssetRecord) => ArrayBuffer | Uint8Array | undefined;
  /** Total byte budget for embedded assets. Default MAX_CLIPBOARD_ASSET_BYTES. */
  maxAssetBytes?: number;
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
      const record = getOwn(doc.assets, v.asset);
      if (record) into[record.id] = clone(record);
    }
  }
}

/** The script file a JavaScript patch runs, if any. */
export function scriptFileOf(node: PatchNode): string | undefined {
  if (node.type !== SCRIPT_PATCH_TYPE) return undefined;
  const file = node.settings?.script;
  return typeof file === "string" && file.trim() ? file.trim() : undefined;
}

/** Component ids that instance layers and component patches point at (not following components). */
function componentRefs(layers: readonly LayerNode[], patches: Iterable<PatchNode>): Set<Id> {
  const refs = new Set<Id>();
  walkLayers(layers, (layer) => {
    if (layer.type === COMPONENT_INSTANCE_LAYER_TYPE && layer.component !== undefined) refs.add(layer.component);
  });
  for (const node of patches) if (node.type === COMPONENT_PATCH_TYPE && node.component !== undefined) refs.add(node.component);
  return refs;
}

/** Copy layers (with subtrees), patches, and comments out of a component. Null when nothing matches. */
export function createClipboardFragment(doc: SonobeDocument, componentId: Id, items: ClipboardItems, options: ClipboardCopyOptions = {}): ClipboardFragment | null {
  const component = getOwn(doc.components, componentId);
  if (!component) return null;
  const layers = topLevelLayerIds(component, items.layers ?? []).map((id) => clone(findLayer(component.layers, id)!.layer));
  const patches: Record<Id, PatchNode> = {};
  for (const id of items.patches ?? []) {
    const node = getOwn(component.patches, id);
    if (node) patches[id] = clone(node);
  }
  const wantedComments = new Set(items.comments ?? []);
  const comments = component.comments.filter((c) => wantedComments.has(c.id)).map((c) => clone(c));
  if (layers.length === 0 && Object.keys(patches).length === 0 && comments.length === 0) return null;

  // The components instances show, with everything they contain, so the paste works in another prototype too.
  const components: Record<Id, Component> = {};
  for (const id of componentRefs(layers, Object.values(patches))) {
    for (const dep of [id, ...componentDependencies(doc, id)]) {
      const c = getOwn(doc.components, dep);
      if (c && !Object.hasOwn(components, dep)) components[dep] = clone(c);
    }
  }

  const assets: Record<Id, AssetRecord> = {};
  const scripts: Record<string, string> = {};
  const collect = (layerNodes: readonly LayerNode[], patchNodes: Iterable<PatchNode>) => {
    walkLayers(layerNodes, (layer) => collectAssets(Object.values(layer.props), doc, assets));
    for (const node of patchNodes) {
      collectAssets(Object.values(node.inputs), doc, assets);
      const file = scriptFileOf(node);
      const source = file !== undefined ? getOwn(doc.scripts, file) : undefined;
      if (file !== undefined && source !== undefined) scripts[file] = source;
    }
  };
  collect(layers, Object.values(patches));
  for (const c of Object.values(components)) {
    collect(c.layers, Object.values(c.patches));
    collectAssets(Object.values(c.interface.inputs).flatMap((p) => (p.default === undefined ? [] : [p.default])), doc, assets);
  }

  const fragment: ClipboardFragment = { type: CLIPBOARD_TYPE, formatVersion: CLIPBOARD_FORMAT_VERSION, source: { component: componentId }, layers, patches, assets };
  if (comments.length) fragment.comments = comments;
  if (Object.keys(scripts).length) fragment.scripts = scripts;
  if (Object.keys(components).length) fragment.components = components;

  if (options.readAssetBytes) {
    let budget = options.maxAssetBytes ?? MAX_CLIPBOARD_ASSET_BYTES;
    const assetData: Record<Id, string> = {};
    for (const record of Object.values(assets)) {
      let bytes: ArrayBuffer | Uint8Array | undefined;
      try {
        bytes = options.readAssetBytes(record);
      } catch {
        bytes = undefined;
      }
      if (!bytes || bytes.byteLength > budget) continue;
      budget -= bytes.byteLength;
      assetData[record.id] = bytesToBase64(bytes);
    }
    if (Object.keys(assetData).length) fragment.assetData = assetData;
  }
  return fragment;
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

function isCommentShape(v: unknown): v is CommentNode {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.text === "string" &&
    Array.isArray(v.rect) &&
    v.rect.length === 4 &&
    v.rect.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    (v.color === undefined || typeof v.color === "string")
  );
}

const COMPONENT_KINDS: readonly string[] = ["prototype", "layerComponent", "patchComponent"];

function isComponentShape(v: unknown): v is Component {
  return (
    isObject(v) &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.kind === "string" &&
    COMPONENT_KINDS.includes(v.kind) &&
    isObject(v.interface) &&
    isObject(v.interface.inputs) &&
    isObject(v.interface.outputs) &&
    Array.isArray(v.layers) &&
    v.layers.every(isLayerNodeShape) &&
    isObject(v.patches) &&
    Object.values(v.patches).every(isPatchNodeShape) &&
    Array.isArray(v.comments)
  );
}

const isStringMap = (v: unknown): v is Record<string, string> => isObject(v) && Object.values(v).every((s) => typeof s === "string");

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
  const comments = value.comments ?? [];
  const scripts = value.scripts ?? {};
  const assetData = value.assetData ?? {};
  const components = value.components ?? {};
  if (!Array.isArray(layers) || !layers.every(isLayerNodeShape) || !isObject(patches) || !Object.values(patches).every(isPatchNodeShape) || !isObject(assets)) return null;
  if (!Array.isArray(comments) || !comments.every(isCommentShape) || !isStringMap(scripts) || !isStringMap(assetData)) return null;
  if (!isObject(components) || !Object.entries(components).every(([id, c]) => isComponentShape(c) && c.id === id)) return null;
  const fragment: ClipboardFragment = { type: CLIPBOARD_TYPE, formatVersion: CLIPBOARD_FORMAT_VERSION, layers: clone(layers), patches: clone(patches as Record<Id, PatchNode>), assets: clone(assets as Record<Id, AssetRecord>) };
  if (isObject(value.source) && typeof value.source.component === "string") fragment.source = { component: value.source.component };
  if (comments.length) fragment.comments = clone(comments);
  if (Object.keys(scripts).length) fragment.scripts = { ...scripts };
  if (Object.keys(assetData).length) fragment.assetData = { ...assetData };
  if (Object.keys(components).length) fragment.components = clone(components as Record<Id, Component>);
  return fragment;
}

export interface PasteOptions {
  /** Parent layer for pasted layers (null: component root). */
  parent?: Id | null;
  /** Insertion index among the parent's children (default: in front). */
  index?: number;
  /** Added to pasted patch and comment positions. */
  patchOffset?: readonly [number, number];
  /** Ids that can't be used even though they're free (removed earlier this session). */
  isReserved?: (id: Id) => boolean;
  /** Fragment components to treat as unavailable, so their instances aren't pasted (applyPastePlan's fallback). */
  excludeComponents?: ReadonlySet<Id>;
}

export interface PastePlan {
  ops: Op[];
  /** Ops from this index on only restore links; they may be dropped if they fail. */
  linkStart: number;
  /** Original top-level layer id → batch ref name. */
  layerRefs: Map<Id, string>;
  /** Original patch id → batch ref name. */
  patchRefs: Map<Id, string>;
  /** Original comment id → batch ref name. */
  commentRefs: Map<Id, string>;
  /** Original id → the id the copy gets ("card" → "card_2"), for every pasted layer, patch, and comment. */
  ids: Map<Id, Id>;
  /** Fragment asset id → the asset id used where you paste (existing same-content assets are reused). */
  assetIds: Map<Id, Id>;
  /** Fragment script file → the file the pasted patches use. */
  scriptFiles: Map<string, string>;
  /** Asset bytes to hand to the host, by asset file name. */
  assetBytes: Record<string, Uint8Array>;
  /** Fragment component id → the component pasted instances show (a same-id, same-kind one here is reused). */
  componentIds: Map<Id, Id>;
  /** Op index of each addComponent op → the fragment component it adds. */
  componentOps: Map<number, Id>;
  /** Instances left out: their component isn't available here, is the wrong kind, or would contain itself. */
  droppedInstances: number;
  /** The same paste with more fragment components treated as unavailable. */
  without?: (componentIds: ReadonlySet<Id>) => PastePlan;
}

const layerRef = (id: Id) => `l_${id}`;
const patchRef = (id: Id) => `p_${id}`;
const commentRef = (id: Id) => `c_${id}`;

/** "js_1.js" → "js_1_2.js" (the first free name). */
function uniqueScriptFile(file: string, isTaken: (name: string) => boolean): string {
  const dot = file.lastIndexOf(".");
  const base = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}${ext}`;
    if (!isTaken(candidate)) return candidate;
  }
}

/** Build the ops that paste a fragment into a component. */
export function planPaste(doc: SonobeDocument, componentId: Id, fragment: ClipboardFragment, options: PasteOptions = {}): PastePlan {
  const target = getOwn(doc.components, componentId);
  const excluded = options.excludeComponents ?? new Set<Id>();
  const embedded = fragment.components ?? {};

  // Components: reuse a component with the same id and kind; add the fragment's definition otherwise
  // (under a new id when that id is taken by another kind, or by a name differing only by case).
  const componentIds = new Map<Id, Id>();
  const unavailable = new Set<Id>();
  const kindOf = new Map<Id, ComponentKind>();
  const added = new Map<Id, Component>();
  const takenComponents = Object.keys(doc.components);
  const resolving = new Set<Id>();
  const resolveComponent = (id: Id): Id | undefined => {
    if (componentIds.has(id)) return componentIds.get(id);
    if (unavailable.has(id) || excluded.has(id) || resolving.has(id)) return undefined;
    const def = getOwn(embedded, id);
    const existing = getOwn(doc.components, id);
    if (existing && (!def || existing.kind === def.kind)) {
      componentIds.set(id, id);
      kindOf.set(id, existing.kind);
      return id;
    }
    if (!def) {
      unavailable.add(id);
      return undefined;
    }
    resolving.add(id);
    const depsOk = [...componentRefs(def.layers, Object.values(def.patches))].every((dep) => resolveComponent(dep) !== undefined);
    resolving.delete(id);
    if (!depsOk) {
      unavailable.add(id);
      return undefined;
    }
    const newId = isFileNameTaken(takenComponents, id) ? uniqueId(isValidId(id) ? id : slugify(id, "component"), (c) => isFileNameTaken(takenComponents, c)) : id;
    takenComponents.push(newId);
    componentIds.set(id, newId);
    kindOf.set(newId, def.kind);
    added.set(id, def); // Dependencies were added first, so this order adds them before the components that use them.
    return newId;
  };
  for (const ref of componentRefs(fragment.layers, Object.values(fragment.patches))) resolveComponent(ref);

  /** A definition with the ids of the components it instantiates remapped (and, when given, assets and scripts). */
  const remapDefinition = (fragmentId: Id, def: Component, values?: { literal: (v: InputValue) => InputValue; scriptFiles: Map<string, string> }): Component => {
    const out = clone(def);
    out.id = componentIds.get(fragmentId)!;
    walkLayers(out.layers, (layer) => {
      if (layer.type === COMPONENT_INSTANCE_LAYER_TYPE && layer.component !== undefined) layer.component = componentIds.get(layer.component) ?? layer.component;
      if (values) for (const [key, value] of Object.entries(layer.props)) layer.props[key] = values.literal(value);
    });
    for (const node of Object.values(out.patches)) {
      if (node.type === COMPONENT_PATCH_TYPE && node.component !== undefined) node.component = componentIds.get(node.component) ?? node.component;
      if (!values) continue;
      for (const [key, value] of Object.entries(node.inputs)) node.inputs[key] = values.literal(value);
      const file = scriptFileOf(node);
      const renamed = file !== undefined ? values.scriptFiles.get(file) : undefined;
      if (renamed !== undefined && renamed !== file) node.settings = { ...node.settings, script: renamed };
    }
    if (values) for (const port of Object.values(out.interface.inputs)) if (port.default !== undefined) port.default = values.literal(port.default);
    return out;
  };
  const merged: SonobeDocument = { ...doc, components: { ...doc.components } };
  for (const [fragmentId, def] of added) merged.components[componentIds.get(fragmentId)!] = remapDefinition(fragmentId, def);

  /** The component a pasted instance can show here, or undefined when it has to be left out. */
  const usableTarget = (ref: Id | undefined, kind: ComponentKind): Id | undefined => {
    const id = ref === undefined ? undefined : componentIds.get(ref);
    if (id === undefined || kindOf.get(id) !== kind) return undefined;
    return target && wouldCreateComponentCycle(merged, componentId, id) ? undefined : id;
  };
  let droppedInstances = 0;
  const droppedLayers = new Set<Id>();
  const instanceTargets = new Map<Id, Id>();
  walkLayers(fragment.layers, (layer) => {
    if (layer.type !== COMPONENT_INSTANCE_LAYER_TYPE) return;
    const id = usableTarget(layer.component, "layerComponent");
    if (id !== undefined) {
      instanceTargets.set(layer.id, id);
      return;
    }
    droppedInstances++;
    walkLayers([layer], (inner) => {
      droppedLayers.add(inner.id);
    });
    return "skip";
  });
  const droppedPatches = new Set<Id>();
  const patchTargets = new Map<Id, Id>();
  for (const [id, node] of Object.entries(fragment.patches)) {
    if (node.type !== COMPONENT_PATCH_TYPE) continue;
    const componentTarget = usableTarget(node.component, "patchComponent");
    if (componentTarget !== undefined) patchTargets.set(id, componentTarget);
    else {
      droppedPatches.add(id);
      droppedInstances++;
    }
  }
  // Only definitions a pasted instance still needs (and what they contain) get added.
  const needed = new Set<Id>();
  const need = (targetId: Id) => {
    for (const [fragmentId, def] of added) {
      if (componentIds.get(fragmentId) !== targetId || needed.has(fragmentId)) continue;
      needed.add(fragmentId);
      for (const dep of componentRefs(def.layers, Object.values(def.patches))) {
        const depTarget = componentIds.get(dep);
        if (depTarget !== undefined) need(depTarget);
      }
    }
  };
  for (const id of [...instanceTargets.values(), ...patchTargets.values()]) need(id);
  const neededDefs = [...added].filter(([fragmentId]) => needed.has(fragmentId));

  const fragmentLayerIds = new Set<Id>();
  walkLayers(fragment.layers, (layer) => {
    if (!droppedLayers.has(layer.id)) fragmentLayerIds.add(layer.id);
  });
  const pastedPatches = Object.entries(fragment.patches).filter(([id]) => !droppedPatches.has(id));
  const existsPatch = (id: Id) => !!target && Object.hasOwn(target.patches, id);
  const existsLayer = (id: Id) => !!target && !!findLayer(target.layers, id);

  const ops: Op[] = [];
  const later: Op[] = [];

  // Assets: reuse same-content records, rename records whose id is taken by different media.
  const assetIds = new Map<Id, Id>();
  const assetBytes: Record<string, Uint8Array> = {};
  const takenAssets = new Set<Id>(Object.keys(doc.assets));
  const existingAssets = Object.values(doc.assets);
  for (const [id, record] of Object.entries(fragment.assets)) {
    const data = fragment.assetData?.[id];
    if (data !== undefined) {
      const bytes = base64ToBytes(data);
      if (bytes) assetBytes[record.file] = bytes;
    }
    const same = (a: AssetRecord) => a.file === record.file || (!!record.sha256 && a.sha256 === record.sha256);
    const existing = getOwn(doc.assets, id);
    if (existing && same(existing)) {
      assetIds.set(id, id);
      continue;
    }
    const match = existingAssets.find(same);
    if (match) {
      assetIds.set(id, match.id);
      continue;
    }
    const newId = existing ? uniqueId(isValidId(id) ? id : slugify(id, "asset"), (candidate) => takenAssets.has(candidate)) : id;
    takenAssets.add(newId);
    assetIds.set(id, newId);
    ops.push({ op: "addAsset", asset: { ...clone(record), id: newId } });
  }

  // Script files: a pasted JavaScript patch gets its own copy of its script (like duplicating one in
  // Origami), unless an identical file here isn't used by any patch yet. Patches pasted together that
  // shared a file share the copy. Names that differ only by case count as taken.
  const scriptFiles = new Map<string, string>();
  const takenScripts = Object.keys(doc.scripts);
  const usedScripts = new Set<string>();
  for (const c of Object.values(doc.components)) {
    for (const node of Object.values(c.patches)) {
      const file = scriptFileOf(node);
      if (file !== undefined) usedScripts.add(file);
    }
  }
  const neededScripts = new Set<string>();
  for (const node of [...pastedPatches.map(([, n]) => n), ...neededDefs.flatMap(([, def]) => Object.values(def.patches))]) {
    const file = scriptFileOf(node);
    if (file !== undefined) neededScripts.add(file);
  }
  for (const [file, source] of Object.entries(fragment.scripts ?? {})) {
    if (!neededScripts.has(file)) continue;
    if (getOwn(doc.scripts, file) === source && !usedScripts.has(file)) {
      scriptFiles.set(file, file);
      continue;
    }
    const name = !isFileNameTaken(takenScripts, file) ? file : uniqueScriptFile(file, (candidate) => isFileNameTaken(takenScripts, candidate));
    takenScripts.push(name);
    scriptFiles.set(file, name);
    ops.push({ op: "setScript", file: name, source });
  }

  const literal = (value: InputValue): InputValue => {
    if (isAssetInput(value)) {
      const id = assetIds.get(value.asset);
      if (id !== undefined && id !== value.asset) return { ...clone(value), asset: id };
    }
    return clone(value);
  };

  // Components before the layers and patches that show them (assets and scripts they use come first).
  const componentOps = new Map<number, Id>();
  for (const [fragmentId, def] of neededDefs) {
    componentOps.set(ops.length, fragmentId);
    ops.push({ op: "addComponent", component: remapDefinition(fragmentId, def, { literal, scriptFiles }) });
  }

  const remapLink = (link: string): string | undefined => {
    const parsed = parseAddress(link);
    if (!parsed) return undefined;
    switch (parsed.kind) {
      case "patch":
        if (droppedPatches.has(parsed.id)) return undefined;
        if (Object.hasOwn(fragment.patches, parsed.id)) return formatAddress({ ...parsed, id: `$${patchRef(parsed.id)}` });
        return existsPatch(parsed.id) ? link : undefined;
      case "layer":
        if (droppedLayers.has(parsed.id)) return undefined;
        if (fragmentLayerIds.has(parsed.id)) return formatAddress({ ...parsed, id: `$${layerRef(parsed.id)}` });
        return existsLayer(parsed.id) ? link : undefined;
      case "componentInput":
        return target && getOwn(target.interface.inputs, parsed.key) ? link : undefined;
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
      if (droppedLayers.has(value.layer)) return undefined;
      if (fragmentLayerIds.has(value.layer)) return { layer: `$${layerRef(value.layer)}` };
      return existsLayer(value.layer) ? value : undefined;
    }
    return value;
  };
  const deferred = (value: InputValue) => isLinkInput(value) || isLayerInput(value);

  const layerRefs = new Map<Id, string>();
  const patchRefs = new Map<Id, string>();
  const commentRefs = new Map<Id, string>();

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

  const toNewLayer = (layer: LayerNode): NewLayer | undefined => {
    if (droppedLayers.has(layer.id)) return undefined;
    const props: Record<string, InputValue> = {};
    for (const [key, value] of Object.entries(layer.props)) {
      if (!deferred(value)) props[key] = literal(value);
      else {
        const next = remap(value);
        if (next !== undefined) later.push({ op: "setInput", component: componentId, target: `@$${layerRef(layer.id)}.${key}`, value: next });
      }
    }
    const nl: NewLayer = { ref: layerRef(layer.id), id: assign(layer.id), type: layer.type, name: layer.name, props };
    if (layer.component !== undefined) nl.component = instanceTargets.get(layer.id) ?? layer.component;
    const children = (layer.children ?? []).map(toNewLayer).filter((c): c is NewLayer => c !== undefined);
    if (children.length) nl.children = children;
    return nl;
  };

  let pastedIndex = 0;
  for (const layer of fragment.layers) {
    const nl = toNewLayer(layer);
    if (!nl) continue;
    layerRefs.set(layer.id, layerRef(layer.id));
    const op: Op = { op: "addLayer", component: componentId, parent: options.parent ?? null, layer: nl };
    if (options.index !== undefined) op.index = options.index + pastedIndex;
    pastedIndex++;
    ops.push(op);
  }

  const [dx, dy] = options.patchOffset ?? [0, 0];
  for (const [id, node] of pastedPatches) {
    patchRefs.set(id, patchRef(id));
    const inputs: Record<string, InputValue> = {};
    for (const [key, value] of Object.entries(node.inputs)) {
      if (!deferred(value)) inputs[key] = literal(value);
      else {
        const next = remap(value);
        if (next !== undefined) later.push({ op: "setInput", component: componentId, target: `$${patchRef(id)}.${key}`, value: next });
      }
    }
    const np: NewPatch = { ref: patchRef(id), id: assign(id), type: node.type, inputs, ui: { x: node.ui.x + dx, y: node.ui.y + dy } };
    if (node.name !== undefined) np.name = node.name;
    if (node.typeParam !== undefined) np.typeParam = node.typeParam;
    if (node.inputCount !== undefined) np.inputCount = node.inputCount;
    if (node.settings !== undefined) {
      np.settings = clone(node.settings);
      const file = scriptFileOf(node);
      const renamed = file !== undefined ? scriptFiles.get(file) : undefined;
      if (renamed !== undefined && renamed !== file) np.settings = { ...np.settings, script: renamed };
    }
    if (node.component !== undefined) np.component = patchTargets.get(id) ?? node.component;
    ops.push({ op: "addPatch", component: componentId, patch: np });
    if (node.muted || node.ui.collapsed || node.ui.color !== undefined) {
      const update: Op = { op: "updatePatch", component: componentId, id: `$${patchRef(id)}` };
      if (node.muted) update.muted = true;
      if (node.ui.collapsed || node.ui.color !== undefined) update.ui = { ...(node.ui.collapsed ? { collapsed: true } : {}), ...(node.ui.color !== undefined ? { color: node.ui.color } : {}) };
      ops.push(update);
    }
  }

  for (const comment of fragment.comments ?? []) {
    commentRefs.set(comment.id, commentRef(comment.id));
    const [x, y, w, h] = comment.rect;
    ops.push({
      op: "addComment",
      component: componentId,
      comment: { ref: commentRef(comment.id), id: assign(comment.id), text: comment.text, rect: [x + dx, y + dy, w, h], ...(comment.color !== undefined ? { color: comment.color } : {}) },
    });
  }

  const linkStart = ops.length;
  ops.push(...later);
  return {
    ops,
    linkStart,
    layerRefs,
    patchRefs,
    commentRefs,
    ids,
    assetIds,
    scriptFiles,
    assetBytes,
    componentIds,
    componentOps,
    droppedInstances,
    without: (more) => planPaste(doc, componentId, fragment, { ...options, excludeComponents: new Set([...excluded, ...more]) }),
  };
}

export interface PasteOutcome {
  result: ApplyOpsResult;
  /** New ids of pasted top-level layers. */
  layers: Id[];
  patches: Id[];
  comments: Id[];
  /** Links that couldn't be restored where the items were pasted. */
  droppedLinks: number;
  /** Component instances that couldn't be pasted (see PastePlan.droppedInstances). */
  droppedInstances: number;
}

/**
 * Apply a paste plan, dropping link ops that fail validation (e.g. a type mismatch in another
 * component). When a component the fragment carries can't be added here, the paste goes ahead
 * without that component's instances.
 */
export function applyPastePlan(plan: PastePlan, apply: (ops: Op[]) => ApplyOpsResult): PasteOutcome {
  let current = plan;
  let ops = plan.ops;
  let dropped = 0;
  const excluded = new Set<Id>();
  const refIds = (result: ApplyOpsResult, refs: Map<Id, string>) => [...refs.values()].map((ref) => result.idMap[ref]).filter((id): id is Id => id !== undefined);
  for (;;) {
    const result = apply(ops);
    const droppedInstances = current.droppedInstances ?? 0;
    if (result.ok) {
      return { result, layers: refIds(result, current.layerRefs), patches: refIds(result, current.patchRefs), comments: refIds(result, current.commentRefs ?? new Map()), droppedLinks: dropped, droppedInstances };
    }
    const failed = result.results.find((r) => !r.ok && r.error?.code !== "skipped");
    const index = failed?.index ?? result.errors[0]?.opIndex;
    const failedComponent = index !== undefined && index < current.linkStart ? current.componentOps?.get(index) : undefined;
    if (failedComponent !== undefined && current.without && !excluded.has(failedComponent)) {
      excluded.add(failedComponent);
      current = current.without(excluded);
      ops = current.ops;
      dropped = 0;
      continue;
    }
    if (index === undefined || index < current.linkStart || index >= ops.length) return { result, layers: [], patches: [], comments: [], droppedLinks: dropped, droppedInstances };
    ops = ops.filter((_, i) => i !== index);
    dropped++;
  }
}
