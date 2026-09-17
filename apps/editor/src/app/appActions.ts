/**
 * Actions behind app commands that no panel owns: close, rename, insert layer, use as mask, align
 * right and bottom, full-screen viewer, and report an issue.
 */

import { findLayer, resolveNodePorts, type Id } from "@sonobe/core";
import { getDesktopHostApi } from "../host/detect.ts";
import { layoutStore } from "../shell/layoutStore.ts";
import type { DialogService } from "../state/dialogs.ts";
import type { EditorSession } from "../state/session.ts";
import type { CommandRegistry } from "../ui/commands/commandRegistry.ts";
import { detectHostPlatform } from "../ui/commands/shortcutManager.ts";
import { toast, type ToastOptions } from "../ui/Toast.tsx";
import { EDITOR_VERSION, issueUrl } from "./about.ts";
import { alignOps, alignPatchRects, patchRects, type AlignEdge } from "./alignPatches.ts";
import { clipParentPlan, INSERTED_LAYER_REF, insertLayerOps, insertParentFor, layerPickItems } from "./layerActions.ts";
import { settingsStore } from "./settings.ts";
import { welcomeStore } from "./welcome/welcomeStore.ts";

export type Notify = (options: ToastOptions) => void;
const defaultNotify: Notify = (options) => void toast(options);

const nextFrame = (fn: () => void) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => fn()) : setTimeout(fn, 16));

/** File → Close: ask about unsaved changes, start an empty prototype, and show the welcome screen. */
export async function closePrototype(session: EditorSession, show: (reason: "close") => void = (reason) => welcomeStore.getState().show(reason)): Promise<boolean> {
  if (!(await session.confirmDiscardChanges("new"))) return false;
  session.document.getState().newDocument({ device: settingsStore.getState().defaultDevice });
  session.selection.getState().setComponentPath([session.document.getState().doc.project.root]);
  show("close");
  return true;
}

/** Edit → Rename: the patch editor's inline title when a patch is on screen, else a rename dialog. */
export async function renameSelection(session: EditorSession, registry: CommandRegistry, dialogs: Pick<DialogService, "prompt">, notify: Notify = defaultNotify): Promise<void> {
  const sel = session.selection.getState();
  const componentId = session.currentComponentId();
  const component = session.document.getState().doc.components[componentId];
  if (!component) return;
  const patchId = sel.patches.length === 1 && sel.layers.length === 0 ? sel.patches[0] : undefined;
  const layerId = sel.layers.length === 1 && sel.patches.length === 0 ? sel.layers[0] : undefined;
  const id = patchId ?? layerId;
  if (!id) return;
  if (patchId && layoutStore.getState().viewMode !== "canvas" && registry.run("patchEditor.rename")) return;
  const current = patchId ? (component.patches[patchId]?.name ?? session.registry.patches.get(component.patches[patchId]?.type ?? "")?.name ?? patchId) : (findLayer(component.layers, layerId!)?.layer.name ?? layerId!);
  const name = await dialogs.prompt({ title: patchId ? "Rename patch" : "Rename layer", defaultValue: current, label: "Name", confirmLabel: "Rename", validate: (value) => (value.trim() ? null : "Give it a name.") });
  const trimmed = name?.trim();
  if (!trimmed || trimmed === current) return;
  const result = session.document.getState().apply([{ op: "rename", component: componentId, id, name: trimmed }], { label: `Rename “${current}” to “${trimmed}”`, defaultComponent: componentId });
  if (!result.ok) notify({ title: result.errors[0]?.message ?? "Couldn't rename it.", tone: "warn" });
}

