/**
 * Node shapes: what a patch editor node shows, as text and chips, so its size can be worked out
 * without a DOM (nodeSize.ts). Built from the same view model the patch editor renders (deriveGraph),
 * following its node views: header chips, then one row per input/output pair with the inline value
 * of an unconnected input and the live value of an output.
 */

import { allLayers } from "../registry.ts";
import { VARIABLE_RECEIVER_TYPE } from "../graph.ts";
import type { Diagnostic, Id, Registry, SonobeDocument, Value } from "../types.ts";
import { decodeInput, defaultValue, isColor, isDecodedLoop, typeLabel } from "../values.ts";
import { deriveGraph } from "./deriveGraph.ts";
import { formatNumberShort, formatValue, formatValueReserve, isLoopValue, loopBadgeReserve, shortHex, type FormatOptions } from "./format.ts";
import type { GraphNodeData, InterfaceNodeData, LayerNodeData, PatchNodeData, PortModel } from "./types.ts";

/** An input's inline value, as the patch editor draws it. */
export type ValueChip =
  | { kind: "number"; text: string }
  | { kind: "vector"; texts: readonly string[] }
  /** A checkbox: checked or not, and whether that's the port's default (the editor tones a default check down). */
  | { kind: "check"; on: boolean; isDefault: boolean }
  | { kind: "menu"; text: string }
  | { kind: "color"; hex: string }
  | { kind: "text"; text: string }
  | { kind: "static"; text: string }
  /**
   * An input linked to a knob: the knob's name, and its value when known (a color knob's as a
   * "#RRGGBBAA" swatch), in a slot `reserve` characters wide at least (knobValueReserve, less where
   * the name needs the room), so tuning it keeps the width.
   */
  | { kind: "knob"; name: string; text?: string; swatch?: string; reserve?: number };

/**
 * Header items after the title: text chips (variant, Muted, layer type), the loop count (at least as
 * wide as its `reserve`, loopBadgeReserve), badges, presence, the enter icon.
 */
export type HeaderChip = { kind: "chip"; text: string } | { kind: "loop"; text: string; reserve?: string } | { kind: "badge" } | { kind: "working"; text: string } | { kind: "enter" };

export interface NodeRowShape {
  in?: { label: string; value?: ValueChip; drive?: boolean };
  /** An output: its live value, in a slot `reserve` characters wide (liveReserve) that shows before a value arrives, and which a longer value ends early in. */
  out?: { label: string; live?: string; reserve?: number };
}

export interface NodeShape {
  kind: "patch" | "layer" | "interface";
  title: string;
  collapsed?: boolean;
  chips: readonly HeaderChip[];
  rows: readonly NodeRowShape[];
}

export interface NodeShapeOptions {
  /**
   * Live values by address (a running prototype, or a headless runtime stepped for a second):
   * output rows print them and loop badges count them. Without it, outputs show no live value.
   */
  live?: (address: string) => unknown;
  /** Layer id → name, for inline layer references. */
  layerName?: (id: Id) => string | undefined;
}

const AXES: Record<string, number> = { point: 2, size: 2, anchor: 2, point3d: 3, point4d: 4 };

/** CSS `text-transform: capitalize`. */
const capitalize = (text: string) => text.replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => space + letter.toUpperCase());

/** The variant chip's text, as the patch editor labels it. */
export function variantLabel(typeParam: string): string {
  return typeLabel(typeParam as never)
    .replace(/ \[.*\]$/, "")
    .replace(/^on\/off \(boolean\)$/, "boolean");
}

function currentValue(port: PortModel): Value {
  if (port.literal !== undefined) {
    const decoded = decodeInput(port.literal, port.type);
    if (decoded !== undefined && !isDecodedLoop(decoded)) return decoded;
  }
  return port.defaultValue ?? defaultValue(port.type);
}

/** The inline editor of an unconnected input (InlineValue), or undefined when it shows none. */
export function valueChip(port: PortModel, layerName?: (id: Id) => string | undefined): ValueChip | undefined {
  const decoded = port.literal !== undefined ? decodeInput(port.literal, port.type) : undefined;
  if (isDecodedLoop(decoded)) return { kind: "static", text: `×${decoded.items.length}` };
  const v = currentValue(port);
  switch (port.type) {
    case "number":
    case "index":
      return { kind: "number", text: formatNumberShort(Number(v) || 0) };
    case "boolean":
      return { kind: "check", on: v === true, isDefault: port.literal === undefined };
    case "enum": {
      const key = String(v ?? "");
      const name = port.enumOptions?.find((o) => o.key === key)?.name ?? key;
      return { kind: "menu", text: name || "—" };
    }
    case "color":
      return { kind: "color", hex: shortHex(isColor(v) ? v : { r: 0, g: 0, b: 0, a: 1 }).slice(1) };
    case "text":
      return { kind: "text", text: String(v ?? "") };
    case "point":
    case "size":
    case "anchor":
    case "point3d":
    case "point4d": {
      const values = Array.isArray(v) ? (v as number[]) : [];
      return { kind: "vector", texts: Array.from({ length: AXES[port.type]! }, (_, i) => formatNumberShort(values[i] ?? 0)) };
    }
    case "layer": {
      const layerId = v && typeof v === "object" ? (v as { layerId?: string }).layerId : undefined;
      return { kind: "menu", text: (layerId && layerName?.(layerId)) ?? (layerId ? "Missing layer" : "None") };
    }
    case "pulse":
      return undefined;
    default: {
      const text = formatValue(v, port.type, { maxText: 10 });
      return text === "—" ? undefined : { kind: "static", text };
    }
  }
}

