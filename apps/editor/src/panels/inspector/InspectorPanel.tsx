import { allLayers, isJsonLiteral, zeroLiteral, type Component as SonobeComponent, type InputValue, type InterfacePort, type Op } from "@sonobe/core";
import { Component, MousePointerClick, PanelRightClose, StickyNote, X } from "lucide-react";
import { useState } from "react";
import { KnobsPanel } from "../knobs/KnobsPanel.tsx";
import { unpublishOps, updatePublishedOps, type PublishSide } from "../patch-editor/model/publish.ts";
import { layoutStore, useLayout, type InspectorTab } from "../../shell/layoutStore.ts";
import { Panel } from "../../shell/Panel.tsx";
import { useCurrentComponent, useDocument, useEditorSession, useSelection } from "../../state/EditorProvider.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { PortGlyph, VALUE_TYPE_LABELS } from "../../ui/PortGlyph.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { TabPanel, Tabs } from "../../ui/Tabs.tsx";
import { TextArea, TextField } from "../../ui/TextField.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { ValueControl, type FieldActions } from "./controls.tsx";
import { LayerInspector } from "./LayerInspector.tsx";
import { sameInputValue, summarizeField, type FieldPort } from "./model.ts";
import { PatchInspector } from "./PatchInspector.tsx";
import { useInspectorEdit } from "./useInspectorEdit.ts";
import "./Inspector.css";

export interface InspectorPanelProps {
  /** Collapse the panel to its rail; the shell passes this. Omit to hide the collapse button. */
  onCollapse?: () => void;
  /** Open a patch type's full reference (e.g. in the Learn drawer). Without it, "Learn More" expands the docs inline. */
  onLearnMore?: (patchType: string) => void;
  className?: string;
}

type View = "layers" | "patches";

const TABS_ID = "sb-insp-tabs";

/**
 * The Inspector: properties of the selected layers or patches in the current component, generated
 * from their declarations. Layers get sections by category with advanced rows behind "More";
 * patches get docs, options, spring presets with a curve and handoff code, inputs, and live
 * outputs. Nothing selected shows the component's summary and notes. The Knobs tab shows the
 * project's knobs and presets, and stays put as the selection changes.
 */
export function InspectorPanel({ onCollapse, onLearnMore, className }: InspectorPanelProps) {
  const session = useEditorSession();
  const layers = useSelection((s) => s.layers);
  const patches = useSelection((s) => s.patches);
  const comments = useSelection((s) => s.comments);
  const [view, setView] = useState<View>("layers");
  const tab = useLayout((s) => s.inspectorTab);
  const knobCount = useDocument((s) => s.doc.knobs?.knobs.length ?? 0);
  const both = layers.length > 0 && patches.length > 0;
  const mode: View | "none" = both ? view : layers.length > 0 ? "layers" : patches.length > 0 ? "patches" : "none";

  return (
    <Panel
      title="Inspector"
      scope="inspector"
      className={cx("sb-insp-panel", className)}
      headerContent={
        <Tabs<InspectorTab>
          size="sm"
          idBase={TABS_ID}
          aria-label="Inspector"
          value={tab}
          onChange={(next) => layoutStore.getState().setInspectorTab(next)}
          items={[
            { value: "properties", label: "Properties" },
            { value: "knobs", label: "Knobs", ...(knobCount ? { badge: knobCount } : {}) },
          ]}
        />
      }
      actions={onCollapse && <IconButton size="sm" icon={<PanelRightClose size={14} />} label="Hide inspector" shortcut="Mod+7" onClick={onCollapse} />}
    >
      {tab === "knobs" ? (
        <TabPanel idBase={TABS_ID} value="knobs" active className="sb-insp sb-scroll">
          <KnobsPanel />
        </TabPanel>
      ) : (
        <div className="sb-insp sb-scroll" role="tabpanel" id={`${TABS_ID}-panel-properties`} aria-labelledby={`${TABS_ID}-tab-properties`} onFocusCapture={() => session.selection.getState().setFocusedPanel("inspector")}>
          {both && (
            <div className="sb-insp-view">
              <SegmentedControl
                size="sm"
                fullWidth
                aria-label="Show properties of"
                value={view}
                onChange={setView}
                options={[
                  { value: "layers", label: `${layers.length} ${layers.length === 1 ? "Layer" : "Layers"}` },
                  { value: "patches", label: `${patches.length} ${patches.length === 1 ? "Patch" : "Patches"}` },
                ]}
              />
            </div>
          )}
          {mode === "layers" && <LayerInspector key={layers.join(",")} layerIds={layers} />}
          {mode === "patches" && <PatchInspector key={patches.join(",")} patchIds={patches} {...(onLearnMore ? { onLearnMore } : {})} />}
          {mode === "none" && <EmptyInspector commentCount={comments.length} />}
        </div>
      )}
    </Panel>
  );
}

