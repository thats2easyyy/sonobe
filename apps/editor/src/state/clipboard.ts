/**
 * Clipboard fragments: layers, patches, and comments copied out of a component, with the assets
 * they use (records plus bytes when the host holds them) and the script files their JavaScript
 * patches run. Pasting turns a fragment into one atomic applyOps batch that recreates every item
 * with fresh ids (through "$ref" names) and rewires links between copied items to the copies. Links
 * to items that don't exist where you paste are dropped.
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
  type CommentNode,
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
      const record = doc.assets[v.asset];
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

/** Copy layers (with subtrees), patches, and comments out of a component. Null when nothing matches. */
export function createClipboardFragment(doc: SonobeDocument, componentId: Id, items: ClipboardItems, options: ClipboardCopyOptions = {}): ClipboardFragment | null {
  const component = doc.components[componentId];
  if (!component) return null;
  const layers = topLevelLayerIds(component, items.layers ?? []).map((id) => clone(findLayer(component.layers, id)!.layer));
  const patches: Record<Id, PatchNode> = {};
  for (const id of items.patches ?? []) {
    const node = component.patches[id];
    if (node) patches[id] = clone(node);
  }
  const wantedComments = new Set(items.comments ?? []);
  const comments = component.comments.filter((c) => wantedComments.has(c.id)).map((c) => clone(c));
  if (layers.length === 0 && Object.keys(patches).length === 0 && comments.length === 0) return null;
  const assets: Record<Id, AssetRecord> = {};
  walkLayers(layers, (layer) => collectAssets(Object.values(layer.props), doc, assets));
  for (const node of Object.values(patches)) collectAssets(Object.values(node.inputs), doc, assets);
  const fragment: ClipboardFragment = { type: CLIPBOARD_TYPE, formatVersion: CLIPBOARD_FORMAT_VERSION, source: { component: componentId }, layers, patches, assets };
  if (comments.length) fragment.comments = comments;

  const scripts: Record<string, string> = {};
  for (const node of Object.values(patches)) {
    const file = scriptFileOf(node);
    if (file !== undefined && doc.scripts[file] !== undefined) scripts[file] = doc.scripts[file]!;
  }
  if (Object.keys(scripts).length) fragment.scripts = scripts;

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
  if (!Array.isArray(layers) || !layers.every(isLayerNodeShape) || !isObject(patches) || !Object.values(patches).every(isPatchNodeShape) || !isObject(assets)) return null;
  if (!Array.isArray(comments) || !comments.every(isCommentShape) || !isStringMap(scripts) || !isStringMap(assetData)) return null;
  const fragment: ClipboardFragment = { type: CLIPBOARD_TYPE, formatVersion: CLIPBOARD_FORMAT_VERSION, layers: clone(layers), patches: clone(patches as Record<Id, PatchNode>), assets: clone(assets as Record<Id, AssetRecord>) };
  if (isObject(value.source) && typeof value.source.component === "string") fragment.source = { component: value.source.component };
  if (comments.length) fragment.comments = clone(comments);
  if (Object.keys(scripts).length) fragment.scripts = { ...scripts };
  if (Object.keys(assetData).length) fragment.assetData = { ...assetData };
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
  const target = doc.components[componentId];
  const fragmentLayerIds = new Set<Id>();
  walkLayers(fragment.layers, (layer) => {
    fragmentLayerIds.add(layer.id);
  });
  const existsPatch = (id: Id) => !!target && id in target.patches;
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
    const existing = doc.assets[id];
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

  // Script files: reuse identical sources, rename files that exist with different code.
  const scriptFiles = new Map<string, string>();
  const takenScripts = new Set(Object.keys(doc.scripts));
  for (const [file, source] of Object.entries(fragment.scripts ?? {})) {
    if (doc.scripts[file] === source) {
      scriptFiles.set(file, file);
      continue;
    }
    const name = doc.scripts[file] === undefined && !takenScripts.has(file) ? file : uniqueScriptFile(file, (candidate) => takenScripts.has(candidate));
    takenScripts.add(name);
    scriptFiles.set(file, name);
    ops.push({ op: "setScript", file: name, source });
  }

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
  const literal = (value: InputValue): InputValue => {
    if (isAssetInput(value)) {
      const id = assetIds.get(value.asset);
      if (id !== undefined && id !== value.asset) return { ...clone(value), asset: id };
    }
    return clone(value);
  };

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

  const toNewLayer = (layer: LayerNode): NewLayer => {
    const props: Record<string, InputValue> = {};
    for (const [key, value] of Object.entries(layer.props)) {
      if (!deferred(value)) props[key] = literal(value);
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
    if (node.component !== undefined) np.component = node.component;
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
  return { ops, linkStart, layerRefs, patchRefs, commentRefs, ids, assetIds, scriptFiles, assetBytes };
}

export interface PasteOutcome {
  result: ApplyOpsResult;
  /** New ids of pasted top-level layers. */
  layers: Id[];
  patches: Id[];
  comments: Id[];
  /** Links that couldn't be restored where the items were pasted. */
  droppedLinks: number;
}

/** Apply a paste plan, dropping link ops that fail validation (e.g. a type mismatch in another component). */
export function applyPastePlan(plan: PastePlan, apply: (ops: Op[]) => ApplyOpsResult): PasteOutcome {
  let ops = plan.ops;
  let dropped = 0;
  const refIds = (result: ApplyOpsResult, refs: Map<Id, string>) => [...refs.values()].map((ref) => result.idMap[ref]).filter((id): id is Id => id !== undefined);
  for (;;) {
    const result = apply(ops);
    if (result.ok) {
      return { result, layers: refIds(result, plan.layerRefs), patches: refIds(result, plan.patchRefs), comments: refIds(result, plan.commentRefs ?? new Map()), droppedLinks: dropped };
    }
    const failed = result.results.find((r) => !r.ok && r.error?.code !== "skipped");
    const index = failed?.index ?? result.errors[0]?.opIndex;
    if (index === undefined || index < plan.linkStart || index >= ops.length) return { result, layers: [], patches: [], comments: [], droppedLinks: dropped };
    ops = ops.filter((_, i) => i !== index);
    dropped++;
  }
}
