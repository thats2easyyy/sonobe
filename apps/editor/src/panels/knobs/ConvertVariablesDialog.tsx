/**
 * Convert Variables to Knobs…: the constant Variable Broadcasters planVariablesToKnobs would turn
 * into knobs, with checkboxes, and the ones it won't convert with the reason. Converting is one undo
 * step: each knob keeps the broadcaster's value in every preset, and the receivers and the
 * broadcaster go.
 */

import { applyOps, planVariablesToKnobs, type Op, type VariableKnobPlan } from "@sonobe/core";
import { useId, useMemo, useState } from "react";
import { useDocument, useEditorSession } from "../../state/EditorProvider.tsx";
import { convertVariablesLabel } from "../../state/undoLabels.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Checkbox } from "../../ui/Toggle.tsx";

const keyOf = (k: { component: string; from: string }) => `${k.component}\u0000${k.from}`;

/** Every candidate and refusal in the document. */
export function useVariableCandidates(): VariableKnobPlan {
  const session = useEditorSession();
  const doc = useDocument((s) => s.doc);
  // Tuning a knob changes no component, so it doesn't plan again.
  return useMemo(() => planVariablesToKnobs(doc, session.registry), [doc.components, session.registry]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function ConvertVariablesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <ConvertVariablesContent onClose={onClose} />;
}

function ConvertVariablesContent({ onClose }: { onClose: () => void }) {
  const session = useEditorSession();
  const doc = useDocument((s) => s.doc);
  const titleId = useId();
  const plan = useVariableCandidates();
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const chosen = plan.knobs.filter((k) => !unchecked.has(keyOf(k)));
  const name = (componentId: string) => doc.components[componentId]?.name ?? componentId;

  const convert = () => {
    if (!chosen.length) return;
    const state = session.document.getState();
    const seen = new Set(state.seenIds().knobs);
    // Broadcaster ids are per component, so each component plans on the document the one before it
    // left: knob names and ids stay unique across them, and the whole thing is still one batch.
    const byComponent = new Map<string, string[]>();
    for (const k of chosen) byComponent.set(k.component, [...(byComponent.get(k.component) ?? []), k.from]);
    let scratch = state.doc;
    const ops: Op[] = [];
    let count = 0;
    for (const [component, ids] of byComponent) {
      const part = planVariablesToKnobs(scratch, session.registry, { component, ids, taken: (id) => seen.has(id) });
      const staged = applyOps(scratch, part.ops, { registry: session.registry });
      if (!staged.ok) break;
      scratch = staged.doc;
      ops.push(...part.ops);
      count += part.knobs.length;
    }
    const result = state.apply(ops, { label: convertVariablesLabel(count) });
    if (!result.ok || !count) {
      const error = result.errors[0];
      toast({ title: error?.message ?? "Those variables couldn't be converted.", ...(error?.hint ? { description: error.hint } : {}), tone: "warn" });
      return;
    }
    toast({ title: `Converted ${count} ${count === 1 ? "variable" : "variables"} to knobs`, description: "Tune them here, or add a preset to compare.", tone: "success" });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} aria-labelledby={titleId} width={480} className="sb-appdialog" modalScope="serviceDialog">
      <div className="sb-appdialog__body">
        <h2 id={titleId} className="sb-appdialog__title">
          Convert Variables to Knobs
        </h2>
        <p className="sb-appdialog__text">Each knob keeps its variable's value in every preset. The inputs its receivers fed read the knob instead, and the broadcaster and receivers go.</p>
        {plan.knobs.length ? (
          <ul className="sb-knobs-convert" aria-label="Variables to convert">
            {plan.knobs.map((k) => {
              const key = keyOf(k);
              const checked = !unchecked.has(key);
              return (
                <li key={key} className="sb-knobs-convert__item">
                  <Checkbox
                    checked={checked}
                    label={k.name}
                    onChange={(on) =>
                      setUnchecked((s) => {
                        const next = new Set(s);
                        if (on) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  />
                  <span className="sb-knobs-convert__meta">
                    {k.readers} {k.readers === 1 ? "input" : "inputs"}
                    {k.component !== doc.project.root ? ` · in ${name(k.component)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="sb-appdialog__text">There are no constant Variable Broadcasters to convert.</p>
        )}
        {plan.refused.length > 0 && (
          <div className="sb-knobs-convert__refused">
            <span className="sb-knob-form__label">Staying variables</span>
            <ul>
              {plan.refused.map((r) => (
                <li key={`${r.component}:${r.id}`}>{r.reason}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="sb-appdialog__actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!chosen.length} onClick={convert}>
            {chosen.length ? `Convert ${chosen.length}` : "Convert"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
