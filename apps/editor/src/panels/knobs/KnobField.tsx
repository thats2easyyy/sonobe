/**
 * Knobs in the Inspector: the field a knob drives (a chip naming the knob, "Knob · 4 uses", and the
 * knob's own control, which tunes the running preset), and the context menu entries every field
 * gets: Make Knob… and Use Knob ▸ on unconnected fields, Show in Knobs and Unlink on knob-driven ones.
 */

import { getKnob, knobLiteral, type Id, type KnobSet } from "@sonobe/core";
import { CircleDot, Link2Off, SlidersHorizontal, Unlink } from "lucide-react";
import { useMemo } from "react";
import { useDocument, useEditorSession } from "../../state/EditorProvider.tsx";
import type { EditorSession } from "../../state/session.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import type { MenuEntry } from "../../ui/Menu.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import type { InspectorField } from "../inspector/model.ts";
import { KnobControl } from "./KnobControl.tsx";
import { showKnobs } from "./knobsStore.ts";
import { knobIdOf, knobsForPort, knobTypeForPort, knobUses, knobValueText, planUnlinkKnob, planUseKnob } from "./model.ts";
import { useKnobEdit } from "./useKnobEdit.ts";

/** The knob every target of a field reads, if they all read the same one. */
export const fieldKnobId = (field: Pick<InspectorField, "link">): Id | undefined => (field.link ? knobIdOf({ link: field.link }) : undefined);

function unlinkFieldKnob(session: EditorSession, field: InspectorField, set: KnobSet, knobId: Id): void {
  const knob = getKnob(set, knobId);
  if (!knob) return;
  const ops = planUnlinkKnob(set, knob, session.currentComponentId(), field.targets.map((t) => ({ address: t.address, type: field.type })));
  session.document.getState().apply(ops, { label: `Unlink ${field.port.name} from ${knob.name}` });
}

/**
 * Context menu entries for knobs on a field: Make Knob… and Use Knob ▸ when nothing drives it, Show in
 * Knobs and Unlink (keeping the value) when a knob does. Empty for fields a knob can't reach.
 */
export function knobFieldEntries(session: EditorSession, field: InspectorField, onMakeKnob: () => void): MenuEntry[] {
  if (!field.bindable || field.type === "pulse") return [];
  const set = session.document.getState().doc.knobs;
  const knobId = fieldKnobId(field);
  if (knobId !== undefined) {
    const knob = getKnob(set, knobId);
    const running = set && knob ? knobValueText(knob, knobLiteral(set, knob)) : undefined;
    return [
      { id: "showKnob", label: "Show in Knobs", icon: <SlidersHorizontal size={14} />, onSelect: () => showKnobs(session, knobId) },
      { id: "unlinkKnob", label: running ? `Unlink (keep ${running})` : "Unlink", icon: <Unlink size={14} />, disabled: !set || !knob, onSelect: () => set && unlinkFieldKnob(session, field, set, knobId) },
    ];
  }
  if (field.linkedCount > 0) return [];
  const type = knobTypeForPort(field.port);
  const fitting = knobsForPort(set, field.port);
  const componentId = session.currentComponentId();
  return [
    { id: "makeKnob", label: "Make Knob…", icon: <CircleDot size={14} />, disabled: !type, ...(type ? {} : { description: "Knobs hold numbers, on/off, colors, choices, points and text" }), onSelect: onMakeKnob },
    {
      id: "useKnob",
      label: "Use Knob",
      icon: <SlidersHorizontal size={14} />,
      disabled: fitting.length === 0,
      ...(fitting.length ? {} : { description: set?.knobs.length ? `No knob fits ${field.port.name}` : "No knobs yet" }),
      submenu: fitting.map((k) => ({
        id: `useKnob:${k.id}`,
        label: k.name,
        description: set ? knobValueText(k, knobLiteral(set, k)) : undefined,
        onSelect: () => session.document.getState().apply(planUseKnob(componentId, field.targets, k.id), { label: `Drive ${field.port.name} with ${k.name}` }),
      })),
    },
  ];
}

/** A field a knob drives: the knob's chip (click to show it in Knobs), its uses, and its control. */
export function KnobField({ field, knobId, label }: { field: InspectorField; knobId: Id; label: string }) {
  const session = useEditorSession();
  const doc = useDocument((s) => s.doc);
  const set = doc.knobs;
  const edit = useKnobEdit();
  const knob = getKnob(set, knobId);
  // Tuning changes no component, so the count isn't worked out again while dragging.
  const uses = useMemo(() => knobUses(doc).get(knobId)?.length ?? 0, [doc.components, knobId]); // eslint-disable-line react-hooks/exhaustive-deps
  const running = set?.presets.find((p) => p.id === set.active);
  const locked = !!running?.locked;
  if (!set || !knob) {
    return (
      <div className="sb-insp-knob" data-missing="">
        <span className="sb-insp-chip sb-insp-knob__chip" title={`There's no knob “${knobId}” anymore.`}>
          <CircleDot size={11} strokeWidth={2} aria-hidden />
          <span className="sb-insp-chip__text">{knobId}</span>
        </span>
        <span className="sb-insp-knob__meta">Missing knob</span>
      </div>
    );
  }
  return (
    <div className="sb-insp-knob">
      <div className="sb-insp-knob__head">
        <Tooltip content={`${knob.name} is a knob${knob.description ? `: ${knob.description}` : ""}. Click to show it in Knobs.`}>
          <button type="button" className="sb-insp-chip sb-insp-knob__chip" onClick={() => showKnobs(session, knobId)}>
            <CircleDot size={11} strokeWidth={2} aria-hidden />
            <span className="sb-insp-chip__text">{knob.name}</span>
          </button>
        </Tooltip>
        <span className="sb-insp-knob__meta">
          Knob · {uses} {uses === 1 ? "use" : "uses"}
          {locked ? ` · ${running!.name} is locked` : ""}
        </span>
        <IconButton size="xs" icon={<Link2Off size={12} />} label={`Unlink ${label} from ${knob.name}`} tooltip={`Unlink (keep ${knobValueText(knob, knobLiteral(set, knob))})`} className="sb-insp-linked__unlink" onClick={() => unlinkFieldKnob(session, field, set, knobId)} />
      </div>
      <KnobControl knob={knob} value={knobLiteral(set, knob)} edit={edit} label={label} disabled={locked} />
    </div>
  );
}
