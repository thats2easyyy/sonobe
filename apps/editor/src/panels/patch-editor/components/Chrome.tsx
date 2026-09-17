/** Patch editor chrome: breadcrumbs, toolbar, zoom and minimap controls, live scope, hints, empty state. */

import { useReactFlow, useViewport } from "@xyflow/react";
import { ChevronDown, ChevronRight, Map as MapIcon, MessageSquarePlus, Minus, Plus, Scan, WandSparkles, X } from "lucide-react";
import { useStore } from "zustand";
import { useEditorSession } from "../../../state/EditorProvider.tsx";
import { selectBreadcrumbs } from "../../../state/selection.ts";
import type { EditorSession } from "../../../state/session.ts";
import { IconButton } from "../../../ui/IconButton.tsx";
import { Kbd } from "../../../ui/Kbd.tsx";
import { useContextMenu, type MenuEntry } from "../../../ui/Menu.tsx";
import { PortGlyph } from "../../../ui/PortGlyph.tsx";
import { instanceChoiceKey } from "../model/instances.ts";
import { patchEditorBridge } from "../state/bridge.ts";
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
  const { ui, markViewportManual } = usePatchEditor();
  const minimap = useUi((s) => s.minimap);
  return (
    <div className="sb-pe-zoom" role="group" aria-label="Zoom">
      <IconButton size="xs" icon={<MapIcon size={12} />} label={minimap ? "Hide minimap" : "Show minimap"} shortcut="Shift+M" active={minimap} onClick={() => ui.getState().set({ minimap: !minimap })} tooltipPlacement="top" />
      <span className="sb-pe-zoom__divider" aria-hidden />
      <IconButton
        size="xs"
        icon={<Minus size={12} />}
        label="Zoom out"
        shortcut="Mod+-"
        onClick={() => {
          markViewportManual();
          void flow.zoomOut({ duration: 120 });
        }}
        tooltipPlacement="top"
      />
      <button
        type="button"
        className="sb-pe-zoom__value sb-tabular"
        onClick={() => {
          markViewportManual();
          void flow.zoomTo(1, { duration: 160 });
        }}
        aria-label="Zoom to 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <IconButton
        size="xs"
        icon={<Plus size={12} />}
        label="Zoom in"
        shortcut="Mod+="
        onClick={() => {
          markViewportManual();
          void flow.zoomIn({ duration: 120 });
        }}
        tooltipPlacement="top"
      />
      <IconButton size="xs" icon={<Scan size={12} />} label="Zoom to fit" shortcut="Shift+1" onClick={() => void flow.fitView({ duration: 200, padding: 0.12 })} tooltipPlacement="top" />
    </div>
  );
}

/**
 * Inside a component: where live values come from ("Live · Press Card"), with a menu to switch
 * instances when the component is used several times, or a note that it doesn't run anywhere.
 */
export function LiveScopeChip({ offset = false }: { offset?: boolean }) {
  const { liveScope, session } = usePatchEditor();
  const menu = useContextMenu();
  if (liveScope.steps.length === 0 && liveScope.prefix !== null) return null;
  if (liveScope.prefix === null) {
    return (
      <div className="sb-pe-live" data-state="off" data-offset={offset || undefined} role="status" title="Use this component in the prototype to see live values, pulses, and state here.">
        <span className="sb-pe-live__dot" aria-hidden />
        Not running · no instance in the prototype
      </div>
    );
  }
  const last = liveScope.steps.at(-1)!;
  const current = last.instances.find((x) => x.id === last.instance) ?? last.instances[0]!;
  const path = liveScope.steps.map((s) => s.instances.find((x) => x.id === s.instance)?.name ?? s.instance).join(" › ");
  const several = last.instances.length > 1;
  const entries: MenuEntry[] = [
    { type: "label", id: "title", label: "Show live values from" },
    ...last.instances.map(
      (instance): MenuEntry => ({
        id: instance.id,
        label: instance.name,
        description: instance.kind === "patch" ? `Patch ${instance.id}` : `Layer ${instance.id}`,
        checked: instance.id === current.id,
        onSelect: () => patchEditorBridge(session).getState().chooseInstance(instanceChoiceKey(last.parent, last.component), instance.id),
      }),
    ),
  ];
  return (
    <div className="sb-pe-live" data-state="on" data-offset={offset || undefined} title={`Live values from ${path}`}>
      <span className="sb-pe-live__dot" aria-hidden />
      <span className="sb-pe-live__label">Live</span>
      {several ? (
        <button type="button" className="sb-pe-live__pick" aria-haspopup="menu" aria-label={`Live values from ${current.name}. Choose another instance`} onClick={(event) => menu.open(event, entries)}>
          {current.name}
          <ChevronDown size={11} strokeWidth={2.25} aria-hidden />
        </button>
      ) : (
        <span className="sb-pe-live__name">{current.name}</span>
      )}
      {menu.element}
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
