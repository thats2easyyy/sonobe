/**
 * Knobs and presets (ARCHITECTURE §3.3): named values any input reads through
 * `{ "link": "$knob.<id>" }`, and presets, each a column holding a value for every knob, one of them
 * running. Pure helpers for effective values, soft ranges, differences between presets, readers,
 * simulation overrides, and turning constant Variable Broadcasters into knobs. Browser-safe.
 */

import { parseAddress } from "./address.ts";
import { listComponentIds } from "./document.ts";
import { getOwn, slugify, uniqueId } from "./ids.ts";
import { patchDisplayName } from "./names.ts";
import { listInputs, targetAddress } from "./ops/references.ts";
import { getPatchSpec, resolveNodePorts, type ResolvedPort } from "./registry.ts";
import { didYouMean, didYouMeanText } from "./suggest.ts";
import type { Component, Id, Knob, KnobPreset, KnobSet, KnobType, Literal, NewKnob, Op, PortAddress, Registry, SonobeDocument, ValueSubtype, ValueType } from "./types.ts";
import { checkScalarLiteral, makeError, resolveTarget, type Check } from "./validate.ts";
import { canConnect, coerce, decodeLiteral, encodeValue, formatNumber, isLinkInput, isLiteral, zeroLiteral } from "./values.ts";
import { componentBroadcasters, followingReceivers } from "./variables.ts";

export const KNOB_TYPES: readonly KnobType[] = ["number", "boolean", "color", "enum", "point", "text"];
/** Most knobs a project holds. */
export const MAX_KNOBS = 500;
/** Most presets a project holds. */
export const MAX_KNOB_PRESETS = 16;
/** The preset a project's first knob creates when no preset exists yet. */
export const DEFAULT_KNOB_PRESET: Readonly<KnobPreset> = Object.freeze({ id: "default", name: "Default" });

export function isKnobType(value: unknown): value is KnobType {
  return typeof value === "string" && (KNOB_TYPES as readonly string[]).includes(value);
}

/** number and point knobs take min, max, step and unit; enum knobs take options. */
export const hasKnobRange = (type: KnobType): boolean => type === "number" || type === "point";

const ok = <T>(value: T): Check<T> => ({ ok: true, value });
const failed = (code: string, message: string, hint?: string): { ok: false; error: ReturnType<typeof makeError> } => ({
  ok: false,
  error: makeError(code, message, hint === undefined ? {} : { hint }),
});

/** The port a knob behaves as: its type, soft range and options drive every control and literal check. */
export function knobAsPort(knob: Knob): ResolvedPort {
  const port: ResolvedPort = { key: knob.id, name: knob.name, type: knob.type, description: knob.description ?? `The knob ${knob.name}.` };
  if (knob.min !== undefined) port.min = knob.min;
  if (knob.max !== undefined) port.max = knob.max;
  if (knob.step !== undefined) port.step = knob.step;
  if (knob.options) port.enumOptions = knob.options.map((o) => ({ ...o }));
  return port;
}

/** "Commit Distance (commit_distance)", or just the name when it is the id. */
export const knobLabel = (knob: Pick<Knob, "id" | "name">): string => (knob.name === knob.id ? knob.name : `${knob.name} (${knob.id})`);

export function getKnob(set: KnobSet | undefined, id: Id): Knob | undefined {
  return set?.knobs.find((k) => k.id === id);
}

export function getKnobPreset(set: KnobSet | undefined, id: Id): KnobPreset | undefined {
  return set?.presets.find((p) => p.id === id);
}

