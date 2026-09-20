/**
 * Knob and preset ops (ARCHITECTURE §3.5): addKnob, updateKnob, removeKnob, setKnobValue,
 * addKnobPreset, updateKnobPreset, removeKnobPreset, applyKnobPreset. They're project-level, like
 * setScript, so they take no component. Inputs read knobs through ordinary links ("$knob.<id>"), set
 * with setInput and connect.
 */

import { parseAddress } from "../address.ts";
import { listComponentIds } from "../document.ts";
import { isValidId, slugify, uniqueId } from "../ids.ts";
import {
  checkKnobLiteral,
  DEFAULT_KNOB_PRESET,
  findKnob,
  findKnobPreset,
  formatKnobValue,
  getKnob,
  getKnobPreset,
  hasKnobRange,
  isKnobType,
  knobLiteral,
  knobReaders,
  knobValueAs,
  knobZeroLiteral,
  KNOB_TYPES,
  MAX_KNOB_PRESETS,
  MAX_KNOBS,
} from "../knobs.ts";
import { didYouMean, didYouMeanText } from "../suggest.ts";
import type { EnumOption, Id, Knob, KnobPreset, KnobSet, KnobType, Literal, NewKnob, Op, SonobeDocument } from "../types.ts";
import { resolveTarget } from "../validate.ts";
import { canConnect, isLinkInput, isLiteral } from "../values.ts";
import { CLEAR, fail, resolveIndex, withComponent, type OpContext, type OpOf, type OpOutcome } from "./context.ts";
import { listInputs, targetAddress, writeInput } from "./references.ts";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const MAX_NAME = { knob: 60, preset: 40 } as const;
const MAX_GROUP = 40;
const MAX_UNIT = 12;
const MAX_DESCRIPTION = 200;

const NEW_KNOB_KEYS = ["id", "name", "type", "group", "description", "min", "max", "step", "unit", "options", "value", "values"];
const NEW_PRESET_KEYS = ["id", "name", "locked"];

function refuseUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    fail("unknown_field", `${what} has no field "${key}".${didYouMeanText(didYouMean(key, allowed))}`, { hint: `${what} takes: ${allowed.join(", ")}.` });
  }
}

/** The document with its knob set replaced (`undefined` removes it, so knobs.json goes). */
function withKnobs(doc: SonobeDocument, set: KnobSet | undefined): SonobeDocument {
  if (set) return { ...doc, knobs: set };
  const { knobs: _removed, ...rest } = doc;
  return rest;
}

/**
 * After removeKnob: no knobs and only the untouched "Default" preset the first knob made is no set
 * at all, so removing the last knob of a project that never had real presets removes knobs.json,
 * and undoing a project's first addKnob restores the document exactly.
 */
function withoutDefaultOnly(set: KnobSet): KnobSet | undefined {
  const [only] = set.presets;
  const untouched = only && set.presets.length === 1 && only.id === DEFAULT_KNOB_PRESET.id && only.name === DEFAULT_KNOB_PRESET.name && !only.locked && set.active === only.id;
  return !set.knobs.length && untouched ? undefined : set;
}

function requireSet(ctx: OpContext): KnobSet {
  const set = ctx.doc.knobs;
  if (!set) fail("unknown_knob", "This project has no knobs yet.", { hint: 'Add one with addKnob, like { "op": "addKnob", "knob": { "name": "Commit Distance", "type": "number", "value": 95 } }.' });
  return set;
}

/** Ops name knobs and presets by id; a name gets pointed at its id. */
function requireKnob(ctx: OpContext, set: KnobSet, id: unknown): Knob {
  const knob = typeof id === "string" ? getKnob(set, id) : undefined;
  if (knob) return knob;
  const found = findKnob(set, String(id));
  if (found.ok) fail("unknown_knob", `"${String(id)}" is the name of the knob ${found.value.id}; ops name knobs by id.`, { hint: `Use "id": "${found.value.id}".` });
  return fail(found.error.code, found.error.message, { hint: found.error.hint });
}

function requirePreset(ctx: OpContext, set: KnobSet | undefined, id: unknown): KnobPreset {
  const preset = typeof id === "string" ? getKnobPreset(set, id) : undefined;
  if (preset) return preset;
  const found = findKnobPreset(set, String(id));
  if (found.ok) fail("unknown_knob_preset", `"${String(id)}" is the name of the preset ${found.value.id}; ops name presets by id.`, { hint: `Use "${found.value.id}".` });
  return fail(found.error.code, found.error.message, { hint: found.error.hint });
}

