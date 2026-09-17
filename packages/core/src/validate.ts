/**
 * Validation shared by ops and diagnostics: resolving port addresses, checking links
 * (existence, self-edges, type compatibility) and literals against declared ports,
 * and building ready-to-apply converter suggestions.
 */

import { formatAddress, parseAddress, type ParsedAddress } from "./address.ts";
import { isValidId } from "./ids.ts";
import {
  allLayerIds,
  findLayer,
  findPort,
  getPatchSpec,
  interfacePortToPort,
  resolveLayerOutputs,
  resolveLayerProps,
  resolveNodePorts,
  type ResolvedPort,
} from "./registry.ts";
import { didYouMean, didYouMeanText } from "./suggest.ts";
import type { Component, GradientLiteral, Id, InputValue, LinkInput, Literal, PatchNode, Registry, SonobeDocument, SonobeError, Suggestion, ValueType } from "./types.ts";
import {
  CONVERTER_CANDIDATES,
  canConnect,
  isAssetInput,
  isColor,
  isGradientLiteral,
  isInputValue,
  isJsonLiteral,
  isLayerInput,
  isLinkInput,
  isLiteral,
  isLoopLiteral,
  normalizeColor,
  typeLabel,
  vectorSize,
  type ConnectCheck,
} from "./values.ts";

export type Check<T> = { ok: true; value: T } | { ok: false; error: SonobeError };

export interface ValidateOptions {
  registry: Registry;
  /** Skip registry checks (unknown types/ports, type mismatches, literal shapes). */
  lenient?: boolean;
}

/** Where a value is written: a patch input, a layer prop, or a published output. */
export interface PortTarget {
  kind: "patch" | "layer" | "componentOutput";
  /** Canonical address string. */
  address: string;
  itemId?: Id;
  key: string;
  /** Declaration; undefined only in lenient mode for unknown types/ports. */
  port: ResolvedPort | undefined;
  /** False for layer props declared `bindable: false`. */
  bindable: boolean;
}

/** Where a link reads from: a patch output, a layer output/prop, or a published input. */
export interface SourcePort {
  kind: ParsedAddress["kind"];
  address: string;
  itemId?: Id;
  key: string;
  port: ResolvedPort | undefined;
}

const ok = <T>(value: T): Check<T> => ({ ok: true, value });

export function makeError(code: string, message: string, extra: Partial<Omit<SonobeError, "code" | "message">> = {}): SonobeError {
  const error: SonobeError = { code, message };
  if (extra.hint !== undefined) error.hint = extra.hint;
  if (extra.opIndex !== undefined) error.opIndex = extra.opIndex;
  if (extra.address !== undefined) error.address = extra.address;
  if (extra.suggestions?.length) error.suggestions = extra.suggestions;
  return error;
}

const fail = (code: string, message: string, extra: Partial<Omit<SonobeError, "code" | "message">> = {}): { ok: false; error: SonobeError } => ({
  ok: false,
  error: makeError(code, message, extra),
});

const ADDRESS_HINT = 'Addresses look like "patchId.port", "@layerId.prop", "$in.key" (a published input) or "$out.key" (a published output).';

const listKeys = (ports: readonly { key: string }[], max = 12) => {
  const keys = ports.map((p) => p.key);
  return keys.length ? keys.slice(0, max).join(", ") + (keys.length > max ? ", …" : "") : "(none)";
};

const portCandidates = (ports: readonly ResolvedPort[]) => ports.map((p) => ({ value: p.key, aliases: [p.name] }));

function describePatch(registry: Registry, id: Id, node: PatchNode): string {
  const spec = getPatchSpec(registry, node.type);
  return `The ${spec?.name ?? node.type} patch "${id}"`;
}

function patchNotFound(component: Component, id: Id, key: string, address: string): { ok: false; error: SonobeError } {
  const isLayer = !!findLayer(component.layers, id);
  const ids = Object.keys(component.patches);
  return fail("not_found", `There's no patch "${id}" in ${component.id}.${didYouMeanText(didYouMean(id, ids))}`, {
    address,
    hint: isLayer ? `"${id}" is a layer. Address its properties as "@${id}.${key}".` : ids.length ? `Patches here: ${ids.slice(0, 12).join(", ")}.` : "This component has no patches yet.",
  });
}

