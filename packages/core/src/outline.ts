/**
 * Outline projection (ARCHITECTURE §10): a compact, token-lean text view of a component
 * for agents and humans. Layers are indented by depth; props show only when they differ
 * from their defaults; links are written as `key←source`.
 */

import { listComponentIds } from "./document.ts";
import { INPUTS_NODE_ID, layerNodeId, layersWithGraphNodes, OUTPUTS_NODE_ID, readNodePositions } from "./graph/graphNodes.ts";
import { getOwn } from "./ids.ts";
import { knobLiteral } from "./knobs.ts";
import { LAYER_TYPES } from "./layerTypes.ts";
import { createRegistry, findPort, resolveLayerProps, resolveNodePorts, type ResolvedPort } from "./registry.ts";
import type { Component, Id, InputValue, KnobSet, LayerNode, PatchNode, Registry, SonobeDocument, ValueType } from "./types.ts";
import { decodeInput, defaultForPort, formatNumber, isAssetInput, isDecodedLoop, isGradientLiteral, isJsonLiteral, isLayerInput, isLinkInput, isLoopLiteral } from "./values.ts";

export type OutlineDetail = "compact" | "normal" | "full";

export interface OutlineOptions {
  /**
   * compact: structure and connections only.
   * normal (default): plus non-default values, notes and comments.
   * full: plus editor positions (patches, and layer and interface nodes in the graph), flags and settings.
   */
  detail?: OutlineDetail;
  /** Registry for patch defaults and port order; layer defaults come from built-in layer types otherwise. */
  registry?: Registry;
}

const LAYER_REGISTRY = createRegistry([], LAYER_TYPES);

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const quote = (s: string, max = 60) => JSON.stringify(truncate(s, max));

