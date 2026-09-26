/** Patch editor chrome: toolbar with the zoom menu, live scope and watched copy, hints, empty state. */

import { useReactFlow, useStore as useFlowStore } from "@xyflow/react";
import { ChevronDown, ChevronLeft, ChevronRight, MessageSquarePlus, Plus, Scan, Workflow, X } from "lucide-react";
import { useRef, useState, type ComponentPropsWithRef, type FocusEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { IconButton } from "../../../ui/IconButton.tsx";
import { Kbd } from "../../../ui/Kbd.tsx";
import { Menu, useContextMenu, type MenuEntry } from "../../../ui/Menu.tsx";
import { PortGlyph } from "../../../ui/PortGlyph.tsx";
import { Tooltip } from "../../../ui/Tooltip.tsx";
import { detectPlatform, formatShortcutLabel } from "../../../ui/commands/shortcutManager.ts";
import { FIT_VIEW_PADDING } from "../model/geometry.ts";
import { instanceChoiceKey } from "../model/instances.ts";
import { patchEditorBridge } from "../state/bridge.ts";
import { usePatchEditor, useUi } from "../state/context.ts";
import { useWatchedCopy } from "../state/watch.ts";

export { PatchEditorBreadcrumbs, type PatchEditorBreadcrumbsProps } from "./Breadcrumbs.tsx";

export interface ToolbarProps {
  /** Render into this element (a panel header) instead of over the canvas. */
  container?: Element | null;
  /** False in a pane under 480px: the fit button steps aside for the zoom menu. */
  roomy?: boolean;
  /** False when the header is short of room (a pane under 300px, or a folded component path in one under 480px): Insert patch drops its "Patch" label. */
  labelled?: boolean;
}

/** One Tab stop for a toolbar: arrows, Home and End move between its buttons. */
function useRovingToolbar() {
  const bar = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const buttons = () => [...(bar.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
  return {
    ref: bar,
    tabIndex: (index: number) => (index === active ? 0 : -1),
    onFocus(event: FocusEvent<HTMLDivElement>) {
      const target: EventTarget = event.target;
      const index = buttons().findIndex((button) => button === target);
      if (index >= 0) setActive(index);
    },
    onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      const items = buttons();
      const at = items.findIndex((button) => button === document.activeElement);
      if (at < 0) return;
      const next = { ArrowRight: (at + 1) % items.length, ArrowLeft: (at - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      items[next]!.focus();
    },
  };
}

/** The zoom menu, with a button for the most used step, fitting the graph. Zoom in, out, 100% and the minimap sit in the menu. */
function ZoomTools({ roomy, tabIndex }: { roomy: boolean; tabIndex: (index: number) => number }) {
  const flow = useReactFlow();
  const { ui, markViewportManual } = usePatchEditor();
  const minimap = useUi((s) => s.minimap);
  const percent = useFlowStore((s) => Math.round(s.transform[2] * 100));
  const step = (move: () => Promise<unknown>) => () => {
    markViewportManual();
    void move();
  };
  const fit = () => void flow.fitView({ duration: 200, padding: FIT_VIEW_PADDING });
  const entries: MenuEntry[] = [
    { id: "zoomIn", label: "Zoom In", shortcut: "Mod+=", onSelect: step(() => flow.zoomIn({ duration: 120 })) },
    { id: "zoomOut", label: "Zoom Out", shortcut: "Mod+-", onSelect: step(() => flow.zoomOut({ duration: 120 })) },
    { id: "zoomReset", label: "Zoom to 100%", shortcut: "Mod+0", onSelect: step(() => flow.zoomTo(1, { duration: 160 })) },
    { id: "zoomFit", label: "Zoom to Fit", shortcut: "Shift+1", onSelect: fit },
    { type: "separator" },
    { id: "minimap", label: "Show Minimap", shortcut: "Shift+M", checked: minimap, onSelect: () => ui.getState().set({ minimap: !minimap }) },
  ];
  return (
    <>
      {roomy && <IconButton size="sm" icon={<Scan size={14} />} label="Zoom to fit" shortcut="Shift+1" tabIndex={tabIndex(3)} onClick={fit} />}
      <Menu aria-label="Patches zoom" placement="bottom-end" entries={entries}>
        <ZoomChip percent={percent} tabIndex={tabIndex(roomy ? 4 : 3)} />
      </Menu>
    </>
  );
}

/** The menu trigger; its tooltip steps aside while the menu is open. */
function ZoomChip({ percent, ...rest }: { percent: number } & ComponentPropsWithRef<"button">) {
  return (
    <Tooltip content="Zoom" disabled={rest["aria-expanded"] === true}>
      <button type="button" className="sb-pe-zoomchip" aria-label={`Patches zoom: ${percent}%`} {...rest}>
        <span className="sb-tabular">{percent}%</span>
        <ChevronDown size={12} strokeWidth={2} aria-hidden />
      </button>
    </Tooltip>
  );
}

/** Tidy up, comment, insert and the zoom menu. Docked in a panel header when `container` is given, else floating in the canvas's top bar. */
export function Toolbar({ container, roomy = true, labelled = true }: ToolbarProps) {
  const { actions } = usePatchEditor();
  const docked = container !== undefined && container !== null;
  const roving = useRovingToolbar();
  const bar = (
    <div ref={roving.ref} className="sb-pe-toolbar" data-docked={docked || undefined} role="toolbar" aria-label="Patch editor tools" onFocus={roving.onFocus} onKeyDown={roving.onKeyDown}>
      <IconButton size="sm" icon={<Workflow size={14} />} label="Tidy up" shortcut="Ctrl+T" tabIndex={roving.tabIndex(0)} onClick={() => void actions.tidyUp()} />
      <IconButton size="sm" icon={<MessageSquarePlus size={14} />} label="Add comment" shortcut="Ctrl+Alt+C" tabIndex={roving.tabIndex(1)} onClick={() => actions.commentSelection()} />
      {labelled ? (
        <Tooltip content="Insert patch" shortcut="Alt+Enter">
          <Button className="sb-pe-toolbar__insert" variant="ghost" size="sm" icon={<Plus size={14} />} aria-label="Insert patch" tabIndex={roving.tabIndex(2)} onClick={() => actions.openPicker()}>
            Patch
          </Button>
        </Tooltip>
      ) : (
        <IconButton size="sm" icon={<Plus size={14} />} label="Insert patch" shortcut="Alt+Enter" tabIndex={roving.tabIndex(2)} onClick={() => actions.openPicker()} />
      )}
      <ZoomTools roomy={roomy} tabIndex={roving.tabIndex} />
    </div>
  );
  return docked ? createPortal(bar, container) : bar;
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
      <span className="sb-pe-hint__text sb-pe-hint__text--long">
        Select an input to connect <strong>{armed.label}</strong>. Hold <Kbd>⇧</Kbd> to connect several.
      </span>
      <span className="sb-pe-hint__text sb-pe-hint__text--short">
        Connect <strong>{armed.label}</strong>: select an input
      </span>
      <IconButton size="sm" icon={<X size={12} />} label="Cancel" shortcut="Escape" onClick={() => ui.getState().set({ armed: null })} />
    </div>
  );
}

/** A blank graph: how to add the first patch, on a block that lets double-clicks through to the canvas. */
export function EmptyGraph() {
  const { actions } = usePatchEditor();
  return (
    <div className="sb-pe-empty" aria-live="polite">
      <EmptyState
        variant="inline"
        size="sm"
        title="No patches yet"
        description={`Double-click the canvas or press ${formatShortcutLabel("Alt+Enter", detectPlatform())} to add a patch.`}
        actions={
          <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => actions.openPicker()}>
            Insert patch
          </Button>
        }
      />
    </div>
  );
}
