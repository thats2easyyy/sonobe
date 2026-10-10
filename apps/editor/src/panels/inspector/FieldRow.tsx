/**
 * One inspector row: the property label, its editor (or a binding chip when a patch drives it), a
 * port to drive it with a patch, and a context menu. Layer property rows accept cables dropped from
 * the patch editor, and asset rows accept dropped files.
 */

import { findLayer, getKnob, type Id, type ValueType } from "@sonobe/core";
import { Cable, Copy, Link2, Link2Off, RotateCcw, ScanSearch } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, type CSSProperties, type DragEvent, type MouseEvent } from "react";
import { dragHasFiles, filesFromDataTransfer } from "../../state/assets.ts";
import { useDocument, useEditorSession, useLiveValues, useSelection } from "../../state/EditorProvider.tsx";
import { currentComponentId } from "../../state/selection.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { ContextMenu, type MenuEntry } from "../../ui/Menu.tsx";
import { PortGlyph } from "../../ui/PortGlyph.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { fieldKnobId, KnobField, knobFieldEntries } from "../knobs/KnobField.tsx";
import { MakeKnobPopover } from "../knobs/MakeKnobPopover.tsx";
import { layerPropDropAttributes, startLinkToLayerProp, useWatchedScope, type LayerPropTarget } from "../patch-editor/api.ts";
import { controlKind, LiveReadout, STACKED_CONTROLS, useAssetFieldImport, ValueControl, type FieldActions } from "./controls.tsx";
import { editLabel, linkSourceItem, planFieldDisconnect, planFieldReset, planFieldSet, type InspectorField } from "./model.ts";
import { useSubjectKey, useSubjectState } from "./subject.ts";
import { useInspectorEdit } from "./useInspectorEdit.ts";

