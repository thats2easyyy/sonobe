/**
 * Selection-based document edits shared by commands, context menus, and tests: delete, copy, cut,
 * paste, duplicate, group, ungroup, create component, select all, visibility, lock, arrange, and
 * entering or leaving components. Each is one atomic, undoable batch.
 */

import {
  COMPONENT_INSTANCE_LAYER_TYPE,
  COMPONENT_PATCH_TYPE,
  deviceScreenSize,
  findLayer,
  isLinkInput,
  resolveLayerProps,
  type ApplyOpsResult,
  type Component,
  type Id,
  type LayerNode,
  type Op,
  type SonobeDocument,
} from "@sonobe/core";
import { applyPastePlan, createClipboardFragment, planPaste, topLevelLayerIds, type ClipboardFragment } from "./clipboard.ts";
import { currentComponentId, hasSelection } from "./selection.ts";
import type { EditorSession } from "./session.ts";

export interface ActionResult {
  ok: boolean;
  /** Human-first explanation when !ok (for a toast). */
  message?: string;
  hint?: string;
  result?: ApplyOpsResult;
}

const failed = (message: string, hint?: string): ActionResult => (hint ? { ok: false, message, hint } : { ok: false, message });

function fromResult(result: ApplyOpsResult): ActionResult {
  if (result.ok) return { ok: true, result };
  const error = result.errors[0];
  return { ok: false, result, message: error?.message ?? "That change couldn't be made.", ...(error?.hint ? { hint: error.hint } : {}) };
}

interface Context {
  doc: SonobeDocument;
  componentId: Id;
  component: Component;
}

function context(session: EditorSession): Context | undefined {
  const doc = session.document.getState().doc;
  const componentId = currentComponentId(session.selection.getState());
  const component = doc.components[componentId];
  return component ? { doc, componentId, component } : undefined;
}

const apply = (session: EditorSession, ops: Op[], label: string, componentId: Id) => session.document.getState().apply(ops, { label, defaultComponent: componentId });

function itemLabel(component: Component, layers: readonly Id[], patches: readonly Id[], comments: readonly Id[] = []): string {
  const count = layers.length + patches.length + comments.length;
  if (count !== 1) return `${count} items`;
  if (layers[0]) return findLayer(component.layers, layers[0])?.layer.name ?? layers[0];
  if (patches[0]) {
    const node = component.patches[patches[0]];
    return node?.name ?? patches[0];
  }
  return "comment";
}

interface Frame {
  position: [number, number];
  size: [number, number];
  topLeft: [number, number];
}

