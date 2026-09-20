/**
 * New Knob… and Edit Knob…: name, type, group, soft range (min, max, step, unit) or options, and a
 * description. Return saves as one undo step; problems show in the form and it stays open.
 * MakeKnobPopover reuses the range fields.
 */

import { getKnob, hasKnobRange, isKnobType, KNOB_TYPES, suggestKnobRange, type EnumOption, type Id, type Knob, type KnobType, type Op } from "@sonobe/core";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import { Button } from "../../ui/Button.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { Select } from "../../ui/Select.tsx";
import { TextArea, TextField } from "../../ui/TextField.tsx";
import type { FloatingAnchor } from "../../ui/lib/useFloating.ts";
import { parseNumberInput } from "../../ui/lib/scrubMath.ts";
import { useKnobEdit } from "./useKnobEdit.ts";

export const KNOB_TYPE_LABELS: Record<KnobType, string> = { number: "Number", boolean: "On/Off", color: "Color", enum: "Choice", point: "Point", text: "Text" };

/** A number field's text: "" for none. */
const numberText = (n: number | undefined) => (n === undefined ? "" : String(n));

/** Typed text as a number; undefined when empty, NaN when it isn't one. */
export function readNumber(text: string): number | undefined {
  if (!text.trim()) return undefined;
  return parseNumberInput(text) ?? Number.NaN;
}

export interface RangeDraft {
  min: string;
  max: string;
  step: string;
  unit: string;
}

export const rangeDraft = (r: { min?: number; max?: number; step?: number; unit?: string }): RangeDraft => ({ min: numberText(r.min), max: numberText(r.max), step: numberText(r.step), unit: r.unit ?? "" });

/** The draft's range fields as numbers, or the problem with them. */
export function readRange(draft: RangeDraft): { ok: true; min?: number; max?: number; step?: number; unit?: string } | { ok: false; message: string } {
  const out: { ok: true; min?: number; max?: number; step?: number; unit?: string } = { ok: true };
  for (const key of ["min", "max", "step"] as const) {
    const n = readNumber(draft[key]);
    if (n !== undefined && !Number.isFinite(n)) return { ok: false, message: `${key === "min" ? "Min" : key === "max" ? "Max" : "Step"} isn't a number.` };
    if (n !== undefined) out[key] = n;
  }
  if (draft.unit.trim()) out.unit = draft.unit.trim();
  return out;
}

/** Min, max, step and unit, in one row. */
export function RangeFields({ draft, onChange }: { draft: RangeDraft; onChange: (draft: RangeDraft) => void }) {
  const field = (key: keyof RangeDraft, label: string, placeholder?: string) => (
    <label className="sb-knob-form__range-field">
      <span className="sb-knob-form__label">{label}</span>
      <TextField size="sm" aria-label={label} mono={key !== "unit"} inputMode={key === "unit" ? "text" : "decimal"} placeholder={placeholder} value={draft[key]} onChange={(event) => onChange({ ...draft, [key]: event.target.value })} />
    </label>
  );
  return (
    <div className="sb-knob-form__range">
      {field("min", "Min")}
      {field("max", "Max")}
      {field("step", "Step")}
      {field("unit", "Unit", "pt")}
    </div>
  );
}

export function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="sb-knob-form__row">
      <span className="sb-knob-form__label">{label}</span>
      {children}
    </label>
  );
}

/**
 * "snappy: Snappy" or "snappy" per line → options. The text has no room for descriptions, so an
 * option whose key is in `previous` keeps its description.
 */
export function parseOptions(text: string, previous: readonly EnumOption[] = []): EnumOption[] {
  const described = new Map(previous.filter((o) => o.description).map((o) => [o.key, o.description!]));
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(":");
      const key = (colon >= 0 ? line.slice(0, colon) : line).trim();
      const name = colon >= 0 ? line.slice(colon + 1).trim() : "";
      const description = described.get(key);
      return { key, name: name || key, ...(description ? { description } : {}) };
    });
}

const optionsText = (options: readonly EnumOption[] | undefined) => (options ?? []).map((o) => (o.name && o.name !== o.key ? `${o.key}: ${o.name}` : o.key)).join("\n");

/** Options compared by what they say, not by how their fields are ordered. */
const optionsKey = (options: readonly EnumOption[] | undefined) => JSON.stringify((options ?? []).map((o) => [o.key, o.name, o.description ?? null]));

export type KnobEditTarget = { kind: "new" } | { kind: "edit"; id: Id };

export interface KnobEditPopoverProps {
  target: KnobEditTarget | null;
  anchor: FloatingAnchor;
  onClose: () => void;
}

/** New Knob… and Edit Knob… (mounted only while open). */
export function KnobEditPopover({ target, anchor, onClose }: KnobEditPopoverProps) {
  if (!target) return null;
  return (
    <Popover open onOpenChange={(open) => !open && onClose()} anchor={anchor} placement="left-start" aria-label={target.kind === "new" ? "New knob" : "Edit knob"} className="sb-knob-popover">
      <KnobForm target={target} onDone={onClose} />
    </Popover>
  );
}

