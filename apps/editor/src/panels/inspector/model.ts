/**
 * The inspector's data model: fields generated from layer props and patch ports, intersected across
 * a multi-selection with mixed-value and link summaries, grouped into sections, plus the ops that
 * edit, reset, and disconnect them and plain-language formatting for live values.
 */

import {
  defaultForPort,
  encodeValue,
  findLayer,
  formatColor,
  isColor,
  isLinkInput,
  parseAddress,
  resolveLayerProps,
  resolveNodePorts,
  roundNumber,
  type Component,
  type Id,
  type InputValue,
  type Op,
  type PropCategory,
  type Registry,
  type ResolvedPort,
  type SonobeDocument,
  type ValueType,
} from "@sonobe/core";

/** A patch port or layer prop as the inspector sees it. */
export type FieldPort = ResolvedPort & { category?: PropCategory; bindable?: boolean };

export interface FieldTarget {
  /** Layer or patch id. */
  id: Id;
  /** "@layer.key" or "patch.key". */
  address: string;
  stored: InputValue | undefined;
  /** This target's default, encoded as a document value. */
  fallback: InputValue;
}

export interface InspectorField {
  key: string;
  port: FieldPort;
  type: ValueType;
  targets: FieldTarget[];
  /** The first unlinked target's value (its default when unset). */
  value: InputValue;
  /** Targets hold different values (or only some are linked). */
  mixed: boolean;
  /** The link every target shares, if they all share one. */
  link: string | undefined;
  linkedCount: number;
  /** Some target stores a value or link instead of using the default. */
  isSet: boolean;
  advanced: boolean;
  bindable: boolean;
}

/** One selected layer or patch: its declared ports and stored values. */
export interface FieldSource {
  id: Id;
  kind: "layer" | "patch";
  ports: readonly FieldPort[];
  values: Readonly<Record<string, InputValue>>;
}

export interface InspectorSection {
  id: string;
  title: string;
  fields: InspectorField[];
}

const keyOf = (value: InputValue | undefined) => JSON.stringify(value ?? null);

export const sameInputValue = (a: InputValue | undefined, b: InputValue | undefined): boolean => keyOf(a) === keyOf(b);

/** A port's default as a document value. */
export function encodeDefault(port: FieldPort): InputValue {
  return port.type === "pulse" ? null : encodeValue(defaultForPort(port), port.type);
}

/** The literal a target shows: its stored value, or its default when unset or linked. */
export const literalValue = (target: FieldTarget): InputValue => (target.stored !== undefined && !isLinkInput(target.stored) ? target.stored : target.fallback);

export function summarizeField(port: FieldPort, targets: FieldTarget[]): InspectorField {
  const links = targets.map((t) => (isLinkInput(t.stored) ? t.stored.link : undefined));
  const linkedCount = links.filter((l) => l !== undefined).length;
  const literals = targets.filter((_, i) => links[i] === undefined).map(literalValue);
  const differs = literals.some((v) => keyOf(v) !== keyOf(literals[0]));
  return {
    key: port.key,
    port,
    type: port.type,
    targets,
    value: literals[0] ?? targets[0]?.fallback ?? null,
    mixed: differs || (linkedCount > 0 && linkedCount < targets.length),
    link: linkedCount > 0 && linkedCount === targets.length && links.every((l) => l === links[0]) ? links[0] : undefined,
    linkedCount,
    isSet: targets.some((t) => t.stored !== undefined),
    advanced: port.advanced === true,
    bindable: port.bindable !== false,
  };
}

const addressFor = (source: FieldSource, key: string) => (source.kind === "layer" ? `@${source.id}.${key}` : `${source.id}.${key}`);

/** Fields every source has (same key and type), in the first source's order. */
export function intersectFields(sources: readonly FieldSource[]): InspectorField[] {
  const [first, ...rest] = sources;
  if (!first) return [];
  const fields: InspectorField[] = [];
  for (const port of first.ports) {
    const ports: FieldPort[] = [port];
    for (const source of rest) {
      const match = source.ports.find((p) => p.key === port.key && p.type === port.type);
      if (!match) break;
      ports.push(match);
    }
    if (ports.length !== sources.length) continue;
    const targets = sources.map((source, i): FieldTarget => ({ id: source.id, address: addressFor(source, port.key), stored: source.values[port.key], fallback: encodeDefault(ports[i]!) }));
    fields.push(summarizeField(port, targets));
  }
  return fields;
}

