/**
 * The Knobs panel's data model: rows grouped the way the panel shows them, the partner preset that
 * ticks, ≠ marks and Flip Presets compare against, which knobs can reach a field, and the ops behind
 * Make Knob, Use Knob and Unlink. Pure, so the panel, the Inspector and the commands share it.
 */

import {
  canConnect,
  deriveKnobId,
  formatKnobValue,
  hasKnobRange,
  isLinkInput,
  knobLiteral,
  knobReaders,
  knobValueAs,
  parseAddress,
  suggestKnobRange,
  type Id,
  type InputValue,
  type Knob,
  type KnobReader,
  type KnobSet,
  type KnobType,
  type Literal,
  type NewKnob,
  type Op,
  type ResolvedPort,
  type SonobeDocument,
  type ValueType,
} from "@sonobe/core";

/** Chip and tick colors, by preset position (the running preset's chip is filled). */
export const PRESET_COLORS: readonly string[] = [
  "var(--category-interaction)",
  "var(--category-animation)",
  "var(--category-logic)",
  "var(--category-color)",
  "var(--category-math)",
  "var(--category-loops)",
  "var(--category-media)",
  "var(--category-layers)",
];

export function presetColor(set: KnobSet, presetId: Id): string {
  const index = Math.max(0, set.presets.findIndex((p) => p.id === presetId));
  return PRESET_COLORS[index % PRESET_COLORS.length]!;
}

/**
 * The preset Flip Presets switches to and the rows compare against: the one that ran before (when
 * it's still there), else the next one in order. Null with a single preset.
 */
export function partnerPreset(set: KnobSet | undefined, remembered: Id | null): Id | null {
  if (!set || set.presets.length < 2) return null;
  if (remembered && remembered !== set.active && set.presets.some((p) => p.id === remembered)) return remembered;
  const index = set.presets.findIndex((p) => p.id === set.active);
  return set.presets[(index + 1) % set.presets.length]!.id;
}

export const presetName = (set: KnobSet, id: Id): string => set.presets.find((p) => p.id === id)?.name ?? id;

const sameLiteral = (a: Literal | undefined, b: Literal | undefined) => JSON.stringify(a) === JSON.stringify(b);

export interface KnobTickModel {
  preset: Id;
  name: string;
  value: Literal;
  color: string;
}

export interface KnobRowModel {
  knob: Knob;
  /** The running preset's value. */
  value: Literal;
  /** The partner preset's value, when there is a partner. */
  partnerValue?: Literal;
  /** The value differs from the partner's. */
  differs: boolean;
  /** Inputs and layer properties that read it. */
  uses: number;
  /** Every other preset's value, for the slider's marks. */
  ticks: KnobTickModel[];
}

export interface KnobGroupModel {
  /** null: knobs without a group (they come first). */
  name: string | null;
  rows: KnobRowModel[];
}

/** Every reader of every knob, by knob id. */
export function knobUses(doc: SonobeDocument): Map<Id, KnobReader[]> {
  const out = new Map<Id, KnobReader[]>();
  for (const reader of knobReaders(doc)) {
    const list = out.get(reader.knob);
    if (list) list.push(reader);
    else out.set(reader.knob, [reader]);
  }
  return out;
}

export function knobRow(set: KnobSet, knob: Knob, partner: Id | null, uses: number): KnobRowModel {
  const value = knobLiteral(set, knob);
  const row: KnobRowModel = { knob, value, differs: false, uses, ticks: [] };
  if (partner) {
    row.partnerValue = knobLiteral(set, knob, partner);
    row.differs = !sameLiteral(value, row.partnerValue);
  }
  for (const preset of set.presets) {
    if (preset.id === set.active) continue;
    row.ticks.push({ preset: preset.id, name: preset.name, value: knobLiteral(set, knob, preset.id), color: presetColor(set, preset.id) });
  }
  return row;
}

/**
 * Rows in panel order, grouped: knobs without a group first, then groups in the order of their first
 * knob. `onlyDifferences` keeps the knobs whose value differs from the partner's, and the ones in
 * `keep` (a row being tuned or holding focus stays until the person leaves it).
 */
export function knobGroups(set: KnobSet, uses: ReadonlyMap<Id, readonly unknown[]>, partner: Id | null, onlyDifferences = false, keep: ReadonlySet<Id> = new Set()): KnobGroupModel[] {
  const ungrouped: KnobGroupModel = { name: null, rows: [] };
  const groups = new Map<string, KnobGroupModel>();
  for (const knob of set.knobs) {
    // A group keeps its place (its first knob's) even when the filter hides that knob.
    let group = ungrouped;
    if (knob.group) {
      group = groups.get(knob.group) ?? { name: knob.group, rows: [] };
      groups.set(knob.group, group);
    }
    const row = knobRow(set, knob, partner, uses.get(knob.id)?.length ?? 0);
    if (onlyDifferences && partner && !row.differs && !keep.has(knob.id)) continue;
    group.rows.push(row);
  }
  return [ungrouped, ...groups.values()].filter((g) => g.rows.length > 0);
}

/** How many knobs differ between the running preset and `other`. */
export function differenceCount(set: KnobSet, other: Id): number {
  return set.knobs.filter((k) => !sameLiteral(knobLiteral(set, k), knobLiteral(set, k, other))).length;
}

/** A value for people, with the knob's unit ("95 pt", "on"). */
export const knobValueText = (knob: Knob, value: Literal | undefined): string => formatKnobValue(knob, value);

// ---------------------------------------------------------------------------
// Fields and knobs
// ---------------------------------------------------------------------------