/** A knob by id, then by name ignoring case, with a did-you-mean that names knobs the way the panel does. */
export function findKnob(set: KnobSet | undefined, idOrName: string): Check<Knob> {
  const text = typeof idOrName === "string" ? idOrName.trim() : "";
  const knob = getKnob(set, text) ?? set?.knobs.find((k) => k.name.toLowerCase() === text.toLowerCase());
  if (knob) return ok(knob);
  const knobs = set?.knobs ?? [];
  if (!knobs.length) return failed("unknown_knob", `There's no knob "${text}": this project has no knobs yet.`, "Make one with addKnob, or set_knobs.");
  const guesses = didYouMean(text, knobs.map((k) => ({ value: k.id, aliases: [k.name] })));
  const named = guesses.map((id) => knobLabel(getKnob(set, id)!));
  return failed(
    "unknown_knob",
    `There's no knob "${text}".${named.length ? ` Did you mean ${named.join(" or ")}?` : ""}`,
    `Knobs: ${knobs.slice(0, 12).map(knobLabel).join(", ")}${knobs.length > 12 ? ", …" : ""}.`,
  );
}

/** A preset by id, then by name ignoring case. */
export function findKnobPreset(set: KnobSet | undefined, idOrName: string): Check<KnobPreset> {
  const text = typeof idOrName === "string" ? idOrName.trim() : "";
  const preset = getKnobPreset(set, text) ?? set?.presets.find((p) => p.name.toLowerCase() === text.toLowerCase());
  if (preset) return ok(preset);
  const presets = set?.presets ?? [];
  if (!presets.length) return failed("unknown_knob_preset", `There's no preset "${text}": this project has no knobs or presets yet.`, "Make knobs with set_knobs first.");
  const guesses = didYouMean(text, presets.map((p) => ({ value: p.id, aliases: [p.name] })));
  return failed(
    "unknown_knob_preset",
    `There's no preset "${text}".${didYouMeanText(guesses.map((id) => getKnobPreset(set, id)!.name))}`,
    `Presets: ${presets.map((p) => (p.name === p.id ? p.name : `${p.name} (${p.id})`)).join(", ")}.`,
  );
}

/** The value a knob has when no preset holds one: its type's zero (the first option for an enum). */
export function knobZeroLiteral(knob: Pick<Knob, "type" | "options">): Literal {
  return zeroLiteral(knob.type, knob.options) as Literal;
}

/**
 * A knob's value in `preset` (default: the running one): its own value there, else the first preset
 * in order that has one, else its type's zero value. Diagnostics report the fallbacks.
 */
export function knobLiteral(set: KnobSet, knob: Knob, preset: Id = set.active): Literal {
  if (Object.hasOwn(knob.values, preset)) return knob.values[preset]!;
  for (const p of set.presets) if (Object.hasOwn(knob.values, p.id)) return knob.values[p.id]!;
  return knobZeroLiteral(knob);
}

/** knobLiteral by knob id; undefined when there's no such knob. */
export function effectiveKnobLiteral(set: KnobSet, id: Id, preset?: Id): Literal | undefined {
  const knob = getKnob(set, id);
  return knob ? knobLiteral(set, knob, preset) : undefined;
}

/** Every knob's value in `preset` (default: the running one), by knob id. */
export function effectiveKnobValues(set: KnobSet, preset?: Id): Record<Id, Literal> {
  const out: Record<Id, Literal> = {};
  for (const knob of set.knobs) out[knob.id] = knobLiteral(set, knob, preset);
  return out;
}

/** Check (and normalize) a value for a knob: the literal rules of a port of the knob's type and options. */
export function checkKnobLiteral(knob: Knob, value: unknown, label = `Knob "${knob.name}"`): Check<Literal> {
  if (value === null || value === undefined || !isLiteral(value)) {
    return failed("invalid_value", `${label} needs ${KNOB_VALUE_NEEDS[knob.type]}, but got ${value === undefined ? "nothing" : JSON.stringify(value)}.`, KNOB_VALUE_HINTS[knob.type]);
  }
  const r = checkScalarLiteral(value, knobAsPort(knob), label);
  if (r.ok) return r;
  const { address: _address, ...error } = r.error;
  return { ok: false, error: { ...error, message: error.message.replace(`${label} (${knob.name})`, label) } };
}

const KNOB_VALUE_NEEDS: Record<KnobType, string> = {
  number: "a number",
  boolean: "true or false",
  color: "a color",
  enum: "one of its options",
  point: "two numbers like [x, y]",
  text: "text",
};