function layerNotFound(component: Component, id: Id, key: string, address: string): { ok: false; error: SonobeError } {
  const isPatch = id in component.patches;
  const ids = allLayerIds(component.layers);
  return fail("not_found", `There's no layer "${id}" in ${component.id}.${didYouMeanText(didYouMean(id, ids))}`, {
    address,
    hint: isPatch ? `"${id}" is a patch. Address patch ports without "@": "${id}.${key}".` : ids.length ? `Layers here: ${ids.slice(0, 12).join(", ")}.` : "This component has no layers yet.",
  });
}

function parseForOps(address: string): Check<ParsedAddress> {
  const parsed = parseAddress(address);
  if (!parsed) return fail("invalid_address", `"${address}" isn't a valid port address.`, { address, hint: ADDRESS_HINT });
  if (parsed.index !== undefined) {
    const { index: _index, ...rest } = parsed;
    return fail("invalid_address", `"${address}" names a loop index; documents connect whole ports.`, { address, hint: `Use "${formatAddress(rest as ParsedAddress)}".` });
  }
  return ok(parsed);
}

/** Resolve an address that a value is written to (setInput / connect "to"). */
export function resolveTarget(doc: SonobeDocument, component: Component, address: string, opts: ValidateOptions): Check<PortTarget> {
  const parsedCheck = parseForOps(address);
  if (!parsedCheck.ok) return parsedCheck;
  const parsed = parsedCheck.value;
  const canonical = formatAddress(parsed);
  switch (parsed.kind) {
    case "patch": {
      const node = component.patches[parsed.id];
      if (!node) return patchNotFound(component, parsed.id, parsed.key, address);
      const base = { kind: "patch" as const, address: canonical, itemId: parsed.id, key: parsed.key, bindable: true };
      const ports = resolveNodePorts(doc, node, opts.registry);
      if (!ports) {
        if (opts.lenient) return ok({ ...base, port: undefined });
        return fail("unknown_patch_type", `Patch "${parsed.id}" has an unknown type "${node.type}", so its inputs can't be checked.`, { address });
      }
      const port = findPort(ports.inputs, parsed.key);
      if (!port) {
        if (opts.lenient) return ok({ ...base, port: undefined });
        const isOutput = !!findPort(ports.outputs, parsed.key);
        return fail("unknown_port", `${describePatch(opts.registry, parsed.id, node)} has no input "${parsed.key}".${didYouMeanText(didYouMean(parsed.key, portCandidates(ports.inputs)))}`, {
          address,
          hint: isOutput ? `"${parsed.key}" is an output. Connections go from an output ("from") into an input ("to").` : `Its inputs: ${listKeys(ports.inputs)}.`,
        });
      }
      return ok({ ...base, port });
    }
    case "layer": {
      const loc = findLayer(component.layers, parsed.id);
      if (!loc) return layerNotFound(component, parsed.id, parsed.key, address);
      const base = { kind: "layer" as const, address: canonical, itemId: parsed.id, key: parsed.key };
      const props = resolveLayerProps(doc, component.id, loc.layer, opts.registry);
      if (!props) {
        if (opts.lenient) return ok({ ...base, port: undefined, bindable: true });
        return fail("unknown_layer_type", `Layer "${parsed.id}" has an unknown type "${loc.layer.type}", so its properties can't be checked.`, { address });
      }
      const prop = findPort(props, parsed.key);
      if (!prop) {
        if (opts.lenient) return ok({ ...base, port: undefined, bindable: true });
        const outputs = resolveLayerOutputs(doc, component.id, loc.layer, opts.registry);
        const isOutput = !!findPort(outputs, parsed.key);
        return fail("unknown_prop", `Layer "${parsed.id}" (${loc.layer.type}) has no property "${parsed.key}".${didYouMeanText(didYouMean(parsed.key, portCandidates(props)))}`, {
          address,
          hint: isOutput ? `"${parsed.key}" is a read-only output of the layer; read it with a link instead.` : `Its properties include: ${listKeys(props.filter((p) => !p.advanced))}.`,
        });
      }
      return ok({ ...base, port: prop, bindable: prop.bindable !== false });
    }
    case "componentOutput": {
      const port = component.interface.outputs[parsed.key];
      const keys = Object.keys(component.interface.outputs);
      if (!port) {
        return fail("not_found", `${component.id} has no published output "${parsed.key}".${didYouMeanText(didYouMean(parsed.key, keys))}`, {
          address,
          hint: "Publish an output first with updateInterface, then connect a patch output to it.",
        });
      }
      return ok({ kind: "componentOutput", address: canonical, key: parsed.key, port: interfacePortToPort(port, "output"), bindable: true });
    }
    case "componentInput":
      return fail("invalid_address", `"${address}" is a published input. It can only be read from ("from"), not written to.`, {
        address,
        hint: "To change its default value, use updateInterface.",
      });
  }
}