/** The knob type a field's port can become: number (and index), boolean, color, enum, point (and size), text. */
export function knobTypeForPort(port: Pick<ResolvedPort, "type" | "enumOptions">): KnobType | undefined {
  switch (port.type) {
    case "number":
    case "index":
      return "number";
    case "boolean":
      return "boolean";
    case "color":
      return "color";
    case "enum":
      return port.enumOptions && port.enumOptions.length >= 2 ? "enum" : undefined;
    case "point":
    case "size":
      return "point";
    case "text":
      return "text";
    default:
      return undefined;
  }
}

/** Can `knob` drive a port of this type (and options)? The link rules: the types connect, and an enum knob's options are ones the port has. */
export function knobFitsPort(knob: Pick<Knob, "type" | "options">, port: Pick<ResolvedPort, "type" | "enumOptions">): boolean {
  if (port.type === "pulse" || port.type === "layer") return false;
  if (!canConnect(knob.type, port.type).ok) return false;
  if (knob.type === "enum" && port.type === "enum" && port.enumOptions?.length) {
    const keys = new Set(port.enumOptions.map((o) => o.key));
    return (knob.options ?? []).every((o) => keys.has(o.key));
  }
  return true;
}

/** Knobs that can drive a port, in panel order. */
export function knobsForPort(set: KnobSet | undefined, port: Pick<ResolvedPort, "type" | "enumOptions">): Knob[] {
  return (set?.knobs ?? []).filter((k) => knobFitsPort(k, port));
}

/** The knob a stored input reads ("$knob.<id>"), if any. */
export function knobIdOf(value: InputValue | undefined): Id | undefined {
  if (!isLinkInput(value)) return undefined;
  const a = parseAddress(value.link);
  return a?.kind === "knob" ? a.key : undefined;
}

export interface MakeKnobDraft {
  name: string;
  group?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

/**
 * What Make Knob proposes for a field: its name, and for numbers and points the soft range worked out
 * from the value and the port (it's stored, so the person and Claude see the same slider).
 */
export function suggestMakeKnob(port: ResolvedPort, value: InputValue, group?: string): MakeKnobDraft {
  const type = knobTypeForPort(port);
  const draft: MakeKnobDraft = { name: port.name, ...(group ? { group } : {}) };
  if (type && hasKnobRange(type) && isRangeValue(value)) Object.assign(draft, suggestKnobRange([value], port));
  return draft;
}

const isRangeValue = (value: InputValue): value is Literal => typeof value === "number" || (Array.isArray(value) && value.every((n) => typeof n === "number"));

export interface MakeKnobPlan {
  id: Id;
  ops: Op[];
}

/**
 * The ops behind Make Knob: a knob holding the field's value in every preset (with the draft's range),
 * then every target linked to it. `seen` names knob ids this session already used, which a new knob
 * never takes. Undefined when the field's type can't be a knob.
 */
export function planMakeKnob(
  doc: SonobeDocument,
  componentId: Id,
  field: { port: ResolvedPort; value: InputValue; targets: readonly { address: string }[] },
  draft: MakeKnobDraft,
  seen: (id: Id) => boolean = () => false,
): MakeKnobPlan | undefined {
  const type = knobTypeForPort(field.port);
  if (!type) return undefined;
  const id = deriveKnobId(doc.knobs, draft.name, seen);
  const knob: NewKnob = { id, name: draft.name.trim(), type };
  if (draft.group?.trim()) knob.group = draft.group.trim();
  if (hasKnobRange(type)) {
    for (const key of ["min", "max", "step"] as const) if (draft[key] !== undefined && Number.isFinite(draft[key])) knob[key] = draft[key];
    if (draft.unit?.trim()) knob.unit = draft.unit.trim();
  }
  if (type === "enum") knob.options = (field.port.enumOptions ?? []).map((o) => ({ ...o }));
  const value = knobValueFor(field.value);
  if (value !== undefined) knob.value = value;
  const ops: Op[] = [{ op: "addKnob", knob }];
  for (const target of field.targets) ops.push({ op: "setInput", component: componentId, target: target.address, value: { link: `$knob.${id}` } });
  return { id, ops };
}

/** A field's literal as a knob keeps it: the same number, flag, color, key, text or vector (an index reads as a number, a size as a point). */
function knobValueFor(value: InputValue): Literal | undefined {
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  return Array.isArray(value) && value.every((n) => typeof n === "number") ? value : undefined;
}

/** Link every target to a knob (Use Knob). Targets that already read it are skipped. */
export function planUseKnob(componentId: Id, targets: readonly { address: string; stored: InputValue | undefined }[], knobId: Id): Op[] {
  return targets.filter((t) => knobIdOf(t.stored) !== knobId).map((t): Op => ({ op: "setInput", component: componentId, target: t.address, value: { link: `$knob.${knobId}` } }));
}

/** Unlink targets from a knob, each keeping the knob's running value as the literal its port takes. */
export function planUnlinkKnob(set: KnobSet, knob: Knob, componentId: Id, targets: readonly { address: string; type: ValueType }[]): Op[] {
  const running = knobLiteral(set, knob);
  return targets.map((t): Op => ({ op: "setInput", component: componentId, target: t.address, value: knobValueAs(knob, running, t.type) ?? null }));
}

/** A new preset's name: "Proposal 2" after Proposal, "Preset 2" after Default, "Preset 1" for a project's first. */
export function newPresetName(set: KnobSet | undefined): string {
  if (!set) return "Preset 1";
  const names = new Set(set.presets.map((p) => p.name.toLowerCase()));
  const running = set.presets.find((p) => p.id === set.active);
  const base = running && running.name !== "Default" ? running.name : "Preset";
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!names.has(name.toLowerCase())) return name;
  }
}
