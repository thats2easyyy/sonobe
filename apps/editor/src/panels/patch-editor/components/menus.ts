/** Context menu entries for patches, cables, comments, layer targets, and the canvas. */

import { getPatchSpec, type Id, type Registry, type SonobeDocument } from "@sonobe/core";
import type { MenuEntry } from "../../../ui/Menu.tsx";
import { VALUE_TYPE_LABELS } from "../../../ui/PortGlyph.tsx";
import { COMMENT_COLORS } from "../model/editOps.ts";
import type { CableData, CommentNodeData, LayerNodeData, PatchNodeData } from "../model/types.ts";
import type { PatchEditorActions } from "../state/actions.ts";

export interface MenuContext {
  actions: PatchEditorActions;
  registry: Registry;
  doc: SonobeDocument;
  componentId: Id;
  selectedPatches: readonly Id[];
  nested: boolean;
  minimap: boolean;
  toggleMinimap: () => void;
  fitView: () => void;
  paste: () => void;
  /** Start editing a node's title. */
  rename: (nodeId: string) => void;
  /** Choose a property of a layer to drive. */
  chooseLayerProperty?: (layerId: Id) => void;
}

const sep = (id: string): MenuEntry => ({ type: "separator", id });

export function patchMenu(ctx: MenuContext, data: PatchNodeData): MenuEntry[] {
  const { actions } = ctx;
  const ids = ctx.selectedPatches.includes(data.patchId) ? ctx.selectedPatches : [data.patchId];
  const single = ids.length === 1;
  const nodes = ids.map((id) => ctx.doc.components[ctx.componentId]?.patches[id]).filter(Boolean);
  const allMuted = nodes.every((n) => n!.muted);
  const allCollapsed = nodes.every((n) => n!.ui.collapsed);
  const entries: MenuEntry[] = [];
  if (single) {
    entries.push({ id: "info", label: "Patch Info", shortcut: "Mod+I", onSelect: () => actions.openInfo(data.patchId) });
    entries.push({ id: "rename", label: "Rename", shortcut: "Enter", onSelect: () => ctx.rename(data.patchId) });
    entries.push(sep("s1"));
    entries.push({ id: "replace", label: "Replace With…", onSelect: () => actions.openPicker({ replace: data.patchId }) });
    if (data.variants?.length) {
      entries.push({
        id: "type",
        label: "Change Type",
        submenu: data.variants.map((v): MenuEntry => ({ id: v, label: VALUE_TYPE_LABELS[v], checked: v === data.typeParam, onSelect: () => actions.changeType(data.patchId, v) })),
      });
    }
    if (data.variadic) {
      const max = Math.min(data.variadic.max, 16);
      const counts = Array.from({ length: max - data.variadic.min + 1 }, (_, i) => data.variadic!.min + i);
      entries.push({
        id: "inputs",
        label: "Number of Inputs",
        submenu: counts.map((n): MenuEntry => ({ id: String(n), label: String(n), checked: n === data.inputCount, onSelect: () => actions.setInputCount(data.patchId, n) })),
      });
    }
    entries.push(sep("s2"));
  }
  entries.push({ id: "mute", label: allMuted ? "Unmute" : "Mute", shortcut: "M", onSelect: () => actions.toggleMute(ids) });
  entries.push({ id: "collapse", label: allCollapsed ? "Expand" : "Collapse", shortcut: "H", onSelect: () => actions.toggleCollapse(ids) });
  entries.push({ id: "duplicate", label: "Duplicate", shortcut: "Mod+D", onSelect: () => actions.duplicateSelection() });
  entries.push({ id: "comment", label: "Comment Selection", shortcut: "Ctrl+Alt+C", onSelect: () => actions.commentSelection() });
  entries.push({ id: "component", label: "Group into Component", shortcut: "Mod+Ctrl+G", onSelect: () => actions.groupIntoComponent() });
  if (!single) {
    entries.push({ id: "alignLeft", label: "Align Left Edges", shortcut: "Mod+[", onSelect: () => actions.align("left") });
    entries.push({ id: "alignTop", label: "Align Top Edges", shortcut: "Mod+]", onSelect: () => actions.align("top") });
    entries.push({ id: "tidy", label: "Tidy Up Selection", shortcut: "Ctrl+T", onSelect: () => void actions.tidyUp() });
  }
  if (single && data.componentTarget) entries.push({ id: "enter", label: "Enter Component", shortcut: "Alt+Down", onSelect: () => actions.enterComponent(data.patchId) });
  if (single && data.layerRef) entries.push({ id: "reveal", label: "Reveal Layer", onSelect: () => actions.revealLayer(data.layerRef!) });
  entries.push(sep("s3"));
  entries.push({ id: "delete", label: "Delete", shortcut: "Backspace", danger: true, onSelect: () => actions.deleteSelection() });
  return entries;
}