/** Resolve an address a link reads from (connect "from" / link strings). */
export function resolveSource(doc: SonobeDocument, component: Component, address: string, opts: ValidateOptions): Check<SourcePort> {
  const parsedCheck = parseForOps(address);
  if (!parsedCheck.ok) return parsedCheck;
  const parsed = parsedCheck.value;
  const canonical = formatAddress(parsed);
  switch (parsed.kind) {
    case "patch": {
      const node = component.patches[parsed.id];
      if (!node) return patchNotFound(component, parsed.id, parsed.key, address);
      const base = { kind: "patch" as const, address: canonical, itemId: parsed.id, key: parsed.key };
      const ports = resolveNodePorts(doc, node, opts.registry);
      if (!ports) {
        if (opts.lenient) return ok({ ...base, port: undefined });
        return fail("unknown_patch_type", `Patch "${parsed.id}" has an unknown type "${node.type}", so its outputs can't be checked.`, { address });
      }
      const port = findPort(ports.outputs, parsed.key);
      if (!port) {
        if (opts.lenient) return ok({ ...base, port: undefined });
        const isInput = !!findPort(ports.inputs, parsed.key);
        return fail("unknown_port", `${describePatch(opts.registry, parsed.id, node)} has no output "${parsed.key}".${didYouMeanText(didYouMean(parsed.key, portCandidates(ports.outputs)))}`, {
          address,
          hint: isInput ? `"${parsed.key}" is an input. Connections go from an output ("from") into an input ("to").` : `Its outputs: ${listKeys(ports.outputs)}.`,
        });
      }
      return ok({ ...base, port });
    }
    case "layer": {
      const loc = findLayer(component.layers, parsed.id);
      if (!loc) return layerNotFound(component, parsed.id, parsed.key, address);
      const base = { kind: "layer" as const, address: canonical, itemId: parsed.id, key: parsed.key };
      const props = resolveLayerProps(doc, component.id, loc.layer, opts.registry);
      if (!props) {
        if (opts.lenient) return ok({ ...base, port: undefined });
        return fail("unknown_layer_type", `Layer "${parsed.id}" has an unknown type "${loc.layer.type}".`, { address });
      }
      const outputs = resolveLayerOutputs(doc, component.id, loc.layer, opts.registry);
      const port = findPort(outputs, parsed.key) ?? findPort(props, parsed.key);
      if (!port) {
        if (opts.lenient) return ok({ ...base, port: undefined });
        return fail("unknown_port", `Layer "${parsed.id}" (${loc.layer.type}) has no output or property "${parsed.key}".${didYouMeanText(didYouMean(parsed.key, portCandidates([...outputs, ...props])))}`, {
          address,
          hint: outputs.length ? `Its outputs: ${listKeys(outputs)}.` : undefined,
        });
      }
      return ok({ ...base, port });
    }
    case "componentInput": {
      const port = component.interface.inputs[parsed.key];
      if (!port) {
        return fail("not_found", `${component.id} has no published input "${parsed.key}".${didYouMeanText(didYouMean(parsed.key, Object.keys(component.interface.inputs)))}`, {
          address,
          hint: "Publish an input first with updateInterface.",
        });
      }
      return ok({ kind: "componentInput", address: canonical, key: parsed.key, port: interfacePortToPort(port, "input") });
    }
    case "componentOutput":
      return fail("invalid_address", `"${address}" is a published output. It can only be written to ("to"), not read from.`, { address });
  }
}