/**
 * With `lenient` (undo and redo replays), names, text and options are taken as given, so what a hand
 * edit left in knobs.json (names alike ignoring case, untrimmed text, an option listed twice) comes
 * back exactly. It loads with diagnostics.
 */
function checkName(value: unknown, others: readonly { name: string }[], what: "knob" | "preset", lenient: boolean): string {
  if (typeof value !== "string" || !value.trim()) fail("invalid_knob", `A ${what} needs a name.`, { hint: what === "knob" ? 'Name it after what it changes, like "Commit Distance".' : 'Name it after what it holds, like "Shipped app" or "Proposal".' });
  const name = value.trim();
  if (name.length > MAX_NAME[what]) fail("invalid_knob", `${what === "knob" ? "Knob" : "Preset"} names are at most ${MAX_NAME[what]} characters; "${name.slice(0, 24)}…" has ${name.length}.`);
  const clash = lenient ? undefined : others.find((o) => o.name.toLowerCase() === name.toLowerCase());
  if (clash) fail("invalid_knob", `There's already a ${what} named "${clash.name}".`, { hint: `${what === "knob" ? "Knob" : "Preset"} names are unique, ignoring case. Pick another name.` });
  return name;
}

function checkText(value: unknown, field: string, max: number, lenient: boolean): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") fail("invalid_knob", `A knob's ${field} must be text.`);
  if (lenient) return value;
  const text = value.trim();
  if (text.length > max) fail("invalid_knob", `A knob's ${field} is at most ${max} characters; this one has ${text.length}.`);
  return text || undefined;
}

function checkNumber(value: unknown, field: string): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) fail("invalid_knob", `A knob's ${field} must be a number, but got ${JSON.stringify(value)}.`);
  return value;
}

function checkOptions(value: unknown, lenient: boolean): EnumOption[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Array.isArray(value)) fail("invalid_knob", 'A knob\'s options are a list like [{ "key": "snappy", "name": "Snappy" }, { "key": "soft", "name": "Soft" }].');
  if (lenient && !value.some((o) => !isObject(o))) return value.map((o: EnumOption) => ({ ...o }));
  const out: EnumOption[] = [];
  for (const raw of value) {
    const option = typeof raw === "string" ? { key: raw, name: raw } : raw;
    if (!isObject(option) || typeof option.key !== "string" || !option.key.trim()) fail("invalid_knob", `Each option needs a "key", but got ${JSON.stringify(raw)}.`);
    const key = option.key.trim();
    if (out.some((o) => o.key === key)) fail("invalid_knob", `The option "${key}" is listed twice.`, { hint: "Option keys are unique." });
    const next: EnumOption = { key, name: typeof option.name === "string" && option.name.trim() ? option.name.trim() : key };
    if (typeof option.description === "string" && option.description.trim()) next.description = option.description.trim();
    out.push(next);
  }
  return out;
}

type KnobFields = Pick<Knob, "group" | "description" | "min" | "max" | "step" | "unit" | "options">;

/** Fields that fit a type: range fields only on number and point knobs, options only on enum knobs. */
function checkFieldsFit(type: KnobType, fields: KnobFields, name: string, lenient: boolean): void {
  if (lenient) return;
  for (const field of ["min", "max", "step", "unit"] as const) {
    if (fields[field] !== undefined && !hasKnobRange(type)) fail("invalid_knob", `Knob "${name}" is ${type === "enum" ? "an" : "a"} ${type} knob, so it has no ${field}.`, { hint: "min, max, step and unit apply to number and point knobs." });
  }
  if (fields.options !== undefined && type !== "enum") fail("invalid_knob", `Knob "${name}" is a ${type} knob, so it has no options.`, { hint: 'Options apply to enum knobs ("type": "enum").' });
  if (type === "enum" && (fields.options?.length ?? 0) < 2) fail("invalid_knob", `Knob "${name}" is an enum knob, so it needs at least 2 options.`, { hint: 'For example "options": [{ "key": "snappy", "name": "Snappy" }, { "key": "soft", "name": "Soft" }].' });
  if (fields.min !== undefined && fields.max !== undefined && !(fields.min < fields.max)) fail("invalid_knob", `Knob "${name}" has min ${fields.min} and max ${fields.max}; min must be below max.`, { hint: "The range is soft: typed values may still go past it." });
  if (fields.step !== undefined && !(fields.step > 0)) fail("invalid_knob", `Knob "${name}" has step ${fields.step}; a step is above 0.`);
}