const KNOB_VALUE_HINTS: Record<KnobType, string> = {
  number: "For example 95.",
  boolean: "For example true.",
  color: 'For example "#FF3B30FF".',
  enum: "Pass one of its option keys.",
  point: "For example [0, 120].",
  text: 'For example "Hello".',
};

const sameLiteral = (a: Literal | undefined, b: Literal | undefined) => JSON.stringify(a) === JSON.stringify(b);

/** A knob value for people: "95 pt", "on", "0.2 s", "#FF3B30FF", "12, 40 pt", or the option's name. */
export function formatKnobValue(knob: Pick<Knob, "type" | "unit" | "options">, value: Literal | undefined): string {
  if (value === undefined || value === null) return "none";
  const unit = knob.unit ? (/^[A-Za-z]/.test(knob.unit) ? ` ${knob.unit}` : knob.unit) : "";
  switch (knob.type) {
    case "number":
      return typeof value === "number" ? `${formatNumber(value)}${unit}` : JSON.stringify(value);
    case "point":
      return Array.isArray(value) ? `${value.map(formatNumber).join(", ")}${unit}` : JSON.stringify(value);
    case "boolean":
      return value === true ? "on" : value === false ? "off" : JSON.stringify(value);
    case "enum":
      return String(knob.options?.find((o) => o.key === value)?.name ?? value);
    case "color":
      return String(value);
    case "text":
      return JSON.stringify(value);
  }
}

export interface KnobDifference {
  id: Id;
  name: string;
  a: Literal;
  b: Literal;
}

/** Knobs whose values differ between presets `a` and `b`, in panel order. */
export function knobDifferences(set: KnobSet, a: Id, b: Id): KnobDifference[] {
  const out: KnobDifference[] = [];
  for (const knob of set.knobs) {
    const va = knobLiteral(set, knob, a);
    const vb = knobLiteral(set, knob, b);
    if (!sameLiteral(va, vb)) out.push({ id: knob.id, name: knob.name, a: va, b: vb });
  }
  return out;
}

const cell = (text: string) => text.replace(/\|/g, "\\|");

