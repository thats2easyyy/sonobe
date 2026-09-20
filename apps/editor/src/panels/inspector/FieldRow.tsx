/**
 * One inspector row: the property label, its editor (or a binding chip when a patch drives it), a
 * port to drive it with a patch, and a context menu. Layer property rows accept cables dropped from
 * the patch editor, and asset rows accept dropped files.
 */

import { findLayer, type Id, type ValueType } from "@sonobe/core";
import { Cable, Copy, Link2, Link2Off, RotateCcw, ScanSearch } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { dragHasFiles, filesFromDataTransfer } from "../../state/assets.ts";
import { useDocument, useEditorSession, useLiveValues, useSelection } from "../../state/EditorProvider.tsx";
import { currentComponentId } from "../../state/selection.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { ContextMenu, type MenuEntry } from "../../ui/Menu.tsx";
import { PortGlyph } from "../../ui/PortGlyph.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { useLatest } from "../../ui/lib/hooks.ts";
import { layerPropDropAttributes, startLinkToLayerProp, useWatchedScope, type LayerPropTarget } from "../patch-editor/api.ts";
import { controlKind, LiveReadout, STACKED_CONTROLS, useAssetFieldImport, ValueControl, type FieldActions } from "./controls.tsx";
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
    const set = (update: Parameters<FieldActions["set"]>[0], options: { gesture?: string; coalesceKey?: string }) => {
      const c = component();
      if (c) edit.apply(planFieldSet(c, latest.current, update), editLabel(latest.current, subject), options);
    };
    return {
      change: (update) => set(update, { gesture: gesture() }),
      set: (update, options) => {
        set(update, options?.coalesceKey ? { coalesceKey: options.coalesceKey } : {});
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

/**
 * A live runtime value that subscribes on its own, so only this readout re-renders while the
 * prototype plays. It reads what the patch editor watches: the same instance (and copy of a looped
 * instance), and the watched copy of a looped value.
 */
export function LiveValue({ address, type, copies }: { address: string; type: ValueType; copies?: boolean }) {
  const { prefix, copy } = useWatchedScope(useEditorSession());
  const values = useLiveValues([address], { hz: 15, ...(prefix !== null ? { scope: { instancePath: prefix } } : {}) });
  return <LiveReadout value={values[address]} type={type} copy={copy} {...(copies ? { copies } : {})} />;
}

/** A row's state while a patch editor drags a cable. */
export interface FieldRowCable {
  /** The dragged cable can drive this property. */
  accept: boolean;
  /** The pointer is over this row. */
  hover: boolean;
  /** What the cable carries, for the drop hint ("Zoom Spring"). */
  source: string;
}

export interface FieldRowProps {
  field: InspectorField;
  /** What's being edited, for undo labels: "Event Card" or "3 layers". */
  subject: string;
  /** Runtime address whose value to show while a patch drives the field ("@card.scale", "pop.output"). */
  liveAddress?: string;
  /** Layers a layer picker leaves out. */
  excludeLayers?: readonly Id[];
  /**
   * The layer property this row drives with a patch (its port, "Drive with a Patch…", and cable
   * drops). `null` keeps the port column but offers nothing (multi-selections, properties that only
   * take a set value). Omit it for rows without ports (patch inputs).
   */
  drive?: LayerPropTarget | null;
  /** Set while a patch editor drags a cable. */
  cable?: FieldRowCable;
}

const chipText = (link: string) => (link.startsWith("$in.") ? link.slice(1) : link);

export function FieldRow({ field, subject, liveAddress, excludeLayers, drive, cable }: FieldRowProps) {
  const session = useEditorSession();
  const componentId = useSelection(currentComponentId);
  const component = useDocument((s) => s.doc.components[componentId]);
  const actions = useFieldActions(field, subject);
  const { importing, importFile } = useAssetFieldImport(field, actions);
  const [fileOver, setFileOver] = useState(false);
  const linked = field.linkedCount > 0;
  const kind = controlKind(field);
  const stacked = !linked && STACKED_CONTROLS.has(kind);
  const takesFiles = !linked && kind === "asset";
  const single = field.targets.length === 1 ? field.targets[0] : undefined;
  const source = field.link ? linkSourceItem(field.link) : undefined;
  const sourceName =
    source?.id && component
      ? source.kind === "patch"
        ? (component.patches[source.id]?.name ?? source.id)
        : (findLayer(component.layers, source.id)?.layer.name ?? source.id)
      : undefined;
  const name = field.port.name;

  const reveal = () => {
    if (source?.id) session.selection.getState().requestReveal(componentId, [source.id]);
  };

  const driveWithPatch = () => {
    if (drive) startLinkToLayerProp(drive, { session });
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
    ...(drive !== undefined
      ? ([
          {
            id: "drive",
            label: linked ? "Change Driving Patch…" : "Drive with a Patch…",
            icon: <Cable size={14} />,
            disabled: !drive,
            ...(drive ? {} : { description: field.bindable ? "Select one layer" : "Takes a set value only" }),
            onSelect: driveWithPatch,
          },
          { type: "separator" },
        ] satisfies MenuEntry[])
      : []),
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

  const fileHandlers = takesFiles
    ? {
        onDragOver: (event: DragEvent<HTMLDivElement>) => {
          if (!dragHasFiles(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
          if (!fileOver) setFileOver(true);
        },
        onDragLeave: (event: DragEvent<HTMLDivElement>) => {
          const next = event.relatedTarget as Node | null;
          if (next && event.currentTarget.contains(next)) return;
          setFileOver(false);
        },
        onDrop: (event: DragEvent<HTMLDivElement>) => {
          if (!dragHasFiles(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          setFileOver(false);
          const file = filesFromDataTransfer(event.dataTransfer)[0];
          if (file) void importFile(file);
        },
      }
    : {};

  const dropHint = cable?.accept && cable.hover ? `Drive ${name} from ${cable.source}` : fileOver ? `Drop to set ${name}` : importing ? "Importing…" : null;

  return (
    <ContextMenu entries={entries}>
      <div
        className="sb-insp-row"
        data-stacked={stacked || undefined}
        data-linked={linked || undefined}
        data-port={drive !== undefined || undefined}
        data-drop={cable ? (cable.accept ? "accept" : "reject") : undefined}
        data-drop-hover={(cable?.accept && cable.hover) || fileOver || undefined}
        {...(drive ? layerPropDropAttributes(drive) : {})}
        {...fileHandlers}
        onPointerDownCapture={() => actions.commit()}
        onPointerEnter={() => setHovered(true, "row")}
        onPointerLeave={() => setHovered(false, "row")}
      >
        <Tooltip content={field.port.description} placement="left" delay={700}>
          <span className="sb-insp-row__label">
            <span className="sb-insp-row__name">{name}</span>
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
              {field.link && liveAddress && <LiveValue address={liveAddress} type={field.type} {...(field.port.subtype === "count" ? { copies: true } : {})} />}
              <IconButton size="xs" icon={<Link2Off size={12} />} label={`Disconnect ${name}`} tooltip="Disconnect" className="sb-insp-linked__unlink" onClick={actions.disconnect} />
            </div>
          ) : (
            <ValueControl field={field} actions={actions} label={name} {...(excludeLayers ? { excludeLayers } : {})} />
          )}
        </div>
        {drive !== undefined && (
          <span className="sb-insp-row__port">
            {drive && (
              <Tooltip content={linked ? `Driven by ${sourceName ?? (field.link ? chipText(field.link) : "a patch")}. Click to choose another.` : "Drive with a patch…"} placement="left" delay={400}>
                <button type="button" className="sb-insp-port" aria-label={linked ? `Change what drives ${name}` : `Drive ${name} with a patch`} data-linked={linked || undefined} onClick={driveWithPatch}>
                  <PortGlyph type={field.type} size={8} />
                </button>
              </Tooltip>
            )}
          </span>
        )}
        {dropHint && (
          <span className="sb-insp-row__drop-hint" role="status">
            {cable?.accept && cable.hover && <Cable size={12} strokeWidth={2} aria-hidden />}
            <span className="sb-insp-row__drop-text">{dropHint}</span>
          </span>
        )}
      </div>
    </ContextMenu>
  );
}