/** The first knob or preset limit a change would pass. */
function checkLimit(ctx: OpContext, count: number, max: number, what: string): void {
  if (!ctx.lenient && count >= max) fail("limit_exceeded", `A project holds up to ${max} ${what}; this one has ${count}.`, { hint: `Remove ${what} you no longer tune first.` });
}

function newKnobId(ctx: OpContext, set: KnobSet, explicit: unknown, name: string): Id {
  const taken = (id: string) => set.knobs.some((k) => k.id === id) || ctx.retiredKnob(id);
  if (explicit !== undefined && explicit !== null) {
    if (!isValidId(explicit)) fail("invalid_id", `"${String(explicit)}" isn't a valid knob id.`, { hint: `Ids use letters, digits and underscores and don't start with a digit, like "${slugify(String(explicit), "knob")}".` });
    if (set.knobs.some((k) => k.id === explicit)) fail("id_taken", `There's already a knob "${explicit}".`, { hint: `Leave "id" out to get a free one, like "${uniqueId(explicit, taken)}".` });
    if (ctx.retiredKnob(explicit)) {
      fail("id_retired", `"${explicit}" belonged to a knob removed earlier in this session. Removed ids aren't given to new knobs, so anything still holding the old id fails instead of reaching the new one.`, {
        hint: `To rebuild a knob under its old id, remove it and add the new one in the same batch (if the removal is already applied, undo it first). Or leave "id" out to get "${uniqueId(explicit, taken)}".`,
      });
    }
    return explicit;
  }
  const base = slugify(name, "knob");
  const id = uniqueId(base, taken);
  if (id !== base && ctx.retiredKnob(base)) ctx.renamed.retired[id] = base;
  return id;
}

function newPresetId(ctx: OpContext, set: KnobSet | undefined, explicit: unknown, name: string): Id {
  const taken = (id: string) => !!set?.presets.some((p) => p.id === id) || ctx.retiredPreset(id);
  if (explicit !== undefined && explicit !== null) {
    if (!isValidId(explicit)) fail("invalid_id", `"${String(explicit)}" isn't a valid preset id.`, { hint: `Ids use letters, digits and underscores and don't start with a digit, like "${slugify(String(explicit), "preset")}".` });
    if (set?.presets.some((p) => p.id === explicit)) fail("id_taken", `There's already a preset "${explicit}".`, { hint: `Leave "id" out to get a free one, like "${uniqueId(explicit, taken)}".` });
    if (ctx.retiredPreset(explicit)) {
      fail("id_retired", `"${explicit}" belonged to a preset removed earlier in this session, so it isn't given to a new one.`, { hint: `Leave "id" out to get "${uniqueId(explicit, taken)}".` });
    }
    return explicit;
  }
  const base = slugify(name, "preset");
  const id = uniqueId(base, taken);
  if (id !== base && ctx.retiredPreset(base)) ctx.renamed.retired[id] = base;
  return id;
}

/** A knob as addKnob takes it, with a value for every preset it has one in. */
function toNewKnob(knob: Knob): NewKnob {
  const out: NewKnob = { id: knob.id, name: knob.name, type: knob.type };
  if (knob.group !== undefined) out.group = knob.group;
  if (knob.description !== undefined) out.description = knob.description;
  if (knob.min !== undefined) out.min = knob.min;
  if (knob.max !== undefined) out.max = knob.max;
  if (knob.step !== undefined) out.step = knob.step;
  if (knob.unit !== undefined) out.unit = knob.unit;
  if (knob.options !== undefined) out.options = knob.options.map((o) => ({ ...o }));
  out.values = { ...knob.values };
  return out;
}

function commit(ctx: OpContext, set: KnobSet | undefined): void {
  ctx.doc = withKnobs(ctx.doc, set);
}

function replaceKnob(set: KnobSet, knob: Knob): KnobSet {
  return { ...set, knobs: set.knobs.map((k) => (k.id === knob.id ? knob : k)) };
}