export function cableMenu(ctx: MenuContext, data: CableData): MenuEntry[] {
  const { actions } = ctx;
  const entries: MenuEntry[] = [];
  for (const s of data.suggestions?.filter((x) => x.ops?.some((op) => op.op === "addPatch")) ?? []) {
    const added = s.ops!.find((op) => op.op === "addPatch");
    const name = added && added.op === "addPatch" ? (getPatchSpec(ctx.registry, added.patch.type)?.name ?? added.patch.type) : "converter";
    entries.push({ id: `fix-${name}`, label: `Insert ${name}`, description: s.description, onSelect: () => actions.explainConnection(data.from, data.to, { x: 0, y: 0 }) });
  }
  if (entries.length) entries.push(sep("s0"));
  entries.push({ id: "disconnect", label: "Disconnect", shortcut: "Backspace", danger: true, onSelect: () => actions.disconnect([data.to]) });
  return entries;
}

export function commentMenu(ctx: MenuContext, data: CommentNodeData, edit: () => void): MenuEntry[] {
  const { actions } = ctx;
  return [
    { id: "edit", label: "Edit Text", onSelect: edit },
    {
      id: "color",
      label: "Color",
      submenu: COMMENT_COLORS.map((c): MenuEntry => ({ id: c.key, label: c.name, checked: (data.color ?? "gray") === c.key, onSelect: () => actions.updateComment(data.commentId, { color: c.key }, `Color comment ${c.name.toLowerCase()}`) })),
    },
    sep("s1"),
    { id: "delete", label: "Delete Comment", shortcut: "Backspace", danger: true, onSelect: () => actions.apply([{ op: "removeComment", component: ctx.componentId, id: data.commentId }], "Delete comment") },
  ];
}

export function layerMenu(ctx: MenuContext, data: LayerNodeData): MenuEntry[] {
  const { actions } = ctx;
  const driven = data.inputs.filter((p) => p.connected);
  const undriven = data.inputs.length - driven.length;
  const entries: MenuEntry[] = [{ id: "reveal", label: "Reveal Layer", onSelect: () => actions.revealLayer(data.layerId) }];
  if (ctx.chooseLayerProperty) entries.push({ id: "drive", label: "Drive a Property…", description: "Show another property here and pick a patch for it", onSelect: () => ctx.chooseLayerProperty!(data.layerId) });
  if (undriven > 0) entries.push({ id: "hide", label: undriven === 1 ? "Hide Undriven Property" : "Hide Undriven Properties", onSelect: () => actions.removeLayerTargets(data.layerId) });
  if (driven.length) entries.push(sep("s1"), { id: "disconnect", label: "Disconnect All Properties", danger: true, onSelect: () => actions.disconnect(driven.map((p) => p.address), `Disconnect ${data.title}`) });
  return entries;
}

export function paneMenu(ctx: MenuContext, at: { x: number; y: number }): MenuEntry[] {
  const { actions } = ctx;
  return [
    { id: "insert", label: "Insert Patch…", shortcut: "Alt+Enter", onSelect: () => actions.openPicker({ position: at }) },
    { id: "comment", label: "Add Comment", shortcut: "Ctrl+Alt+C", onSelect: () => actions.commentSelection() },
    { id: "paste", label: "Paste", shortcut: "Mod+V", onSelect: ctx.paste },
    { id: "selectAll", label: "Select All", shortcut: "Mod+A", onSelect: () => actions.selectAll() },
    sep("s1"),
    { id: "tidy", label: "Tidy Up", shortcut: "Ctrl+T", onSelect: () => void actions.tidyUp() },
    { id: "fit", label: "Zoom to Fit", shortcut: "Shift+1", onSelect: ctx.fitView },
    { id: "minimap", label: ctx.minimap ? "Hide Minimap" : "Show Minimap", shortcut: "Shift+M", onSelect: ctx.toggleMinimap },
    ...(ctx.nested ? [sep("s2"), { id: "exit", label: "Exit Component", shortcut: "Alt+Up", onSelect: () => actions.exitComponent() } as MenuEntry] : []),
  ];
}
