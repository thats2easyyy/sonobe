/**
 * Knob tools: get_knobs, set_knobs and apply_knob_preset (ARCHITECTURE §10). Knobs are named values
 * inputs read through { "link": "$knob.<id>" }; presets are columns of knob values with one running.
 * set_knobs compiles to the knob ops in one batch, in a fixed order, so a single call can create a
 * reference preset, fill it and lock it.
 */

import {
  applyOps,
  findKnob,
  findKnobPreset,
  findLayer,
  formatKnobValue,
  getKnob,
  getKnobPreset,
  hasKnobRange,
  isKnobType,
  isLinkInput,
  isLiteral,
  KNOB_TYPES,
  knobDifferences,
  knobLiteral,
  knobReaders,
  knobValueAs,
  parseAddress,
  planVariablesToKnobs,
  resolveTarget,
  slugify,
  suggestKnobRange,
  uniqueId,
  type EnumOption,
  type Id,
  type Knob,
  type KnobSet,
  type KnobType,
  type Literal,
  type NewKnob,
  type Op,
  type OpResult,
  type ResolvedPort,
  type SonobeDocument,
  type ValueType,
} from "@sonobe/core";
import { z } from "zod";
import { joinList, plural } from "../format.ts";
import { failure, success } from "../results.ts";
import { ADDITIVE, DESTRUCTIVE, READ_ONLY, type ToolContext } from "../server.ts";
import { DocIdSchema, ExpectedRevisionSchema, LabelSchema, WriteOutputSchema } from "../schemas.ts";
import { writeResult } from "./write.ts";

/** "Proposal (running), Shipped app (locked)". */
function presetList(set: KnobSet): string {
  return set.presets
    .map((p) => {
      const marks = [p.id === set.active ? "running" : "", p.locked ? "locked" : ""].filter(
        Boolean,
      );
      return `${p.name}${marks.length ? ` (${marks.join(", ")})` : ""}`;
    })
    .join(", ");
}

/** "14 in 7 groups · presets Proposal (running), Shipped app (locked)", for get_document_info. */
export function knobSetSummary(set: KnobSet): string {
  const groups = new Set(set.knobs.map((k) => k.group).filter(Boolean)).size;
  return `${set.knobs.length}${groups ? ` in ${plural(groups, "group")}` : ""} · presets ${presetList(set)}`;
}

const presetLabel = (set: KnobSet, id: Id) => getKnobPreset(set, id)?.name ?? id;

/** "Throw Lookahead 0.2 → 0 s", with the unit once. */
function changeText(knob: Knob, from: Literal, to: Literal): string {
  const a = formatKnobValue({ ...knob, unit: undefined }, from);
  return `${knob.name} ${a} → ${formatKnobValue(knob, to)}`;
}

/** The preset a comparison defaults to: the one after the running preset (or before it, when it's last). */
function partnerOf(set: KnobSet): Id | undefined {
  const i = set.presets.findIndex((p) => p.id === set.active);
  return (set.presets[i + 1] ?? set.presets[i - 1])?.id;
}

function knobLine(set: KnobSet, knob: Knob, readers: number): string {
  const parts = [`  ${knob.id} "${knob.name}" ${knob.type}`];
  const range: string[] = [];
  if (knob.min !== undefined && knob.max !== undefined) range.push(`${knob.min}…${knob.max}`);
  else if (knob.min !== undefined) range.push(`min ${knob.min}`);
  else if (knob.max !== undefined) range.push(`max ${knob.max}`);
  if (knob.step !== undefined) range.push(`step ${knob.step}`);
  if (knob.unit) range.push(knob.unit);
  if (knob.options?.length) range.push(`options ${knob.options.map((o) => o.key).join("|")}`);
  if (range.length) parts[0] += ` ${range.join(" ")}`;
  for (const p of set.presets)
    parts.push(
      `${p.name} ${formatKnobValue({ ...knob, unit: undefined }, knobLiteral(set, knob, p.id))}`,
    );
  parts.push(plural(readers, "reader"));
  return parts.join(" · ");
}

/** A target given as "@card.cornerRadius" or { component, target }. */
type TargetInput = string | { component?: string | undefined; target: string };

const TargetSchema = z.union([
  z.string(),
  z.object({
    component: z.string().optional(),
    target: z.string().describe('"patchId.port" or "@layerId.prop".'),
  }),
]);