function pickPort(ports: readonly ResolvedPort[], test: (p: ResolvedPort) => ConnectCheck, exactType: ValueType): ResolvedPort | undefined {
  return ports.find((p) => p.type === exactType) ?? ports.find((p) => test(p).ok && !test(p).conversion) ?? ports.find((p) => test(p).ok);
}

/**
 * A suggestion that inserts `patchType` between `from` and `to`, with ready ops.
 * Undefined when the type isn't registered or has no compatible ports.
 */
export function insertPatchSuggestion(
  doc: SonobeDocument,
  registry: Registry,
  componentId: Id,
  patchType: string,
  description: string,
  from: { address: string; type: ValueType },
  to: { address: string; type: ValueType },
): Suggestion | undefined {
  const spec = getPatchSpec(registry, patchType);
  if (!spec) return undefined;
  const variants = spec.variants ?? [];
  const typeParam = variants.length ? ([to.type, from.type].find((t) => variants.includes(t)) ?? variants[0]) : undefined;
  const node: PatchNode = { type: patchType, inputs: {}, ui: { x: 0, y: 0 } };
  if (typeParam) node.typeParam = typeParam;
  const ports = resolveNodePorts(doc, node, registry);
  if (!ports) return undefined;
  const input = pickPort(ports.inputs, (p) => canConnect(from.type, p.type), from.type);
  const output = pickPort(ports.outputs, (p) => canConnect(p.type, to.type), to.type);
  if (!input || !output || !canConnect(from.type, input.type).ok || !canConnect(output.type, to.type).ok) return undefined;
  const ref = patchType;
  return {
    description,
    ops: [
      { op: "addPatch", component: componentId, patch: typeParam ? { ref, type: patchType, typeParam } : { ref, type: patchType } },
      { op: "connect", component: componentId, from: from.address, to: `$${ref}.${input.key}` },
      { op: "connect", component: componentId, from: `$${ref}.${output.key}`, to: to.address },
    ],
  };
}

/** Converter patches that make an invalid connection work (only registered types, best first). */
export function converterSuggestions(
  doc: SonobeDocument,
  registry: Registry,
  componentId: Id,
  from: { address: string; type: ValueType },
  to: { address: string; type: ValueType },
): Suggestion[] {
  if (from.type === "layer" || to.type === "layer") return [];
  const out: Suggestion[] = [];
  const tried = new Set<string>();
  for (const c of CONVERTER_CANDIDATES) {
    if (!(c.from === "*" || c.from.includes(from.type)) || !(c.to === "*" || c.to.includes(to.type))) continue;
    for (const t of c.patchTypes) {
      if (tried.has(t)) continue;
      tried.add(t);
      const s = insertPatchSuggestion(doc, registry, componentId, t, c.description, from, to);
      if (s) {
        out.push(s);
        break;
      }
    }
    if (out.length >= 2) break;
  }
  return out;
}

/** Check a link string written into `target`; returns the canonical link. */
export function checkLink(doc: SonobeDocument, component: Component, link: string, target: PortTarget, opts: ValidateOptions): Check<LinkInput> {
  const srcCheck = resolveSource(doc, component, link, opts);
  if (!srcCheck.ok) return srcCheck;
  const src = srcCheck.value;
  if (target.kind === "layer" && !target.bindable) {
    return fail("not_bindable", `${target.address} can't be connected; it only takes a set value.`, { address: target.address, hint: "Use setInput with a literal value instead." });
  }
  const selfPatch = src.kind === "patch" && target.kind === "patch" && src.itemId === target.itemId;
  const selfLayer = src.kind === "layer" && target.kind === "layer" && src.itemId === target.itemId && src.key === target.key;
  if (selfPatch || selfLayer) {
    const suggestions: Suggestion[] = [];
    const delayName = getPatchSpec(opts.registry, "delay1")?.name ?? "Delay One Frame";
    if (selfPatch && src.port && target.port) {
      const s = insertPatchSuggestion(doc, opts.registry, component.id, "delay1", `Insert a ${delayName} patch so the feedback reads the previous frame.`, { address: src.address, type: src.port.type }, { address: target.address, type: target.port.type });
      if (s) suggestions.push(s);
    }
    return fail("self_edge", `"${src.itemId}" can't feed its own ${selfPatch ? "input" : "property"} directly (${src.address} → ${target.address}).`, {
      address: target.address,
      hint: `Feedback needs one frame of delay: put a ${delayName} patch between the output and the input.`,
      suggestions,
    });
  }
  if (!opts.lenient && src.port && target.port) {
    const check = canConnect(src.port.type, target.port.type);
    if (!check.ok) {
      const suggestions = converterSuggestions(doc, opts.registry, component.id, { address: src.address, type: src.port.type }, { address: target.address, type: target.port.type });
      return fail("type_mismatch", `Can't connect ${src.address} (${typeLabel(src.port.type)}) to ${target.address} (${typeLabel(target.port.type)}). ${check.reason ?? ""}`.trim(), {
        address: target.address,
        hint: suggestions.length ? `Try: ${suggestions[0]!.description}` : "Connect an output whose type matches, or convert the value with a patch in between.",
        suggestions,
      });
    }
  }
  return ok({ link: src.address });
}