/** Sources for layers in a component (unknown layers and types are skipped). */
export function layerSources(doc: SonobeDocument, componentId: Id, layerIds: readonly Id[], registry: Registry): FieldSource[] {
  const component = doc.components[componentId];
  if (!component) return [];
  const out: FieldSource[] = [];
  for (const id of layerIds) {
    const layer = findLayer(component.layers, id)?.layer;
    const props = layer ? resolveLayerProps(doc, componentId, layer, registry) : undefined;
    if (layer && props) out.push({ id, kind: "layer", ports: props, values: layer.props });
  }
  return out;
}

/** Sources for patches in a component (unknown patches and types are skipped). */
export function patchSources(doc: SonobeDocument, componentId: Id, patchIds: readonly Id[], registry: Registry): FieldSource[] {
  const component = doc.components[componentId];
  if (!component) return [];
  const out: FieldSource[] = [];
  for (const id of patchIds) {
    const node = component.patches[id];
    const ports = node ? resolveNodePorts(doc, node, registry) : undefined;
    if (node && ports) out.push({ id, kind: "patch", ports: ports.inputs, values: node.inputs });
  }
  return out;
}

/** Layer sections in inspector order. */
export const LAYER_SECTION_ORDER: readonly PropCategory[] = ["basics", "content", "text", "fill", "stroke", "shadow", "layout", "transform", "filters", "interaction"];

export const SECTION_TITLES: Readonly<Record<PropCategory, string>> = {
  basics: "Basics",
  content: "Content",
  text: "Text",
  fill: "Fill",
  stroke: "Stroke",
  shadow: "Shadow",
  layout: "Layout",
  transform: "Transform",
  filters: "Filters and Blending",
  interaction: "Interaction",
};

/** Group layer fields by category; a component instance's published inputs come first. */
export function layerSections(fields: readonly InspectorField[]): InspectorSection[] {
  const sections: InspectorSection[] = [];
  const published = fields.filter((f) => f.port.fromInterface);
  if (published.length) sections.push({ id: "component", title: "Component Inputs", fields: published });
  for (const category of LAYER_SECTION_ORDER) {
    const list = fields.filter((f) => !f.port.fromInterface && (f.port.category ?? "basics") === category);
    if (list.length) sections.push({ id: category, title: SECTION_TITLES[category], fields: list });
  }
  return sections;
}

/** Fields shown before "More": everything that isn't advanced, plus advanced fields someone has set. */
export function splitAdvanced(fields: readonly InspectorField[]): { primary: InspectorField[]; more: InspectorField[] } {
  const primary: InspectorField[] = [];
  const more: InspectorField[] = [];
  for (const field of fields) (field.advanced && !field.isSet ? more : primary).push(field);
  return { primary, more };
}

/** The stored value at "@layer.key" or "patch.key". */
export function readStoredInput(component: Component, address: string): InputValue | undefined {
  const parsed = parseAddress(address);
  if (parsed?.kind === "layer") return findLayer(component.layers, parsed.id)?.layer.props[parsed.key];
  if (parsed?.kind === "patch") return component.patches[parsed.id]?.inputs[parsed.key];
  return undefined;
}

/** A new value for every target, or a function of each target's current literal. null resets to the default. */
export type FieldUpdate = InputValue | ((current: InputValue, index: number) => InputValue);

/**
 * setInput ops for an edit, read against the component as it is now (so relative edits during a
 * scrub stay accurate). Targets that wouldn't change are skipped.
 */
export function planFieldSet(component: Component, field: Pick<InspectorField, "targets">, update: FieldUpdate): Op[] {
  const ops: Op[] = [];
  field.targets.forEach((target, index) => {
    const stored = readStoredInput(component, target.address);
    const current = stored !== undefined && !isLinkInput(stored) ? stored : target.fallback;
    const next = typeof update === "function" ? update(current, index) : update;
    if (next === null ? stored === undefined : stored !== undefined ? sameInputValue(stored, next) : sameInputValue(next, target.fallback)) return;
    ops.push({ op: "setInput", component: component.id, target: target.address, value: next });
  });
  return ops;
}