function move<T>(list: readonly T[], item: T, index: number): T[] {
  const rest = list.filter((x) => x !== item);
  rest.splice(Math.max(0, Math.min(rest.length, index)), 0, item);
  return rest;
}

export function addKnob(ctx: OpContext, op: OpOf<"addKnob">): OpOutcome {
  const input = op.knob as unknown;
  if (!isObject(input)) fail("invalid_op", 'addKnob needs "knob", like { "name": "Commit Distance", "type": "number", "value": 95 }.');
  if (!ctx.lenient) refuseUnknownKeys(input, NEW_KNOB_KEYS, "A new knob");
  const before = ctx.doc.knobs;
  const set: KnobSet = before ?? { active: DEFAULT_KNOB_PRESET.id, presets: [{ ...DEFAULT_KNOB_PRESET }], knobs: [] };
  checkLimit(ctx, set.knobs.length, MAX_KNOBS, "knobs");
  if (!isKnobType(input.type)) fail("invalid_knob", `A knob's type is one of ${KNOB_TYPES.join(", ")}, but got ${JSON.stringify(input.type)}.`);
  const type = input.type;
  const name = checkName(input.name, set.knobs, "knob", ctx.lenient);
  const id = newKnobId(ctx, set, input.id, name);
  const fields: KnobFields = {};
  const group = checkText(input.group, "group", MAX_GROUP, ctx.lenient);
  if (group !== undefined) fields.group = group;
  const description = checkText(input.description, "description", MAX_DESCRIPTION, ctx.lenient);
  if (description !== undefined) fields.description = description;
  for (const key of ["min", "max", "step"] as const) {
    const n = checkNumber(input[key], key);
    if (n !== undefined) fields[key] = n;
  }
  const unit = checkText(input.unit, "unit", MAX_UNIT, ctx.lenient);
  if (unit !== undefined) fields.unit = unit;
  const options = checkOptions(input.options, ctx.lenient);
  if (options !== undefined) fields.options = options;
  checkFieldsFit(type, fields, name, ctx.lenient);
  const knob: Knob = { id, name, type, values: {}, ...fields };
  const given = input.values;
  if (given !== undefined && !isObject(given)) fail("invalid_knob", 'A knob\'s "values" map preset ids to values, like { "proposal": 95, "shipped_app": 80 }.');
  const literalFor = (raw: unknown, preset: string): Literal => {
    if (ctx.lenient && isLiteral(raw)) return raw;
    const literal = checkKnobLiteral(knob, raw, `Knob "${name}" in ${preset}`);
    if (!literal.ok) fail(literal.error.code, literal.error.message, { hint: literal.error.hint });
    return literal.value;
  };
  if (ctx.lenient && given !== undefined) {
    // Undo puts the values back as they were: a preset without one of its own stays without (it runs the fallback).
    for (const [presetId, raw] of Object.entries(given)) {
      if (!isValidId(presetId)) fail("invalid_id", `"${presetId}" isn't a valid preset id.`);
      knob.values[presetId] = literalFor(raw, getKnobPreset(set, presetId)?.name ?? presetId);
    }
  } else {
    for (const presetId of Object.keys(given ?? {})) requirePreset(ctx, set, presetId);
    for (const preset of set.presets) {
      const raw = given && Object.hasOwn(given, preset.id) ? given[preset.id] : input.value;
      knob.values[preset.id] = raw === undefined ? knobLiteral(set, knob, preset.id) : literalFor(raw, preset.name);
    }
  }
  const index = resolveIndex(op.index, set.knobs.length);
  const knobs = [...set.knobs];
  knobs.splice(index, 0, knob);
  commit(ctx, { ...set, knobs });
  ctx.affected.knobs.add(id);
  if (!before) ctx.affected.presets.add(set.active);
  const inverse: Op[] = [{ op: "removeKnob", id }];
  // removeKnob drops a set left with only an untouched Default preset; this one was already there.
  if (before && !withoutDefaultOnly(before)) inverse.push({ op: "addKnobPreset", preset: { ...DEFAULT_KNOB_PRESET } });
  return { ids: [id], applied: { op: "addKnob", knob: toNewKnob(knob), index }, inverse };
}

const UPDATE_FIELDS = ["name", "group", "description", "type", "min", "max", "step", "unit", "options"] as const;

