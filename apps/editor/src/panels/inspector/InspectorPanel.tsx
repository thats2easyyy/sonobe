import type { Op } from "@sonobe/core";
import { Component, MousePointerClick, PanelRightClose, StickyNote } from "lucide-react";
import { useState } from "react";
import { Panel } from "../../shell/Panel.tsx";
import { useCurrentComponent, useEditorSession, useSelection } from "../../state/EditorProvider.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { TextArea } from "../../ui/TextField.tsx";
import { cx } from "../../ui/lib/cx.ts";
import { allLayers } from "@sonobe/core";
import { LayerInspector } from "./LayerInspector.tsx";
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

/**
 * The Inspector: properties of the selected layers or patches in the current component, generated
 * from their declarations. Layers get sections by category with advanced rows behind "More";
 * patches get docs, options, spring presets with a curve and handoff code, inputs, and live
 * outputs. Nothing selected shows the component's summary and notes.
 */
export function InspectorPanel({ onCollapse, onLearnMore, className }: InspectorPanelProps) {
  const session = useEditorSession();
  const layers = useSelection((s) => s.layers);
  const patches = useSelection((s) => s.patches);
  const comments = useSelection((s) => s.comments);
  const [view, setView] = useState<View>("layers");
  const both = layers.length > 0 && patches.length > 0;
  const mode: View | "none" = both ? view : layers.length > 0 ? "layers" : patches.length > 0 ? "patches" : "none";

  return (
    <Panel
      title="Inspector"
      scope="inspector"
      className={cx("sb-insp-panel", className)}
      actions={onCollapse && <IconButton size="sm" icon={<PanelRightClose size={14} />} label="Hide inspector" shortcut="Mod+7" onClick={onCollapse} />}
    >
      <div className="sb-insp sb-scroll" onFocusCapture={() => session.selection.getState().setFocusedPanel("inspector")}>
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
    </div>
  );
}
