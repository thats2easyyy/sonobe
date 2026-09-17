/**
 * getDiagnostics (ARCHITECTURE §3.6): a pure pass over a document that reports problems
 * and teaching hints with ready-to-apply suggestions.
 */

import { parseAddress } from "./address.ts";
import { componentDependencies, listComponentIds } from "./document.ts";
import { isValidId } from "./ids.ts";
import { listInputs } from "./ops/references.ts";
import {
  allLayerIds,
  COMPONENT_INSTANCE_LAYER_TYPE,
  COMPONENT_PATCH_TYPE,
  findLayer,
  getPatchSpec,
  interfacePortToPort,
  resolveNodePorts,
  walkLayers,
} from "./registry.ts";
import { didYouMean, didYouMeanText } from "./suggest.ts";
import type { Component, Diagnostic, Id, Registry, Severity, SonobeDocument, SonobeError, Suggestion } from "./types.ts";
import { checkInputValue, checkLink, checkLiteral, insertPatchSuggestion, resolveSource, resolveTarget, type PortTarget, type ValidateOptions } from "./validate.ts";
import { isAssetInput, isLayerInput, isLinkInput } from "./values.ts";

export interface DiagnosticsOptions {
  /** Limit the pass to these components (default: all). */
  components?: Id[];
}

function diag(severity: Severity, code: string, message: string, component: Id, itemIds: Id[], extra: { port?: string; suggestions?: Suggestion[] } = {}): Diagnostic {
  const d: Diagnostic = { code, severity, message, component, itemIds };
  if (extra.port !== undefined) d.port = extra.port;
  if (extra.suggestions?.length) d.suggestions = extra.suggestions;
  return d;
}

const withHint = (e: SonobeError) => (e.hint ? `${e.message} ${e.hint}` : e.message);

const STATE_TYPES = new Set(["boolean", "number", "index"]);