function KnobForm({ target, onDone }: { target: KnobEditTarget; onDone: () => void }) {
  const session = useEditorSession();
  const edit = useKnobEdit();
  const titleId = useId();
  const existing: Knob | undefined = target.kind === "edit" ? getKnob(session.document.getState().doc.knobs, target.id) : undefined;
  const [name, setName] = useState(existing?.name ?? "");
  const [type, setType] = useState<KnobType>(existing?.type ?? "number");
  const [group, setGroup] = useState(existing?.group ?? "");
  const [value, setValue] = useState("");
  const [range, setRange] = useState<RangeDraft>(rangeDraft(existing ?? {}));
  const [options, setOptions] = useState(optionsText(existing?.options));
  const [description, setDescription] = useState(existing?.description ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem("A knob needs a name, like “Commit Distance”.");
      return;
    }
    const r = readRange(range);
    if (!r.ok) {
      setProblem(r.message);
      return;
    }
    const { ok: _ok, ...bounds } = r;
    const ranged = hasKnobRange(type);
    const parsedOptions = type === "enum" ? parseOptions(options, existing?.options) : undefined;
    let ops: Op[];
    let label: string;
    if (!existing) {
      const typed = type === "number" ? readNumber(value) : undefined;
      if (typed !== undefined && !Number.isFinite(typed)) {
        setProblem("Value isn't a number.");
        return;
      }
      const knob: Record<string, unknown> = { name: trimmed, type };
      if (group.trim()) knob.group = group.trim();
      if (description.trim()) knob.description = description.trim();
      if (ranged) Object.assign(knob, bounds.min === undefined && bounds.max === undefined ? { ...suggestKnobRange([typed ?? 0]), ...bounds } : bounds);
      if (parsedOptions) knob.options = parsedOptions;
      if (typed !== undefined) knob.value = typed;
      else if (parsedOptions?.[0]) knob.value = parsedOptions[0].key;
      ops = [{ op: "addKnob", knob: knob as never }];
      label = `New Knob “${trimmed}”`;
    } else {
      const update: Record<string, unknown> = { op: "updateKnob", id: existing.id };
      if (trimmed !== existing.name) update.name = trimmed;
      if (type !== existing.type) update.type = type;
      if ((group.trim() || undefined) !== existing.group) update.group = group.trim() || null;
      if ((description.trim() || undefined) !== existing.description) update.description = description.trim() || null;
      if (ranged) {
        for (const key of ["min", "max", "step", "unit"] as const) if (bounds[key] !== existing[key]) update[key] = bounds[key] ?? null;
      }
      if (parsedOptions && optionsKey(parsedOptions) !== optionsKey(existing.options)) update.options = parsedOptions;
      if (Object.keys(update).length === 2) {
        onDone();
        return;
      }
      ops = [update as Op];
      label = `Edit Knob “${trimmed}”`;
    }
    const result = session.document.getState().apply(ops, { label });
    if (!result.ok) {
      const error = result.errors[0];
      setProblem(error ? `${error.message}${error.hint ? ` ${error.hint}` : ""}` : "That knob couldn't be saved.");
      return;
    }
    edit.end();
    onDone();
  };

  return (
    <form className="sb-knob-form" aria-labelledby={titleId} onSubmit={submit}>
      <div id={titleId} className="sb-knob-form__title">
        {existing ? `Edit ${existing.name}` : "New Knob"}
      </div>
      <FormRow label="Name">
        <TextField size="sm" aria-label="Knob name" autoFocus placeholder="Commit Distance" value={name} onChange={(event) => setName(event.target.value)} />
      </FormRow>
      <FormRow label="Type">
        <Select size="sm" aria-label="Knob type" value={type} options={KNOB_TYPES.map((t) => ({ value: t, label: KNOB_TYPE_LABELS[t] }))} onChange={(next) => isKnobType(next) && setType(next)} />
      </FormRow>
      {!existing && type === "number" && (
        <FormRow label="Value">
          <TextField size="sm" aria-label="Knob value" mono inputMode="decimal" placeholder="0" value={value} onChange={(event) => setValue(event.target.value)} />
        </FormRow>
      )}
      <FormRow label="Group">
        <TextField size="sm" aria-label="Knob group" placeholder="Throw" value={group} onChange={(event) => setGroup(event.target.value)} />
      </FormRow>
      {hasKnobRange(type) && <RangeFields draft={range} onChange={setRange} />}
      {type === "enum" && (
        <FormRow label="Options">
          <TextArea aria-label="Knob options" mono rows={3} placeholder={"snappy: Snappy\nsoft: Soft"} value={options} onChange={(event) => setOptions(event.target.value)} />
        </FormRow>
      )}
      <FormRow label="Description">
        <TextArea aria-label="Knob description" rows={2} placeholder="What it changes in the feel" value={description} onChange={(event) => setDescription(event.target.value)} />
      </FormRow>
      {problem && (
        <p className="sb-knob-form__problem" role="alert">
          {problem}
        </p>
      )}
      <div className="sb-knob-form__actions">
        <Button size="sm" variant="ghost" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit">
          {existing ? "Save" : "Add Knob"}
        </Button>
      </div>
    </form>
  );
}
