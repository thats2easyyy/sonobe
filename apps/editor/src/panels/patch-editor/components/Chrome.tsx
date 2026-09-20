/** Patch editor chrome: toolbar, zoom and minimap controls, live scope and watched copy, hints, empty state. */

import { useReactFlow, useViewport } from "@xyflow/react";
import { ChevronDown, ChevronLeft, ChevronRight, Map as MapIcon, MessageSquarePlus, Minus, Plus, Scan, WandSparkles, X } from "lucide-react";
import { createPortal } from "react-dom";
import { IconButton } from "../../../ui/IconButton.tsx";
import { Kbd } from "../../../ui/Kbd.tsx";
import { useContextMenu, type MenuEntry } from "../../../ui/Menu.tsx";
import { PortGlyph } from "../../../ui/PortGlyph.tsx";
import { FIT_VIEW_PADDING } from "../model/geometry.ts";
import { instanceChoiceKey } from "../model/instances.ts";
import { patchEditorBridge } from "../state/bridge.ts";
import { usePatchEditor, useUi } from "../state/context.ts";
import { useWatchedCopy } from "../state/watch.ts";

export { PatchEditorBreadcrumbs, type PatchEditorBreadcrumbsProps } from "./Breadcrumbs.tsx";

export interface ToolbarProps {
  /** Render into this element (a panel header) instead of over the canvas. */
  container?: Element | null;
}

/** Tidy up, comment, insert. Docked in a panel header when `container` is given, else floating in the canvas's top bar. */
export function Toolbar({ container }: ToolbarProps) {
  const { actions } = usePatchEditor();
  const docked = container !== undefined && container !== null;
  const bar = (
    <div className="sb-pe-toolbar" data-docked={docked || undefined} role="toolbar" aria-label="Patch editor tools">
      <IconButton size={docked ? "xs" : "sm"} icon={<WandSparkles size={docked ? 13 : 14} />} label="Tidy up" shortcut="Ctrl+T" onClick={() => void actions.tidyUp()} />
      <IconButton size={docked ? "xs" : "sm"} icon={<MessageSquarePlus size={docked ? 13 : 14} />} label="Add comment" shortcut="Ctrl+Alt+C" onClick={() => actions.commentSelection()} />
      <IconButton size={docked ? "xs" : "sm"} icon={<Plus size={docked ? 13 : 14} />} label="Insert patch" shortcut="Alt+Enter" onClick={() => actions.openPicker()} />
    </div>
  );
  return docked ? createPortal(bar, container) : bar;
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
      <IconButton size="xs" icon={<Scan size={12} />} label="Zoom to fit" shortcut="Shift+1" onClick={() => void flow.fitView({ duration: 200, padding: FIT_VIEW_PADDING })} tooltipPlacement="top" />
    </div>
  );
}

/** Copies listed by name in the live scope menu; the watched copy chip steps through more. */
const LISTED_COPIES = 24;

/**
 * Inside a component: where live values come from ("Live · Press Card"), with a menu to switch
 * instances when the component is used several times or to pick one copy of a looped instance
 * ("Card #3"), or a note that it doesn't run anywhere.
 */
