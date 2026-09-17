/**
 * Cable drops from the patch editor onto the Layers panel and the Inspector: which annotated row
 * the pointer is over while a cable is being dragged (so rows can light up before the release),
 * and whether a layer has any property the dragged cable can drive.
 */

import { resolveLayerProps, type Id, type LayerNode, type Registry, type SonobeDocument } from "@sonobe/core";
import { useEffect, useState } from "react";
import { acceptsCable, dropTargetAt, type CableDrag } from "../patch-editor/api.ts";

/** Hover key for a property row ("prop:photo.scale"). */
export const propHoverKey = (layerId: Id, prop: string): string => `prop:${layerId}.${prop}`;

/** Hover key for a layer row ("layer:photo"). */
export const layerHoverKey = (layerId: Id): string => `layer:${layerId}`;

/** The hover key of the drop target an element belongs to, or null. */
export function cableHoverKey(element: Element | null | undefined): string | null {
  const target = dropTargetAt(element);
  if (!target) return null;
  return target.kind === "prop" ? propHoverKey(target.target.layerId, target.target.prop) : layerHoverKey(target.layerId);
}

const isElement = (value: unknown): value is Element => typeof Element !== "undefined" && value instanceof Element;

/**
 * While `active` (a cable is being dragged), the hover key of the drop target under the pointer.
 * Reads the element under the pointer on every move, because the patch editor's drag doesn't give
 * other panels pointer events of their own.
 */
export function useCableHover(active: boolean): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const onMove = (event: MouseEvent) => {
      const doc = globalThis.document;
      const under = typeof doc?.elementFromPoint === "function" ? doc.elementFromPoint(event.clientX, event.clientY) : null;
      const next = cableHoverKey(under ?? (isElement(event.target) ? event.target : null));
      setKey((current) => (current === next ? current : next));
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("mousemove", onMove, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("mousemove", onMove, true);
      setKey(null);
    };
  }, [active]);
  return active ? key : null;
}

/** True when the dragged cable belongs to this component and can drive at least one of the layer's properties. */
export function layerAcceptsCable(doc: SonobeDocument, componentId: Id, registry: Registry, layer: LayerNode, drag: CableDrag | null): boolean {
  if (!drag || drag.component !== componentId) return false;
  const props = resolveLayerProps(doc, componentId, layer, registry) ?? [];
  return props.some((prop) => prop.bindable !== false && acceptsCable(drag, prop.type));
}
