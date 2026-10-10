import { DEFAULT_DEVICE } from "@sonobe/core";
import { Layers, SlidersHorizontal, Smartphone, TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useAssistant } from "../panels/assistant/assistantStore.ts";
import { Button } from "../ui/Button.tsx";
import { CommandPalette } from "../ui/CommandPalette.tsx";
import { DialogBoundary, ErrorBoundary, type BoundaryProblem } from "../ui/ErrorBoundary.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Splitter } from "../ui/Splitter.tsx";
import { getFocusable } from "../ui/lib/focus.ts";
import { observeResize } from "../ui/lib/observeResize.ts";
import { useElementSize } from "../ui/lib/useElementSize.ts";
import { DrawerHost } from "./drawers/DrawerHost.tsx";
import { DEFAULT_LAYOUT, MIN_CENTER_WIDTH, SIZE_LIMITS, SPLIT_LIMITS, drawerOverhang, fitPanelWidths, layoutStore, useLayout, useLiveDrawerWidth } from "./layoutStore.ts";
import { PanelBoundary, PanelRail, type PanelBoundaryProps } from "./Panel.tsx";
import { Toolbar, type ToolbarProps } from "./Toolbar.tsx";
import { useShellCommands } from "./useShellCommands.tsx";
import "./AppShell.css";
import "./docking.css";

export interface AppShellSlots {
  layers?: ReactNode;
  viewer?: ReactNode;
  canvas?: ReactNode;
  patchEditor?: ReactNode;
  inspector?: ReactNode;
  /** Bottom HUD (console, diagnostics, AI activity, performance). */
  hud?: ReactNode;
  /** Learn drawer content. */
  learn?: ReactNode;
  /** Toolbar Claude button. */
  claude?: ReactNode;
  /** Full-width notice between the toolbar and the panels. */
  banner?: ReactNode;
}

export interface AppShellProps {
  documentTitle?: string;
  dirty?: boolean;
  onRenameDocument?: (name: string) => void;
  documentMenu?: ToolbarProps["documentMenu"];
  deviceId?: string;
  onDeviceChange?: (id: string) => void;
  playing?: boolean;
  onTogglePlay?: () => void;
  onRestart?: () => void;
  slots?: AppShellSlots;
  /** Left inset for native window controls (e.g. macOS traffic lights in Electron). */
  titlebarInset?: number;
  /** Dock the Learn drawer beside the panels (e.g. during a lesson) instead of over them. */
  drawerDocked?: boolean;
}

const noop = () => undefined;

// The two parts with no room for a SurfaceProblem say it in the room they have, and can be tried again: a notice that
// stayed hidden could be the one that says the project changed on disk.
const noticeProblem = ({ retry }: BoundaryProblem) => (
  <div className="sb-shell__notice-problem" role="alert">
    <span>A notice couldn’t be shown here. The rest of Sonobe still works.</span>
    <Button size="sm" variant="ghost" onClick={retry}>
      Try again
    </Button>
  </div>
);
const claudeProblem = ({ retry }: BoundaryProblem) => <IconButton icon={<TriangleAlert size={16} strokeWidth={1.75} />} label="The Claude button hit a problem. Try again" onClick={retry} />;

/** What each panel slot is called when it fails, and the panel that says so. Every slot is contained here, whatever fills it. */
const SLOT_PANELS = {
  layers: { name: "Layers", title: "Layers", scope: "layers" },
  viewer: { name: "The Viewer", title: "Viewer", scope: "viewer", surface: "sunken" },
  canvas: { name: "The canvas", title: "Canvas", scope: "canvas", surface: "sunken" },
  patchEditor: { name: "The Patches panel", title: "Patches", scope: "patchEditor", surface: "sunken" },
  inspector: { name: "The Inspector", title: "Inspector", scope: "inspector" },
} as const satisfies Record<string, Omit<PanelBoundaryProps, "children">>;

const SIDE_PANELS = ["layers", "viewer", "inspector"] as const;
type SidePanel = (typeof SIDE_PANELS)[number];

/** Where focus goes once a side panel has collapsed to its rail, or reopened from it. */
interface FocusIntent {
  panel: SidePanel;
  to: "rail" | "panel";
}

/**
 * The editor frame: toolbar; Layers | Viewer | Canvas / Patch Editor | Inspector; bottom HUD; and the
 * Learn drawer. Panels resize (sizes are written to CSS variables while dragging and committed on
 * release), collapse to rails, and persist their layout. Content comes through slots, each contained:
 * a slot that throws while drawing says so in its own place (ARCHITECTURE §9, Error containment).
 */