export function updateKnob(ctx: OpContext, op: OpOf<"updateKnob">): OpOutcome {
  const set = requireSet(ctx);
  const old = requireKnob(ctx, set, op.id);
  const next: Knob = { ...old, values: { ...old.values } };
  const raw = op as unknown as Record<string, unknown>;
  if (op.name !== undefined) next.name = checkName(op.name, set.knobs.filter((k) => k !== old), "knob", ctx.lenient);
  for (const [field, max] of [["group", MAX_GROUP], ["description", MAX_DESCRIPTION], ["unit", MAX_UNIT]] as const) {
    if (!(field in raw)) continue;
    const text = checkText(raw[field], field, max, ctx.lenient);
    if (text === undefined) delete next[field];
    else next[field] = text;
  }
  for (const field of ["min", "max", "step"] as const) {
    if (!(field in raw)) continue;
    const n = checkNumber(raw[field], field);
    if (n === undefined) delete next[field];
    else next[field] = n;
  }
  if ("options" in raw) {
    const options = checkOptions(raw.options, ctx.lenient);
    if (options === undefined) delete next.options;
    else next.options = options;
  }
  const retyped = op.type !== undefined && op.type !== old.type;
  if (op.type !== undefined && !isKnobType(op.type)) fail("invalid_knob", `A knob's type is one of ${KNOB_TYPES.join(", ")}, but got ${JSON.stringify(op.type)}.`);
  const readers = retyped || (next.type === "enum" && "options" in raw) ? knobReaders(ctx.doc, old.id) : [];
  if (retyped) {
    const type = op.type!;
    if (!ctx.lenient && !canConnect(old.type, type).ok) {
      fail("invalid_knob", `Knob "${old.name}" can't turn from ${old.type} into ${type}: its values don't convert.`, { hint: `Remove it and add a ${type} knob instead (removing keeps its value in every input that reads it).` });
    }
    next.type = type;
    // Fields the new type can't have go, unless the op sets them.
    if (!hasKnobRange(type)) for (const field of ["min", "max", "step", "unit"] as const) if (!(field in raw)) delete next[field];
    if (type !== "enum" && !("options" in raw)) delete next.options;
    for (const [preset, value] of Object.entries(old.values)) next.values[preset] = knobValueAs(old, value, type) ?? knobZeroLiteral({ type });
  }
  checkFieldsFit(next.type, next, next.name, ctx.lenient);
  if (!ctx.lenient) {
    for (const [presetId, value] of Object.entries(next.values)) {
      const check = checkKnobLiteral(next, value, `Knob "${next.name}" in ${getKnobPreset(set, presetId)?.name ?? presetId}`);
      if (!check.ok) {
        fail("invalid_knob", `${check.error.message.replace(/\.$/, "")}${retyped ? ` after turning it into ${next.type}` : ""}.`, {
          hint: next.type === "enum" ? "Give the knob options that include every preset's value, or set the values first." : check.error.hint,
        });
      }
      next.values[presetId] = check.value;
    }
    const failing: string[] = [];
    for (const reader of readers) {
      const c = ctx.doc.components[reader.component]!;
      const target = resolveTarget(ctx.doc, c, reader.target, ctx.validate);
      const port = target.ok ? target.value.port : undefined;
      if (!port) continue;
      const fits = canConnect(next.type, port.type).ok && !(next.type === "enum" && port.type === "enum" && port.enumOptions?.length && (next.options ?? []).some((o) => !port.enumOptions!.some((p) => p.key === o.key)));
      if (!fits) failing.push(reader.component === ctx.doc.project.root ? reader.target : `${reader.component}: ${reader.target}`);
    }
    if (failing.length) {
      const running = knobLiteral(set, old);
      fail("knob_type_mismatch", `Knob "${old.name}" can't change like that: ${failing.length === 1 ? "an input that reads it" : `${failing.length} inputs that read it`} can't take ${next.type === old.type ? "those options" : `a ${next.type}`} (${failing.slice(0, 6).join(", ")}${failing.length > 6 ? ", …" : ""}).`, {
        hint: `Unlink them first; they keep ${formatKnobValue(old, running)}.`,
        suggestions: [
          {
            description: `Unlink the inputs that can't take it, keeping ${formatKnobValue(old, running)}`,
            ops: readers.map((r) => {
              const c = ctx.doc.components[r.component]!;
              const target = resolveTarget(ctx.doc, c, r.target, { ...ctx.validate, lenient: true });
              const type = target.ok && target.value.port ? target.value.port.type : old.type;
              return { op: "setInput", component: r.component, target: r.target, value: knobValueAs(old, running, type) ?? null } as Op;
            }),
          },
        ],
      });
    }
  }
  let knobs = set.knobs.map((k) => (k === old ? next : k));
  const oldIndex = set.knobs.indexOf(old);
  if (op.index !== undefined) knobs = move(knobs, next, resolveIndex(op.index, set.knobs.length - 1));
  commit(ctx, { ...set, knobs });
  ctx.affected.knobs.add(old.id);
  const inverse: OpOf<"updateKnob"> = { op: "updateKnob", id: old.id };
  const applied: OpOf<"updateKnob"> = { op: "updateKnob", id: old.id };
  const inv = inverse as unknown as Record<string, unknown>;
  const app = applied as unknown as Record<string, unknown>;
  for (const field of UPDATE_FIELDS) {
    if (sameJson(old[field], next[field])) continue;
    inv[field] = old[field] ?? CLEAR;
    app[field] = next[field] ?? CLEAR;
  }
  const newIndex = knobs.indexOf(next);
  if (newIndex !== oldIndex) {
    inverse.index = oldIndex;
    applied.index = newIndex;
  }
  if (retyped) {
    // Converting back may not be possible (text → on/off) or may lose the values (95 → on → 1), so
    // the inverse puts the old knob back whole and relinks its readers.
    const relink = readers.map((r): Op => ({ op: "setInput", component: r.component, target: r.target, value: { link: `$knob.${old.id}` } }));
    return { ids: [old.id], applied, inverse: [{ op: "removeKnob", id: old.id }, { op: "addKnob", knob: toNewKnob(old), index: oldIndex }, ...relink] };
  }
  return { ids: [old.id], applied, inverse: [inverse] };
}