function preview(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (typeof value === "string") return `text ${JSON.stringify(value.length > 40 ? value.slice(0, 40) + "…" : value)}`;
  if (typeof value === "number") return `the number ${value}`;
  if (typeof value === "boolean") return `${value}`;
  if (Array.isArray(value)) return `a list of ${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") {
    const keys = Object.keys(value);
    return keys.length ? `an object with ${keys.map((k) => `"${k}"`).join(", ")}` : "an empty object";
  }
  return String(value);
}

const INPUT_VALUE_HINT = 'Values are numbers, true/false, text, number lists like [x, y], null, or { "link" }, { "layer" }, { "asset" }, { "loop" }, { "json" }, { "gradient" }.';

const JSON_TYPES: ReadonlySet<ValueType> = new Set(["json", "any", "textStyle", "layerEffect", "shape", "gradient"]);
const ASSET_TYPES: ReadonlySet<ValueType> = new Set(["image", "video", "sound", "json", "any"]);

function vectorExample(n: number): string {
  return `[${["x", "y", "z", "w"].slice(0, n).join(", ")}]`;
}

/** Check a single literal (not a wrapper) against a declared port. */
export function checkScalarLiteral(lit: Literal, port: ResolvedPort, address: string): Check<Literal> {
  if (lit === null) return ok(null);
  const label = `${address} (${port.name})`;
  const mismatch = (need: string, hint?: string) => fail("invalid_value", `${label} needs ${need}, but got ${preview(lit)}.`, { address, hint });
  switch (port.type) {
    case "any":
      return ok(lit);
    case "number":
      if (typeof lit === "number") return ok(lit);
      if (typeof lit === "string" && lit.trim() !== "" && Number.isFinite(Number(lit))) return mismatch("a number", `Write the number without quotes: ${Number(lit)}.`);
      return mismatch("a number");
    case "index":
      if (typeof lit === "number" && Number.isInteger(lit) && lit >= 0) return ok(lit);
      return mismatch("a whole number ≥ 0", "Indexes count from 0: 0, 1, 2, …");
    case "boolean":
      return typeof lit === "boolean" ? ok(lit) : mismatch("true or false");
    case "pulse":
      return fail("invalid_value", `${label} is a pulse input. Pulses have no stored value; they only fire for one frame.`, {
        address,
        hint: "Connect a pulse output to it instead, such as an Interaction patch's tap.",
      });
    case "text":
      return typeof lit === "string" ? ok(lit) : mismatch("text", typeof lit === "number" ? `Write it as text: "${lit}".` : undefined);
    case "enum": {
      if (typeof lit !== "string") return mismatch("one of its options");
      const options = port.enumOptions ?? [];
      if (!options.length || options.some((o) => o.key === lit)) return ok(lit);
      const byName = options.find((o) => o.name.toLowerCase() === lit.toLowerCase() || o.key.toLowerCase() === lit.toLowerCase());
      return fail("invalid_value", `${label} has no option "${lit}".${didYouMeanText(byName ? [byName.key] : didYouMean(lit, options.map((o) => ({ value: o.key, aliases: [o.name] }))))}`, {
        address,
        hint: `Options: ${options.map((o) => o.key).join(", ")}.`,
      });
    }
    case "color": {
      if (typeof lit === "string") {
        const normalized = normalizeColor(lit);
        if (normalized) return ok(normalized);
      }
      return mismatch("a color", 'Use hex text like "#FF3B30FF" (RRGGBBAA), "#FF3B30", or "rgba(255, 59, 48, 1)".');
    }
    case "point":
    case "size":
    case "anchor":
    case "point3d":
    case "point4d": {
      const n = vectorSize(port.type)!;
      if (Array.isArray(lit) && lit.length === n) return ok(lit);
      return mismatch(`${n} numbers like ${vectorExample(n)}`, typeof lit === "number" ? `Write it as ${JSON.stringify(new Array(n).fill(lit))}.` : undefined);
    }
    case "transform":
      return Array.isArray(lit) && lit.length === 16 ? ok(lit) : mismatch("16 numbers (a 4×4 matrix)");
    case "json":
      return ok(lit);
    case "layer":
      return mismatch("a layer", typeof lit === "string" ? `Write it as { "layer": "${lit}" }.` : 'Write it as { "layer": "layerId" }.');
    case "image":
    case "video":
    case "sound":
      return typeof lit === "string" ? ok(lit) : mismatch(`an ${port.type === "image" ? "image" : port.type} asset or URL`, 'Use { "asset": "assetId" } or a URL string.');
    case "shape":
      return typeof lit === "string" ? ok(lit) : mismatch("SVG path text", 'Write the path data as text, like "M0 0 L100 0".');
    case "gradient":
      return mismatch("a gradient", 'Use { "gradient": { "kind": "linear", "stops": [[0, "#FFFFFFFF"], [1, "#000000FF"]], "start": [0.5, 0], "end": [0.5, 1] } }.');
    case "textStyle":
    case "layerEffect":
      return mismatch(port.type === "textStyle" ? "a text style" : "a layer effect", 'Wrap objects as { "json": { … } }, or connect a patch output.');
    case "connection":
      return mismatch("a connection", "Connections have no stored value. Connect the output of a patch that opens one, such as WebSocket Connection.");
  }
}

function checkGradient(value: { gradient: Record<string, unknown> }, address: string): Check<InputValue> {
  const g = value.gradient;
  const bad = (why: string) => fail("invalid_value", `${address} has an invalid gradient: ${why}.`, {
    address,
    hint: 'Example: { "gradient": { "kind": "linear", "stops": [[0, "#FFFFFFFF"], [1, "#000000FF"]], "start": [0.5, 0], "end": [0.5, 1] } }.',
  });
  if (g.kind !== "linear" && g.kind !== "radial" && g.kind !== "angular") return bad('kind must be "linear", "radial" or "angular"');
  if (!Array.isArray(g.stops) || !g.stops.length) return bad("it needs at least one stop");
  const stops: [number, string][] = [];
  for (const stop of g.stops) {
    if (!Array.isArray(stop) || stop.length !== 2 || typeof stop[0] !== "number" || typeof stop[1] !== "string") return bad('each stop is [offset, "#RRGGBBAA"]');
    const color = normalizeColor(stop[1]);
    if (!color) return bad(`"${stop[1]}" isn't a color`);
    stops.push([stop[0], color]);
  }
  const vec = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  if (!vec(g.start) || !vec(g.end)) return bad("start and end are [x, y] in 0..1");
  const extra = Object.keys(g).filter((k) => !["kind", "stops", "start", "end", "ratio"].includes(k));
  if (extra.length) return bad(`unknown field ${extra.map((k) => `"${k}"`).join(", ")}`);
  if (g.ratio !== undefined && !(typeof g.ratio === "number" && Number.isFinite(g.ratio) && g.ratio > 0)) return bad("ratio is a number above 0 (2 makes a radial gradient twice as wide as tall)");
  const normalized: GradientLiteral["gradient"] = { kind: g.kind, stops, start: g.start as [number, number], end: g.end as [number, number] };
  if (typeof g.ratio === "number") normalized.ratio = g.ratio;
  return ok({ gradient: normalized });
}