function equalValues(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => equalValues((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function isDefault(value: InputValue, port: ResolvedPort): boolean {
  if (isLinkInput(value)) return false;
  const decoded = decodeInput(value, port.type);
  if (isDecodedLoop(decoded)) return false;
  return equalValues(decoded, defaultForPort(port));
}

/** Format a stored value for the outline. */
export function formatOutlineValue(value: InputValue, type?: ValueType): string {
  if (value === null) return "none";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    if (type === "enum" || type === "color" || (type === undefined && /^#[0-9A-Fa-f]{8}$/.test(value))) return value;
    return quote(value);
  }
  if (Array.isArray(value)) return value.map(formatNumber).join(",");
  if (isLinkInput(value)) return `←${value.link}`;
  if (isLayerInput(value)) return `@${value.layer}`;
  if (isAssetInput(value)) return `asset:${value.asset}`;
  if (isLoopLiteral(value)) return `loop[${value.loop.map((v) => formatOutlineValue(v, type)).join("|")}]`;
  if (isJsonLiteral(value)) return `json${truncate(JSON.stringify(value.json) ?? "null", 60)}`;
  if (isGradientLiteral(value)) {
    const g = value.gradient;
    return `gradient(${g.kind} ${g.stops.map(([o, c]) => `${c}@${formatNumber(o)}`).join(",")})`;
  }
  return truncate(JSON.stringify(value) ?? "", 60);
}

function orderedKeys(values: Record<string, unknown>, ports: readonly { key: string }[] | undefined): string[] {
  const keys = Object.keys(values);
  const known = (ports ?? []).map((p) => p.key).filter((k) => k in values);
  return [...known, ...keys.filter((k) => !known.includes(k)).sort()];
}

function valueTokens(values: Record<string, InputValue>, ports: readonly ResolvedPort[] | undefined, detail: OutlineDetail, skip: ReadonlySet<string>): string[] {
  const tokens: string[] = [];
  for (const key of orderedKeys(values, ports)) {
    if (skip.has(key)) continue;
    const value = values[key]!;
    if (isLinkInput(value)) {
      tokens.push(`${key}←${value.link}`);
      continue;
    }
    if (detail === "compact" && !isLayerInput(value)) continue;
    const port = findPort(ports, key);
    if (port && isDefault(value, port)) continue;
    tokens.push(`${key}=${formatOutlineValue(value, port?.type)}`);
  }
  return tokens;
}

function layerLines(doc: SonobeDocument, c: Component, layer: LayerNode, depth: number, detail: OutlineDetail, registry: Registry, out: string[], graphNodes?: ReadonlyMap<Id, string>): void {
  const props = resolveLayerProps(doc, c.id, layer, registry) ?? resolveLayerProps(doc, c.id, layer, LAYER_REGISTRY);
  const parts = [`layer ${layer.id} ${layer.type}${layer.component ? `:${layer.component}` : ""} ${quote(layer.name)}`];
  const skip = new Set<string>();
  if (detail !== "compact") {
    if ((layer.type === "text" || layer.type === "textField") && typeof layer.props.text === "string") {
      parts.push(quote(layer.props.text));
      skip.add("text");
    }
    for (const [key, format] of [
      ["position", (v: number[]) => `@${v.map(formatNumber).join(",")}`],
      ["size", (v: number[]) => v.map(formatNumber).join("x")],
    ] as const) {
      const v = layer.props[key];
      const port = findPort(props, key);
      if (Array.isArray(v) && v.length === 2) {
        skip.add(key);
        if (!port || !isDefault(v, port)) parts.push(format(v));
      }
    }
  }
  parts.push(...valueTokens(layer.props, props, detail, skip));
  if (detail === "full") {
    if (layer.locked) parts.push("locked");
    if (layer.collapsed) parts.push("collapsed");
    const node = graphNodes?.get(layer.id);
    if (node) parts.push(`node=${node}`);
  }
  out.push("  ".repeat(depth) + parts.join(" "));
  for (const child of layer.children ?? []) layerLines(doc, c, child, depth + 1, detail, registry, out, graphNodes);
}

/** Patches in dataflow order: sources before consumers, ties by editor x, then id. */
function patchOrder(c: Component): Id[] {
  const ids = Object.keys(c.patches);
  const deps = new Map<Id, Set<Id>>(ids.map((id) => [id, new Set()]));
  for (const [id, node] of Object.entries(c.patches)) {
    for (const value of Object.values(node.inputs)) {
      if (!isLinkInput(value)) continue;
      const source = value.link.split(".")[0]!;
      if (source !== id && getOwn(c.patches, source)) deps.get(id)!.add(source);
    }
  }
  const byPosition = (a: Id, b: Id) => c.patches[a]!.ui.x - c.patches[b]!.ui.x || c.patches[a]!.ui.y - c.patches[b]!.ui.y || (a < b ? -1 : a > b ? 1 : 0);
  const done = new Set<Id>();
  const order: Id[] = [];
  let remaining = [...ids].sort(byPosition);
  while (remaining.length) {
    const ready = remaining.filter((id) => [...deps.get(id)!].every((d) => done.has(d)));
    const next = ready.length ? ready[0]! : remaining[0]!;
    order.push(next);
    done.add(next);
    remaining = remaining.filter((id) => id !== next);
  }
  return order;
}

function patchLine(doc: SonobeDocument, id: Id, node: PatchNode, detail: OutlineDetail, registry: Registry | undefined): string {
  let head = `patch ${id} ${node.type}`;
  if (node.component) head += `:${node.component}`;
  if (node.typeParam) head += `<${node.typeParam}>`;
  if (node.inputCount !== undefined) head += `×${node.inputCount}`;
  const parts = [head];
  if (node.name) parts.push(quote(node.name));
  if (node.muted) parts.push("muted");
  const ports = registry ? resolveNodePorts(doc, node, registry)?.inputs : undefined;
  parts.push(...valueTokens(node.inputs, ports, detail, new Set()));
  if (detail === "full") {
    parts.push(`ui=${formatNumber(node.ui.x)},${formatNumber(node.ui.y)}`);
    if (node.ui.collapsed) parts.push("collapsed");
    if (node.ui.color) parts.push(`color=${node.ui.color}`);
    if (node.settings && Object.keys(node.settings).length) parts.push(`settings=${truncate(JSON.stringify(node.settings), 80)}`);
  }
  return parts.join(" ");
}

function componentOutline(doc: SonobeDocument, c: Component, detail: OutlineDetail, registry: Registry | undefined): string[] {
  const out: string[] = [];
  const size = c.size ? ` ${formatNumber(c.size[0])}x${formatNumber(c.size[1])}` : "";
  out.push(`component ${c.id} ${quote(c.name)} (${c.kind})${size}`);
  if (detail !== "compact" && c.notes) out.push(`notes ${quote(c.notes, 160)}`);
  for (const port of Object.values(c.interface.inputs).sort((a, b) => (a.key < b.key ? -1 : 1))) {
    let line = `input ${port.key} ${port.type}`;
    if (port.name && port.name !== port.key) line += ` ${quote(port.name)}`;
    if (port.default !== undefined && detail !== "compact") line += ` default=${formatOutlineValue(port.default, port.type)}`;
    if (detail === "full" && port.loopBehavior) line += ` loop=${port.loopBehavior}`;
    out.push(line);
  }
  for (const port of Object.values(c.interface.outputs).sort((a, b) => (a.key < b.key ? -1 : 1))) {
    let line = `output ${port.key} ${port.type}`;
    if (port.name && port.name !== port.key) line += ` ${quote(port.name)}`;
    if (port.link) line += ` ←${port.link}`;
    out.push(line);
  }
  // Full detail: where graph nodes the document doesn't place on an item sit (setNodePositions), or "auto".
  let graphNodes: Map<Id, string> | undefined;
  if (detail === "full") {
    const saved = readNodePositions(c);
    const at = (nodeId: string) => (saved[nodeId] ? `${formatNumber(saved[nodeId].x)},${formatNumber(saved[nodeId].y)}` : "auto");
    graphNodes = new Map([...layersWithGraphNodes(c)].map((id) => [id, at(layerNodeId(id))]));
    const sides = [Object.keys(c.interface.inputs).length ? `${INPUTS_NODE_ID}=${at(INPUTS_NODE_ID)}` : "", Object.keys(c.interface.outputs).length ? `${OUTPUTS_NODE_ID}=${at(OUTPUTS_NODE_ID)}` : ""].filter(Boolean);
    if (sides.length) out.push(`nodes ${sides.join(" ")}`);
  }
  const layerRegistry = registry ?? LAYER_REGISTRY;
  for (const layer of c.layers) layerLines(doc, c, layer, 0, detail, layerRegistry, out, graphNodes);
  for (const id of patchOrder(c)) out.push(patchLine(doc, id, c.patches[id]!, detail, registry));
  if (detail !== "compact") {
    for (const comment of c.comments) {
      let line = `comment ${comment.id} ${quote(comment.text, 120)}`;
      if (detail === "full") line += ` rect=${comment.rect.map(formatNumber).join(",")}${comment.color ? ` color=${comment.color}` : ""}`;
      out.push(line);
    }
  }
  return out;
}

/**
 * The knob block: a header with the running preset and every preset, then one line per knob. Links
 * that read a knob print as `key←$knob.<id>` on their own lines, as any link does.
 */
function knobLines(set: KnobSet, detail: OutlineDetail): string[] {
  const running = set.presets.find((p) => p.id === set.active);
  const presets = set.presets.map((p) => `${p.id} ${quote(p.name)}${p.locked ? " locked" : ""}`).join(", ");
  const out = [`knobs ${set.knobs.length} · running ${set.active}${running ? ` ${quote(running.name)}` : ""} · presets ${presets}`];
  for (const knob of set.knobs) {
    if (detail === "compact") {
      out.push(`knob ${knob.id} ${knob.type} =${formatOutlineValue(knobLiteral(set, knob), knob.type)}`);
      continue;
    }
    const parts = [`knob ${knob.id} ${knob.type} ${quote(knob.name)}`];
    if (knob.group) parts.push(`group=${quote(knob.group)}`);
    if (knob.min !== undefined && knob.max !== undefined) parts.push(`${formatNumber(knob.min)}…${formatNumber(knob.max)}`);
    else if (knob.min !== undefined) parts.push(`min=${formatNumber(knob.min)}`);
    else if (knob.max !== undefined) parts.push(`max=${formatNumber(knob.max)}`);
    if (knob.step !== undefined) parts.push(`step=${formatNumber(knob.step)}`);
    if (knob.unit) parts.push(`unit=${knob.unit}`);
    if (detail === "full" && knob.options?.length) parts.push(`options=${knob.options.map((o) => o.key).join("|")}`);
    for (const preset of set.presets) if (Object.hasOwn(knob.values, preset.id)) parts.push(`${preset.id}=${formatOutlineValue(knob.values[preset.id]!, knob.type)}`);
    if (detail === "full" && knob.description) parts.push(`description=${quote(knob.description, 200)}`);
    out.push(parts.join(" "));
  }
  return out;
}

/**
 * Compact text projection of one component (or every component, root first,
 * separated by blank lines). The knob block comes first whenever the root component is shown.
 * Throws when `componentId` doesn't exist.
 */
export function getOutline(doc: SonobeDocument, componentId?: Id, options: OutlineOptions = {}): string {
  const detail = options.detail ?? "normal";
  const knobs = doc.knobs && (componentId === undefined || componentId === doc.project.root) ? [knobLines(doc.knobs, detail).join("\n")] : [];
  if (componentId !== undefined) {
    const c = getOwn(doc.components, componentId);
    if (!c) throw new Error(`There's no component "${componentId}".`);
    return [...knobs, componentOutline(doc, c, detail, options.registry).join("\n")].join("\n\n");
  }
  return [...knobs, ...listComponentIds(doc).map((id) => componentOutline(doc, doc.components[id]!, detail, options.registry).join("\n"))].join("\n\n");
}
