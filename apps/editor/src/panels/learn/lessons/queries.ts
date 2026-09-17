/**
 * Document queries for lesson checks, in the document's own address model: a patch input holds
 * `{ link: "patchId.port" }`, a layer reference holds `{ layer: "layerId" }`, and layer props are
 * `@layerId.prop`. These are the facts get_outline reports to Claude.
 */

import { findLayer, isLinkInput, parseAddress, type Component, type Id, type InputValue, type PatchNode } from "@sonobe/core";

export interface PortRef {
  patchId: Id;
  port: string;
}

/** Patch ids of a type, in document order. */
export function patchesOfType(component: Component, type: string): Id[] {
  return Object.entries(component.patches)
    .filter(([, node]) => node.type === type)
    .map(([id]) => id);
}

/** The patch port driving a value, when it's a link to a patch output. */
export function patchSource(value: InputValue | undefined): PortRef | undefined {
  if (!isLinkInput(value)) return undefined;
  const address = parseAddress(value.link.replace(/#\d+$/, ""));
  return address?.kind === "patch" ? { patchId: address.id, port: address.key } : undefined;
}

/** What drives a patch input ("switch_1.flip" ← "tap_photo.tap"). */
export function inputSource(component: Component, patchId: Id, key: string): PortRef | undefined {
  return patchSource(component.patches[patchId]?.inputs[key]);
}

/** What drives a layer property (`@photo.scale`). */
export function layerPropSource(component: Component, layerId: Id, prop: string): PortRef | undefined {
  return patchSource(findLayer(component.layers, layerId)?.layer.props[prop]);
}

/** True when `patchId.key` is linked to `from.port` (or to any port of `from` when `fromPort` is omitted). */
export function isLinked(component: Component, patchId: Id, key: string, from: Id, fromPort?: string): boolean {
  const source = inputSource(component, patchId, key);
  return !!source && source.patchId === from && (fromPort === undefined || source.port === fromPort);
}

/** The layer a patch's layer input points at. */
export function layerRef(node: PatchNode | undefined, key = "layer"): Id | undefined {
  const value = node?.inputs[key];
  return value && typeof value === "object" && !Array.isArray(value) && typeof (value as { layer?: unknown }).layer === "string" ? (value as { layer: string }).layer : undefined;
}

/** A patch of `type` whose layer input is `layerId` (e.g. the Interaction on @photo). */
export function patchOnLayer(component: Component, type: string, layerId: Id): Id | undefined {
  return patchesOfType(component, type).find((id) => layerRef(component.patches[id]) === layerId);
}

/** A patch of `type` whose `inputKey` is linked to `from.fromPort`. */
export function findLinked(component: Component, type: string, inputKey: string, from: Id, fromPort?: string): Id | undefined {
  return patchesOfType(component, type).find((id) => isLinked(component, id, inputKey, from, fromPort));
}

/** A literal number input, or `fallback` when it's linked or unset. */
export function numberInput(component: Component, patchId: Id, key: string, fallback: number): number {
  const value = component.patches[patchId]?.inputs[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Times a pulse output fired since the step started. */
export function firedSince(fired: ReadonlyMap<string, number>, address: string): number {
  return fired.get(address) ?? 0;
}