export function AppShell({
  documentTitle = "Untitled",
  dirty = false,
  onRenameDocument,
  documentMenu,
  deviceId = DEFAULT_DEVICE,
  onDeviceChange = noop,
  playing = false,
  onTogglePlay = noop,
  onRestart = noop,
  slots = {},
  titlebarInset = 0,
  drawerDocked = false,
}: AppShellProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sizes = useLayout((s) => s.sizes);
  const split = useLayout((s) => s.split);
  const collapsed = useLayout((s) => s.collapsed);
  const viewMode = useLayout((s) => s.viewMode);
  const splitDirection = useLayout((s) => s.splitDirection);
  const drawerOpen = useLayout((s) => s.drawer !== null);
  const assistantOpen = useAssistant((s) => s.open);
  const { setSize, setSplit, toggleCollapsed } = layoutStore.getState();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [centerRef, center] = useElementSize<HTMLDivElement>();
  const [rowRef, row] = useElementSize<HTMLDivElement>();
  const [keepViewer, setKeepViewer] = useState(false);
  const bannersRef = useRef<HTMLDivElement>(null);
  const focusIntent = useRef<FocusIntent | null>(null);

  const learnShown = drawerOpen && slots.learn !== undefined;
  const docked = drawerDocked && learnShown;
  const drawerWidth = useLiveDrawerWidth() ?? sizes.drawer;
  const floating = !docked && (learnShown || assistantOpen);
  const overhang = floating ? drawerOverhang(drawerWidth, sizes.inspector, collapsed.inspector) : 0;
  const fitted = row.width > 0 ? fitPanelWidths(sizes, collapsed, row.width - overhang, MIN_CENTER_WIDTH, keepViewer) : null;
  const shown = fitted?.sizes ?? sizes;
  const viewerRail = collapsed.viewer || !!fitted?.viewerAuto;

  const showViewer = () => {
    if (rootRef.current?.querySelector('.sb-rail[data-panel="viewer"]')?.contains(document.activeElement)) focusIntent.current = { panel: "viewer", to: "panel" };
    setKeepViewer(true);
    toggleCollapsed("viewer", false);
  };

  useShellCommands({
    openPalette: () => setPaletteOpen(true),
    toggleViewer: () => (viewerRail ? showViewer() : toggleCollapsed("viewer", true)),
  });

  useEffect(() => {
    if (!keepViewer) return;
    const allOpen = { layers: false, viewer: false, inspector: false };
    if (collapsed.viewer || (row.width > 0 && !fitPanelWidths(sizes, allOpen, row.width - overhang).viewerAuto)) setKeepViewer(false);
  }, [keepViewer, collapsed.viewer, sizes, row.width, overhang]);

  useEffect(
    () =>
      layoutStore.subscribe((state, prev) => {
        const active = document.activeElement;
        for (const panel of SIDE_PANELS) {
          if (state.collapsed[panel] === prev.collapsed[panel]) continue;
          if (state.collapsed[panel]) {
            const inside = document.getElementById(`sb-${panel}`)?.contains(active) || active?.getAttribute("aria-controls") === `sb-${panel}`;
            if (inside) focusIntent.current = { panel, to: "rail" };
          } else if (rootRef.current?.querySelector(`.sb-rail[data-panel="${panel}"]`)?.contains(active)) {
            focusIntent.current = { panel, to: "panel" };
          }
        }
      }),
    [],
  );

  useLayoutEffect(() => {
    const intent = focusIntent.current;
    if (!intent) return;
    focusIntent.current = null;
    const root = rootRef.current;
    if (!root) return;
    const target =
      intent.to === "rail"
        ? root.querySelector<HTMLElement>(`.sb-rail[data-panel="${intent.panel}"] .sb-iconbtn`)
        : (root.querySelector<HTMLElement>(`#sb-${intent.panel} .sb-panel__header button[aria-label^="Hide"]`) ?? getFocusable(document.getElementById(`sb-${intent.panel}`))[0]);
    target?.focus();
  });

  useEffect(() => {
    const banners = bannersRef.current;
    const root = rootRef.current;
    if (!banners || !root) return;
    const measure = () => root.style.setProperty("--sb-banner-h", `${banners.offsetHeight}px`);
    measure();
    return observeResize([banners], measure);
  }, []);

  const live = (name: string, value: string) => rootRef.current?.style.setProperty(name, value);

  const style = {
    "--sb-layers-w": `${shown.layers}px`,
    "--sb-viewer-w": `${shown.viewer}px`,
    "--sb-inspector-w": `${shown.inspector}px`,
    ...(fitted ? { "--sb-center-min": `${Math.max(0, Math.min(MIN_CENTER_WIDTH, fitted.center))}px` } : {}),
    "--sb-hud-h": `${sizes.hud}px`,
    "--sb-drawer-w": `${drawerWidth}px`,
    "--sb-inspector-slot": collapsed.inspector ? "var(--rail-w)" : "calc(var(--sb-inspector-w) + 1px)",
    "--sb-split": String(split),
    "--sb-titlebar-inset": `${titlebarInset}px`,
  } as CSSProperties;

  const sideSplitter = (panel: SidePanel, label: string, controls: string, invert = false) => (
    <Splitter
      orientation="vertical"
      size={shown[panel]}
      min={SIZE_LIMITS[panel][0]}
      max={SIZE_LIMITS[panel][1]}
      defaultSize={DEFAULT_LAYOUT.sizes[panel]}
      invert={invert}
      label={label}
      controls={controls}
      onResize={(size) => live(`--sb-${panel}-w`, `${size}px`)}
      onResizeEnd={(size) => setSize(panel, size)}
      onToggleCollapse={() => toggleCollapsed(panel)}
    />
  );

  const splitDimension = splitDirection === "rows" ? center.height : center.width;
  const contained = (slot: keyof typeof SLOT_PANELS) => <PanelBoundary {...SLOT_PANELS[slot]}>{slots[slot]}</PanelBoundary>;

  return (
    <div ref={rootRef} className="sb-app sb-shell" style={style}>
      <Toolbar
        documentTitle={documentTitle}
        dirty={dirty}
        {...(onRenameDocument ? { onRename: onRenameDocument } : {})}
        {...(documentMenu ? { documentMenu } : {})}
        deviceId={deviceId}
        onDeviceChange={onDeviceChange}
        playing={playing}
        onTogglePlay={onTogglePlay}
        onRestart={onRestart}
        onOpenPalette={() => setPaletteOpen(true)}
        claude={
          <ErrorBoundary name="The Claude button" fallback={claudeProblem}>
            {slots.claude}
          </ErrorBoundary>
        }
      />
      <div ref={bannersRef} className="sb-shell__banners">
        <ErrorBoundary name="The notice bar" fallback={noticeProblem}>
          {slots.banner}
        </ErrorBoundary>
      </div>
      <main className="sb-shell__main" data-drawer-docked={docked || undefined} data-drawer-over={floating || undefined}>
        <div ref={rowRef} className="sb-shell__row">
          {collapsed.layers ? (
            <PanelRail panel="layers" title="Layers" side="left" icon={<Layers size={14} strokeWidth={1.75} />} shortcut="Mod+1" onExpand={() => toggleCollapsed("layers", false)} />
          ) : (
            <>
              <div id="sb-layers" className="sb-shell__slot sb-shell__layers">
                {contained("layers")}
              </div>
              {sideSplitter("layers", "Resize layers", "sb-layers")}
            </>
          )}

          {viewerRail ? (
            <PanelRail panel="viewer" title="Viewer" side="left" icon={<Smartphone size={14} strokeWidth={1.75} />} shortcut="Mod+2" onExpand={showViewer} />
          ) : (
            <>
              <div id="sb-viewer" className="sb-shell__slot sb-shell__viewer">
                {contained("viewer")}
              </div>
              {sideSplitter("viewer", "Resize viewer", "sb-viewer")}
            </>
          )}

          <div ref={centerRef} className="sb-shell__center" data-direction={splitDirection} data-mode={viewMode}>
            {viewMode !== "patches" && <div className="sb-shell__canvas">{contained("canvas")}</div>}
            {viewMode === "split" && (
              <Splitter
                orientation={splitDirection === "rows" ? "horizontal" : "vertical"}
                size={split * splitDimension}
                min={SPLIT_LIMITS[0] * splitDimension}
                max={SPLIT_LIMITS[1] * splitDimension}
                defaultSize={0.5 * splitDimension}
                label="Resize canvas and patch editor"
                onResize={(px) => {
                  if (splitDimension > 0) live("--sb-split", String(px / splitDimension));
                }}
                onResizeEnd={(px) => {
                  if (splitDimension > 0) setSplit(px / splitDimension);
                }}
              />
            )}
            {viewMode !== "canvas" && <div className="sb-shell__patches">{contained("patchEditor")}</div>}
          </div>

          {collapsed.inspector ? (
            <PanelRail panel="inspector" title="Inspector" side="right" icon={<SlidersHorizontal size={14} strokeWidth={1.75} />} shortcut="Mod+7" onExpand={() => toggleCollapsed("inspector", false)} />
          ) : (
            <>
              {sideSplitter("inspector", "Resize inspector", "sb-inspector", true)}
              <div id="sb-inspector" className="sb-shell__slot sb-shell__inspector">
                {contained("inspector")}
              </div>
            </>
          )}
        </div>

        {!collapsed.hud && (
          <Splitter
            orientation="horizontal"
            invert
            size={sizes.hud}
            min={SIZE_LIMITS.hud[0]}
            max={SIZE_LIMITS.hud[1]}
            defaultSize={DEFAULT_LAYOUT.sizes.hud}
            label="Resize console"
            controls="sb-hud"
            onResize={(size) => live("--sb-hud-h", `${size}px`)}
            onResizeEnd={(size) => setSize("hud", size)}
            onToggleCollapse={() => toggleCollapsed("hud", true)}
          />
        )}
        <div id="sb-hud" className="sb-shell__hud" data-collapsed={collapsed.hud || undefined}>
          <ErrorBoundary name="The bottom panel">{slots.hud}</ErrorBoundary>
        </div>

        <DrawerHost learn={slots.learn} docked={drawerDocked} />
      </main>

      {/* The palette stays mounted while closed, so opening it is what clears a problem. */}
      <DialogBoundary name="The command palette" resetKey={paletteOpen} onFailed={() => setPaletteOpen(false)}>
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </DialogBoundary>
    </div>
  );
}
