/**
 * The Touch button on a layer row: pre-wired interaction patches for a layer, built from real
 * registry types and port keys, and placed near the patches that already use the layer.
 */

import { findLayer, isLinkInput, resolveLayerProps, type Component, type Id, type InputValue, type Op, type Registry, type SonobeDocument } from "@sonobe/core";
import { relatedPatchIds } from "./layerTree.ts";

export type TouchKind = "tap" | "press" | "longPress" | "doubleTap" | "drag" | "scrollY" | "scrollX" | "hover";

export interface TouchOption {
  kind: TouchKind;
  label: string;
  /** Patch type the option inserts. */
  patchType: string;
  description: string;
}

/** Menu order. Options whose patch type isn't in the registry are hidden. */
export const TOUCH_OPTIONS: readonly TouchOption[] = [
  { kind: "tap", label: "Tap", patchType: "interaction", description: "Pulses Tap when the layer is tapped." },
  { kind: "press", label: "Press", patchType: "interaction", description: "Down stays on while the layer is held." },
  { kind: "longPress", label: "Long Press", patchType: "longPress", description: "Turns on after holding still for a moment." },
  { kind: "doubleTap", label: "Double Tap", patchType: "doubleTap", description: "Tells a double tap from a single tap." },
  { kind: "drag", label: "Drag", patchType: "drag", description: "Moves the layer with a finger, wired to its Position." },
  { kind: "scrollY", label: "Scroll Y", patchType: "scroll", description: "Scrolls the layer up and down inside its parent." },
  { kind: "scrollX", label: "Scroll X", patchType: "scroll", description: "Scrolls the layer sideways inside its parent." },
  { kind: "hover", label: "Hover", patchType: "hover", description: "On while the mouse pointer is over the layer." },
];

/** Touch options available with this registry. */
export function touchOptions(registry: Registry): TouchOption[] {
  return TOUCH_OPTIONS.filter((option) => registry.patches.has(option.patchType));
}

export interface TouchPlan {
  ops: Op[];
  label: string;
  /** Batch ref of the new patch; read its id from `idMap`. */
  ref: string;
  /** Drag and Scroll only: Position was already driven by a patch, so it was left connected as is. */
  positionLinked: boolean;
}

export const TOUCH_REF = "touch";

const ROW = 140;
const CLEAR_X = 180;
const CLEAR_Y = 110;

/**
 * Where a new patch for `layerId` goes: under the patches related to the layer (in their left
 * column), else under the whole graph, moving down until it doesn't overlap another patch.
 */
export function touchPlacement(component: Component, layerId: Id): { x: number; y: number } {
  const all = Object.values(component.patches).map((node) => node.ui);
  const related = relatedPatchIds(component, layerId).map((id) => component.patches[id]!.ui);
  const basis = related.length ? related : all;
  let x = basis.length ? Math.min(...basis.map((ui) => ui.x)) : 40;
  let y = basis.length ? Math.max(...basis.map((ui) => ui.y)) + ROW : 60;
  x = Math.round(x);
  y = Math.round(y);
  while (all.some((ui) => Math.abs(ui.x - x) < CLEAR_X && Math.abs(ui.y - y) < CLEAR_Y)) y += ROW;
  return { x, y };
}

/** Ops that add a pre-wired interaction for a layer; undefined when the layer or patch type is missing. */
export function planTouch(doc: SonobeDocument, componentId: Id, layerId: Id, kind: TouchKind, registry: Registry): TouchPlan | undefined {
  const component = doc.components[componentId];
  const layer = component ? findLayer(component.layers, layerId)?.layer : undefined;
  const option = TOUCH_OPTIONS.find((o) => o.kind === kind);
  if (!component || !layer || !option || !registry.patches.has(option.patchType)) return undefined;

  const inputs: Record<string, InputValue> = { layer: { layer: layerId } };
  if (kind === "scrollX") Object.assign(inputs, { scrollX: "free", scrollY: "off" });
  if (kind === "scrollY") Object.assign(inputs, { scrollX: "off", scrollY: "free" });

  const wiresPosition = kind === "drag" || kind === "scrollX" || kind === "scrollY";
  const positionProp = wiresPosition ? resolveLayerProps(doc, componentId, layer, registry)?.find((p) => p.key === "position") : undefined;
  const stored = layer.props.position;
  const positionLinked = !!positionProp && isLinkInput(stored);
  if (positionProp) {
    const start = Array.isArray(stored) ? stored : Array.isArray(positionProp.default) ? (positionProp.default as number[]) : undefined;
    if (start && typeof start[0] === "number" && typeof start[1] === "number") inputs.startPosition = [start[0], start[1]];
  }

  const ops: Op[] = [
    {
      op: "addPatch",
      component: componentId,
      patch: { ref: TOUCH_REF, type: option.patchType, name: `${option.label} ${layer.name}`, inputs, ui: touchPlacement(component, layerId) },
    },
  ];
  if (positionProp && !positionLinked) ops.push({ op: "connect", component: componentId, from: `$${TOUCH_REF}.position`, to: `@${layerId}.position` });
  return { ops, label: `Add ${option.label} to ${layer.name}`, ref: TOUCH_REF, positionLinked };
}