function checkComponent(doc: SonobeDocument, c: Component, registry: Registry, out: Diagnostic[]): void {
  const validate: ValidateOptions = { registry, lenient: false };
  const push = (d: Diagnostic) => out.push(d);

  const counts = new Map<Id, number>();
  for (const id of [...allLayerIds(c.layers), ...Object.keys(c.patches), ...c.comments.map((x) => x.id)]) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    if (n > 1) push(diag("error", "duplicate_id", `The id "${id}" is used ${n} times in ${c.id}. Ids must be unique across layers, patches and comments.`, c.id, [id]));
    if (!isValidId(id)) push(diag("error", "invalid_id", `"${id}" isn't a valid id (letters, digits and underscores, not starting with a digit).`, c.id, [id]));
  }

  const componentRef = (itemId: Id, targetId: Id | undefined, expected: Component["kind"], label: string) => {
    if (targetId === undefined) {
      push(diag("error", "missing_component", `${label} "${itemId}" doesn't say which component it shows.`, c.id, [itemId]));
      return;
    }
    const target = doc.components[targetId];
    if (!target) {
      push(diag("error", "component_not_found", `${label} "${itemId}" shows component "${targetId}", which doesn't exist.${didYouMeanText(didYouMean(targetId, Object.keys(doc.components)))}`, c.id, [itemId]));
      return;
    }
    if (target.kind !== expected) push(diag("error", "wrong_component_kind", `${label} "${itemId}" shows "${targetId}", which is a ${target.kind}, not a ${expected}.`, c.id, [itemId]));
    if (targetId === c.id || componentDependencies(doc, targetId).has(c.id)) {
      push(diag("error", "component_cycle", `"${targetId}" ends up containing itself through "${itemId}" in ${c.id}.`, c.id, [itemId]));
    }
  };

  const checkValue = (target: PortTarget, value: unknown) => {
    const itemIds = target.itemId ? [target.itemId] : [];
    const r = checkInputValue(doc, c, target, value, validate);
    if (!r.ok) {
      let code = r.error.code;
      const suggestions: Suggestion[] = [...(r.error.suggestions ?? [])];
      if (isLinkInput(value)) {
        if (code === "not_found") code = "dangling_link";
        if (code === "self_edge") code = "self_cycle";
        const source = parseAddress(value.link);
        if (source && (source.kind === "patch" || source.kind === "layer") && !itemIds.includes(source.id)) itemIds.push(source.id);
        suggestions.push({ description: "Disconnect it", ops: [{ op: "disconnect", component: c.id, to: target.address }] });
      } else {
        if (code === "not_found" && isLayerInput(value)) code = "missing_layer";
        if (code === "not_found" && isAssetInput(value)) code = "missing_asset";
        if (target.kind !== "componentOutput") suggestions.push({ description: "Reset it to its default", ops: [{ op: "setInput", component: c.id, target: target.address, value: null }] });
      }
      push(diag("error", code, withHint(r.error), c.id, itemIds, { port: target.key, suggestions }));
      return;
    }
    if (!isLinkInput(value) || !target.port) return;
    const src = resolveSource(doc, c, value.link, validate);
    if (!src.ok || !src.value.port || src.value.port.type !== "pulse" || !STATE_TYPES.has(target.port.type)) return;
    const suggestions: Suggestion[] = [];
    const s = insertPatchSuggestion(doc, registry, c.id, "switch", "Insert a Switch: each pulse flips it on or off, and it holds that state.", { address: src.value.address, type: "pulse" }, { address: target.address, type: target.port.type });
    if (s) suggestions.push(s);
    if (src.value.itemId) itemIds.push(src.value.itemId);
    push(
      diag("warning", "pulse_into_state", `${src.value.address} is a pulse, which is on for a single frame, but ${target.address} expects a steady ${target.port.type}. Did you mean to use a Switch?`, c.id, itemIds, {
        port: target.key,
        suggestions,
      }),
    );
  };

  walkLayers(c.layers, (layer, info) => {
    const spec = registry.layers.get(layer.type);
    if (!spec) {
      const types = [...registry.layers.values()].map((t) => ({ value: t.type, aliases: [t.name] }));
      push(diag("error", "unknown_layer_type", `Layer "${layer.id}" has an unknown type "${layer.type}".${didYouMeanText(didYouMean(layer.type, types))}`, c.id, [layer.id]));
      return;
    }
    if (info.parent) {
      const parentSpec = registry.layers.get(info.parent.type);
      if (parentSpec && !parentSpec.canHaveChildren) push(diag("error", "cannot_have_children", `"${info.parent.id}" is a ${parentSpec.name} layer, which can't hold other layers like "${layer.id}".`, c.id, [info.parent.id, layer.id]));
    }
    if (layer.type === COMPONENT_INSTANCE_LAYER_TYPE) componentRef(layer.id, layer.component, "layerComponent", "Component layer");
    for (const [key, value] of Object.entries(layer.props)) {
      const target = resolveTarget(doc, c, `@${layer.id}.${key}`, validate);
      if (!target.ok) {
        push(diag("error", target.error.code, withHint(target.error), c.id, [layer.id], { port: key, suggestions: [{ description: `Remove "${key}"`, ops: [{ op: "setInput", component: c.id, target: `@${layer.id}.${key}`, value: null }] }] }));
        continue;
      }
      checkValue(target.value, value);
    }
  });

  for (const [id, node] of Object.entries(c.patches)) {
    const spec = getPatchSpec(registry, node.type);
    if (!spec) {
      const types = [...registry.patches.values()].map((s) => ({ value: s.type, aliases: [s.name, ...(s.aliases ?? [])] }));
      push(diag("error", "unknown_patch_type", `Patch "${id}" has an unknown type "${node.type}".${didYouMeanText(didYouMean(node.type, types))}`, c.id, [id], {
        suggestions: [{ description: `Remove "${id}"`, ops: [{ op: "removePatch", component: c.id, id }] }],
      }));
      continue;
    }
    if (node.typeParam !== undefined) {
      const variants = spec.variants ?? [];
      if (!variants.length) push(diag("warning", "invalid_type_param", `Patch "${id}" sets typeParam "${node.typeParam}", but ${spec.name} has no type options.`, c.id, [id]));
      else if (!(variants as string[]).includes(node.typeParam)) {
        push(diag("error", "invalid_type_param", `Patch "${id}" is set to type "${node.typeParam}", which ${spec.name} doesn't support (${variants.join(", ")}).`, c.id, [id], {
          suggestions: [{ description: `Use "${variants[0]}"`, ops: [{ op: "updatePatch", component: c.id, id, typeParam: variants[0] }] }],
        }));
      }
    }
    if (node.inputCount !== undefined && spec.variadic && (node.inputCount < spec.variadic.min || node.inputCount > spec.variadic.max)) {
      push(diag("warning", "input_count_out_of_range", `Patch "${id}" has ${node.inputCount} ${spec.variadic.name.toLowerCase()} inputs; ${spec.name} supports ${spec.variadic.min}–${spec.variadic.max}.`, c.id, [id]));
    }
    if (node.type === COMPONENT_PATCH_TYPE) componentRef(id, node.component, "patchComponent", "Component patch");
    const ports = resolveNodePorts(doc, node, registry);
    if (ports?.dynamicPortsError) push(diag("warning", "dynamic_ports_failed", `Patch "${id}" couldn't work out its ports: ${ports.dynamicPortsError}`, c.id, [id]));
    for (const [key, value] of Object.entries(node.inputs)) {
      const target = resolveTarget(doc, c, `${id}.${key}`, validate);
      if (!target.ok) {
        push(diag("error", target.error.code, withHint(target.error), c.id, [id], { port: key, suggestions: [{ description: `Remove "${key}"`, ops: [{ op: "setInput", component: c.id, target: `${id}.${key}`, value: null }] }] }));
        continue;
      }
      checkValue(target.value, value);
    }
  }

  for (const [key, port] of Object.entries(c.interface.inputs)) {
    if (port.default === undefined) continue;
    const r = checkLiteral(doc, c, port.default, interfacePortToPort(port, "input"), `$in.${key}`, validate);
    if (!r.ok) push(diag("error", r.error.code, withHint(r.error), c.id, [], { port: key }));
  }
  for (const [key, port] of Object.entries(c.interface.outputs)) {
    if (port.link === undefined) {
      push(diag("info", "unconnected_output", `The published output "${key}" of ${c.id} isn't connected to anything inside the component.`, c.id, [], { port: key }));
      continue;
    }
    const target: PortTarget = { kind: "componentOutput", address: `$out.${key}`, key, port: interfacePortToPort(port, "output"), bindable: true };
    const r = checkLink(doc, c, port.link, target, validate);
    if (!r.ok) push(diag("error", r.error.code === "not_found" ? "dangling_link" : r.error.code, withHint(r.error), c.id, [], { port: key, suggestions: r.error.suggestions }));
  }

  // Graph: feedback loops and unused patches.
  const edges = new Map<Id, Set<Id>>();
  const consumed = new Set<Id>();
  for (const e of listInputs(c)) {
    if (!isLinkInput(e.value)) continue;
    const a = parseAddress(e.value.link);
    if (!a || a.kind !== "patch") continue;
    consumed.add(a.id);
    if (e.target.kind === "patch" && c.patches[a.id] && a.id !== e.target.id) {
      if (!edges.has(a.id)) edges.set(a.id, new Set());
      edges.get(a.id)!.add(e.target.id);
    }
  }
  for (const loop of stronglyConnected(Object.keys(c.patches), edges)) {
    push(diag("info", "feedback_loop", `Patches ${loop.map((x) => `"${x}"`).join(", ")} form a feedback loop. The connection that closes the loop reads the previous frame's value.`, c.id, loop));
  }
  for (const [id, node] of Object.entries(c.patches)) {
    if (consumed.has(id)) continue;
    const ports = resolveNodePorts(doc, node, registry);
    if (!ports || !ports.outputs.length) continue;
    push(diag("info", "unused_patch", `Patch "${id}" (${ports.spec.name}) isn't connected to anything, so its outputs aren't used.`, c.id, [id], {
      suggestions: [{ description: `Remove "${id}"`, ops: [{ op: "removePatch", component: c.id, id }] }],
    }));
  }

  // Layers that can't receive touches but have an interaction bound.
  const reported = new Set<string>();
  for (const [id, node] of Object.entries(c.patches)) {
    const spec = getPatchSpec(registry, node.type);
    if (spec?.category !== "interaction") continue;
    const ports = resolveNodePorts(doc, node, registry);
    for (const port of ports?.inputs ?? []) {
      const value = node.inputs[port.key];
      if (port.type !== "layer" || !isLayerInput(value)) continue;
      const loc = findLayer(c.layers, value.layer);
      if (!loc || reported.has(`${id}:${value.layer}`)) continue;
      const reasons: string[] = [];
      const fixes: Suggestion[] = [];
      for (const ancestorId of loc.path) {
        const layer = findLayer(c.layers, ancestorId)!.layer;
        const self = ancestorId === value.layer;
        if (layer.props.enabled === false) {
          reasons.push(self ? "it's disabled" : `its parent "${ancestorId}" is disabled`);
          fixes.push({ description: `Enable "${ancestorId}"`, ops: [{ op: "setInput", component: c.id, target: `@${ancestorId}.enabled`, value: null }] });
        }
        if (layer.props.opacity === 0) {
          reasons.push(self ? "its opacity is 0" : `its parent "${ancestorId}" has opacity 0`);
          fixes.push({ description: "Use a Hit Area layer as an invisible touch target instead of a transparent layer." });
        }
        if (self && layer.props.hitTest === false) {
          reasons.push("Receives Touches is off");
          fixes.push({ description: `Turn Receives Touches back on for "${ancestorId}"`, ops: [{ op: "setInput", component: c.id, target: `@${ancestorId}.hitTest`, value: null }] });
        }
      }
      if (!reasons.length) continue;
      reported.add(`${id}:${value.layer}`);
      push(diag("warning", "untouchable_layer", `Layer "${value.layer}" can't receive touches because ${reasons.join(" and ")}, so ${spec.name} "${id}" will never fire.`, c.id, [value.layer, id], { port: port.key, suggestions: fixes }));
    }
  }
}

