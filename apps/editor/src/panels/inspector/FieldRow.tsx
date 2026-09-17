/** One inspector row: the property label, its editor (or a binding chip when a patch drives it), and a context menu. */

import { findLayer, type Id, type ValueType } from "@sonobe/core";
import { Copy, Link2, Link2Off, RotateCcw, ScanSearch } from "lucide-react";
import { useMemo } from "react";
import { useDocument, useEditorSession, useLiveValues, useSelection } from "../../state/EditorProvider.tsx";
import { currentComponentId } from "../../state/selection.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { ContextMenu, type MenuEntry } from "../../ui/Menu.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { useLatest } from "../../ui/lib/hooks.ts";
import { controlKind, LiveReadout, STACKED_CONTROLS, ValueControl, type FieldActions } from "./controls.tsx";
import { editLabel, linkSourceItem, planFieldDisconnect, planFieldReset, planFieldSet, type InspectorField } from "./model.ts";
import { useInspectorEdit } from "./useInspectorEdit.ts";

/** Session-bound edits for a field, labeled for undo ("Set Opacity on Card"). */
export function useFieldActions(field: InspectorField, subject: string): FieldActions {
  const session = useEditorSession();
  const edit = useInspectorEdit();
  const latest = useLatest(field);
  return useMemo(() => {
    const component = () => session.document.getState().doc.components[session.currentComponentId()];
    const gesture = () => `${latest.current.key}:${latest.current.targets.map((t) => t.address).join(",")}`;
    const set = (update: Parameters<FieldActions["set"]>[0], options: { gesture?: string }) => {
      const c = component();
      if (c) edit.apply(planFieldSet(c, latest.current, update), editLabel(latest.current, subject), options);
    };
    return {
      change: (update) => set(update, { gesture: gesture() }),
      set: (update) => {
        set(update, {});
        edit.endGesture();
      },
      commit: () => edit.endGesture(),
      reset: () => {
        const c = component();
        if (c) edit.apply(planFieldReset(c, latest.current), editLabel(latest.current, subject, "Reset"));
      },
      disconnect: () => {
        const c = component();
        if (c) edit.apply(planFieldDisconnect(c, latest.current), editLabel(latest.current, subject, "Disconnect"));
      },
    };
  }, [session, edit, latest, subject]);
}

/** A live runtime value that subscribes on its own, so only this readout re-renders while the prototype plays. */
export function LiveValue({ address, type }: { address: string; type: ValueType }) {
  const values = useLiveValues([address], { hz: 15 });
  return <LiveReadout value={values[address]} type={type} />;
}

export interface FieldRowProps {
  field: InspectorField;
  /** What's being edited, for undo labels: "Event Card" or "3 layers". */
  subject: string;
  /** Runtime address whose value to show while a patch drives the field ("@card.scale", "pop.output"). */
  liveAddress?: string;
  /** Layers a layer picker leaves out. */
  excludeLayers?: readonly Id[];
}

const chipText = (link: string) => (link.startsWith("$in.") ? link.slice(1) : link);

export function FieldRow({ field, subject, liveAddress, excludeLayers }: FieldRowProps) {
  const session = useEditorSession();
  const componentId = useSelection(currentComponentId);
  const component = useDocument((s) => s.doc.components[componentId]);
  const actions = useFieldActions(field, subject);
  const linked = field.linkedCount > 0;
  const stacked = !linked && STACKED_CONTROLS.has(controlKind(field));
  const single = field.targets.length === 1 ? field.targets[0] : undefined;
  const source = field.link ? linkSourceItem(field.link) : undefined;
  const sourceName =
    source?.id && component
      ? source.kind === "patch"
        ? (component.patches[source.id]?.name ?? source.id)
        : (findLayer(component.layers, source.id)?.layer.name ?? source.id)
      : undefined;

  const reveal = () => {
    if (source?.id) session.selection.getState().requestReveal(componentId, [source.id]);
  };

  const setHovered = (on: boolean, kind: "row" | "source") => {
    const selection = session.selection.getState();
    if (!on) {
      if (selection.hovered?.source === "inspector") selection.setHovered(null);
      return;
    }
    if (kind === "source" && source?.id && field.link) {
      selection.setHovered({ kind: "port", id: source.id, component: componentId, address: field.link, source: "inspector" });
    } else if (single) {
      selection.setHovered({ kind: "port", id: single.id, component: componentId, address: single.address, source: "inspector" });
    }
  };

  const entries = (): MenuEntry[] => [
    { id: "reset", label: "Reset to Default", icon: <RotateCcw size={14} />, disabled: !field.isSet, onSelect: actions.reset },
    ...(linked
      ? ([
          { id: "disconnect", label: "Disconnect", icon: <Link2Off size={14} />, onSelect: actions.disconnect },
          { id: "reveal", label: "Reveal Driving Patch", icon: <ScanSearch size={14} />, disabled: !source?.id, onSelect: reveal },
        ] satisfies MenuEntry[])
      : []),
    { type: "separator" },
    {
      id: "copyAddress",
      label: "Copy Address",
      icon: <Copy size={14} />,
      ...(single ? { description: single.address } : {}),
      disabled: !single,
      onSelect: () => {
        if (!single) return;
        void globalThis.navigator?.clipboard?.writeText(single.address).then(
          () => toast({ id: "inspector-copied", title: `Copied ${single.address}`, tone: "success" }),
          () => undefined,
        );
      },
    },
  ];

  return (
    <ContextMenu entries={entries}>
      <div className="sb-insp-row" data-stacked={stacked || undefined} data-linked={linked || undefined} onPointerEnter={() => setHovered(true, "row")} onPointerLeave={() => setHovered(false, "row")}>
        <Tooltip content={field.port.description} placement="left" delay={700}>
          <span className="sb-insp-row__label">
            <span className="sb-insp-row__name">{field.port.name}</span>
            {field.isSet && !linked && <span className="sb-insp-row__dot" aria-label="Changed from default" />}
          </span>
        </Tooltip>
        <div className="sb-insp-row__control">
          {linked ? (
            <div className="sb-insp-linked">
              <Tooltip content={field.link ? `Driven by ${sourceName ?? chipText(field.link)}. Click to show it in the patch editor.` : `${field.linkedCount} of ${field.targets.length} selected are connected to patches.`}>
                <button
                  type="button"
                  className="sb-insp-chip"
                  disabled={!source?.id}
                  onClick={reveal}
                  onPointerEnter={() => setHovered(true, "source")}
                  onPointerLeave={() => setHovered(true, "row")}
                >
                  <Link2 size={11} strokeWidth={2} aria-hidden />
                  <span className="sb-insp-chip__text sb-mono">{field.link ? `← ${chipText(field.link)}` : "Mixed connections"}</span>
                </button>
              </Tooltip>
              {field.link && liveAddress && <LiveValue address={liveAddress} type={field.type} />}
              <IconButton size="xs" icon={<Link2Off size={12} />} label={`Disconnect ${field.port.name}`} tooltip="Disconnect" className="sb-insp-linked__unlink" onClick={actions.disconnect} />
            </div>
          ) : (
            <ValueControl field={field} actions={actions} label={field.port.name} {...(excludeLayers ? { excludeLayers } : {})} />
          )}
        </div>
      </div>
    </ContextMenu>
  );
}
