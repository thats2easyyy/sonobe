/**
 * One knob in the Knobs tab: its name (the description and "Used by 4" as the tooltip), a ≠ mark when
 * it differs from the partner preset, and its control. The context menu edits the knob, copies the
 * partner's value, shows what reads it, and removes it (every input keeps the running value).
 */

import { findLayer, getPatchSpec, patchDisplayName, parseAddress, type KnobReader, type KnobSet } from "@sonobe/core";
import { ArrowLeftRight, Ellipsis, ListTree, Pencil, Trash2 } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import type { EditorSession } from "../../state/session.ts";
import { removeKnobLabel } from "../../state/undoLabels.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { ContextMenu, Menu, type MenuEntry } from "../../ui/Menu.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { revealItems } from "../hud/reveal.ts";
import { KnobControl } from "./KnobControl.tsx";
import { knobValueText, presetName, type KnobRowModel } from "./model.ts";
import type { KnobEdit } from "./useKnobEdit.ts";

/** "Spring Feel · Response", "Card · Corner Radius", with the component when it isn't the root. */
export function readerLabel(session: EditorSession, reader: KnobReader): string {
  const doc = session.document.getState().doc;
  const component = doc.components[reader.component];
  const a = parseAddress(reader.target);
  let text: string = reader.target;
  if (component && a?.kind === "patch") {
    const node = component.patches[a.id];
    const spec = node ? getPatchSpec(session.registry, node.type) : undefined;
    const port = spec?.inputs.find((p) => p.key === a.key);
    text = `${node ? patchDisplayName(node, spec) : a.id} · ${port?.name ?? a.key}`;
  } else if (component && a?.kind === "layer") {
    const layer = findLayer(component.layers, a.id)?.layer;
    const spec = layer ? session.registry.layers.get(layer.type) : undefined;
    const prop = spec?.props.find((p) => p.key === a.key);
    text = `${layer?.name ?? a.id} · ${prop?.name ?? a.key}`;
  }
  return reader.component !== doc.project.root && component ? `${text} (in ${component.name})` : text;
}

/** Select a reader in the patch editor (entering its component). */
export function revealReader(session: EditorSession, reader: KnobReader): void {
  const a = parseAddress(reader.target);
  const id = a && (a.kind === "patch" || a.kind === "layer") ? a.id : undefined;
  if (id) revealItems(session, reader.component, [id]);
}

export interface KnobRowProps {
  set: KnobSet;
  row: KnobRowModel;
  readers: readonly KnobReader[];
  partner: string | null;
  locked: boolean;
  edit: KnobEdit;
  flashing: boolean;
  onEdit: () => void;
}

export const KnobRow = forwardRef<HTMLDivElement, KnobRowProps>(function KnobRow({ set, row, readers, partner, locked, edit, flashing, onEdit }, ref) {
  const session = useEditorSession();
  const { knob } = row;
  const unused = row.uses === 0;
  const partnerLabel = partner ? presetName(set, partner) : null;
  const tooltip: ReactNode = (
    <span className="sb-knob-row__tip">
      {knob.description && <span>{knob.description}</span>}
      <span>{unused ? "Not used yet" : `Used by ${row.uses}`}</span>
      {partnerLabel && row.differs && <span>{`${partnerLabel}: ${knobValueText(knob, row.partnerValue)}`}</span>}
    </span>
  );
  const entries = (): MenuEntry[] => [
    { id: "edit", label: "Edit Knob…", icon: <Pencil size={14} />, onSelect: onEdit },
    ...(partnerLabel
      ? ([
          {
            id: "partner",
            label: `Use Value from ${partnerLabel}`,
            icon: <ArrowLeftRight size={14} />,
            disabled: !row.differs || locked,
            ...(row.differs ? { description: knobValueText(knob, row.partnerValue) } : {}),
            onSelect: () => row.partnerValue !== undefined && edit.tune(knob.id, row.partnerValue),
          },
        ] satisfies MenuEntry[])
      : []),
    {
      id: "uses",
      label: "Show Uses",
      icon: <ListTree size={14} />,
      disabled: unused,
      submenu: readers.map((reader, i) => ({ id: `use:${i}`, label: readerLabel(session, reader), onSelect: () => revealReader(session, reader) })),
    },
    { type: "separator" },
    {
      id: "remove",
      label: "Remove Knob",
      icon: <Trash2 size={14} />,
      danger: true,
      description: unused ? "Nothing reads it" : `${row.uses === 1 ? "1 input keeps" : `${row.uses} inputs keep`} ${knobValueText(knob, row.value)}`,
      onSelect: () => edit.apply([{ op: "removeKnob", id: knob.id }], removeKnobLabel(knob.name)),
    },
  ];
  return (
    <ContextMenu entries={entries}>
      <div ref={ref} className="sb-knob-row" data-knob-row={knob.id} data-unused={unused || undefined} data-flash={flashing || undefined} data-type={knob.type} role="group" aria-label={knob.name}>
        <div className="sb-knob-row__head">
          <span className="sb-knob-row__diff" aria-label={row.differs && partnerLabel ? `Differs from ${partnerLabel}` : undefined} data-on={row.differs || undefined}>
            {row.differs ? "≠" : ""}
          </span>
          <Tooltip content={tooltip} placement="left" delay={500}>
            <span className="sb-knob-row__name">{knob.name}</span>
          </Tooltip>
          <Menu aria-label={`${knob.name} options`} placement="bottom-end" entries={entries}>
            <IconButton size="xs" className="sb-knob-row__menu" icon={<Ellipsis size={12} />} label={`${knob.name} options`} />
          </Menu>
        </div>
        <div className="sb-knob-row__control">
          <KnobControl knob={knob} value={row.value} edit={edit} disabled={locked} ticks={row.ticks} rowKeys />
        </div>
        {unused && <p className="sb-knob-row__hint">Not used yet: right-click a field in Properties and choose Use Knob.</p>}
      </div>
    </ContextMenu>
  );
});
