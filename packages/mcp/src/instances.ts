/**
 * Component-internal addressing: "instancePath/patchId.port", "@instancePath/layerId.prop" and
 * "instancePath/itemId", where instancePath walks componentInstance layers and component patches
 * from the root ("card#2/badge" for copy 2 of card, then badge inside it). Mirrors the engine's
 * getValue addressing so tools validate what the runtime can read. Browser-safe.
 */

import {
  didYouMean,
  didYouMeanText,
  findLayer,
  walkLayers,
  type Component,
  type Id,
  type SonobeDocument,
} from "@sonobe/core";

const SEGMENT = /^([A-Za-z_][A-Za-z0-9_]*)(?:#(\d+))?$/;

export interface InstanceStep {
  /** The segment as written ("card#2"). */
  segment: string;
  id: Id;
  /** Copy index when the instance is replicated by a loop. */
  copy?: number;
  kind: "layer" | "patch";
  /** The component this instance runs. */
  component: Id;
}

export type InstanceResolution =
  | { ok: true; component: Component; steps: InstanceStep[] }
  | { ok: false; code: string; message: string; hint?: string };

/**
 * Split "@card#2/badge.scale" into { at: "@", path: "card#2", tail: "badge.scale" }. Addresses
 * without a slash have no path.
 */
export function splitInstanceAddress(address: string): {
  at: "" | "@";
  path: string | undefined;
  tail: string;
} {
  const text = address.trim();
  const at = text.startsWith("@") ? "@" : "";
  const body = at ? text.slice(1) : text;
  const slash = body.lastIndexOf("/");
  if (slash < 0) return { at, path: undefined, tail: body };
  return { at, path: body.slice(0, slash), tail: body.slice(slash + 1) };
}

/** Instances inside a component: componentInstance layers and component patches. */
export function instanceIds(component: Component): { id: Id; kind: "layer" | "patch"; component: Id }[] {
  const out: { id: Id; kind: "layer" | "patch"; component: Id }[] = [];
  walkLayers(component.layers, (layer) => {
    if (layer.type === "componentInstance" && layer.component)
      out.push({ id: layer.id, kind: "layer", component: layer.component });
  });
  for (const [id, node] of Object.entries(component.patches))
    if (node.type === "component" && node.component)
      out.push({ id, kind: "patch", component: node.component });
  return out;
}

/** Walk an instance path from `from` (default: the root component). */
export function resolveInstancePath(
  doc: SonobeDocument,
  path: string | undefined,
  from?: Id,
): InstanceResolution {
  const start = doc.components[from ?? doc.project.root];
  if (!start)
    return {
      ok: false,
      code: "not_found",
      message: `There's no component "${from ?? doc.project.root}".`,
    };
  const steps: InstanceStep[] = [];
  if (path === undefined || path === "") return { ok: true, component: start, steps };
  const segments = path.split("/");
  const rootId = doc.project.root;
  if (
    from === undefined &&
    segments[0] === rootId &&
    !instanceIds(start).some((i) => i.id === rootId)
  )
    segments.shift();
  let current = start;
  for (const segment of segments) {
    const m = SEGMENT.exec(segment);
    if (!m)
      return {
        ok: false,
        code: "invalid_address",
        message: `"${segment}" in "${path}" isn't an instance id.`,
        hint: 'Instance paths name component instances from the root, e.g. "card/tap_badge.down" or "@card#2/badge.scale" for copy 2.',
      };
    const id = m[1]!;
    const instances = instanceIds(current);
    const found = instances.find((i) => i.id === id);
    if (!found) {
      const layer = findLayer(current.layers, id)?.layer;
      const patch = current.patches[id];
      const what = layer
        ? `a ${layer.type} layer`
        : patch
          ? `a ${patch.type} patch`
          : undefined;
      return {
        ok: false,
        code: "not_an_instance",
        message: what
          ? `"${id}" in ${current.id} is ${what}, not a component instance, so there's nothing inside it to read.`
          : `There's no component instance "${id}" in ${current.id}.${didYouMeanText(didYouMean(id, instances.map((i) => i.id)))}`,
        hint: instances.length
          ? `Instances in ${current.id}: ${instances.map((i) => `${i.id} (${i.component})`).join(", ")}.`
          : `${current.id} has no component instances.`,
      };
    }
    const next = doc.components[found.component];
    if (!next)
      return {
        ok: false,
        code: "missing_component",
        message: `Instance "${id}" runs component "${found.component}", which isn't in the document.`,
      };
    const step: InstanceStep = { segment, id, kind: found.kind, component: next.id };
    if (m[2] !== undefined) step.copy = Number(m[2]);
    steps.push(step);
    current = next;
  }
  return { ok: true, component: current, steps };
}

/** The shortest instance path from the root to an instance of `componentId`, if any is on screen. */
export function instancePathTo(doc: SonobeDocument, componentId: Id, maxDepth = 6): string | undefined {
  const root = doc.components[doc.project.root];
  if (!root) return undefined;
  let frontier: { component: Component; path: string[] }[] = [{ component: root, path: [] }];
  const seen = new Set<Id>([root.id]);
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: { component: Component; path: string[] }[] = [];
    for (const { component, path } of frontier) {
      for (const instance of instanceIds(component)) {
        const target = doc.components[instance.component];
        if (!target) continue;
        const nextPath = [...path, instance.id];
        if (target.id === componentId) return nextPath.join("/");
        if (seen.has(target.id)) continue;
        seen.add(target.id);
        next.push({ component: target, path: nextPath });
      }
    }
    frontier = next;
  }
  return undefined;
}