const KIND_LABELS = { prototype: "Prototype", layerComponent: "Layer component", patchComponent: "Patch component" } as const;

function EmptyInspector({ commentCount }: { commentCount: number }) {
  const component = useCurrentComponent();
  const edit = useInspectorEdit();
  const [draft, setDraft] = useState<string | null>(null);
  const notes = component?.notes ?? "";
  const commitNotes = () => {
    if (!component || draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next === notes) return;
    const op: Op = { op: "updateComponent", id: component.id, notes: next ? next : null };
    edit.apply([op], next ? `Edit notes on ${component.name}` : `Clear notes on ${component.name}`);
  };
  return (
    <div className="sb-insp-empty">
      <EmptyState
        icon={commentCount ? <StickyNote size={18} /> : <MousePointerClick size={18} />}
        title={commentCount ? "A comment is selected" : "Nothing selected"}
        description={
          commentCount
            ? "Edit the comment's text right in the patch editor."
            : "Select a layer or a patch to see its properties here. Drag a number's field to scrub it; hold Shift for bigger steps."
        }
      />
      {component && (
        <div className="sb-insp-card sb-insp-component">
          <div className="sb-insp-component__head">
            <span className="sb-insp-card__icon" aria-hidden>
              <Component size={14} strokeWidth={1.75} />
            </span>
            <div className="sb-insp-card__text">
              <div className="sb-insp-card__title">{component.name}</div>
              <div className="sb-insp-card__meta">
                {KIND_LABELS[component.kind]} · {allLayers(component.layers).length} layers · {Object.keys(component.patches).length} patches
                {component.size ? ` · ${component.size[0]}×${component.size[1]}` : ""}
              </div>
            </div>
          </div>
          <label className="sb-insp-component__notes">
            <span className="sb-insp-component__label">Notes</span>
            <TextArea
              aria-label="Component notes"
              rows={3}
              placeholder="What should this prototype show? Notes help teammates and Claude."
              className="sb-insp-textarea"
              value={draft ?? notes}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitNotes}
              onCommit={commitNotes}
            />
          </label>
        </div>
      )}
      {component && component.kind !== "prototype" && <PublishedPorts component={component} />}
    </div>
  );
}

const byKey = (a: InterfacePort, b: InterfacePort) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * A component's published inputs and outputs: what shows as properties wherever the component is
 * placed. Rename them, set an input's default, or unpublish them. Publishing happens in the patch
 * editor (⌥P on a port, or its context menu).
 */
function PublishedPorts({ component }: { component: SonobeComponent }) {
  const inputs = Object.values(component.interface.inputs).sort(byKey);
  const outputs = Object.values(component.interface.outputs).sort(byKey);
  return (
    <div className="sb-insp-card sb-insp-interface" role="group" aria-label="Published ports">
      <div className="sb-insp-interface__group">
        <span className="sb-insp-component__label">Published inputs</span>
        {inputs.length ? inputs.map((port) => <PublishedRow key={port.key} componentId={component.id} port={port} side="in" />) : <p className="sb-insp-note">None yet. In the patch editor, point at an input and press ⌥P, or right-click it and choose Publish as Component Input.</p>}
      </div>
      <div className="sb-insp-interface__group">
        <span className="sb-insp-component__label">Published outputs</span>
        {outputs.length ? outputs.map((port) => <PublishedRow key={port.key} componentId={component.id} port={port} side="out" />) : <p className="sb-insp-note">None yet. Point at an output and press ⌥P, so patches outside can read it.</p>}
      </div>
    </div>
  );
}