/** A knob chip: the name, then a color knob's swatch or another knob's value text. */
function knobValueChip(knob: NonNullable<PortModel["knob"]>): ValueChip {
  if (knob.color) return { kind: "knob", name: knob.name, swatch: knob.color };
  if (!knob.valueText) return { kind: "knob", name: knob.name };
  return { kind: "knob", name: knob.name, text: knob.valueText, ...(knob.valueReserve ? { reserve: knob.valueReserve } : {}) };
}

type LivePort = Pick<PortModel, "type" | "enumOptions" | "subtype" | "loop">;

/** Characters of text a live value prints inside its quotes (“Hello wo…”); names and ids print 10. */
const LIVE_TEXT_CHARS = 8;

const liveFormat = (port: LivePort, copy: number | null): FormatOptions => ({ maxText: port.type === "text" ? LIVE_TEXT_CHARS : 10, copy, ...(port.enumOptions ? { enumOptions: port.enumOptions } : {}) });

/** What an output row prints as its live value, for the watched loop copy when there is one (empty for pulses and missing values). */
export function liveText(port: LivePort, value: unknown, copy: number | null = null): string {
  if (value === undefined || port.type === "pulse") return "";
  return formatValue(value, port.type, liveFormat(port, copy));
}

/**
 * The characters an output row keeps for its live value, whatever the value is on this frame, before
 * the first one arrives, and whichever loop copy is watched (formatValueReserve: 8 for a number, 6
 * for a progress, 9 for a color, …), so the node doesn't grow and shrink while the prototype runs
 * and mounts at the width it keeps. The patch editor sets it as the slot's width in `ch`, where a
 * longer value ends in "…"; 0 for a pulse, and for a json or any port until its value arrives.
 */
export function liveReserve(port: LivePort, value: unknown): number {
  if (port.type === "pulse") return 0;
  return formatValueReserve(value, port.type, { ...liveFormat(port, null), ...(port.subtype ? { subtype: port.subtype } : {}), ...(port.loop ? { loop: true } : {}) });
}

function headerChips(data: PatchNodeData | LayerNodeData | InterfaceNodeData, live: NodeShapeOptions["live"]): HeaderChip[] {
  const chips: HeaderChip[] = [];
  if (data.kind === "patch") {
    if (data.variants && data.typeParam && data.typeParam !== data.variants[0]) chips.push({ kind: "chip", text: capitalize(variantLabel(data.typeParam)) });
    if (data.looped || data.outputs.some((o) => o.wholeLoop)) {
      const loopOutput = data.outputs.find((o) => o.loop);
      const value = loopOutput && live ? live(loopOutput.address) : undefined;
      const length = isLoopValue(value) ? value.items.length : data.loopLength;
      // The patch editor runs the prototype, so a count is on its way: size its room from the start
      // (a canvas with nothing running draws a bare "×" in less).
      chips.push({ kind: "loop", text: `×${length ?? ""}`, reserve: loopBadgeReserve(length ?? 0) });
    }
    if (data.muted) chips.push({ kind: "chip", text: "Muted" });
    if (data.issues.length) chips.push({ kind: "badge" });
    if (data.working.length) chips.push({ kind: "working", text: data.working[0]! });
    if (data.componentTarget) chips.push({ kind: "enter" });
    if (data.type === VARIABLE_RECEIVER_TYPE) chips.push({ kind: "badge" });
  } else if (data.kind === "layer") {
    chips.push({ kind: "chip", text: data.layerTypeName });
    if (data.issues.length) chips.push({ kind: "badge" });
  }
  return chips;
}

/** A node's shape from its view model data (deriveGraph). */
export function nodeShapeFromData(data: PatchNodeData | LayerNodeData | InterfaceNodeData, options: NodeShapeOptions = {}): NodeShape {
  const editable = data.kind === "patch";
  const rows: NodeRowShape[] = [];
  for (let i = 0; i < Math.max(data.inputs.length, data.outputs.length); i++) {
    const input = data.inputs[i];
    const output = data.outputs[i];
    const row: NodeRowShape = {};
    if (input) {
      const value: ValueChip | undefined = input.knob ? knobValueChip(input.knob) : !input.connected && editable ? valueChip(input, options.layerName) : undefined;
      row.in = { label: input.name, ...(value ? { value } : {}), ...(data.kind === "layer" && !input.connected ? { drive: true } : {}) };
    }
    if (output) {
      const value = options.live?.(output.address);
      const text = liveText(output, value);
      // Component Inputs never shows live values, so its outputs keep no slot.
      const reserve = data.kind === "interface" ? 0 : liveReserve(output, value);
      row.out = { label: output.name, ...(text ? { live: text } : {}), ...(reserve ? { reserve } : {}) };
    }
    rows.push(row);
  }
  return { kind: data.kind, title: data.title, ...(data.kind === "patch" && data.collapsed ? { collapsed: true } : {}), chips: headerChips(data, options.live), rows };
}

export interface ComponentShapesOptions extends Pick<NodeShapeOptions, "live"> {
  /** Document diagnostics, for issue badges. */
  diagnostics?: readonly Diagnostic[];
}

/** Every node of a component's graph (patches, "@layer" targets, "$in"/"$out") → its shape. Comments aren't included. */
export function componentNodeShapes(doc: SonobeDocument, registry: Registry, componentId: Id, options: ComponentShapesOptions = {}): Map<string, NodeShape> {
  const model = deriveGraph({ doc, componentId, registry, ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}) });
  const layers = new Map(allLayers(doc.components[componentId]?.layers ?? []).map((l) => [l.id, l.name]));
  const shapes = new Map<string, NodeShape>();
  for (const node of model.nodes) {
    const data: GraphNodeData = node.data;
    if (data.kind === "comment") continue;
    shapes.set(node.id, nodeShapeFromData(data, { ...(options.live ? { live: options.live } : {}), layerName: (id) => layers.get(id) }));
  }
  return shapes;
}