const PresetInputSchema = z.object({
  id: z
    .string()
    .optional()
    .describe(
      "An existing preset's id or name to update; otherwise the new preset's id (default: derived from its name).",
    ),
  name: z.string().optional().describe("Creating: required. Updating: renames it."),
  locked: z
    .boolean()
    .optional()
    .describe(
      "Locked presets refuse value edits; locks are applied last, after this call fills the preset.",
    ),
  copyFrom: z
    .string()
    .optional()
    .describe("Creating: start from this preset's values (default: the running preset)."),
  index: z.number().int().optional(),
  remove: z
    .literal(true)
    .optional()
    .describe("Remove the preset (not the last one, not a locked one)."),
});

const KnobInputSchema = z.object({
  id: z
    .string()
    .optional()
    .describe(
      "An existing knob's id or name to update; otherwise the new knob's id (default: derived from its name).",
    ),
  name: z
    .string()
    .optional()
    .describe('Creating: required. Name it after what it changes ("Commit Distance").'),
  type: z
    .enum(KNOB_TYPES as unknown as [KnobType, ...KnobType[]])
    .optional()
    .describe("Default: the type of the first connect target."),
  group: z
    .string()
    .nullable()
    .optional()
    .describe('Panel section, in the order the gesture happens ("Throw", "Tilt").'),
  description: z
    .string()
    .nullable()
    .optional()
    .describe("What it changes in the feel (≤ 200 characters)."),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  step: z.number().nullable().optional(),
  unit: z.string().nullable().optional().describe('Display suffix: "pt", "s", "°".'),
  options: z
    .array(z.union([z.string(), z.object({ key: z.string(), name: z.string().optional() })]))
    .nullable()
    .optional()
    .describe("Enum knobs: at least 2 option keys."),
  index: z.number().int().optional().describe("Position in the knob list."),
  value: z
    .unknown()
    .optional()
    .describe(
      "Creating: every preset's value. Updating: only when the project has one preset (use values otherwise).",
    ),
  values: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Preset id or name → value: { "Shipped app": 0 }.'),
  connect: z
    .array(TargetSchema)
    .max(100)
    .optional()
    .describe("Inputs and layer properties that read this knob from now on."),
  disconnect: z
    .array(TargetSchema)
    .max(100)
    .optional()
    .describe("Inputs that stop reading it; each keeps the running value."),
  remove: z
    .literal(true)
    .optional()
    .describe("Remove the knob; every input that reads it keeps the running value."),
});

/** A knob-able type for a port a knob would drive, or undefined (pulses, layers, media...). */
function knobTypeFor(type: ValueType): KnobType | undefined {
  if (isKnobType(type)) return type;
  if (type === "index") return "number";
  if (type === "size" || type === "anchor") return "point";
  return undefined;
}