/** Reset every target that stores a value or link. */
export function planFieldReset(component: Component, field: Pick<InspectorField, "targets">): Op[] {
  return field.targets.filter((t) => readStoredInput(component, t.address) !== undefined).map((t): Op => ({ op: "setInput", component: component.id, target: t.address, value: null }));
}

/** Disconnect every linked target. */
export function planFieldDisconnect(component: Component, field: Pick<InspectorField, "targets">): Op[] {
  return field.targets.filter((t) => isLinkInput(readStoredInput(component, t.address))).map((t): Op => ({ op: "disconnect", component: component.id, to: t.address }));
}

/** Add `delta` to numeric literals (a mixed selection scrubs relatively). */
export function offsetNumber(delta: number): FieldUpdate {
  return (current) => (typeof current === "number" ? roundNumber(current + delta) : current);
}

/** Change one component of each target's vector: absolutely to `value`, or relatively by `delta`. */
export function updateVectorComponent(index: number, value: number, delta: number, relative: boolean): FieldUpdate {
  return (current) => {
    if (!Array.isArray(current)) return current;
    const next = [...current];
    next[index] = relative ? roundNumber((next[index] ?? 0) + delta) : value;
    return next;
  };
}

/** "Event Card", or "3 layers". */
export function subjectLabel(names: readonly string[], noun: "layer" | "patch"): string {
  if (names.length === 1) return names[0]!;
  return `${names.length} ${noun === "layer" ? "layers" : "patches"}`;
}

/** Undo label for an edit: "Set Opacity on Event Card". */
export function editLabel(field: Pick<InspectorField, "port">, subject: string, verb = "Set"): string {
  return `${verb} ${field.port.name}${subject ? ` on ${subject}` : ""}`;
}

const trimNumber = (n: number) => String(roundNumber(n, 3));

/**
 * A runtime value in plain language, for read-only readouts of linked properties and outputs. With
 * a watched `copy`, a loop shows that item ("#3 of 12 · 0.5", wrapping like a shorter loop does).
 */
export function formatLiveValue(value: unknown, type: ValueType, copy: number | null = null): string {
  if (value === undefined) return "—";
  if (value && typeof value === "object" && (value as { __loop?: unknown }).__loop === true) {
    const items = (value as { items: readonly unknown[] }).items;
    if (copy !== null && items.length) return `#${copy % items.length} of ${items.length} · ${formatLiveValue(items[copy % items.length], type)}`;
    return `×${items.length}${items.length ? ` · ${formatLiveValue(items[0], type)}` : ""}`;
  }
  if (type === "pulse") return value === true ? "Fired" : "—";
  if (typeof value === "number") return trimNumber(value);
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "string") return value.length > 48 ? `${value.slice(0, 47)}…` : value;
  if (value === null) return "None";
  if (isColor(value)) return formatColor(value);
  if (Array.isArray(value) && value.every((n) => typeof n === "number")) return value.map(trimNumber).join(", ");
  if (typeof value === "object" && typeof (value as { layerId?: unknown }).layerId === "string") return `@${(value as { layerId: string }).layerId}`;
  if (typeof value === "object" && typeof (value as { assetId?: unknown }).assetId === "string") return (value as { assetId: string }).assetId;
  try {
    const text = JSON.stringify(value) ?? "";
    return text.length > 48 ? `${text.slice(0, 47)}…` : text;
  } catch {
    return "—";
  }
}

/** A layer's live copy count, as the Repeat row shows it while a loop drives it: "4 copies". */
export function formatCopies(value: unknown): string {
  return typeof value === "number" ? `${trimNumber(value)} ${value === 1 ? "copy" : "copies"}` : formatLiveValue(value, "any");
}

/** The item id a link reads from ("grow" for "grow.output", "card" for "@card.size"). */
export function linkSourceItem(link: string): { kind: "patch" | "layer" | "componentInput"; id?: Id; key: string } | undefined {
  const parsed = parseAddress(link);
  if (!parsed) return undefined;
  if (parsed.kind === "patch" || parsed.kind === "layer") return { kind: parsed.kind, id: parsed.id, key: parsed.key };
  if (parsed.kind === "componentInput") return { kind: "componentInput", key: parsed.key };
  return undefined;
}
