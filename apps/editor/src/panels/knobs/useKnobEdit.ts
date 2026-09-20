/**
 * Applying knob edits from the Knobs tab and the Inspector: a slider drag or scrub is one undo step
 * ("Tune Commit Distance to 110 pt (Proposal)"), a run of preset switches is one step until another
 * edit ("Switch Presets"), and failures show as a toast with their hint.
 */

import { getKnob, getKnobPreset, type ApplyOpsResult, type Id, type Literal, type Op } from "@sonobe/core";
import { useEffect, useMemo, useRef } from "react";
import type { ApplyInput } from "../../state/document.ts";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import type { EditorSession } from "../../state/session.ts";
import { SWITCH_PRESETS_LABEL, tuneKnobLabel } from "../../state/undoLabels.ts";
import { toast } from "../../ui/Toast.tsx";
import { knobValueText } from "./model.ts";

export interface KnobEdit {
  /** Apply ops as one undo step (errors show as a toast). */
  apply: (ops: readonly Op[], label: string) => ApplyOpsResult | undefined;
  /**
   * Set a knob's value in the running preset. With `continuous` (a drag, a scrub) the changes merge
   * into one undo step until `end()`; otherwise it's its own step.
   */
  tune: (knobId: Id, value: Literal, continuous?: boolean) => ApplyOpsResult | undefined;
  /** End a drag or scrub. */
  end: () => void;
  /** Run another preset; consecutive switches undo as one step. */
  switchPreset: (presetId: Id) => ApplyOpsResult | undefined;
}

const SWITCH_KEY = "knobs:switch";

const tuneKey = (knobId: Id, presetId: Id) => `knobs:${knobId}:${presetId}`;

/** The knob an open drag or scrub is tuning, read from the document store's `gesture`. */
export function tuningKnob(gesture: string | null): Id | null {
  return gesture?.match(/^knobs:(.+):[^:]+$/)?.[1] ?? null;
}

function report(result: ApplyOpsResult): ApplyOpsResult {
  if (!result.ok) {
    const error = result.errors[0];
    toast({ id: "knob-edit", title: error?.message ?? "That change couldn't be made.", ...(error?.hint ? { description: error.hint } : {}), tone: "warn" });
  }
  return result;
}

/** Knob edits for `session` (the hook form closes an open drag when the control unmounts). */
export function knobEdit(session: EditorSession, open: { current: string | null } = { current: null }): KnobEdit {
  const store = () => session.document.getState();
  const close = () => {
    const key = open.current;
    if (key === null) return;
    open.current = null;
    store().endGesture(key);
  };
  const run = (ops: readonly Op[], input: ApplyInput) => (ops.length ? report(store().apply(ops, { defaultComponent: session.currentComponentId(), ...input })) : undefined);
  return {
    apply(ops, label) {
      close();
      return run(ops, { label });
    },
    tune(knobId, value, continuous = false) {
      const set = store().doc.knobs;
      const knob = getKnob(set, knobId);
      if (!set || !knob) return undefined;
      const preset = getKnobPreset(set, set.active);
      const label = tuneKnobLabel(knob.name, knobValueText(knob, value), preset?.name ?? set.active);
      const op: Op = { op: "setKnobValue", id: knobId, value };
      if (!continuous) {
        close();
        return run([op], { label });
      }
      const key = tuneKey(knobId, set.active);
      if (open.current !== null && open.current !== key) close();
      const phase = open.current === key ? "update" : "begin";
      open.current = key;
      return run([op], { label, coalesceKey: key, gesture: phase });
    },
    end: close,
    switchPreset(presetId) {
      close();
      if (store().doc.knobs?.active === presetId) return undefined;
      return run([{ op: "applyKnobPreset", id: presetId }], { label: SWITCH_PRESETS_LABEL, coalesceKey: SWITCH_KEY, run: true });
    },
  };
}

export function useKnobEdit(): KnobEdit {
  const session = useEditorSession();
  const open = useRef<string | null>(null);
  const edit = useMemo(() => knobEdit(session, open), [session]);
  // A control that unmounts mid-drag must not leave its gesture open.
  useEffect(() => () => edit.end(), [edit]);
  return edit;
}