export function removeKnob(ctx: OpContext, op: OpOf<"removeKnob">): OpOutcome {
  const set = requireSet(ctx);
  const knob = requireKnob(ctx, set, op.id);
  const index = set.knobs.indexOf(knob);
  const running = knobLiteral(set, knob);
  const lenient = { ...ctx.validate, lenient: true };
  let doc = ctx.doc;
  const restores: Op[] = [];
  for (const componentId of listComponentIds(doc)) {
    const c = doc.components[componentId]!;
    let next = c;
    for (const e of listInputs(c)) {
      if (!isLinkInput(e.value)) continue;
      const a = parseAddress(e.value.link);
      if (a?.kind !== "knob" || a.key !== knob.id) continue;
      const target = targetAddress(e.target);
      const resolved = resolveTarget(doc, c, target, lenient);
      const type = resolved.ok && resolved.value.port ? resolved.value.port.type : knob.type;
      // Every reader keeps the running value, converted to what it takes, so the prototype behaves as it does now.
      next = writeInput(next, e.target, e.target.kind === "componentOutput" ? undefined : knobValueAs(knob, running, type));
      restores.push({ op: "setInput", component: componentId, target, value: e.value });
      if (e.target.kind === "patch") ctx.affected.patches.add(e.target.id);
      if (e.target.kind === "layer") ctx.affected.layers.add(e.target.id);
    }
    if (next !== c) {
      doc = withComponent(doc, next);
      ctx.affected.components.add(componentId);
    }
  }
  ctx.doc = doc;
  commit(ctx, withoutDefaultOnly({ ...set, knobs: set.knobs.filter((k) => k !== knob) }));
  ctx.affected.knobs.add(knob.id);
  return { ids: [knob.id], applied: { op: "removeKnob", id: knob.id }, inverse: [{ op: "addKnob", knob: toNewKnob(knob), index }, ...restores] };
}