const vec2 = (v: unknown): [number, number] | undefined => (Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number" ? [v[0], v[1]] : undefined);

/** Position, size, and top-left when all are literal (or defaults). */
function literalFrame(session: EditorSession, doc: SonobeDocument, componentId: Id, layer: LayerNode): Frame | undefined {
  const props = resolveLayerProps(doc, componentId, layer, session.registry);
  if (!props) return undefined;
  const read = (key: string) => {
    const stored = layer.props[key];
    if (stored !== undefined) return isLinkInput(stored) ? undefined : vec2(stored);
    return vec2(props.find((p) => p.key === key)?.default);
  };
  const position = read("position");
  const size = read("size");
  const anchor = read("anchor") ?? [0, 0];
  if (!position || !size) return undefined;
  return { position, size, topLeft: [position[0] - anchor[0] * size[0], position[1] - anchor[1] * size[1]] };
}

/** Delete selected layers (with their children), patches, and comments. */
export function deleteSelection(session: EditorSession): ActionResult {
  const ctx = context(session);
  const s = session.selection.getState();
  if (!ctx || !hasSelection(s)) return failed("Select something to delete.");
  const layers = topLevelLayerIds(ctx.component, s.layers);
  const patches = s.patches.filter((id) => id in ctx.component.patches);
  const comments = s.comments.filter((id) => ctx.component.comments.some((c) => c.id === id));
  const ops: Op[] = [
    ...layers.map((id): Op => ({ op: "removeLayer", component: ctx.componentId, id })),
    ...patches.map((id): Op => ({ op: "removePatch", component: ctx.componentId, id })),
    ...comments.map((id): Op => ({ op: "removeComment", component: ctx.componentId, id })),
  ];
  if (ops.length === 0) return failed("Select something to delete.");
  const result = apply(session, ops, `Delete ${itemLabel(ctx.component, layers, patches, comments)}`, ctx.componentId);
  if (result.ok) session.selection.getState().clear();
  return fromResult(result);
}

/** Fragment of the current selection, carrying asset bytes the session holds. */
function fragmentOf(session: EditorSession, ctx: Context, items: { layers: readonly Id[]; patches: readonly Id[]; comments: readonly Id[] }): ClipboardFragment | null {
  const assets = (session as Partial<Pick<EditorSession, "assets">>).assets;
  return createClipboardFragment(ctx.doc, ctx.componentId, items, assets ? { readAssetBytes: (record) => assets.peekBytes(record.file) } : {});
}

/** Copy the selection into a fragment (also kept on the session as the paste fallback). */
export function copySelection(session: EditorSession): ClipboardFragment | null {
  const ctx = context(session);
  const s = session.selection.getState();
  if (!ctx) return null;
  const fragment = fragmentOf(session, ctx, { layers: s.layers, patches: s.patches, comments: s.comments });
  if (fragment) session.clipboard = fragment;
  return fragment;
}

/** Copy, then delete. */
export function cutSelection(session: EditorSession): ActionResult & { fragment?: ClipboardFragment } {
  const fragment = copySelection(session);
  if (!fragment) return failed("Select layers, patches, or comments to cut.");
  const ctx = context(session)!;
  const s = session.selection.getState();
  const layers = topLevelLayerIds(ctx.component, s.layers);
  const patches = s.patches.filter((id) => id in ctx.component.patches);
  const comments = s.comments.filter((id) => ctx.component.comments.some((c) => c.id === id));
  const ops: Op[] = [
    ...layers.map((id): Op => ({ op: "removeLayer", component: ctx.componentId, id })),
    ...patches.map((id): Op => ({ op: "removePatch", component: ctx.componentId, id })),
    ...comments.map((id): Op => ({ op: "removeComment", component: ctx.componentId, id })),
  ];
  const result = apply(session, ops, `Cut ${itemLabel(ctx.component, layers, patches, comments)}`, ctx.componentId);
  if (result.ok) session.selection.getState().clear();
  return { ...fromResult(result), fragment };
}

export interface PasteActionResult extends ActionResult {
  layers: Id[];
  patches: Id[];
  /** Pasted comment ids. */
  comments?: Id[];
  droppedLinks: number;
}

/** Paste a fragment above the selected layer (or in front), selecting what was pasted. */
export function pasteFragment(session: EditorSession, fragment: ClipboardFragment, options: { label?: string } = {}): PasteActionResult {
  const ctx = context(session);
  if (!ctx) return { ...failed("There's no component to paste into."), layers: [], patches: [], droppedLinks: 0 };
  const s = session.selection.getState();
  let parent: Id | null = null;
  let index: number | undefined;
  const anchorId = s.layers.at(-1);
  const anchor = anchorId ? findLayer(ctx.component.layers, anchorId) : undefined;
  if (anchor) {
    parent = anchor.parent?.id ?? null;
    index = anchor.index + 1;
  }
  const overlapping =
    Object.values(fragment.patches).some((node) => Object.values(ctx.component.patches).some((p) => p.ui.x === node.ui.x && p.ui.y === node.ui.y)) ||
    (fragment.comments ?? []).some((c) => ctx.component.comments.some((existing) => existing.rect[0] === c.rect[0] && existing.rect[1] === c.rect[1]));
  const plan = planPaste(ctx.doc, ctx.componentId, fragment, {
    parent,
    ...(index !== undefined ? { index } : {}),
    patchOffset: overlapping ? [24, 24] : [0, 0],
    isReserved: session.document.getState().isReservedId,
  });
  const comments = fragment.comments ?? [];
  const count = fragment.layers.length + Object.keys(fragment.patches).length + comments.length;
  const single = fragment.layers[0]?.name ?? Object.values(fragment.patches)[0]?.name ?? (comments.length ? "comment" : "1 item");
  const label = options.label ?? `Paste ${count === 1 ? single : `${count} items`}`;
  // Bytes first, so the runtime can load pasted media as soon as the document changes.
  const assets = (session as Partial<Pick<EditorSession, "assets">>).assets;
  if (assets) for (const [file, bytes] of Object.entries(plan.assetBytes)) if (!assets.peekBytes(file)) assets.storeBytes(file, bytes);
  const outcome = applyPastePlan(plan, (ops) => apply(session, ops, label, ctx.componentId));
  if (outcome.result.ok) session.selection.getState().select({ layers: outcome.layers, patches: outcome.patches, comments: outcome.comments });
  return { ...fromResult(outcome.result), layers: outcome.layers, patches: outcome.patches, comments: outcome.comments, droppedLinks: outcome.droppedLinks };
}

/** Duplicate the selection in place (patches and comments shift so the copies are visible). */
export function duplicateSelection(session: EditorSession): PasteActionResult {
  const ctx = context(session);
  const s = session.selection.getState();
  if (!ctx) return { ...failed("Select layers or patches to duplicate."), layers: [], patches: [], droppedLinks: 0 };
  const fragment = fragmentOf(session, ctx, { layers: s.layers, patches: s.patches, comments: s.comments });
  if (!fragment) return { ...failed("Select layers or patches to duplicate."), layers: [], patches: [], droppedLinks: 0 };
  const top = topLevelLayerIds(ctx.component, s.layers);
  const last = top.length ? findLayer(ctx.component.layers, top.at(-1)!) : undefined;
  if (last) session.selection.getState().select({ layers: [last.layer.id], patches: [], comments: [] });
  return pasteFragment(session, fragment, { label: `Duplicate ${itemLabel(ctx.component, top, Object.keys(fragment.patches), fragment.comments?.map((c) => c.id))}` });
}

/** Wrap the selected layers in a new group that hugs them. */
export function groupSelection(session: EditorSession): ActionResult & { groupId?: Id } {
  const ctx = context(session);
  if (!ctx) return failed("Select layers to group.");
  const top = topLevelLayerIds(ctx.component, session.selection.getState().layers);
  if (top.length === 0) return failed("Select layers to group.");
  const locations = top.map((id) => findLayer(ctx.component.layers, id)!);
  if (new Set(locations.map((l) => l.parent?.id ?? null)).size > 1) return failed("These layers sit in different groups, so they can't be grouped together.", "Move them into the same group first.");
  const parent = locations[0]!.parent;
  const frames = locations.map((l) => literalFrame(session, ctx.doc, ctx.componentId, l.layer));
  let position: [number, number] = [0, 0];
  let size: [number, number] = (parent && literalFrame(session, ctx.doc, ctx.componentId, parent)?.size) ?? ctx.component.size ?? deviceScreenSize(ctx.doc.project.device);
  const literal = frames.every((f): f is Frame => f !== undefined);
  if (literal) {
    const minX = Math.min(...frames.map((f) => f.topLeft[0]));
    const minY = Math.min(...frames.map((f) => f.topLeft[1]));
    const maxX = Math.max(...frames.map((f) => f.topLeft[0] + f.size[0]));
    const maxY = Math.max(...frames.map((f) => f.topLeft[1] + f.size[1]));
    position = [minX, minY];
    size = [maxX - minX, maxY - minY];
  }
  const ops: Op[] = [
    {
      op: "addLayer",
      component: ctx.componentId,
      parent: parent?.id ?? null,
      index: Math.max(...locations.map((l) => l.index)) + 1,
      layer: { ref: "group", type: "group", name: "Group", props: { position, size } },
    },
  ];
  for (const loc of [...locations].sort((a, b) => a.index - b.index)) ops.push({ op: "moveLayer", component: ctx.componentId, id: loc.layer.id, parent: "$group" });
  if (literal) {
    locations.forEach((loc, i) => {
      const f = frames[i]!;
      ops.push({ op: "updateLayer", component: ctx.componentId, id: loc.layer.id, props: { position: [f.position[0] - position[0], f.position[1] - position[1]] } });
    });
  }
  const result = apply(session, ops, `Group ${top.length === 1 ? locations[0]!.layer.name : `${top.length} layers`}`, ctx.componentId);
  const groupId = result.idMap.group;
  if (result.ok && groupId) session.selection.getState().select({ layers: [groupId], patches: [], comments: [] });
  return { ...fromResult(result), ...(groupId ? { groupId } : {}) };
}

/** Move the children of selected groups into their parent and remove the groups. */
export function ungroupSelection(session: EditorSession): ActionResult {
  const ctx = context(session);
  if (!ctx) return failed("Select a group to ungroup.");
  const groups = topLevelLayerIds(ctx.component, session.selection.getState().layers)
    .map((id) => findLayer(ctx.component.layers, id)!)
    .filter((loc) => loc.layer.type === "group")
    .sort((a, b) => b.index - a.index);
  if (groups.length === 0) return failed("Select a group to ungroup.");
  const ops: Op[] = [];
  const moved: Id[] = [];
  for (const loc of groups) {
    const frame = literalFrame(session, ctx.doc, ctx.componentId, loc.layer);
    (loc.layer.children ?? []).forEach((child, i) => {
      ops.push({ op: "moveLayer", component: ctx.componentId, id: child.id, parent: loc.parent?.id ?? null, index: loc.index + i });
      const childFrame = frame ? literalFrame(session, ctx.doc, ctx.componentId, child) : undefined;
      if (frame && childFrame) ops.push({ op: "updateLayer", component: ctx.componentId, id: child.id, props: { position: [childFrame.position[0] + frame.topLeft[0], childFrame.position[1] + frame.topLeft[1]] } });
      moved.push(child.id);
    });
    ops.push({ op: "removeLayer", component: ctx.componentId, id: loc.layer.id });
  }
  const result = apply(session, ops, `Ungroup ${groups.length === 1 ? groups[0]!.layer.name : `${groups.length} groups`}`, ctx.componentId);
  if (result.ok) session.selection.getState().select({ layers: moved, patches: [], comments: [] });
  return fromResult(result);
}

/** Turn the selected layers and patches into a component and leave an instance. */
export function createComponentFromSelection(session: EditorSession, name?: string): ActionResult & { componentId?: Id; instanceId?: Id } {
  const ctx = context(session);
  const s = session.selection.getState();
  if (!ctx) return failed("Select layers or patches to make a component.");
  const layerIds = topLevelLayerIds(ctx.component, s.layers);
  const patchIds = s.patches.filter((id) => id in ctx.component.patches);
  if (layerIds.length === 0 && patchIds.length === 0) return failed("Select layers or patches to make a component.");
  const names = new Set(Object.values(ctx.doc.components).map((c) => c.name));
  let componentName = name ?? (layerIds.length === 1 ? findLayer(ctx.component.layers, layerIds[0]!)!.layer.name : "Component");
  if (!name && names.has(componentName)) {
    let n = 2;
    while (names.has(`${componentName} ${n}`)) n++;
    componentName = `${componentName} ${n}`;
  }
  const label = `Create component "${componentName}"`;
  let result = apply(session, [{ op: "createComponent", component: ctx.componentId, name: componentName, layerIds, patchIds }], label, ctx.componentId);
  // Patches that point at moved layers have to move too; core suggests the widened op.
  for (let attempt = 0; !result.ok && attempt < 32; attempt++) {
    const suggested = result.errors[0]?.suggestions?.[0]?.ops;
    if (suggested?.length !== 1 || suggested[0]!.op !== "createComponent") break;
    result = apply(session, suggested, label, ctx.componentId);
  }
  if (!result.ok) return fromResult(result);
  const [componentId, instanceId] = result.results[0]?.ids ?? [];
  if (instanceId) session.selection.getState().select(layerIds.length ? { layers: [instanceId], patches: [], comments: [] } : { layers: [], patches: [instanceId], comments: [] });
  return { ...fromResult(result), ...(componentId ? { componentId } : {}), ...(instanceId ? { instanceId } : {}) };
}

/** Select everything in the focused panel's domain (patches in the patch editor, top-level layers elsewhere). */
export function selectAll(session: EditorSession): void {
  const ctx = context(session);
  if (!ctx) return;
  const panel = session.selection.getState().focusedPanel;
  const layers = ctx.component.layers.map((l) => l.id);
  const patches = Object.keys(ctx.component.patches);
  const comments = ctx.component.comments.map((c) => c.id);
  if (panel === "patchEditor") session.selection.getState().select({ layers: [], patches, comments });
  else if (panel === "layers" || panel === "canvas" || panel === "viewer") session.selection.getState().select({ layers, patches: [], comments: [] });
  else session.selection.getState().select({ layers, patches, comments: [] });
}

/** Hide or show the selected layers (Enabled). Linked Enabled props are left alone. */
export function toggleLayerVisibility(session: EditorSession): ActionResult {
  const ctx = context(session);
  if (!ctx) return failed("Select layers to hide or show.");
  const layers = topLevelLayerIds(ctx.component, session.selection.getState().layers).map((id) => findLayer(ctx.component.layers, id)!.layer);
  const editable = layers.filter((l) => !isLinkInput(l.props.enabled));
  if (editable.length === 0) return failed(layers.length ? "Enabled is driven by a patch on these layers." : "Select layers to hide or show.", layers.length ? "Disconnect Enabled in the inspector to toggle it by hand." : undefined);
  const show = editable.every((l) => l.props.enabled === false);
  const ops: Op[] = editable.map((l) => ({ op: "updateLayer", component: ctx.componentId, id: l.id, props: { enabled: show ? null : false } }));
  return fromResult(apply(session, ops, `${show ? "Show" : "Hide"} ${itemLabel(ctx.component, editable.map((l) => l.id), [])}`, ctx.componentId));
}

/** Lock or unlock the selected layers. */
export function toggleLayerLock(session: EditorSession): ActionResult {
  const ctx = context(session);
  if (!ctx) return failed("Select layers to lock.");
  const layers = topLevelLayerIds(ctx.component, session.selection.getState().layers).map((id) => findLayer(ctx.component.layers, id)!.layer);
  if (layers.length === 0) return failed("Select layers to lock.");
  const lock = !layers.every((l) => l.locked);
  const ops: Op[] = layers.map((l) => ({ op: "updateLayer", component: ctx.componentId, id: l.id, locked: lock }));
  return fromResult(apply(session, ops, `${lock ? "Lock" : "Unlock"} ${itemLabel(ctx.component, layers.map((l) => l.id), [])}`, ctx.componentId));
}

export type ArrangeDirection = "forward" | "backward" | "front" | "back";

/** Change stacking order among siblings. */
export function arrangeLayers(session: EditorSession, direction: ArrangeDirection): ActionResult {
  const ctx = context(session);
  if (!ctx) return failed("Select layers to arrange.");
  const locations = topLevelLayerIds(ctx.component, session.selection.getState().layers).map((id) => findLayer(ctx.component.layers, id)!);
  if (locations.length === 0) return failed("Select layers to arrange.");
  const frontFirst = direction === "forward" || direction === "front";
  const sorted = [...locations].sort((a, b) => (frontFirst ? b.index - a.index : a.index - b.index));
  const ops: Op[] = [];
  const reserved = new Map<string, number>();
  for (const loc of sorted) {
    const key = loc.parent?.id ?? "";
    const last = loc.siblings.length - 1;
    let index: number;
    if (direction === "forward") index = Math.min(last, loc.index + 1);
    else if (direction === "backward") index = Math.max(0, loc.index - 1);
    else {
      const used = reserved.get(key) ?? 0;
      reserved.set(key, used + 1);
      index = direction === "front" ? last - used : used;
    }
    if (index !== loc.index) ops.push({ op: "moveLayer", component: ctx.componentId, id: loc.layer.id, parent: loc.parent?.id ?? null, index });
  }
  if (ops.length === 0) return { ok: true };
  const labels: Record<ArrangeDirection, string> = { forward: "Bring forward", backward: "Send backward", front: "Bring to front", back: "Send to back" };
  return fromResult(apply(session, ops, `${labels[direction]} ${itemLabel(ctx.component, locations.map((l) => l.layer.id), [])}`, ctx.componentId));
}

/** Enter the component behind the selected instance layer or component patch. */
export function enterSelectedComponent(session: EditorSession): boolean {
  const ctx = context(session);
  const s = session.selection.getState();
  if (!ctx) return false;
  const layer = s.layers.length === 1 ? findLayer(ctx.component.layers, s.layers[0]!)?.layer : undefined;
  const patch = s.patches.length === 1 ? ctx.component.patches[s.patches[0]!] : undefined;
  const target = layer?.type === COMPONENT_INSTANCE_LAYER_TYPE ? layer.component : patch?.type === COMPONENT_PATCH_TYPE ? patch.component : undefined;
  if (!target || !ctx.doc.components[target]) return false;
  session.selection.getState().enterComponent(target);
  return true;
}

/** Leave the current component, selecting the instance you came from when there's exactly one. */
export function exitComponent(session: EditorSession): boolean {
  const s = session.selection.getState();
  if (s.componentPath.length <= 1) return false;
  const inner = s.componentPath.at(-1)!;
  const outerId = s.componentPath.at(-2)!;
  const outer = session.document.getState().doc.components[outerId];
  const select: { layers: Id[]; patches: Id[] } = { layers: [], patches: [] };
  if (outer) {
    const patchIds = Object.entries(outer.patches).filter(([, p]) => p.type === COMPONENT_PATCH_TYPE && p.component === inner).map(([id]) => id);
    const layerIds: Id[] = [];
    const visit = (layers: readonly LayerNode[]) => {
      for (const l of layers) {
        if (l.type === COMPONENT_INSTANCE_LAYER_TYPE && l.component === inner) layerIds.push(l.id);
        if (l.children?.length) visit(l.children);
      }
    };
    visit(outer.layers);
    if (layerIds.length + patchIds.length === 1) {
      select.layers = layerIds;
      select.patches = patchIds;
    }
  }
  s.exitComponent(select);
  return true;
}
