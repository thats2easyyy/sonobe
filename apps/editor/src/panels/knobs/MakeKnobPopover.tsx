/**
 * Make Knob… on an Inspector field: a name (the port's), a group (the last one used) and, for numbers
 * and points, the soft range worked out from the value, all editable. Return makes the knob with the
 * field's value in every preset and links every selected target to it, as one undo step.
 */

import { hasKnobRange } from "@sonobe/core";
import { useId, useState, type FormEvent } from "react";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import { makeKnobLabel } from "../../state/undoLabels.ts";
import { Button } from "../../ui/Button.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { TextField } from "../../ui/TextField.tsx";
import { toast } from "../../ui/Toast.tsx";
import type { FloatingAnchor } from "../../ui/lib/useFloating.ts";
import type { InspectorField } from "../inspector/model.ts";
import { FormRow, RangeFields, rangeDraft, readRange, type RangeDraft } from "./KnobEditPopover.tsx";
import { knobsUi, showKnobs } from "./knobsStore.ts";
import { knobTypeForPort, planMakeKnob, suggestMakeKnob } from "./model.ts";

export interface MakeKnobPopoverProps {
  field: InspectorField | null;
  anchor: FloatingAnchor;
  onClose: () => void;
}

export function MakeKnobPopover({ field, anchor, onClose }: MakeKnobPopoverProps) {
  if (!field) return null;
  return (
    <Popover open onOpenChange={(open) => !open && onClose()} anchor={anchor} placement="left-start" aria-label="Make knob" className="sb-knob-popover">
      <MakeKnobForm field={field} onDone={onClose} />
    </Popover>
  );
}

function MakeKnobForm({ field, onDone }: { field: InspectorField; onDone: () => void }) {
  const session = useEditorSession();
  const titleId = useId();
  const [initial] = useState(() => suggestMakeKnob(field.port, field.value, knobsUi(session).getState().lastGroup ?? undefined));
  const [name, setName] = useState(initial.name);
  const [group, setGroup] = useState(initial.group ?? "");
  const [range, setRange] = useState<RangeDraft>(rangeDraft(initial));
  const [problem, setProblem] = useState<string | null>(null);
  const type = knobTypeForPort(field.port);

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
    const state = session.document.getState();
    const seen = new Set(state.seenIds().knobs);
    const componentId = session.currentComponentId();
    const plan = planMakeKnob(state.doc, componentId, field, { name: trimmed, ...(group.trim() ? { group: group.trim() } : {}), ...bounds }, (id) => seen.has(id));
    if (!plan) {
      setProblem(`${field.port.name} can't be a knob.`);
      return;
    }
    const result = state.apply(plan.ops, { label: makeKnobLabel(trimmed), defaultComponent: componentId });
    if (!result.ok) {
      const error = result.errors[0];
      setProblem(error ? `${error.message}${error.hint ? ` ${error.hint}` : ""}` : "That knob couldn't be made.");
      return;
    }
    knobsUi(session).getState().set({ lastGroup: group.trim() || null });
    toast({ id: "knob-made", title: "Added to Knobs", description: `${trimmed} now drives ${field.targets.length === 1 ? field.port.name : `${field.targets.length} fields`}.`, tone: "success", action: { label: "Show", onClick: () => showKnobs(session, plan.id) } });
    onDone();
  };

  return (
    <form className="sb-knob-form" aria-labelledby={titleId} onSubmit={submit}>
      <div id={titleId} className="sb-knob-form__title">
        Make Knob
      </div>
      <FormRow label="Name">
        <TextField size="sm" aria-label="Knob name" autoFocus value={name} onChange={(event) => setName(event.target.value)} onFocus={(event) => event.currentTarget.select()} />
      </FormRow>
      <FormRow label="Group">
        <TextField size="sm" aria-label="Knob group" placeholder="None" value={group} onChange={(event) => setGroup(event.target.value)} />
      </FormRow>
      {type && hasKnobRange(type) && <RangeFields draft={range} onChange={setRange} />}
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
          Make Knob
        </Button>
      </div>
    </form>
  );
}