/** The locked-preset refusal, with the ways out. */
function lockedPreset(set: KnobSet, preset: KnobPreset, doing: string): never {
  const other = set.presets.find((p) => p.id !== preset.id && !p.locked);
  return fail("preset_locked", `${preset.name} is locked, so its values stay as they are${doing ? `; ${doing}` : ""}.`, {
    hint: other ? `Switch to ${other.name} to tune, or unlock ${preset.name}.` : `Unlock ${preset.name} to change it, or add a preset to tune.`,
    suggestions: [
      ...(other ? [{ description: `Switch to ${other.name}`, ops: [{ op: "applyKnobPreset", id: other.id } as Op] }] : []),
      { description: `Unlock ${preset.name}`, ops: [{ op: "updateKnobPreset", id: preset.id, locked: false }] },
    ],
  });
}

export function setKnobValue(ctx: OpContext, op: OpOf<"setKnobValue">): OpOutcome {
  const set = requireSet(ctx);
  const knob = requireKnob(ctx, set, op.id);
  const preset = requirePreset(ctx, set, op.preset ?? set.active);
  if (preset.locked && !ctx.lenient) lockedPreset(set, preset, "");
  const old = Object.hasOwn(knob.values, preset.id) ? knob.values[preset.id]! : undefined;
  const values = { ...knob.values };
  let value: Literal = null;
  if (op.value === null) {
    // null removes the preset's own value: it falls back to the first preset's (undo of a filled-in value).
    delete values[preset.id];
  } else if (ctx.lenient && isLiteral(op.value)) {
    value = op.value;
    values[preset.id] = value;
  } else {
    const check = checkKnobLiteral(knob, op.value, `Knob "${knob.name}"`);
    if (!check.ok) fail(check.error.code, check.error.message, { hint: check.error.hint });
    value = check.value;
    values[preset.id] = value;
  }
  commit(ctx, replaceKnob(set, { ...knob, values }));
  ctx.affected.knobs.add(knob.id);
  ctx.affected.presets.add(preset.id);
  return {
    ids: [knob.id],
    applied: { op: "setKnobValue", id: knob.id, preset: preset.id, value },
    inverse: [{ op: "setKnobValue", id: knob.id, preset: preset.id, value: old ?? null }],
  };
}

export function addKnobPreset(ctx: OpContext, op: OpOf<"addKnobPreset">): OpOutcome {
  const input = op.preset as unknown;
  if (!isObject(input)) fail("invalid_op", 'addKnobPreset needs "preset", like { "name": "Shipped app" }.');
  if (!ctx.lenient) refuseUnknownKeys(input, NEW_PRESET_KEYS, "A new preset");
  const before = ctx.doc.knobs;
  if (before) checkLimit(ctx, before.presets.length, MAX_KNOB_PRESETS, "presets");
  const name = checkName(input.name, before?.presets ?? [], "preset", ctx.lenient);
  const id = newPresetId(ctx, before, input.id, name);
  if (input.locked !== undefined && typeof input.locked !== "boolean") fail("invalid_knob", "A preset's locked is true or false.");
  const preset: KnobPreset = { id, name };
  if (input.locked) preset.locked = true;
  if (!before) {
    if (op.copyFrom !== undefined && op.copyFrom !== null) requirePreset(ctx, before, op.copyFrom);
    commit(ctx, { active: id, presets: [preset], knobs: [] });
    ctx.affected.presets.add(id);
    return { ids: [id], applied: { op: "addKnobPreset", preset: { ...preset } }, inverse: presetInverse(preset) };
  }
  // Undo of removeKnobPreset copies from a running preset a hand edit left dangling; knobLiteral falls back from it.
  const dangling = ctx.lenient && (op.copyFrom === undefined || op.copyFrom === null) && !getKnobPreset(before, before.active);
  const from = dangling ? before.active : requirePreset(ctx, before, op.copyFrom ?? before.active).id;
  const index = resolveIndex(op.index, before.presets.length);
  const presets = [...before.presets];
  presets.splice(index, 0, preset);
  const knobs = before.knobs.map((k) => ({ ...k, values: { ...k.values, [id]: knobLiteral(before, k, from) } }));
  commit(ctx, { ...before, presets, knobs });
  ctx.affected.presets.add(id);
  return { ids: [id], applied: { op: "addKnobPreset", preset: { ...preset }, copyFrom: from, index }, inverse: presetInverse(preset) };
}

function presetInverse(preset: KnobPreset): Op[] {
  const remove: Op = { op: "removeKnobPreset", id: preset.id };
  return preset.locked ? [{ op: "updateKnobPreset", id: preset.id, locked: false }, remove] : [remove];
}

