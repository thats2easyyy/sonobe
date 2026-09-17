/**
 * getDiagnostics (ARCHITECTURE §3.6): a pure pass over a document that reports problems
 * and teaching hints with ready-to-apply suggestions.
 */

import { parseAddress } from "./address.ts";
import { componentDependencies, listComponentIds } from "./document.ts";
import { DELAY_ONE_FRAME_TYPE, feedbackLoops, type FeedbackEdge, type FeedbackLoop } from "./graph.ts";
import { isValidId } from "./ids.ts";
import { listInputs } from "./ops/references.ts";
import {
  allLayerIds,
  COMPONENT_INSTANCE_LAYER_TYPE,
  COMPONENT_PATCH_TYPE,
  findLayer,
  getInputCountRange,
  getPatchSpec,
  interfacePortToPort,
  resolveNodePorts,
  walkLayers,
} from "./registry.ts";
import { didYouMean, didYouMeanText } from "./suggest.ts";
import type { Component, Diagnostic, Id, Registry, Severity, SonobeDocument, SonobeError, Suggestion, ValueType } from "./types.ts";
import { checkInputValue, checkLink, checkLiteral, insertPatchSuggestion, resolveSource, resolveTarget, type PortTarget, type ValidateOptions } from "./validate.ts";
import { isAssetInput, isLayerInput, isLinkInput } from "./values.ts";

export interface DiagnosticsOptions {
  /** Limit the pass to these components (default: all). */
  components?: Id[];
}

function diag(severity: Severity, code: string, message: string, component: Id, itemIds: Id[], extra: { port?: string; hint?: string; suggestions?: Suggestion[] } = {}): Diagnostic {
  const d: Diagnostic = { code, severity, message, component, itemIds };
  if (extra.hint !== undefined) d.hint = extra.hint;
  if (extra.port !== undefined) d.port = extra.port;
  if (extra.suggestions?.length) d.suggestions = extra.suggestions;
  return d;
}

const withHint = (e: SonobeError) => (e.hint ? `${e.message} ${e.hint}` : e.message);

const STATE_TYPES = new Set(["boolean", "number", "index"]);

/** "a", "a and b", "a, b and c". */
const listText = (items: readonly string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** feedback_loop: names the cables that read the previous frame and offers to make each delay explicit. */
function feedbackDiagnostic(doc: SonobeDocument, c: Component, registry: Registry, loop: FeedbackLoop): Diagnostic {
  const delayName = getPatchSpec(registry, DELAY_ONE_FRAME_TYPE)?.name ?? "Delay One Frame";
  const cable = (e: FeedbackEdge) => `${e.from} → ${e.to}`;
  const connections = (edges: readonly FeedbackEdge[]) => `The ${edges.length === 1 ? "connection" : "connections"} ${listText(edges.map(cable))}`;
  const delayed = loop.feedback.filter((e) => e.reason === "delay1");
  const backwards = loop.feedback.filter((e) => e.reason === "backwards");
  const byOrder = loop.feedback.filter((e) => e.reason === "id");
  const parts = [`Patches ${loop.patchIds.map((x) => `"${x}"`).join(", ")} form a feedback loop.`];
  if (delayed.length) {
    const one = delayed.length === 1;
    parts.push(`${delayName} ${listText(delayed.map((e) => `"${e.targetId}"`))} ${one ? "gives" : "give"} it one frame of delay: ${listText(delayed.map(cable))} ${one ? "reads last frame's value" : "read last frame's values"}.`);
  }
  if (backwards.length) {
    parts.push(`${connections(backwards)} ${backwards.length === 1 ? "runs right to left, so it reads last frame's value" : "run right to left, so they read last frame's values"}.`);
  }
  if (byOrder.length) parts.push(`${connections(byOrder)} ${byOrder.length === 1 ? "reads last frame's value" : "read last frame's values"}.`);

  const implicit = loop.feedback.filter((e) => e.reason !== "delay1");
  const validate: ValidateOptions = { registry, lenient: false };
  const suggestions: Suggestion[] = [];
  for (const e of implicit.slice(0, 3)) {
    const src = resolveSource(doc, c, e.from, validate);
    const tgt = resolveTarget(doc, c, e.to, validate);
    const fromType: ValueType = src.ok && src.value.port ? src.value.port.type : "any";
    const toType: ValueType = tgt.ok && tgt.value.port ? tgt.value.port.type : "any";
    const s = insertPatchSuggestion(doc, registry, c.id, DELAY_ONE_FRAME_TYPE, `Insert a ${delayName} on ${cable(e)}`, { address: e.from, type: fromType }, { address: e.to, type: toType });
    if (!s) continue;
    const add = s.ops?.[0];
    const a = c.patches[e.sourceId]?.ui;
    const b = c.patches[e.targetId]?.ui;
    if (add?.op === "addPatch" && a && b && Number.isFinite(a.x + a.y + b.x + b.y)) add.patch.ui = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
    suggestions.push(s);
  }
  const extra: { hint?: string; suggestions: Suggestion[] } = { suggestions };
  if (implicit.length) extra.hint = `To make the delay explicit, insert a ${delayName} patch on ${implicit.length === 1 ? "that connection" : "one of those connections"}.`;
  return diag("info", "feedback_loop", parts.join(" "), c.id, loop.patchIds, extra);
}

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

  /** State inputs that take pulses on purpose: ports declared acceptsPulse, and boolean inputs of logic patches (Or and And merge taps). */
  const acceptsPulses = (target: PortTarget): boolean => {
    if (target.port?.acceptsPulse) return true;
    if (target.kind !== "patch" || target.itemId === undefined || target.port?.type !== "boolean") return false;
    const node = c.patches[target.itemId];
    return !!node && getPatchSpec(registry, node.type)?.category === "logic";
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
    if (acceptsPulses(target)) return;
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
    const ports = resolveNodePorts(doc, node, registry);
    if (node.typeParam !== undefined) {
      const variants = ports?.variants ?? [];
      if (!variants.length) push(diag("warning", "invalid_type_param", `Patch "${id}" sets typeParam "${node.typeParam}", but ${spec.name} has no type options.`, c.id, [id]));
      else if (!(variants as string[]).includes(node.typeParam)) {
        push(diag("error", "invalid_type_param", `Patch "${id}" is set to type "${node.typeParam}", which ${spec.name} doesn't support (${variants.join(", ")}).`, c.id, [id], {
          suggestions: [{ description: `Use "${variants[0]}"`, ops: [{ op: "updatePatch", component: c.id, id, typeParam: variants[0] }] }],
        }));
      }
    }
    const range = getInputCountRange(spec);
    if (node.inputCount !== undefined && range && (node.inputCount < range.min || node.inputCount > range.max)) {
      const message = spec.variadic
        ? `Patch "${id}" has ${node.inputCount} ${spec.variadic.name.toLowerCase()} inputs; ${spec.name} supports ${range.min}–${range.max}.`
        : `Patch "${id}" has an input count of ${node.inputCount}; ${spec.name} supports ${range.min}–${range.max}.`;
      push(diag("warning", "input_count_out_of_range", message, c.id, [id]));
    }
    if (node.type === COMPONENT_PATCH_TYPE) componentRef(id, node.component, "patchComponent", "Component patch");
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
  const consumed = new Set<Id>();
  for (const e of listInputs(c)) {
    if (!isLinkInput(e.value)) continue;
    const a = parseAddress(e.value.link);
    if (a && a.kind === "patch") consumed.add(a.id);
  }
  for (const loop of feedbackLoops(doc, c.id, registry)) push(feedbackDiagnostic(doc, c, registry, loop));
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