/** A teaching failure from a set_knobs request, before anything is sent. */
class RequestError extends Error {
  readonly hint: string | undefined;
  readonly code: string;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

interface Compiled {
  ops: Op[];
  notes: string[];
  skipped: { target: string; reason: string }[];
  created: Id[];
  updated: Id[];
  removed: Id[];
  connected: number;
  disconnected: number;
  convertedCount: number;
}

interface SetKnobsArgs {
  presets?: z.infer<typeof PresetInputSchema>[] | undefined;
  knobs?: z.infer<typeof KnobInputSchema>[] | undefined;
  convertVariables?: { component?: string | undefined; ids?: string[] | undefined } | undefined;
  replaceConnections?: boolean | undefined;
}

/**
 * Compile a set_knobs request into ops, stage by stage against a local copy of the document so later
 * stages resolve what earlier ones create (a preset named in `values`, a converted knob updated in
 * `knobs`). Every created knob and preset gets an explicit id; `avoid` holds ids the host refused as
 * retired this session.
 */
function compileSetKnobs(
  doc: SonobeDocument,
  registry: Parameters<typeof applyOps>[2]["registry"],
  args: SetKnobsArgs,
  avoid: ReadonlySet<Id>,
): Compiled {
  let local = doc;
  const out: Compiled = {
    ops: [],
    notes: [],
    skipped: [],
    created: [],
    updated: [],
    removed: [],
    connected: 0,
    disconnected: 0,
    convertedCount: 0,
  };
  const stage = (ops: Op[], what: string) => {
    if (!ops.length) return;
    const r = applyOps(local, ops, { registry });
    if (!r.ok) {
      const e = r.errors[0]!;
      // Op errors name the knob or preset themselves; a converted batch says where it came from.
      throw new RequestError(
        e.code,
        what === "convertVariables" ? `convertVariables: ${e.message}` : e.message,
        e.hint,
      );
    }
    local = r.doc;
    out.ops.push(...r.applied);
  };
  const set = () => local.knobs;

  // 1. Presets: create and update, unlocks now and locks last.
  const locks: Op[] = [];
  const presetRemovals: Op[] = [];
  const presetOps: Op[] = [];
  const createdPresets = new Set<Id>();
  let presetSet = set();
  for (const [i, p] of (args.presets ?? []).entries()) {
    const found =
      p.id !== undefined
        ? findKnobPreset(presetSet, p.id)
        : p.name !== undefined
          ? findKnobPreset(presetSet, p.name)
          : undefined;
    const existing = found?.ok ? found.value : undefined;
    if (p.remove) {
      if (!existing)
        throw new RequestError(
          "unknown_knob_preset",
          `presets[${i}]: ${found && !found.ok ? found.error.message : "say which preset to remove with id."}`,
        );
      presetRemovals.push({ op: "removeKnobPreset", id: existing.id });
      continue;
    }
    if (existing) {
      const op: Extract<Op, { op: "updateKnobPreset" }> = {
        op: "updateKnobPreset",
        id: existing.id,
      };
      if (p.name !== undefined && p.name !== existing.name) {
        op.name = p.name;
        // Later entries can name it by its new name.
        presetSet = {
          ...presetSet!,
          presets: presetSet!.presets.map((x) =>
            x.id === existing.id ? { ...x, name: p.name! } : x,
          ),
        };
      }
      if (p.index !== undefined) op.index = p.index;
      if (p.locked === false) op.locked = false;
      if (op.name !== undefined || op.index !== undefined || op.locked !== undefined)
        presetOps.push(op);
      if (p.locked === true && !existing.locked)
        locks.push({ op: "updateKnobPreset", id: existing.id, locked: true });
      continue;
    }
    const name = p.name ?? p.id;
    if (!name?.trim())
      throw new RequestError(
        "invalid_knob",
        `presets[${i}] needs a name to create a preset.`,
        'For example { "name": "Shipped app", "locked": true }.',
      );
    const taken = (x: Id) => !!getKnobPreset(presetSet, x) || createdPresets.has(x) || avoid.has(x);
    const id =
      p.id !== undefined && p.name !== undefined ? p.id : uniqueId(slugify(name, "preset"), taken);
    createdPresets.add(id);
    const copy = p.copyFrom !== undefined ? findKnobPreset(presetSet, p.copyFrom) : undefined;
    if (copy && !copy.ok)
      throw new RequestError(
        copy.error.code,
        `presets[${i}].copyFrom: ${copy.error.message}`,
        copy.error.hint,
      );
    const add: Extract<Op, { op: "addKnobPreset" }> = { op: "addKnobPreset", preset: { id, name } };
    if (copy?.ok) add.copyFrom = copy.value.id;
    if (p.index !== undefined) add.index = p.index;
    presetOps.push(add);
    if (p.locked) locks.push({ op: "updateKnobPreset", id, locked: true });
    // Later entries (and copyFrom) can name presets this call creates.
    presetSet = presetSet
      ? { ...presetSet, presets: [...presetSet.presets, { id, name }] }
      : { active: id, presets: [{ id, name }], knobs: [] };
  }
  stage(presetOps, "presets");

  // 2. Variable Broadcasters → knobs.
  if (args.convertVariables) {
    const component = args.convertVariables.component;
    if (component !== undefined && !Object.hasOwn(local.components, component))
      throw new RequestError("not_found", `convertVariables: there's no component "${component}".`);
    const plan = planVariablesToKnobs(local, registry, {
      ...(component !== undefined ? { component } : {}),
      ...(args.convertVariables.ids ? { ids: args.convertVariables.ids } : {}),
      taken: (id) => avoid.has(id),
    });
    stage(plan.ops, "convertVariables");
    out.convertedCount = plan.knobs.length;
    out.created.push(...plan.knobs.map((k) => k.id));
    if (plan.knobs.length) {
      const readers = plan.knobs.reduce((n, k) => n + k.readers, 0);
      out.notes.push(
        `Converted ${plan.knobs.length === 1 ? "1 Variable Broadcaster" : `${plan.knobs.length} Variable Broadcasters`} into knobs (${plan.knobs.map((k) => k.name).join(", ")}): ${plural(readers, "input")} read them now, and their broadcasters and receivers are gone.`,
      );
    } else if (!plan.refused.length)
      out.notes.push(
        "convertVariables: no constant Variable Broadcasters with receivers to convert.",
      );
    for (const r of plan.refused)
      out.notes.push(
        `Not converted (${r.id}${r.component !== local.project.root ? ` in ${r.component}` : ""}): ${r.reason}`,
      );
  }

  // 3. Knobs: create and update, with values. 4. connect and disconnect.
  const knobOps: Op[] = [];
  const linkOps: Op[] = [];
  const knobRemovals: Op[] = [];
  const createdKnobs = new Set<Id>(out.created);
  const resolveTargetInput = (
    t: TargetInput,
    where: string,
  ): { component: Id; target: string; port: ResolvedPort | undefined; current: unknown } => {
    const componentId =
      typeof t === "string" ? local.project.root : (t.component ?? local.project.root);
    const target = typeof t === "string" ? t : t.target;
    const c = Object.hasOwn(local.components, componentId)
      ? local.components[componentId]
      : undefined;
    if (!c) throw new RequestError("not_found", `${where}: there's no component "${componentId}".`);
    const resolved = resolveTarget(local, c, target, { registry });
    if (!resolved.ok)
      throw new RequestError(
        resolved.error.code,
        `${where}: ${resolved.error.message}`,
        resolved.error.hint,
      );
    const a = parseAddress(target);
    const current =
      a?.kind === "patch"
        ? c.patches[a.id]?.inputs[a.key]
        : a?.kind === "layer"
          ? findLayer(c.layers, a.id)?.layer.props[a.key]
          : undefined;
    return {
      component: componentId,
      target: resolved.value.address,
      port: resolved.value.port,
      current,
    };
  };
  const presetValues = (
    values: Record<string, unknown> | undefined,
    where: string,
  ): Record<Id, unknown> => {
    const out: Record<Id, unknown> = {};
    for (const [ref, value] of Object.entries(values ?? {})) {
      const preset = findKnobPreset(set(), ref);
      if (!preset.ok)
        throw new RequestError(
          preset.error.code,
          `${where}.values: ${preset.error.message}`,
          preset.error.hint,
        );
      out[preset.value.id] = value;
    }
    return out;
  };
  for (const [i, k] of (args.knobs ?? []).entries()) {
    const where = `knobs[${i}]${k.name ? ` (${k.name})` : k.id ? ` (${k.id})` : ""}`;
    const ref = k.id ?? k.name;
    const found = ref !== undefined ? findKnob(set(), ref) : undefined;
    let knob = found?.ok ? found.value : undefined;
    if (k.remove) {
      if (!knob)
        throw new RequestError(
          "unknown_knob",
          `${where}: ${found && !found.ok ? found.error.message : "say which knob to remove with id."}`,
          found && !found.ok ? found.error.hint : undefined,
        );
      knobRemovals.push({ op: "removeKnob", id: knob.id });
      out.removed.push(knob.id);
      continue;
    }
    const connects = (k.connect ?? []).map((t, j) =>
      resolveTargetInput(t, `${where}.connect[${j}]`),
    );
    const options =
      k.options === null
        ? null
        : k.options?.map((o): EnumOption =>
            typeof o === "string" ? { key: o, name: o } : { key: o.key, name: o.name ?? o.key },
          );
    if (!knob) {
      const name = k.name ?? k.id;
      if (!name?.trim())
        throw new RequestError(
          "invalid_knob",
          `${where} needs a name to create a knob.`,
          'For example { "name": "Commit Distance", "value": 95, "connect": ["lands_past.value2"] }.',
        );
      const first = connects[0];
      const guesses: string[] = [];
      let type = k.type;
      let portOptions: EnumOption[] | undefined;
      if (!type) {
        const inferred = first?.port ? knobTypeFor(first.port.type) : undefined;
        if (!inferred) {
          throw new RequestError(
            "invalid_knob",
            `${where} needs a type${first?.port ? `: ${first.target} takes ${first.port.type}, which a knob can't hold` : ", or a connect target to take it from"}.`,
            `Types: ${KNOB_TYPES.join(", ")}.`,
          );
        }
        type = inferred;
        guesses.push(`type ${type}`);
        if (type === "enum")
          portOptions = first?.port?.enumOptions?.map((o) => ({ key: o.key, name: o.name }));
      }
      // The value presets `values` doesn't name start from: given, else what the first target holds.
      let value = k.value;
      if (value === undefined && first?.port && knobTypeFor(first.port.type) === type) {
        const current =
          isLiteral(first.current) && first.current !== null ? first.current : undefined;
        value =
          current ??
          (first.port?.default !== undefined &&
          isLiteral(first.port.default) &&
          first.port.default !== null
            ? first.port.default
            : undefined);
        if (value !== undefined)
          guesses.push(`value ${JSON.stringify(value)} from ${first.target}`);
      }
      const id =
        k.id !== undefined && k.name !== undefined
          ? k.id
          : uniqueId(
              slugify(name, "knob"),
              (x) => !!getKnob(set(), x) || createdKnobs.has(x) || avoid.has(x),
            );
      createdKnobs.add(id);
      const newKnob: NewKnob = { id, name: name.trim(), type };
      for (const field of ["group", "description", "unit"] as const)
        if (typeof k[field] === "string") newKnob[field] = k[field] as string;
      for (const field of ["min", "max", "step"] as const)
        if (typeof k[field] === "number") newKnob[field] = k[field] as number;
      if (options) newKnob.options = options;
      else if (portOptions && portOptions.length >= 2) {
        newKnob.options = portOptions;
        guesses.push(`options ${portOptions.map((o) => o.key).join("|")}`);
      }
      if (value !== undefined) newKnob.value = value as Literal;
      if (k.values) newKnob.values = presetValues(k.values, where) as Record<Id, Literal>;
      if (
        hasKnobRange(type) &&
        k.min === undefined &&
        k.max === undefined &&
        k.step === undefined
      ) {
        const sample = [value, ...Object.values(newKnob.values ?? {})].filter((v): v is Literal =>
          isLiteral(v),
        );
        const range = suggestKnobRange(sample, first?.port);
        Object.assign(newKnob, range, typeof k.unit === "string" ? { unit: k.unit } : {});
        if (range.min !== undefined)
          guesses.push(
            `range ${range.min}…${range.max} step ${range.step}${range.unit && k.unit === undefined ? ` ${range.unit}` : ""} from ${first?.port?.min !== undefined && first.port.max !== undefined ? `${first.target}'s declared range` : "the value"}`,
          );
      }
      if (k.index !== undefined) knobOps.push({ op: "addKnob", knob: newKnob, index: k.index });
      else knobOps.push({ op: "addKnob", knob: newKnob });
      out.created.push(id);
      if (guesses.length)
        out.notes.push(
          `${name}: inferred ${joinList(guesses)} (pass ${guesses.length === 1 ? "it" : "them"} to set your own).`,
        );
      knob = { id, name, type, values: {} };
    } else {
      const op: Extract<Op, { op: "updateKnob" }> = { op: "updateKnob", id: knob.id };
      const raw = op as unknown as Record<string, unknown>;
      if (k.name !== undefined && k.name !== knob.name && k.id !== undefined) op.name = k.name;
      for (const field of [
        "group",
        "description",
        "min",
        "max",
        "step",
        "unit",
        "index",
        "type",
      ] as const)
        if (k[field] !== undefined) raw[field] = k[field];
      if (options !== undefined) op.options = options;
      if (Object.keys(op).length > 2) {
        knobOps.push(op);
        out.updated.push(knob.id);
      }
      const values = presetValues(k.values, where);
      if (k.value !== undefined) {
        const presets = set()!.presets;
        if (presets.length > 1 && !k.values) {
          throw new RequestError(
            "ambiguous_value",
            `${knob.name} has values in ${joinList(presets.map((p) => p.name))}. Say which one: values: { "${presets[0]!.name}": ${JSON.stringify(k.value)} }.`,
            "value sets every preset only when a knob is created.",
          );
        }
        values[set()!.active] ??= k.value;
      }
      for (const [preset, value] of Object.entries(values))
        knobOps.push({ op: "setKnobValue", id: knob.id, preset, value: value as Literal });
      if (Object.keys(values).length && !out.updated.includes(knob.id)) out.updated.push(knob.id);
    }
    for (const c of connects) {
      const link = `$knob.${knob.id}`;
      if (isLinkInput(c.current) && c.current.link !== link && !args.replaceConnections) {
        out.skipped.push({
          target: c.target,
          reason: `driven by ${c.current.link}; pass replaceConnections: true to replace it`,
        });
        continue;
      }
      linkOps.push({ op: "setInput", component: c.component, target: c.target, value: { link } });
      out.connected++;
    }
    for (const [j, t] of (k.disconnect ?? []).entries()) {
      const c = resolveTargetInput(t, `${where}.disconnect[${j}]`);
      if (!isLinkInput(c.current) || c.current.link !== `$knob.${knob.id}`) {
        out.skipped.push({ target: c.target, reason: `doesn't read ${knob.name}` });
        continue;
      }
      const existing = getKnob(set(), knob.id);
      const running = existing ? knobLiteral(set()!, existing) : null;
      const kept =
        existing && running !== null && c.port
          ? (knobValueAs(existing, running, c.port.type) ?? null)
          : null;
      linkOps.push({ op: "setInput", component: c.component, target: c.target, value: kept });
      out.disconnected++;
    }
  }
  stage(knobOps, "knobs");
  stage(linkOps, "connections");
  // 5. Removals, knobs before presets. 6. Locks last.
  stage(knobRemovals, "knob removals");
  stage(presetRemovals, "preset removals");
  stage(locks, "locks");
  return out;
}

export function registerKnobTools(tc: ToolContext): void {
  const { host } = tc;

  tc.tool(
    "get_knobs",
    {
      title: "Get knobs",
      description:
        'The project\'s knobs (named values inputs read through { "link": "$knob.<id>" }) and presets (a value for every knob; one runs): each knob\'s range, unit, values per preset and how many inputs read it, grouped as the panel shows them, plus which knobs differ between two presets. compare defaults to the running preset and the next one.',
      input: z.object({
        docId: DocIdSchema.optional(),
        compare: z
          .tuple([z.string(), z.string()])
          .optional()
          .describe("Two preset ids or names to compare."),
        onlyDifferences: z
          .boolean()
          .optional()
          .describe("List only knobs whose values differ between the compared presets."),
      }),
      annotations: READ_ONLY,
    },
    async ({ docId, compare, onlyDifferences }) => {
      const snap = await host.getDocument(docId);
      const set = snap.doc.knobs;
      if (!set) {
        return success(
          'This project has no knobs yet. Make the numbers a person will tune into knobs with set_knobs, e.g. { "presets": [{ "name": "Proposal" }], "knobs": [{ "name": "Commit Distance", "connect": ["lands_past.value2"] }] }.',
          {
            docId: snap.docId,
            revision: snap.revision,
            active: null,
            presets: [],
            knobs: [],
            compare: null,
          },
        );
      }
      let pair: [Id, Id] | undefined;
      if (compare) {
        const found = compare.map((ref) => findKnobPreset(set, ref));
        for (const f of found)
          if (!f.ok)
            return failure({
              code: f.error.code,
              message: `compare: ${f.error.message}`,
              ...(f.error.hint ? { hint: f.error.hint } : {}),
            });
        pair = found.map((f) => (f.ok ? f.value.id : "")) as [Id, Id];
      } else {
        const partner = partnerOf(set);
        if (partner) pair = [set.active, partner];
      }
      const differences = pair ? knobDifferences(set, pair[0], pair[1]) : [];
      const differs = new Set(differences.map((d) => d.id));
      const readers = new Map<Id, { component: Id; target: string }[]>();
      for (const r of knobReaders(snap.doc))
        readers.set(r.knob, [
          ...(readers.get(r.knob) ?? []),
          { component: r.component, target: r.target },
        ]);
      const shown = set.knobs.filter((k) => !onlyDifferences || differs.has(k.id));
      const groups = new Set(set.knobs.map((k) => k.group).filter(Boolean)).size;
      const lines = [
        `${plural(set.knobs.length, "knob")}${groups ? ` in ${plural(groups, "group")}` : ""} · running ${presetLabel(set, set.active)} · presets: ${set.presets.map((p) => `${p.name}${p.locked ? " (locked)" : ""}`).join(", ")}`,
      ];
      const order: (string | undefined)[] = [];
      for (const k of shown) if (!order.includes(k.group)) order.push(k.group);
      order.sort((a, b) => (a === undefined ? -1 : b === undefined ? 1 : 0));
      for (const group of order) {
        if (group !== undefined) lines.push(group);
        for (const k of shown.filter((x) => x.group === group))
          lines.push(knobLine(set, k, readers.get(k.id)?.length ?? 0));
      }
      if (onlyDifferences && !shown.length) lines.push("  No knob differs between them.");
      if (pair) {
        const listed = differences
          .slice(0, 6)
          .map((d) => changeText(getKnob(set, d.id)!, d.a, d.b));
        lines.push(
          `${presetLabel(set, pair[0])} vs ${presetLabel(set, pair[1])}: ${differences.length ? `${differences.length} of ${set.knobs.length} differ (${listed.join(", ")}${differences.length > 6 ? ", …" : ""})` : "no knob differs"}`,
        );
      }
      return success(lines.join("\n"), {
        docId: snap.docId,
        revision: snap.revision,
        active: set.active,
        presets: set.presets.map((p) => ({
          id: p.id,
          name: p.name,
          locked: !!p.locked,
          running: p.id === set.active,
        })),
        knobs: shown.map((k) => ({
          ...k,
          running: knobLiteral(set, k),
          readers: readers.get(k.id) ?? [],
        })),
        compare: pair ? { a: pair[0], b: pair[1], differences } : null,
      });
    },
  );

  tc.tool(
    "set_knobs",
    {
      title: "Set knobs",
      description:
        'Create, tune, connect and remove knobs and presets in one undoable batch. A knob is a named value (number, boolean, color, enum, point, text) that inputs and layer properties read through { "link": "$knob.<id>" }; a preset holds a value for every knob, and one preset runs. Knobs and presets are matched by id or name (case-insensitive): a match is updated, anything else is created. The call runs in this order: presets (locks held back), convertVariables (constant Variable Broadcasters become knobs), knobs and their values, connect/disconnect, removals, then locks, so one call can create a reference preset, fill it and lock it. A new knob takes its type, value and range from its first connect target unless given; the result says what it inferred. value sets every preset when creating; afterwards say which preset in values. Build numbers a person will want to tune or compare as knobs, never as values in names.',
      input: z.object({
        docId: DocIdSchema.optional(),
        presets: z.array(PresetInputSchema).max(16).optional(),
        knobs: z.array(KnobInputSchema).max(200).optional(),
        convertVariables: z
          .object({
            component: z.string().optional(),
            ids: z.array(z.string()).max(200).optional(),
          })
          .optional()
          .describe(
            "Turn constant Variable Broadcasters (in one component, or only these ids) into knobs: every input their receivers drive reads the knob, and the broadcasters and receivers go.",
          ),
        replaceConnections: z
          .boolean()
          .optional()
          .describe(
            "connect may replace an input's existing connection (default false: such inputs are skipped and reported).",
          ),
        dryRun: z.boolean().optional(),
        label: LabelSchema.optional(),
        expectedRevision: ExpectedRevisionSchema.optional(),
      }),
      output: WriteOutputSchema,
      annotations: DESTRUCTIVE,
    },
    async (args, ctx) => {
      if (!args.presets?.length && !args.knobs?.length && !args.convertVariables)
        return failure({
          code: "nothing_to_do",
          message: "set_knobs needs presets, knobs or convertVariables.",
          hint: 'For example { "knobs": [{ "name": "Commit Distance", "value": 95, "connect": ["lands_past.value2"] }] }.',
        });
      const avoid = new Set<Id>();
      for (let attempt = 0; attempt < 5; attempt++) {
        const snap = await host.getDocument(args.docId);
        let compiled: Compiled;
        try {
          compiled = compileSetKnobs(snap.doc, host.registry, args, avoid);
        } catch (err) {
          if (err instanceof RequestError)
            return failure({
              code: err.code,
              message: err.message,
              ...(err.hint ? { hint: err.hint } : {}),
            });
          throw err;
        }
        if (!compiled.ops.length) {
          const skippedText = compiled.skipped.map((s) => `Skipped ${s.target}: ${s.reason}.`);
          return success(
            [
              `Nothing to change (revision ${snap.revision}).`,
              ...compiled.notes,
              ...skippedText,
            ].join("\n"),
            {
              ok: true,
              changed: "none",
              docId: snap.docId,
              revision: snap.revision,
              skipped: compiled.skipped,
            },
          );
        }
        const label = args.label?.trim() || describeKnobChange(compiled);
        const result = await host.apply(compiled.ops, {
          label,
          author: tc.author(ctx),
          signal: tc.signal(ctx),
          ...(args.docId !== undefined ? { docId: args.docId } : {}),
          ...(args.expectedRevision !== undefined
            ? { expectedRevision: args.expectedRevision }
            : {}),
          ...(args.dryRun ? { dryRun: true } : {}),
        });
        // A derived id retired earlier this session: derive again past it.
        const retired = result.ok ? undefined : retiredIdIn(result.results, compiled.ops);
        if (retired) {
          avoid.add(retired);
          continue;
        }
        const after = result.ok
          ? result.dryRun
            ? result.preview
            : (await host.getDocument(args.docId)).doc
          : undefined;
        const notes = [
          summaryLine(compiled, after?.knobs),
          ...compiled.notes,
          ...compiled.skipped.map((s) => `Skipped ${s.target}: ${s.reason}.`),
        ];
        const set = after?.knobs;
        const partner = set ? partnerOf(set) : undefined;
        if (set && partner) {
          const n = knobDifferences(set, set.active, partner).length;
          notes.push(
            `${presetLabel(set, set.active)} vs ${presetLabel(set, partner)}: ${n} of ${plural(set.knobs.length, "knob")} differ. The person's viewer runs ${presetLabel(set, set.active)}; switch with apply_knob_preset when they ask, and compare without touching it with sim_reset({ "preset": … }).`,
          );
        }
        return writeResult(result, {
          notes: result.ok
            ? notes
            : compiled.skipped.map((s) => `Skipped ${s.target}: ${s.reason}.`),
          data: {
            skipped: compiled.skipped,
            knobs: {
              created: compiled.created,
              updated: compiled.updated,
              removed: compiled.removed,
            },
          },
        });
      }
      return failure({
        code: "id_retired",
        message:
          "Couldn't find free ids for the new knobs or presets: the ones derived from their names were all used earlier in this session.",
        hint: "Pass explicit ids.",
      });
    },
  );

  tc.tool(
    "apply_knob_preset",
    {
      title: "Apply knob preset",
      description:
        "Switch which knob preset the prototype runs, live and without restarting. This changes what the person's viewer and phone show, so do it when they ask. To compare presets without touching their viewer, use sim_reset({ preset }).",
      input: z.object({
        docId: DocIdSchema.optional(),
        preset: z.string().describe("Preset id or name."),
        label: LabelSchema.optional(),
        expectedRevision: ExpectedRevisionSchema.optional(),
      }),
      output: WriteOutputSchema,
      annotations: ADDITIVE,
    },
    async (args, ctx) => {
      const snap = await host.getDocument(args.docId);
      const set = snap.doc.knobs;
      const found = findKnobPreset(set, args.preset);
      if (!found.ok)
        return failure({
          code: found.error.code,
          message: found.error.message,
          ...(found.error.hint ? { hint: found.error.hint } : {}),
        });
      const preset = found.value;
      if (set!.active === preset.id)
        return success(
          `${preset.name} is already running (revision ${snap.revision}). Nothing changed.`,
          { ok: true, changed: "none", docId: snap.docId, revision: snap.revision },
        );
      const result = await host.apply([{ op: "applyKnobPreset", id: preset.id }], {
        label: args.label?.trim() || `switched to ${preset.name}`,
        author: tc.author(ctx),
        signal: tc.signal(ctx),
        ...(args.docId !== undefined ? { docId: args.docId } : {}),
        ...(args.expectedRevision !== undefined ? { expectedRevision: args.expectedRevision } : {}),
      });
      const differences = knobDifferences(set!, set!.active, preset.id);
      const changes = differences
        .slice(0, 8)
        .map((d) => changeText(getKnob(set!, d.id)!, d.a, d.b));
      const note = `Running ${preset.name} (was ${presetLabel(set!, set!.active)}) · ${differences.length ? `${plural(differences.length, "knob")} changed: ${changes.join(", ")}${differences.length > 8 ? ", …" : ""}` : "no knob value changed"}`;
      return writeResult(result, {
        notes: [note],
        data: { active: preset.id, previous: set!.active, differences },
      });
    },
  );
}

/** The op a failed batch stopped at, when it's an explicit id the host refused as retired. */
function retiredIdIn(results: readonly OpResult[], ops: readonly Op[]): Id | undefined {
  const failed = results.find((r) => !r.ok && r.error?.code === "id_retired");
  if (!failed) return undefined;
  const op = ops[failed.index];
  if (op?.op === "addKnob") return op.knob.id;
  if (op?.op === "addKnobPreset") return op.preset.id;
  return undefined;
}

function describeKnobChange(c: Compiled): string {
  const parts: string[] = [];
  if (c.convertedCount) parts.push(`converted ${plural(c.convertedCount, "variable")} to knobs`);
  const made = c.created.length - c.convertedCount;
  if (made > 0) parts.push(`made ${plural(made, "knob")}`);
  if (c.updated.length) parts.push(`tuned ${plural(c.updated.length, "knob")}`);
  if (c.removed.length) parts.push(`removed ${plural(c.removed.length, "knob")}`);
  if (!parts.length) parts.push("changed knob presets");
  return parts.join(", ");
}

/** "Knobs: created 3 (2 groups), updated 1 · Presets: Proposal (running), Shipped app (locked) · Connected 4 inputs". */
function summaryLine(c: Compiled, set: KnobSet | undefined): string {
  const groups = set
    ? new Set(
        set.knobs
          .filter((k) => c.created.includes(k.id))
          .map((k) => k.group)
          .filter(Boolean),
      ).size
    : 0;
  const parts = [
    `Knobs: created ${c.created.length}${groups ? ` (${plural(groups, "group")})` : ""}, updated ${c.updated.length}${c.removed.length ? `, removed ${c.removed.length}` : ""}`,
  ];
  if (set) parts.push(`Presets: ${presetList(set)}`);
  if (c.connected) parts.push(`Connected ${plural(c.connected, "input")}`);
  if (c.disconnected)
    parts.push(`Disconnected ${plural(c.disconnected, "input")} (each keeps the running value)`);
  return parts.join(" · ");
}