/** Strongly connected components with more than one node (Tarjan). */
function stronglyConnected(nodes: Id[], edges: Map<Id, Set<Id>>): Id[][] {
  let index = 0;
  const indexes = new Map<Id, number>();
  const low = new Map<Id, number>();
  const stack: Id[] = [];
  const onStack = new Set<Id>();
  const out: Id[][] = [];
  const visit = (v: Id) => {
    indexes.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!indexes.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, indexes.get(w)!));
      }
    }
    if (low.get(v) === indexes.get(v)) {
      const group: Id[] = [];
      let w: Id;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        group.push(w);
      } while (w !== v);
      if (group.length > 1) out.push(group.sort());
    }
  };
  for (const v of [...nodes].sort()) if (!indexes.has(v)) visit(v);
  return out;
}

/** Diagnose a whole document (or selected components). */
export function getDiagnostics(doc: SonobeDocument, registry: Registry, options: DiagnosticsOptions = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  const root = doc.components[doc.project.root];
  if (!root) out.push(diag("error", "missing_root", `The project's root component "${doc.project.root}" doesn't exist.`, doc.project.root, []));
  else if (root.kind !== "prototype") out.push(diag("warning", "root_not_prototype", `The root component "${root.id}" is a ${root.kind}; the root should be a prototype.`, root.id, []));
  const ids = options.components ?? listComponentIds(doc);
  for (const id of ids) {
    const c = doc.components[id];
    if (c) checkComponent(doc, c, registry, out);
  }
  return out;
}