export function updateKnobPreset(ctx: OpContext, op: OpOf<"updateKnobPreset">): OpOutcome {
  const set = requireSet(ctx);
  const old = requirePreset(ctx, set, op.id);
  const next: KnobPreset = { ...old };
  if (op.name !== undefined) next.name = checkName(op.name, set.presets.filter((p) => p !== old), "preset", ctx.lenient);
  if (op.locked !== undefined) {
    if (typeof op.locked !== "boolean") fail("invalid_knob", "A preset's locked is true or false.");
    if (op.locked) next.locked = true;
    else delete next.locked;
  }
  const oldIndex = set.presets.indexOf(old);
  let presets = set.presets.map((p) => (p === old ? next : p));
  if (op.index !== undefined) presets = move(presets, next, resolveIndex(op.index, set.presets.length - 1));
  commit(ctx, { ...set, presets });
  ctx.affected.presets.add(old.id);
  const inverse: OpOf<"updateKnobPreset"> = { op: "updateKnobPreset", id: old.id };
  const applied: OpOf<"updateKnobPreset"> = { op: "updateKnobPreset", id: old.id };
  if (next.name !== old.name) {
    inverse.name = old.name;
    applied.name = next.name;
  }
  if (!!next.locked !== !!old.locked) {
    inverse.locked = !!old.locked;
    applied.locked = !!next.locked;
  }
  const newIndex = presets.indexOf(next);
  if (newIndex !== oldIndex) {
    inverse.index = oldIndex;
    applied.index = newIndex;
  }
  return { ids: [old.id], applied, inverse: [inverse] };
}

export function removeKnobPreset(ctx: OpContext, op: OpOf<"removeKnobPreset">): OpOutcome {
  const set = requireSet(ctx);
  const preset = requirePreset(ctx, set, op.id);
  if (preset.locked && !ctx.lenient) {
    fail("preset_locked", `${preset.name} is locked. Unlock ${preset.name} first.`, { suggestions: [{ description: `Unlock ${preset.name}`, ops: [{ op: "updateKnobPreset", id: preset.id, locked: false }] }] });
  }
  if (set.presets.length === 1 && set.knobs.length) {
    fail("last_preset", `${preset.name} is the only preset, and every knob keeps its values in a preset.`, { hint: "Add another preset first, or remove the knobs." });
  }
  const index = set.presets.indexOf(preset);
  const presets = set.presets.filter((p) => p !== preset);
  const active = set.active !== preset.id ? set.active : (presets[index] ?? presets[index - 1])?.id;
  const knobs = set.knobs.map((k) => {
    if (!Object.hasOwn(k.values, preset.id)) return k;
    const values = { ...k.values };
    delete values[preset.id];
    return { ...k, values };
  });
  // The last preset of a project without knobs takes the knob set with it.
  commit(ctx, presets.length ? { ...set, active: active ?? set.active, presets, knobs } : undefined);
  ctx.affected.presets.add(preset.id);
  // Restore it unlocked, put every knob's own value back (null: it had none), then lock it again.
  const restore: Op[] = [{ op: "addKnobPreset", preset: { id: preset.id, name: preset.name }, index }];
  for (const k of set.knobs) restore.push({ op: "setKnobValue", id: k.id, preset: preset.id, value: Object.hasOwn(k.values, preset.id) ? k.values[preset.id]! : null });
  if (preset.locked) restore.push({ op: "updateKnobPreset", id: preset.id, locked: true });
  if (set.active === preset.id && presets.length) restore.push({ op: "applyKnobPreset", id: preset.id });
  return { ids: [preset.id], applied: { op: "removeKnobPreset", id: preset.id }, inverse: restore };
}

export function applyKnobPreset(ctx: OpContext, op: OpOf<"applyKnobPreset">): OpOutcome {
  const set = requireSet(ctx);
  // Undo may put back a running preset that isn't one (a hand edit; unknown_knob_preset reports it).
  const id = ctx.lenient && isValidId(op.id) && !getKnobPreset(set, op.id) ? op.id : requirePreset(ctx, set, op.id).id;
  const previous = set.active;
  if (previous !== id) commit(ctx, { ...set, active: id });
  ctx.affected.presets.add(id);
  return { ids: [id], applied: { op: "applyKnobPreset", id }, inverse: [{ op: "applyKnobPreset", id: previous }] };
}
