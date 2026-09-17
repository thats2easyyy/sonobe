/**
 * Files dropped on the Layers panel. A single image, video, or Lottie file dropped on a layer of the
 * matching type replaces what it shows; files dropped on a group go inside it (in front); files
 * dropped on any other row become new media layers just in front of that layer; files dropped below
 * the rows go in front of everything. Imports go through `session.assets` (via the canvas helpers,
 * so drops behave the same on both surfaces).
 */

import { deviceScreenSize, findLayer, isLinkInput, type Id, type Op, type Registry, type SonobeDocument } from "@sonobe/core";
import type { EditorSession } from "../../state/session.ts";
import { classifyMediaFile, dropUndoLabel, MEDIA_LAYER, mediaLayerOps, prepareDroppedFiles, type MediaKind } from "../canvas/assetDrop.ts";

export type LayerFileDrop =
  | { kind: "replace"; layerId: Id; prop: string; label: string }
  | {
      kind: "insert";
      parentId: Id | null;
      /** Index among the parent's children (back → front); undefined puts the new layers in front. */
      index?: number;
      /** Size of what the layers land in (group size, else the prototype screen). */
      frame: [number, number];
      /** "Add image above Title" */
      label: string;
      /** The group or layer the drop names, for the undo label. */
      anchorName?: string;
    };

const vec2 = (value: unknown): [number, number] | undefined =>
  Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number" && value[0] > 0 && value[1] > 0 ? [value[0], value[1]] : undefined;

const NOUNS: Readonly<Record<MediaKind, string>> = { image: "image", video: "video", lottie: "Lottie animation" };

/** "image", "video", "Lottie animation", "3 files", or "file". */
export function mediaNoun(kinds: readonly (MediaKind | null)[]): string {
  if (kinds.length > 1) return `${kinds.length} files`;
  const kind = kinds[0];
  return kind ? NOUNS[kind] : "file";
}

/** Media kinds of a drag from the MIME types it exposes before the drop (file names aren't readable yet). */
export function dragMediaKinds(items: ArrayLike<{ kind: string; type: string }> | null | undefined): (MediaKind | null)[] {
  return Array.from(items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => classifyMediaFile({ name: "", type: item.type }));
}

/** What dropping files of `kinds` on `layerId` (null: below the rows) does. */
export function planLayerFileDrop(doc: SonobeDocument, componentId: Id, registry: Registry, layerId: Id | null, kinds: readonly (MediaKind | null)[]): LayerFileDrop | undefined {
  const component = doc.components[componentId];
  if (!component) return undefined;
  const noun = mediaNoun(kinds);
  const screen = component.size ? vec2(component.size) : undefined;
  const root: [number, number] = screen ?? deviceScreenSize(doc.project.device);
  const entry = layerId !== null ? findLayer(component.layers, layerId) : undefined;
  if (!entry) return { kind: "insert", parentId: null, frame: root, label: `Add ${noun}` };
  const layer = entry.layer;
  const only = kinds.length === 1 ? kinds[0] : null;
  if (only && MEDIA_LAYER[only].type === layer.type && !isLinkInput(layer.props[MEDIA_LAYER[only].prop])) {
    return { kind: "replace", layerId: layer.id, prop: MEDIA_LAYER[only].prop, label: `Replace ${NOUNS[only]} in ${layer.name}` };
  }
  if (registry.layers.get(layer.type)?.canHaveChildren) {
    return { kind: "insert", parentId: layer.id, frame: vec2(layer.props.size) ?? root, label: `Add ${noun} to ${layer.name}`, anchorName: layer.name };
  }
  const parent = entry.parent ?? null;
  return { kind: "insert", parentId: parent?.id ?? null, index: entry.index + 1, frame: (parent ? vec2(parent.props.size) : undefined) ?? root, label: `Add ${noun} above ${layer.name}`, anchorName: layer.name };
}

export interface LayerFileDropResult {
  ok: boolean;
  /** Layers added (select them). */
  layerIds: Id[];
  /** Human-first problems (unsupported files, failed imports). */
  errors: string[];
  label?: string;
}

/** Import dropped files and add or update layers in one undo step (the import itself is its own step). */
export async function dropFilesOnLayers(session: EditorSession, componentId: Id, layerId: Id | null, files: readonly File[]): Promise<LayerFileDropResult> {
  const prepared = await prepareDroppedFiles(session, files);
  const errors = [...prepared.errors];
  if (prepared.items.length === 0) return { ok: false, layerIds: [], errors };
  const store = session.document.getState();
  const plan = planLayerFileDrop(store.doc, componentId, session.registry, layerId, prepared.items.map((item) => item.kind));
  if (!plan) return { ok: false, layerIds: [], errors };
  let ops: Op[];
  let refs: string[] = [];
  let label: string;
  if (plan.kind === "replace") {
    ops = [...prepared.assetOps, { op: "setInput", component: componentId, target: `@${plan.layerId}.${plan.prop}`, value: prepared.items[0]!.value }];
    label = plan.label;
  } else {
    const placed = mediaLayerOps(prepared.items, { componentId, center: [plan.frame[0] / 2, plan.frame[1] / 2], parentId: plan.parentId, parentWorld: null, artboard: plan.frame });
    const index = plan.index;
    const layerOps = index === undefined ? placed.ops : placed.ops.map((op, i): Op => (op.op === "addLayer" ? { ...op, index: index + i } : op));
    ops = [...prepared.assetOps, ...layerOps];
    refs = placed.refs;
    label = plan.parentId !== null && plan.index === undefined && plan.anchorName ? `${dropUndoLabel(prepared.items)} to ${plan.anchorName}` : dropUndoLabel(prepared.items);
  }
  const result = session.document.getState().apply(ops, { label, defaultComponent: componentId });
  if (!result.ok) return { ok: false, layerIds: [], errors: [result.errors[0]?.message ?? "Couldn't add the files.", ...errors], label };
  return { ok: true, layerIds: refs.map((ref) => result.idMap[ref]).filter((id): id is Id => typeof id === "string"), errors, label };
}
