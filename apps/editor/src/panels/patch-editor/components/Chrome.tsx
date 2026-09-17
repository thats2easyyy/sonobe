/** Patch editor chrome: breadcrumbs, toolbar, zoom and minimap controls, hints, empty state. */

import { useReactFlow, useViewport } from "@xyflow/react";
import { ChevronRight, Map as MapIcon, MessageSquarePlus, Minus, Plus, Scan, WandSparkles, X } from "lucide-react";
import { useStore } from "zustand";
import { useEditorSession } from "../../../state/EditorProvider.tsx";
import { selectBreadcrumbs } from "../../../state/selection.ts";
import type { EditorSession } from "../../../state/session.ts";
import { IconButton } from "../../../ui/IconButton.tsx";
import { Kbd } from "../../../ui/Kbd.tsx";
import { PortGlyph } from "../../../ui/PortGlyph.tsx";
import { usePatchEditor, useUi } from "../state/context.ts";

export interface PatchEditorBreadcrumbsProps {
  /** Default: the nearest EditorProvider's session. */
  session?: EditorSession;
  className?: string;
}

/** Component path: click a crumb to go back up (⌥↑ exits one level). */
export function PatchEditorBreadcrumbs({ session: provided, className }: PatchEditorBreadcrumbsProps) {
  const fallback = useEditorSession();
  const session = provided ?? fallback;
  const path = useStore(session.selection, (s) => s.componentPath);
  const components = useStore(session.document, (s) => s.doc.components);
  const crumbs = selectBreadcrumbs({ componentPath: path }, { components } as never);
  return (
    <nav className={`sb-pe-crumbs${className ? ` ${className}` : ""}`} aria-label="Component path">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={crumb.path.join("/")} className="sb-pe-crumbs__item">
            {i > 0 && <ChevronRight size={12} aria-hidden className="sb-pe-crumbs__sep" />}
            {last ? (
              <span aria-current="page">{crumb.name}</span>
            ) : (
              <button type="button" onClick={() => session.selection.getState().setComponentPath(crumb.path)}>
                {crumb.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function Toolbar() {
  const { actions } = usePatchEditor();
  return (
    <div className="sb-pe-toolbar" role="toolbar" aria-label="Patch editor tools">
      <IconButton size="sm" icon={<WandSparkles size={14} />} label="Tidy up" shortcut="Ctrl+T" onClick={() => void actions.tidyUp()} />
      <IconButton size="sm" icon={<MessageSquarePlus size={14} />} label="Add comment" shortcut="Ctrl+Alt+C" onClick={() => actions.commentSelection()} />
      <IconButton size="sm" icon={<Plus size={14} />} label="Insert patch" shortcut="Alt+Enter" onClick={() => actions.openPicker()} />
    </div>
  );
}

export function ZoomControls() {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const { ui } = usePatchEditor();
  const minimap = useUi((s) => s.minimap);
  return (
    <div className="sb-pe-zoom" role="group" aria-label="Zoom">
      <IconButton size="xs" icon={<MapIcon size={12} />} label={minimap ? "Hide minimap" : "Show minimap"} shortcut="Shift+M" active={minimap} onClick={() => ui.getState().set({ minimap: !minimap })} tooltipPlacement="top" />
      <span className="sb-pe-zoom__divider" aria-hidden />
      <IconButton size="xs" icon={<Minus size={12} />} label="Zoom out" shortcut="Mod+-" onClick={() => void flow.zoomOut({ duration: 120 })} tooltipPlacement="top" />
      <button type="button" className="sb-pe-zoom__value sb-tabular" onClick={() => void flow.zoomTo(1, { duration: 160 })} aria-label="Zoom to 100%">
        {Math.round(zoom * 100)}%
      </button>
      <IconButton size="xs" icon={<Plus size={12} />} label="Zoom in" shortcut="Mod+=" onClick={() => void flow.zoomIn({ duration: 120 })} tooltipPlacement="top" />
      <IconButton size="xs" icon={<Scan size={12} />} label="Zoom to fit" shortcut="Shift+1" onClick={() => void flow.fitView({ duration: 200, padding: 0.12 })} tooltipPlacement="top" />
    </div>
  );
}

/** Shown while an output is armed for click-to-connect. */
export function ArmedHint() {
  const armed = useUi((s) => s.armed);
  const { ui } = usePatchEditor();
  if (!armed) return null;
  return (
    <div className="sb-pe-hint" role="status">
      <PortGlyph type={armed.type} size={9} />
      <span>
        Click an input to connect <strong>{armed.label}</strong>. Hold <Kbd>⇧</Kbd> to connect several.
      </span>
      <IconButton size="xs" icon={<X size={12} />} label="Cancel" shortcut="Escape" onClick={() => ui.getState().set({ armed: null })} />
    </div>
  );
}

export function EmptyGraph() {
  return (
    <div className="sb-pe-empty" aria-live="polite">
      <div className="sb-pe-empty__title">No patches yet</div>
      <div className="sb-pe-empty__body">
        Double-click the canvas or press <Kbd shortcut="Alt+Enter" /> to add one. Hover here and press <Kbd>I</Kbd> for an Interaction, <Kbd>S</Kbd> for a Switch, <Kbd>A</Kbd> for a Pop Animation.
      </div>
    </div>
  );
}