/** Session-bound edits for a field, labeled for undo ("Set Opacity on Card"). */
export function useFieldActions(field: InspectorField, subject: string): FieldActions {
  const session = useEditorSession();
  const edit = useInspectorEdit();
  const subjectKey = useSubjectKey();
  // The latest field, held per subject: the row stays for the next selection, and actions handed out
  // for the last one (an import still running, an open menu's entries) must keep editing what they began with.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const latest = useMemo(() => ({ current: field }), [subjectKey]);
  useLayoutEffect(() => {
    latest.current = field;
  });
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

/** A number field that doesn't fit its text, in full ("Position X: -1234.567"), or null. */
function clippedNumber(target: EventTarget): string | null {
  const input = target instanceof HTMLInputElement ? target : null;
  if (!input?.classList.contains("sb-scrub__input") || input.scrollWidth <= input.clientWidth) return null;
  return `${input.getAttribute("aria-label") ?? "Value"}: ${input.value}`;
}

/** The address ends in the property, so a long source name elides before it, not after. */
function ChipText({ text }: { text: string }) {
  const split = text.lastIndexOf(".");
  return (
    <span className="sb-insp-chip__text sb-mono">
      <span className="sb-insp-chip__head">{split > 0 ? text.slice(0, split) : text}</span>
      {split > 0 && <span className="sb-insp-chip__tail">{text.slice(split)}</span>}
    </span>
  );
}

const chipText = (link: string) => (link.startsWith("$in.") ? link.slice(1) : link);

export function FieldRow({ field, subject, liveAddress, excludeLayers, drive, cable }: FieldRowProps) {
  const session = useEditorSession();
  const componentId = useSelection(currentComponentId);
  const component = useDocument((s) => s.doc.components[componentId]);
  const actions = useFieldActions(field, subject);
  const { importing, importFile } = useAssetFieldImport(field, actions);
  const subjectKey = useSubjectKey();
  const [fileOver, setFileOver] = useSubjectState(false);
  const [nameClipped, setNameClipped] = useSubjectState(false);
  const [clippedValue, setClippedValue] = useSubjectState<string | null>(null);
  const linked = field.linkedCount > 0;
  const kind = controlKind(field);
  // A knob-driven field shows the knob's chip and control under the label.
  const knobId = fieldKnobId(field);
  const [makingKnob, setMakingKnob] = useSubjectState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const stacked = (!linked && STACKED_CONTROLS.has(kind)) || knobId !== undefined;
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
  const knobName = useDocument((s) => (knobId !== undefined ? (getKnob(s.doc.knobs, knobId)?.name ?? null) : null));
  // What the port's tooltip says drives the field: the knob by name, the patch or layer, or the link.
  const driver = knobId !== undefined ? (knobName !== null ? `the knob ${knobName}` : `a missing knob (${knobId})`) : (sourceName ?? (field.link ? chipText(field.link) : "a patch"));

  const reveal = () => {
    if (source?.id) session.selection.getState().requestReveal(componentId, [source.id]);
  };

  const reset = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) rowRef.current?.querySelector<HTMLElement>(".sb-insp-row__control :is(input, select, textarea, button, [tabindex='0']):not(:disabled)")?.focus();
    actions.reset();
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

  const knobEntries = () => {
    const list = knobFieldEntries(session, field, () => setMakingKnob(true));
    return list.length ? ([...list, { type: "separator" }] satisfies MenuEntry[]) : [];
  };

  const entries = (): MenuEntry[] => [
    ...knobEntries(),
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
    ...(linked && knobId === undefined
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
    <ContextMenu entries={entries} dismissKey={subjectKey}>
      <div
        ref={rowRef}
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
        <span className="sb-insp-row__label">
          <Tooltip content={nameClipped ? `${name}. ${field.port.description}` : field.port.description} placement="left" delay={nameClipped ? 400 : 700}>
            <span className="sb-insp-row__name" onPointerEnter={(event) => setNameClipped(event.currentTarget.scrollWidth > event.currentTarget.clientWidth)}>
              {name}
            </span>
          </Tooltip>
          {field.isSet && !linked && (
            <Tooltip content="Reset to default" placement="top">
              <button type="button" className="sb-insp-row__dot" aria-label={`Reset ${name} to default`} onClick={reset}>
                <RotateCcw size={12} strokeWidth={1.75} aria-hidden />
              </button>
            </Tooltip>
          )}
        </span>
        <Tooltip content={clippedValue} placement="top" delay={600}>
          <div
            className="sb-insp-row__control"
            onPointerOver={(event) => setClippedValue(clippedNumber(event.target))}
            onPointerLeave={() => setClippedValue(null)}
            onFocus={(event) => setClippedValue(clippedNumber(event.target))}
            onBlur={() => setClippedValue(null)}
          >
            {knobId !== undefined ? (
              <KnobField key={subjectKey} field={field} knobId={knobId} label={name} />
            ) : linked ? (
              <div className="sb-insp-linked" data-live={(field.link && liveAddress) || undefined}>
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
                    <ChipText text={field.link ? `← ${chipText(field.link)}` : "Mixed connections"} />
                  </button>
                </Tooltip>
                <div className="sb-insp-linked__meta">
                  {field.link && liveAddress && <LiveValue address={liveAddress} type={field.type} {...(field.port.subtype === "count" ? { copies: true } : {})} />}
                  <IconButton size="xs" icon={<Link2Off size={12} />} label={`Disconnect ${name}`} tooltip="Disconnect" className="sb-insp-linked__unlink" onClick={actions.disconnect} />
                </div>
              </div>
            ) : (
              // Keyed by the subject: a typed draft, a scrub under way and an open picker belong to the layers they were for.
              <ValueControl key={subjectKey} field={field} actions={actions} label={name} {...(excludeLayers ? { excludeLayers } : {})} />
            )}
          </div>
        </Tooltip>
        {drive !== undefined && (
          <span className="sb-insp-row__port">
            {drive && (
              <Tooltip content={linked ? `Driven by ${driver}. ${knobId !== undefined ? "Click to drive it with a patch instead." : "Click to choose another."}` : "Drive with a patch…"} placement="left" delay={150}>
                <button type="button" className="sb-insp-port" aria-label={linked ? `Change what drives ${name}` : `Drive ${name} with a patch`} data-linked={linked || undefined} onClick={driveWithPatch}>
                  <PortGlyph type={field.type} size={8} {...(linked ? { style: { "--sb-port-color": "var(--accent)" } as CSSProperties } : {})} />
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
        <MakeKnobPopover field={makingKnob ? field : null} anchor={rowRef.current} onClose={() => setMakingKnob(false)} />
      </div>
    </ContextMenu>
  );
}
