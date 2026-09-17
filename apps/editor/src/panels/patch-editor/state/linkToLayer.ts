/**
 * "Drive with a patch": the public bridge other panels use to connect patches to layer properties.
 *
 * - `startLinkToLayerProp({ layerId, prop })` shows that property on the layer's node in the patch
 *   editor (opening the patch editor when the shell has it hidden), centers it, and opens the picker
 *   to choose a driving patch or an output already in the graph.
 * - `completeConnectionToLayerProp(from, { layerId, prop })` connects an output to a property, with
 *   the patch editor's converter suggestions when the types don't fit.
 * - Rows that accept cable drops spread `layerPropDropAttributes(target)` (a property row) or
 *   `layerDropAttributes(layerId)` (a layer row: dropping opens that layer's property list); the patch
 *   editor finds them under the pointer when a cable is released over another panel.
 * - `useCableDrag()` reports the cable being dragged, so rows can highlight what accepts it.
 */

import { canConnect, findLayer, getPatchSpec, isLinkInput, resolveLayerProps, type Id, type Registry, type SonobeDocument, type ValueType } from "@sonobe/core";
import { useStore } from "zustand";
import { layoutStore } from "../../../shell/layoutStore.ts";
import { useEditorSession } from "../../../state/EditorProvider.tsx";
import { currentComponentId } from "../../../state/selection.ts";
import { getDefaultSession, type EditorSession } from "../../../state/session.ts";
import { toast } from "../../../ui/Toast.tsx";
import { portLabel } from "../model/editOps.ts";
import { mountedPatchEditor, patchEditorBridge, type CableDrag, type LayerPropTarget } from "./bridge.ts";

export type { CableDrag, LayerPropTarget };

export interface LinkToLayerOptions {
  /** Default: the app-wide session. */
  session?: EditorSession;
}

export type DriveCheck = { ok: true; address: string; type: ValueType; layerName: string; propName: string; driver?: string } | { ok: false; reason: string };

/** Whether a layer property can be driven by a patch (it exists and is bindable), and its type. */
export function canDriveLayerProp(doc: SonobeDocument, componentId: Id, registry: Registry, target: LayerPropTarget): DriveCheck {
  const component = doc.components[componentId];
  const layer = component ? findLayer(component.layers, target.layerId)?.layer : undefined;
  if (!layer) return { ok: false, reason: `There's no layer "${target.layerId}" here.` };
  const prop = resolveLayerProps(doc, componentId, layer, registry)?.find((p) => p.key === target.prop);
  if (!prop) return { ok: false, reason: `${layer.name} has no property "${target.prop}".` };
  if (prop.bindable === false) return { ok: false, reason: `${prop.name} on ${layer.name} can't be driven by a patch.`, };
  const value = layer.props[target.prop];
  const check: DriveCheck = { ok: true, address: `@${layer.id}.${prop.key}`, type: prop.type, layerName: layer.name, propName: prop.name };
  if (isLinkInput(value)) check.driver = value.link;
  return check;
}

function componentFor(session: EditorSession, target: LayerPropTarget): Id {
  return target.component ?? currentComponentId(session.selection.getState());
}

/**
 * Show a layer property as a target node in the patch editor and open the picker to choose what
 * drives it. Returns false (with a toast) when the property can't be driven.
 */
export function startLinkToLayerProp(target: LayerPropTarget, options: LinkToLayerOptions & { show?: () => void } = {}): boolean {
  const session = options.session ?? getDefaultSession();
  const componentId = componentFor(session, target);
  const check = canDriveLayerProp(session.document.getState().doc, componentId, session.registry, target);
  if (!check.ok) {
    void toast({ title: check.reason, tone: "warn" });
    return false;
  }
  const selection = session.selection.getState();
  if (currentComponentId(selection) !== componentId) {
    const i = selection.componentPath.indexOf(componentId);
    if (i >= 0) selection.setComponentPath(selection.componentPath.slice(0, i + 1));
    else selection.enterComponent(componentId);
  }
  const bridge = patchEditorBridge(session);
  if (!check.driver) bridge.getState().addTarget(componentId, check.address);
  bridge.getState().requestDrive(componentId, check.address);
  if (!mountedPatchEditor(session)) {
    if (options.show) options.show();
    else if (layoutStore.getState().viewMode === "canvas") layoutStore.getState().setViewMode("split");
  }
  return true;
}

/**
 * Connect an output (in the target's component) to a layer property. Uses the mounted patch
 * editor when there is one, so a type mismatch offers a converter. Returns whether it connected.
 */