export function LiveScopeChip() {
  const { liveScope, session, instanceCopies } = usePatchEditor();
  const watched = useWatchedCopy(session);
  const menu = useContextMenu();
  if (liveScope.steps.length === 0 && liveScope.prefix !== null) return null;
  if (liveScope.prefix === null) {
    return (
      <div className="sb-pe-live" data-state="off" role="status" title="Use this component in the prototype to see live values, pulses, and state here.">
        <span className="sb-pe-live__dot" aria-hidden />
        Not running · no instance in the prototype
      </div>
    );
  }
  const last = liveScope.steps.at(-1)!;
  const current = last.instances.find((x) => x.id === last.instance) ?? last.instances[0]!;
  const path = liveScope.steps.map((s) => s.instances.find((x) => x.id === s.instance)?.name ?? s.instance).join(" › ");
  const several = last.instances.length > 1;
  // A looped instance draws one copy per item; values come from the watched one (copy 0 until you pick).
  const copies = instanceCopies ?? 0;
  const copy = copies ? (watched ?? 0) % copies : null;
  const bridge = patchEditorBridge(session).getState();
  const entries: MenuEntry[] = [
    { type: "label", id: "title", label: "Show live values from" },
    ...last.instances.map(
      (instance): MenuEntry => ({
        id: instance.id,
        label: instance.name,
        description: instance.kind === "patch" ? `Patch ${instance.id}` : `Layer ${instance.id}`,
        checked: instance.id === current.id,
        onSelect: () => bridge.chooseInstance(instanceChoiceKey(last.parent, last.component), instance.id),
      }),
    ),
  ];
  if (copies) {
    entries.push({ type: "separator", id: "copies" }, { type: "label", id: "copies-title", label: `${current.name} has ${copies === 1 ? "1 copy" : `${copies} copies`}` });
    for (let i = 0; i < Math.min(copies, LISTED_COPIES); i++) {
      entries.push({ id: `copy-${i}`, label: `${current.name} #${i}`, description: `${current.id}#${i}`, checked: i === copy, onSelect: () => bridge.watchCopy(i) });
    }
  }
  const name = copy === null ? current.name : `${current.name} #${copy}`;
  return (
    <div className="sb-pe-live" data-state="on" title={`Live values from ${path}${copy === null ? "" : ` #${copy}`}`}>
      <span className="sb-pe-live__dot" aria-hidden />
      <span className="sb-pe-live__label">Live</span>
      {several || copies > 1 ? (
        <button type="button" className="sb-pe-live__pick" aria-haspopup="menu" aria-label={`Live values from ${name}. Choose another ${several ? "instance" : "copy"}`} onClick={(event) => menu.open(event, entries)}>
          {name}
          <ChevronDown size={11} strokeWidth={2.25} aria-hidden />
        </button>
      ) : (
        <span className="sb-pe-live__name">{name}</span>
      )}
      {menu.element}
    </div>
  );
}

/**
 * "Copy #3 of 12": the loop copy live values show here and in the inspector, with arrows to step
 * through the copies and × to go back to the "×N" summary. It counts the longest loop shown, or,
 * inside a looped component instance, its copies.
 */
export function WatchedCopyChip() {
  const { session, liveEnabled, instanceCopies } = usePatchEditor();
  const loopCopies = useUi((s) => s.loopCopies);
  const watched = useWatchedCopy(session);
  const count = instanceCopies ?? loopCopies;
  if (!liveEnabled || (count === 0 && watched === null)) return null;
  const bridge = patchEditorBridge(session).getState();
  const step = (delta: number) => {
    if (!count) return;
    const from = watched === null ? (delta > 0 ? -1 : 0) : watched % count;
    bridge.watchCopy((from + delta + count) % count);
  };
  const shown = watched === null ? null : count ? watched % count : watched;
  const label = shown === null ? `${count} ${count === 1 ? "copy" : "copies"}` : count ? `Copy #${shown} of ${count}` : `Copy #${shown}`;
  return (
    <div className="sb-pe-copy" role="group" aria-label="Watched loop copy" data-watching={shown !== null || undefined}>
      <IconButton size="xs" icon={<ChevronLeft size={12} />} label="Watch the previous copy" disabled={count === 0} onClick={() => step(-1)} />
      <span className="sb-pe-copy__label sb-tabular" aria-live="polite" title={shown === null ? "Loops show their size and first item. Step to one copy to see its values here and in the inspector." : "Live values show this copy of every loop."}>
        {label}
      </span>
      <IconButton size="xs" icon={<ChevronRight size={12} />} label="Watch the next copy" disabled={count === 0} onClick={() => step(1)} />
      {shown !== null && <IconButton size="xs" icon={<X size={12} />} label="Show every copy" onClick={() => bridge.watchCopy(null)} />}
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
