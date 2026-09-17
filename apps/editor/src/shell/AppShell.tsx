import { DEFAULT_DEVICE, getDevicePreset } from "@sonobe/core";
import { Layers, SlidersHorizontal, Smartphone } from "lucide-react";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CommandPalette } from "../ui/CommandPalette.tsx";
import { Splitter } from "../ui/Splitter.tsx";
import { useElementSize } from "../ui/lib/useElementSize.ts";
import { DrawerHost } from "./drawers/DrawerHost.tsx";
import { SIZE_LIMITS, SPLIT_LIMITS, layoutStore, useLayout, type SizedPanel } from "./layoutStore.ts";
import { MOCK_DOCUMENT_TITLE } from "./mockData.ts";
import { PanelRail } from "./Panel.tsx";
import { BottomHud, type BottomHudSlots } from "./panels/BottomHud.tsx";
import { CanvasPanel } from "./panels/CanvasPanel.tsx";
import { InspectorPanel } from "./panels/InspectorPanel.tsx";
import { LayersPanel } from "./panels/LayersPanel.tsx";
import { PatchEditorPanel } from "./panels/PatchEditorPanel.tsx";
import { ViewerPanel } from "./panels/ViewerPanel.tsx";
import { PatchPicker } from "./PatchPicker.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { useShellCommands } from "./useShellCommands.tsx";
import "./AppShell.css";
import "./panels/panels.css";

export interface AppShellSlots extends BottomHudSlots {
  devicePicker?: ReactNode;
  share?: ReactNode;
  layers?: ReactNode;
  viewer?: ReactNode;
  canvas?: ReactNode;
  patchEditor?: ReactNode;
  inspector?: ReactNode;
  learn?: ReactNode;
  assistant?: ReactNode;
}

export interface AppShellProps {
  documentTitle?: string;
  /** Replace placeholder panels with real ones as they land. */
  slots?: AppShellSlots;
  /** Left inset for native window controls (e.g. macOS traffic lights in Electron). */
  titlebarInset?: number;
}

/**
 * The editor frame: toolbar; Layers | Viewer | Canvas / Patch Editor | Inspector; bottom HUD; and
 * right-side drawers. Panels resize (sizes are written to CSS variables while dragging and
 * committed on release), collapse to rails, and persist their layout.
 */