function PublishedRow({ componentId, port, side }: { componentId: string; port: InterfacePort; side: PublishSide }) {
  const session = useEditorSession();
  const edit = useInspectorEdit();
  const [draft, setDraft] = useState<string | null>(null);
  const kind = side === "in" ? "input" : "output";
  const latest = () => session.document.getState().doc.components[componentId];
  const rename = () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    const c = latest();
    if (!c || !next || next === port.name) return;
    edit.apply(updatePublishedOps(c, side, port.key, { name: next }), `Rename published ${kind} “${port.name}” to “${next}”`);
  };
  const remove = () => {
    const c = latest();
    if (c) edit.apply(unpublishOps(c, port.key, side), `Unpublish “${port.name}”`);
  };
  return (
    <div className="sb-insp-interface__port">
      <div className="sb-insp-interface__row">
        <PortGlyph type={port.type} size={8} />
        <TextField
          size="sm"
          aria-label={`Published ${kind} name`}
          containerClassName="sb-insp-interface__name"
          value={draft ?? port.name}
          onFocus={() => setDraft(port.name)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={rename}
          onCommit={rename}
          onCancel={() => setDraft(null)}
        />
        <span className="sb-insp-interface__type">{VALUE_TYPE_LABELS[port.type] ?? port.type}</span>
        <IconButton size="xs" icon={<X size={12} />} label={`Unpublish ${port.name}`} tooltip="Unpublish" onClick={remove} />
      </div>
      {side === "in" && port.type !== "pulse" && port.type !== "layer" && <PublishedDefault componentId={componentId} port={port} />}
    </div>
  );
}

/** A published input's default: the value it has where an instance doesn't set it. */
function PublishedDefault({ componentId, port }: { componentId: string; port: InterfacePort }) {
  const session = useEditorSession();
  const edit = useInspectorEdit();
  const fallback = zeroLiteral(port.type) as InputValue;
  const fieldPort: FieldPort = { key: port.key, name: port.name, type: port.type, description: "The value where an instance doesn't set it.", ...(port.enumOptions ? { enumOptions: port.enumOptions.map((key) => ({ key, name: key })) } : {}) };
  const field = summarizeField(fieldPort, [{ id: componentId, address: `$in.${port.key}`, stored: port.default, fallback: port.default ?? fallback }]);
  const write = (update: Parameters<FieldActions["set"]>[0], options: { gesture?: string; coalesceKey?: string }) => {
    const c = session.document.getState().doc.components[componentId];
    const current = c?.interface.inputs[port.key];
    if (!c || !current) return;
    const value = current.default ?? fallback;
    const next = typeof update === "function" ? update(value, 0) : update;
    if (sameInputValue(value, next)) return;
    edit.apply(updatePublishedOps(c, "in", port.key, { default: (isJsonLiteral(next) ? next.json : next) as InputValue }), `Set default of “${current.name}”`, options);
  };
  const actions: FieldActions = {
    change: (update) => write(update, { gesture: `published-default:${componentId}:${port.key}` }),
    set: (update, options) => {
      write(update, options?.coalesceKey ? { coalesceKey: options.coalesceKey } : {});
      edit.endGesture();
    },
    commit: () => edit.endGesture(),
    reset: () => {
      const c = session.document.getState().doc.components[componentId];
      if (c) edit.apply(updatePublishedOps(c, "in", port.key, { default: null }), `Reset default of “${port.name}”`);
    },
    disconnect: () => undefined,
  };
  return (
    <div className="sb-insp-interface__default">
      <span className="sb-insp-interface__default-label">Default</span>
      <div className="sb-insp-interface__default-control">
        <ValueControl field={field} actions={actions} label={`${port.name} default`} />
      </div>
    </div>
  );
}