export function completeConnectionToLayerProp(from: string, target: LayerPropTarget, options: LinkToLayerOptions = {}): boolean {
  const session = options.session ?? getDefaultSession();
  const componentId = componentFor(session, target);
  const doc = session.document.getState().doc;
  const check = canDriveLayerProp(doc, componentId, session.registry, target);
  if (!check.ok) {
    void toast({ title: check.reason, tone: "warn" });
    return false;
  }
  if (check.driver === from) return true;
  const bridge = patchEditorBridge(session);
  const editor = mountedPatchEditor(session, componentId);
  let ok: boolean;
  if (editor) ok = editor.connect(from, check.address);
  else {
    const result = session.document.getState().apply([{ op: "connect", component: componentId, from, to: check.address }], {
      label: `Connect ${portLabel(doc, componentId, session.registry, from)} to ${portLabel(doc, componentId, session.registry, check.address)}`,
      defaultComponent: componentId,
    });
    ok = result.ok;
    if (!ok) {
      const error = result.errors.find((e) => e.code !== "skipped") ?? result.errors[0];
      void toast({ title: error?.message ?? "Those don't connect.", ...(error?.hint ? { description: error.hint } : {}), tone: "warn" });
    }
  }
  if (ok) bridge.getState().removeTargets(componentId, [check.address]);
  return ok;
}

export const LAYER_PROP_DROP_ATTRIBUTE = "data-sb-layer-prop";
export const LAYER_DROP_ATTRIBUTE = "data-sb-layer-drop";
export const DROP_COMPONENT_ATTRIBUTE = "data-sb-drop-component";

/** Attributes for a property row that accepts cable drops (Inspector). */
export function layerPropDropAttributes(target: LayerPropTarget): Record<string, string> {
  return { [LAYER_PROP_DROP_ATTRIBUTE]: `${target.layerId}.${target.prop}`, ...(target.component ? { [DROP_COMPONENT_ATTRIBUTE]: target.component } : {}) };
}

/** Attributes for a layer row that accepts cable drops (Layers panel): dropping lists the layer's properties. */
export function layerDropAttributes(layerId: Id, component?: Id): Record<string, string> {
  return { [LAYER_DROP_ATTRIBUTE]: layerId, ...(component ? { [DROP_COMPONENT_ATTRIBUTE]: component } : {}) };
}

export type DropTarget = { kind: "prop"; target: LayerPropTarget } | { kind: "layer"; layerId: Id; component?: Id };

/** The drop target an element belongs to (the nearest annotated ancestor). */
export function dropTargetAt(element: Element | null | undefined): DropTarget | undefined {
  const el = element?.closest(`[${LAYER_PROP_DROP_ATTRIBUTE}], [${LAYER_DROP_ATTRIBUTE}]`);
  if (!el) return undefined;
  const component = el.getAttribute(DROP_COMPONENT_ATTRIBUTE) ?? undefined;
  const prop = el.getAttribute(LAYER_PROP_DROP_ATTRIBUTE);
  if (prop) {
    const dot = prop.indexOf(".");
    if (dot <= 0) return undefined;
    return { kind: "prop", target: { layerId: prop.slice(0, dot), prop: prop.slice(dot + 1), ...(component ? { component } : {}) } };
  }
  const layerId = el.getAttribute(LAYER_DROP_ATTRIBUTE);
  return layerId ? { kind: "layer", layerId, ...(component ? { component } : {}) } : undefined;
}

/** The cable being dragged in a patch editor, or null. */
export function getCableDrag(session: EditorSession = getDefaultSession()): CableDrag | null {
  return patchEditorBridge(session).getState().cableDrag;
}

/** React: the cable being dragged, or null (rows highlight when `acceptsCable(drag, type)`). */
export function useCableDrag(session?: EditorSession): CableDrag | null {
  const fallback = useEditorSession();
  return useStore(patchEditorBridge(session ?? fallback), (s) => s.cableDrag);
}

/** Whether a dragged cable can drive a property of `type`. */
export function acceptsCable(drag: CableDrag | null, type: ValueType): boolean {
  return !!drag && canConnect(drag.type, type).ok;
}

/** "Zoom Spring" for a from address, for row hover text ("Drop to drive Scale from Zoom Spring"). */
export function cableSourceName(session: EditorSession, drag: CableDrag): string {
  const doc = session.document.getState().doc;
  const id = drag.from.split(".")[0] ?? "";
  const node = doc.components[drag.component]?.patches[id];
  return node ? node.name || getPatchSpec(session.registry, node.type)?.name || node.type : portLabel(doc, drag.component, session.registry, drag.from);
}