/** Check a non-link input value against a declared port; returns a normalized value. */
export function checkLiteral(doc: SonobeDocument, component: Component, value: unknown, port: ResolvedPort | undefined, address: string, opts: ValidateOptions): Check<InputValue> {
  if (!isInputValue(value)) return fail("invalid_value", `${address} got a value that can't be stored: ${preview(value)}.`, { address, hint: INPUT_VALUE_HINT });
  if (isLinkInput(value)) return checkLink(doc, component, value.link, { kind: "patch", address, key: "", port, bindable: true }, opts);
  if (isLayerInput(value) && !isValidId(value.layer)) return fail("invalid_value", `${address} refers to layer "${value.layer}", which isn't a valid id.`, { address });
  if (isAssetInput(value) && !isValidId(value.asset)) return fail("invalid_value", `${address} refers to asset "${value.asset}", which isn't a valid id.`, { address });
  if (opts.lenient || !port) return ok(value);
  const type = port.type;
  const label = `${address} (${port.name})`;
  if (isLayerInput(value)) {
    if (type !== "layer" && type !== "any") return fail("invalid_value", `${label} needs ${typeLabel(type)}, not a layer reference.`, { address });
    if (!findLayer(component.layers, value.layer)) {
      return fail("not_found", `There's no layer "${value.layer}" in ${component.id}.${didYouMeanText(didYouMean(value.layer, allLayerIds(component.layers)))}`, {
        address,
        hint: "Layer references only reach layers in the same component.",
      });
    }
    return ok(value);
  }
  if (isAssetInput(value)) {
    if (!ASSET_TYPES.has(type)) return fail("invalid_value", `${label} needs ${typeLabel(type)}, not an asset.`, { address });
    if (!doc.assets[value.asset]) {
      return fail("not_found", `There's no asset "${value.asset}".${didYouMeanText(didYouMean(value.asset, Object.keys(doc.assets)))}`, {
        address,
        hint: "Add the file with an addAsset op first.",
      });
    }
    return ok(value);
  }
  if (isLoopLiteral(value)) {
    const items: Literal[] = [];
    for (let i = 0; i < value.loop.length; i++) {
      const item = checkScalarLiteral(value.loop[i]!, port, `${address}#${i}`);
      if (!item.ok) return item;
      items.push(item.value);
    }
    return ok({ loop: items });
  }
  if (isJsonLiteral(value)) {
    if (!JSON_TYPES.has(type)) return fail("invalid_value", `${label} needs ${typeLabel(type)}; { "json": … } only fits JSON-like inputs.`, { address });
    const obj = value.json;
    if ((type === "textStyle" || type === "layerEffect") && (!obj || typeof obj !== "object" || Array.isArray(obj))) {
      return fail("invalid_value", `${label} needs an object inside { "json": … }.`, { address });
    }
    if (type === "layerEffect" && typeof (obj as Record<string, unknown>).kind !== "string") {
      return fail("invalid_value", `${label} needs a layer effect with a "kind".`, { address });
    }
    if (type === "textStyle" && isColor((obj as Record<string, unknown>).color) === false && (obj as Record<string, unknown>).color !== undefined) {
      return fail("invalid_value", `${label} has a text style color that isn't { r, g, b, a }.`, { address });
    }
    return ok(value);
  }
  if (isGradientLiteral(value)) {
    if (type !== "gradient" && type !== "any") return fail("invalid_value", `${label} needs ${typeLabel(type)}, not a gradient.`, { address });
    return checkGradient(value as { gradient: Record<string, unknown> }, address);
  }
  if (isLiteral(value)) return checkScalarLiteral(value, port, address);
  return fail("invalid_value", `${address} got an unsupported value: ${preview(value)}.`, { address, hint: INPUT_VALUE_HINT });
}

/** Check any input value (link or literal) written into `target`. */
export function checkInputValue(doc: SonobeDocument, component: Component, target: PortTarget, value: unknown, opts: ValidateOptions): Check<InputValue> {
  if (isLinkInput(value)) return checkLink(doc, component, value.link, target, opts);
  if (target.kind === "componentOutput") {
    return fail("invalid_value", `${target.address} is a published output; it can only hold a connection.`, {
      address: target.address,
      hint: 'Connect a patch output to it, e.g. { "link": "pop.output" }.',
    });
  }
  return checkLiteral(doc, component, value, target.port, target.address, opts);
}