/** Layer → Insert Layer: pick a type, add it centered, and select it. */
export async function insertLayer(session: EditorSession, dialogs: Pick<DialogService, "pick">, notify: Notify = defaultNotify): Promise<Id | null> {
  const type = await dialogs.pick({ title: "Insert Layer", items: layerPickItems(session.registry), confirmLabel: "Insert" });
  if (!type) return null;
  const componentId = session.currentComponentId();
  const doc = session.document.getState().doc;
  const component = doc.components[componentId];
  if (!component) return null;
  const parent = insertParentFor(component, session.selection.getState().layers, session.registry);
  const spec = session.registry.layers.get(type);
  const result = session.document.getState().apply(insertLayerOps(doc, componentId, type, session.registry, parent), { label: `Insert ${spec?.name ?? type}`, defaultComponent: componentId });
  const id = result.idMap[INSERTED_LAYER_REF];
  if (!result.ok || !id) {
    notify({ title: result.errors[0]?.message ?? `Couldn't insert ${spec?.name ?? type}.`, tone: "warn" });
    return null;
  }
  session.selection.getState().select({ layers: [id] });
  session.selection.getState().requestReveal(componentId, [id]);
  return id;
}

/** Layer → Use as Mask: turn on Clip Contents for the selected layers' parent groups (or off, when they all clip). */
export function useAsMask(session: EditorSession, notify: Notify = defaultNotify): boolean {
  const componentId = session.currentComponentId();
  const component = session.document.getState().doc.components[componentId];
  const layers = session.selection.getState().layers;
  if (!component || layers.length === 0) return false;
  const plan = clipParentPlan(component, layers, session.registry);
  if (!plan.ok) {
    notify({ title: plan.message, description: plan.hint, tone: "neutral" });
    return false;
  }
  const names = plan.groups.map((g) => `“${g.name}”`).join(", ");
  const result = session.document.getState().apply(plan.ops, { label: plan.clip ? `Clip contents of ${names}` : `Stop clipping ${names}`, defaultComponent: componentId });
  if (!result.ok) {
    notify({ title: result.errors[0]?.message ?? "Couldn't change clipping.", tone: "warn" });
    return false;
  }
  notify({ title: plan.clip ? `${names} now clips its contents` : `${names} no longer clips its contents`, description: plan.clip ? "Anything outside the group's bounds is hidden, like a mask." : undefined, tone: "success" });
  return true;
}

/** Patch → Align Right / Align Bottom (and left/top) for the selected patches. */
export function alignSelection(session: EditorSession, edge: AlignEdge, root: ParentNode | null = typeof document === "undefined" ? null : document): boolean {
  const componentId = session.currentComponentId();
  const doc = session.document.getState().doc;
  const component = doc.components[componentId];
  const ids = session.selection.getState().patches;
  if (!component || ids.length < 2) return false;
  const rects = patchRects(
    component,
    ids,
    (id) => {
      const node = component.patches[id];
      const ports = node ? resolveNodePorts(doc, node, session.registry) : undefined;
      return { inputs: ports?.inputs.length ?? 1, outputs: ports?.outputs.length ?? 1 };
    },
    root,
  );
  const ops = alignOps(component, alignPatchRects(rects, edge));
  if (ops.length === 0) return false;
  return session.document.getState().apply(ops, { label: `Align ${edge} edges`, defaultComponent: componentId }).ok;
}

/** Viewer → Full Screen: show the viewer panel on its own (Escape exits). */
export function toggleViewerFullscreen(target: Document = document, notify: Notify = defaultNotify): void {
  if (target.fullscreenElement) {
    void target.exitFullscreen?.();
    return;
  }
  const layout = layoutStore.getState();
  const enter = () => {
    const viewer = target.getElementById("sb-viewer");
    if (!viewer?.requestFullscreen) {
      notify({ title: "Full screen isn't available here", tone: "neutral" });
      return;
    }
    viewer.requestFullscreen().catch(() => notify({ title: "Couldn't go full screen", description: "Try the command again from the menu or keyboard.", tone: "neutral" }));
  };
  if (layout.collapsed.viewer) {
    layout.toggleCollapsed("viewer", false);
    nextFrame(enter);
  } else {
    enter();
  }
}

/** Help → Report an Issue: a new issue with the version and platform filled in, in the system browser. */
export function reportIssue(session: Pick<EditorSession, "host">): string {
  const api = getDesktopHostApi();
  const url = issueUrl({ version: api?.version ?? EDITOR_VERSION, platform: detectHostPlatform(), host: session.host?.kind ?? "browser", ...(typeof navigator !== "undefined" ? { userAgent: navigator.userAgent } : {}) });
  if (api?.openExternal) void api.openExternal(url);
  else if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
  return url;
}