/** The differences between two presets as a Markdown table (Copy Differences, get_knobs). */
export function knobDifferencesMarkdown(set: KnobSet, a: Id, b: Id): string {
  const name = (id: Id) => getKnobPreset(set, id)?.name ?? id;
  const differences = knobDifferences(set, a, b);
  if (!differences.length) return `${name(a)} and ${name(b)} have the same value for every knob.`;
  const rows = differences.map((d) => {
    const knob = getKnob(set, d.id)!;
    return `| ${cell(d.name)} | ${cell(formatKnobValue(knob, d.a))} | ${cell(formatKnobValue(knob, d.b))} |`;
  });
  return [`| Knob | ${cell(name(a))} | ${cell(name(b))} |`, "| --- | --- | --- |", ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Simulation overrides
// ---------------------------------------------------------------------------

/** What a simulation runs instead of the person's knobs: another preset, and values over it. */
export interface KnobOverride {
  preset?: Id;
  /** Knob id → literal, written into the preset the override runs. */
  values?: Record<Id, Literal>;
}

/**
 * The document with another preset running and values written into it. Pure, and it keeps every
 * component as it is, so a runtime hot-patches the change in place. Simulations use it (sim_reset);
 * the person's document never changes.
 */
export function withKnobOverride(doc: SonobeDocument, override: KnobOverride): SonobeDocument {
  const set = doc.knobs;
  if (!set) return doc;
  const active = override.preset !== undefined && getKnobPreset(set, override.preset) ? override.preset : set.active;
  const values = override.values ?? {};
  let changed = false;
  const knobs = set.knobs.map((knob) => {
    if (!Object.hasOwn(values, knob.id) || sameLiteral(knob.values[active], values[knob.id])) return knob;
    changed = true;
    return { ...knob, values: { ...knob.values, [active]: values[knob.id]! } };
  });
  if (active === set.active && !changed) return doc;
  return { ...doc, knobs: { ...set, active, knobs: changed ? knobs : set.knobs } };
}

/** Resolve an override given by preset and knob ids or names, checking every value. */
export function resolveKnobOverride(doc: SonobeDocument, request: { preset?: string; values?: Record<string, unknown> }): Check<KnobOverride> {
  const set = doc.knobs;
  const out: KnobOverride = {};
  if (request.preset !== undefined) {
    const preset = findKnobPreset(set, request.preset);
    if (!preset.ok) return preset;
    out.preset = preset.value.id;
  }
  const entries = Object.entries(request.values ?? {});
  if (entries.length) {
    const values: Record<Id, Literal> = {};
    for (const [name, value] of entries) {
      const knob = findKnob(set, name);
      if (!knob.ok) return knob;
      const literal = checkKnobLiteral(knob.value, value);
      if (!literal.ok) return literal;
      values[knob.value.id] = literal.value;
    }
    out.values = values;
  }
  return ok(out);
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export interface KnobReader {
  knob: Id;
  component: Id;
  /** The input or layer property that reads the knob ("spring.response", "@card.cornerRadius"). */
  target: PortAddress;
}

/** The knob ids a component's links read. */
export function componentKnobReads(component: Component): Set<Id> {
  const out = new Set<Id>();
  for (const e of listInputs(component)) {
    if (!isLinkInput(e.value)) continue;
    const a = parseAddress(e.value.link);
    if (a?.kind === "knob") out.add(a.key);
  }
  return out;
}

/** Every input and layer property that reads a knob (or only `id`), root component first. */
export function knobReaders(doc: SonobeDocument, id?: Id): KnobReader[] {
  const out: KnobReader[] = [];
  for (const componentId of listComponentIds(doc)) {
    for (const e of listInputs(doc.components[componentId]!)) {
      if (!isLinkInput(e.value)) continue;
      const a = parseAddress(e.value.link);
      if (a?.kind !== "knob" || (id !== undefined && a.key !== id)) continue;
      out.push({ knob: a.key, component: componentId, target: targetAddress(e.target) });
    }
  }
  return out;
}

/**
 * A knob value as a reader of type `type` stores it: the value converted the way a link would
 * convert it. Undefined when that type stores no value (a pulse input).
 */
export function knobValueAs(knob: Pick<Knob, "type">, value: Literal, type: ValueType): Literal | undefined {
  if (type === knob.type || type === "any") return value;
  if (type === "pulse") return undefined;
  if (!canConnect(knob.type, type).ok) return value;
  const encoded = encodeValue(coerce(decodeLiteral(value, knob.type), knob.type, type), type);
  return isLiteral(encoded) && encoded !== null ? encoded : undefined;
}

// ---------------------------------------------------------------------------
// Ranges and ids
// ---------------------------------------------------------------------------

const SUBTYPE_UNITS: Partial<Record<ValueSubtype, string>> = { distance: "pt", duration: "s", angle: "°", velocity: "pt/s" };

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** 10^k without float noise (1e-2, not 0.010000000000000002). */
const power = (k: number) => Number(`1e${k}`);

/** The smallest of 1, 2, 5 × 10^k that is at least `x`. */
function niceCeil(x: number): number {
  const k = Math.floor(Math.log10(x) + 1e-9);
  for (const e of [k - 1, k, k + 1]) for (const d of [1, 2, 5]) if (d * power(e) >= x * (1 - 1e-9)) return Number(`${d}e${e}`);
  return power(k + 2);
}

/** A hundredth of the range, rounded down to a power of ten. */
function defaultStep(min: number, max: number): number {
  return power(Math.floor(Math.log10((max - min) / 100) + 1e-9));
}

export interface KnobRange {
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

/**
 * The soft range for a new number or point knob, worked out once from its values and the port it
 * drives, then stored: the port's declared bounds; 0…1 for progress; otherwise 0 to twice the largest
 * value rounded up to 1, 2 or 5 × 10^k (and as far below 0 when a value is negative). The step is a
 * hundredth of the range rounded down to a power of ten; the unit comes from the port's subtype.
 */
export function suggestKnobRange(values: readonly Literal[], port?: Pick<ResolvedPort, "min" | "max" | "step" | "subtype">): KnobRange {
  const unit = port?.subtype ? SUBTYPE_UNITS[port.subtype] : undefined;
  const range = (r: KnobRange): KnobRange => (unit ? { ...r, unit } : r);
  if (port && finite(port.min) && finite(port.max) && port.max > port.min) {
    return range({ min: port.min, max: port.max, step: finite(port.step) && port.step > 0 ? port.step : defaultStep(port.min, port.max) });
  }
  if (port?.subtype === "progress") return range({ min: 0, max: 1, step: 0.01 });
  const numbers = values.flatMap((v) => (typeof v === "number" ? [v] : Array.isArray(v) ? v : [])).filter(finite);
  const largest = numbers.reduce((m, n) => Math.max(m, Math.abs(n)), 0);
  if (largest === 0) return port?.subtype === "distance" ? range({ min: 0, max: 100, step: 1 }) : range({ min: 0, max: 1, step: 0.01 });
  const hi = niceCeil(2 * largest);
  const lo = numbers.every((n) => n >= 0) ? 0 : -hi;
  return range({ min: lo, max: hi, step: defaultStep(lo, hi) });
}

/** A free knob id derived from a name ("Commit Distance" → commit_distance), skipping ids `taken` says are used. */
export function deriveKnobId(set: KnobSet | undefined, name: string, taken?: (id: Id) => boolean): Id {
  const ids = new Set(set?.knobs.map((k) => k.id));
  return uniqueId(slugify(name, "knob"), (id) => ids.has(id) || !!taken?.(id));
}

/** A free preset id derived from a name ("Shipped app" → shipped_app). */
export function deriveKnobPresetId(set: KnobSet | undefined, name: string, taken?: (id: Id) => boolean): Id {
  const ids = new Set(set?.presets.map((p) => p.id));
  return uniqueId(slugify(name, "preset"), (id) => ids.has(id) || !!taken?.(id));
}

/** `base`, or "base 2", "base 3", … when a knob already has that name (ignoring case). */
export function uniqueKnobName(names: Iterable<string>, base: string): string {
  const taken = new Set([...names].map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

// ---------------------------------------------------------------------------
// Variable Broadcasters → knobs
// ---------------------------------------------------------------------------

export interface VariableKnobPlan {
  /** One batch: addKnob per candidate, then the readers relinked, then receivers and broadcasters removed. */
  ops: Op[];
  knobs: { id: Id; name: string; component: Id; from: Id; readers: number }[];
  refused: { component: Id; id: Id; reason: string }[];
}

export interface VariableKnobOptions {
  /** Only this component's broadcasters (default: every component). */
  component?: Id;
  /** Only these broadcaster ids; each one that can't convert is refused with a reason. */
  ids?: Id[];
  /** Knob ids that are used elsewhere (retired this session): derived ids skip them. */
  taken?: (id: Id) => boolean;
}

/**
 * Turn constant Variable Broadcasters into knobs: a named, unmuted broadcaster with a literal value of
 * a knob type and at least one receiver becomes a knob named after its variable (the patch's display
 * name goes into the description when it says more), every input its receivers drive reads the knob
 * instead, and the receivers and the broadcaster go. A broadcaster driven by a link is a live signal
 * and stays; so does one whose receiver feeds a published output. Pure and deterministic.
 */
export function planVariablesToKnobs(doc: SonobeDocument, registry: Registry, options: VariableKnobOptions = {}): VariableKnobPlan {
  const plan: VariableKnobPlan = { ops: [], knobs: [], refused: [] };
  const wanted = options.ids ? new Set(options.ids) : undefined;
  const components = options.component !== undefined ? [options.component] : listComponentIds(doc);
  const ids = new Set(doc.knobs?.knobs.map((k) => k.id));
  const names = new Set(doc.knobs?.knobs.map((k) => k.name));
  const adds: Op[] = [];
  const links: Op[] = [];
  const receiversGone: Op[] = [];
  const broadcastersGone: Op[] = [];
  const lenient = { registry, lenient: true };
  for (const componentId of components) {
    const c = getOwn(doc.components, componentId);
    if (!c) continue;
    for (const b of componentBroadcasters(doc, registry, componentId)) {
      if (wanted && !wanted.has(b.id)) continue;
      const node = c.patches[b.id]!;
      const title = patchDisplayName(node, getPatchSpec(registry, node.type));
      const refuse = (reason: string, always = false) => {
        if (always || wanted) plan.refused.push({ component: componentId, id: b.id, reason });
      };
      if (!b.name) {
        refuse(`${title} has no variable name, so nothing reads it.`);
        continue;
      }
      if (b.muted) {
        refuse(`${b.name} is muted, so its receivers read zero values.`);
        continue;
      }
      const stored = getOwn(node.inputs, "value");
      if (isLinkInput(stored)) {
        refuse(`${b.name} is driven by ${stored.link}, so it's a live signal. Keep it a variable.`, true);
        continue;
      }
      if (!isKnobType(b.type) || b.type === "enum") {
        refuse(`${b.name} shares a ${b.type} value; knobs hold numbers, true/false, colors, points and text.`);
        continue;
      }
      const type = b.type;
      const valuePort = resolveNodePorts(doc, node, registry)?.inputs.find((p) => p.key === "value");
      const raw = stored === undefined ? (valuePort?.default ?? zeroLiteral(type)) : stored;
      const probe: Knob = { id: "knob", name: b.name, type, values: {} };
      const literal = isLiteral(raw) && raw !== null ? checkKnobLiteral(probe, raw) : undefined;
      if (!literal?.ok) {
        refuse(`${b.name}'s value isn't a single ${type} value.`, true);
        continue;
      }
      const receivers = followingReceivers(doc, registry, componentId, b.id);
      const readers: { component: Id; target: PortAddress; port: ResolvedPort | undefined }[] = [];
      let blocked: string | undefined;
      for (const r of receivers) {
        const rc = doc.components[r.componentId]!;
        for (const e of listInputs(rc)) {
          if (!isLinkInput(e.value) || e.value.link !== `${r.id}.output`) continue;
          if (e.target.kind === "componentOutput") {
            blocked = `${b.name} reaches ${rc.name}'s published output "${e.target.key}", and a published output can't read a knob. Put a patch between them, then convert it.`;
            break;
          }
          const target = targetAddress(e.target);
          const resolved = resolveTarget(doc, rc, target, lenient);
          readers.push({ component: r.componentId, target, port: resolved.ok ? resolved.value.port : undefined });
        }
        if (blocked) break;
      }
      if (blocked) {
        refuse(blocked, true);
        continue;
      }
      if (!receivers.length) {
        refuse(`Nothing receives ${b.name}.`);
        continue;
      }
      const name = uniqueKnobName(names, b.name.slice(0, 60));
      const id = uniqueId(slugify(b.name, "knob"), (x) => ids.has(x) || !!options.taken?.(x));
      ids.add(id);
      names.add(name);
      const knob: NewKnob = { id, name, type, value: literal.value };
      if (title !== b.name) knob.description = title.slice(0, 200);
      if (hasKnobRange(type)) {
        const port = readers.find((r) => finite(r.port?.min) && finite(r.port?.max))?.port ?? readers.find((r) => r.port?.subtype)?.port;
        Object.assign(knob, suggestKnobRange([literal.value], port));
      }
      adds.push({ op: "addKnob", knob });
      for (const r of readers) links.push({ op: "setInput", component: r.component, target: r.target, value: { link: `$knob.${id}` } });
      for (const r of receivers) receiversGone.push({ op: "removePatch", component: r.componentId, id: r.id });
      broadcastersGone.push({ op: "removePatch", component: componentId, id: b.id });
      plan.knobs.push({ id, name, component: componentId, from: b.id, readers: readers.length });
    }
  }
  plan.ops = [...adds, ...links, ...receiversGone, ...broadcastersGone];
  return plan;
}