export function AppShell({ documentTitle = MOCK_DOCUMENT_TITLE, slots = {}, titlebarInset = 0 }: AppShellProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sizes = useLayout((s) => s.sizes);
  const split = useLayout((s) => s.split);
  const collapsed = useLayout((s) => s.collapsed);
  const viewMode = useLayout((s) => s.viewMode);
  const splitDirection = useLayout((s) => s.splitDirection);
  const { setSize, setSplit, toggleCollapsed } = layoutStore.getState();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [restartKey, setRestartKey] = useState(0);
  const [deviceId, setDeviceId] = useState(DEFAULT_DEVICE);
  const device = getDevicePreset(deviceId);
  const [centerRef, center] = useElementSize<HTMLDivElement>();

  const restart = () => {
    setRestartKey((k) => k + 1);
    setPlaying(true);
  };

  useShellCommands({
    openPalette: () => setPaletteOpen(true),
    openPatchPicker: () => setPickerOpen(true),
    togglePlay: () => setPlaying((p) => !p),
    restart,
  });

  const live = (name: string, value: string) => rootRef.current?.style.setProperty(name, value);

  const style = {
    "--sb-layers-w": `${sizes.layers}px`,
    "--sb-viewer-w": `${sizes.viewer}px`,
    "--sb-inspector-w": `${sizes.inspector}px`,
    "--sb-hud-h": `${sizes.hud}px`,
    "--sb-drawer-w": `${sizes.drawer}px`,
    "--sb-split": String(split),
    "--sb-titlebar-inset": `${titlebarInset}px`,
  } as CSSProperties;

  const sideSplitter = (panel: SizedPanel, label: string, controls: string, invert = false) => (
    <Splitter
      orientation="vertical"
      size={sizes[panel]}
      min={SIZE_LIMITS[panel][0]}
      max={SIZE_LIMITS[panel][1]}
      invert={invert}
      label={label}
      controls={controls}
      onResize={(size) => live(`--sb-${panel}-w`, `${size}px`)}
      onResizeEnd={(size) => setSize(panel, size)}
      onToggleCollapse={panel === "drawer" || panel === "hud" ? undefined : () => toggleCollapsed(panel)}
    />
  );

  const splitDimension = splitDirection === "rows" ? center.height : center.width;

  return (
    <div ref={rootRef} className="sb-app sb-shell" style={style}>
      <Toolbar
        documentTitle={documentTitle}
        deviceId={deviceId}
        onDeviceChange={setDeviceId}
        playing={playing}
        onTogglePlay={() => setPlaying((p) => !p)}
        onRestart={restart}
        onOpenPalette={() => setPaletteOpen(true)}
        devicePicker={slots.devicePicker}
        share={slots.share}
      />
      <div className="sb-shell__main">
        <div className="sb-shell__row">
          {collapsed.layers ? (
            <PanelRail title="Layers" side="left" icon={<Layers size={13} />} shortcut="Mod+1" onExpand={() => toggleCollapsed("layers", false)} />
          ) : (
            <>
              <div id="sb-layers" className="sb-shell__slot sb-shell__layers">
                {slots.layers ?? <LayersPanel onCollapse={() => toggleCollapsed("layers", true)} />}
              </div>
              {sideSplitter("layers", "Resize layers", "sb-layers")}
            </>
          )}

          {collapsed.viewer ? (
            <PanelRail title="Viewer" side="left" icon={<Smartphone size={13} />} shortcut="Mod+2" onExpand={() => toggleCollapsed("viewer", false)} />
          ) : (
            <>
              <div id="sb-viewer" className="sb-shell__slot sb-shell__viewer">
                {slots.viewer ?? <ViewerPanel device={device} playing={playing} restartKey={restartKey} onCollapse={() => toggleCollapsed("viewer", true)} />}
              </div>
              {sideSplitter("viewer", "Resize viewer", "sb-viewer")}
            </>
          )}

          <div ref={centerRef} className="sb-shell__center" data-direction={splitDirection} data-mode={viewMode}>
            {viewMode !== "patches" && <div className="sb-shell__canvas">{slots.canvas ?? <CanvasPanel device={device} />}</div>}
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
            {viewMode !== "canvas" && <div className="sb-shell__patches">{slots.patchEditor ?? <PatchEditorPanel onOpenPicker={() => setPickerOpen(true)} />}</div>}
          </div>

          {collapsed.inspector ? (
            <PanelRail title="Inspector" side="right" icon={<SlidersHorizontal size={13} />} shortcut="Mod+7" onExpand={() => toggleCollapsed("inspector", false)} />
          ) : (
            <>
              {sideSplitter("inspector", "Resize inspector", "sb-inspector", true)}
              <div id="sb-inspector" className="sb-shell__slot sb-shell__inspector">
                {slots.inspector ?? <InspectorPanel onCollapse={() => toggleCollapsed("inspector", true)} />}
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
            defaultSize={176}
            label="Resize console"
            controls="sb-hud"
            onResize={(size) => live("--sb-hud-h", `${size}px`)}
            onResizeEnd={(size) => setSize("hud", size)}
            onToggleCollapse={() => toggleCollapsed("hud", true)}
          />
        )}
        <div id="sb-hud" className="sb-shell__hud" data-collapsed={collapsed.hud || undefined}>
          <BottomHud slots={slots} collapsed={collapsed.hud} onToggleCollapse={() => toggleCollapsed("hud")} />
        </div>

        <DrawerHost learn={slots.learn} assistant={slots.assistant} />
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <PatchPicker open={pickerOpen} onOpenChange={setPickerOpen} />
    </div>
  );
}
