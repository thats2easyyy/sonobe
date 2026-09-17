/**
 * The Viewer panel: the live prototype in a device frame. Device picker (project.device), rotate,
 * frame toggle (⌥D), fit or 1:1, hit targets, play/pause, restart (⌘R), fps, a detachable floating
 * window, and "On phone" when the host serves the web player on the local network.
 */

import { DEVICE_PRESETS, getDevicePreset, type DevicePreset } from "@sonobe/core";
import { Frame, Maximize, Minimize2, Monitor, MousePointerClick, PanelLeftClose, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, Smartphone, Tablet, TriangleAlert, Watch } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { Panel } from "../../shell/Panel.tsx";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import type { EditorSession } from "../../state/session.ts";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Select, type SelectOption } from "../../ui/Select.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { useOptionalCommands } from "../../ui/commands/CommandProvider.tsx";
import type { Command } from "../../ui/commands/commandRegistry.ts";
import { cx } from "../../ui/lib/cx.ts";
import { useLatest } from "../../ui/lib/hooks.ts";
import { readString, writeString } from "../../ui/lib/storage.ts";
import { FloatingWindow } from "./FloatingWindow.tsx";
import { PhonePreviewButton } from "./PhonePreview.tsx";
import { ViewerStage } from "./ViewerStage.tsx";
import { devicePresetOps, formatFps, rotateDeviceOps, type ViewerZoom } from "./viewerModel.ts";
import "./viewer.css";

export interface ViewerPanelProps {
  /** Default: the session from the nearest EditorProvider. */
  session?: EditorSession;
  /** The host's LAN web player URL. "On phone" (QR code + link) only shows when set. */
  lanPreviewUrl?: string | null;
  /** Open the viewer in its own host window. Without it, the viewer detaches into a floating in-app window. */
  onPopOut?: () => void;
  /** Shows a "Hide viewer" button. */
  onCollapse?: () => void;
  /** Register viewer.* commands and shortcuts (⌥D...). Default true. */
  commands?: boolean;
  className?: string;
}

const KIND_ICONS: Record<DevicePreset["kind"], typeof Smartphone> = { phone: Smartphone, tablet: Tablet, computer: Monitor, watch: Watch, custom: Frame };
const KIND_LABELS: Record<DevicePreset["kind"], string> = { phone: "Phones", tablet: "Tablets", computer: "Desktop", watch: "Watch", custom: "Custom" };

const DEVICE_OPTIONS: SelectOption[] = DEVICE_PRESETS.map((device) => {
  const Icon = KIND_ICONS[device.kind];
  return {
    value: device.id,
    label: device.name,
    group: KIND_LABELS[device.kind],
    icon: <Icon size={14} strokeWidth={1.75} />,
    trailing: `${device.size[0]}×${device.size[1]}`,
    keywords: [device.platform, device.kind],
  };
});

const FRAME_KEY = "sonobe.viewer.frame";
const ZOOM_KEY = "sonobe.viewer.zoom";

function ViewerTransport({ session, lanPreviewUrl, phoneOpen, onPhoneOpenChange }: { session: EditorSession; lanPreviewUrl: string | null; phoneOpen: boolean; onPhoneOpenChange: (open: boolean) => void }) {
  const playing = useStore(session.runtime.state, (s) => s.playing);
  const fps = useStore(session.runtime.state, (s) => s.fps);
  const frame = useStore(session.runtime.state, (s) => s.frame);
  const diagnostics = useStore(session.runtime.state, (s) => s.diagnostics);
  const warnings = useMemo(() => diagnostics.filter((d) => d.severity === "warning"), [diagnostics]);

  return (
    <div className="sb-vw__footer">
      <div className="sb-vw__transport" role="group" aria-label="Prototype playback">
        <IconButton size="sm" icon={playing ? <Pause size={14} /> : <Play size={14} />} label={playing ? "Pause prototype" : "Play prototype"} shortcut="Mod+Alt+P" tooltipPlacement="top" onClick={() => session.runtime.togglePlay()} />
        <IconButton size="sm" icon={<RotateCcw size={14} />} label="Restart prototype" shortcut="Mod+R" tooltipPlacement="top" onClick={() => session.runtime.restart()} />
      </div>
      <span className="sb-vw__pill" data-playing={playing || undefined}>
        <span className="sb-vw__dot" aria-hidden />
        {playing ? "Live" : "Paused"}
        <span className="sb-vw__pill-meta sb-tabular">{playing ? formatFps(Math.round(fps)) : `frame ${Math.max(0, frame).toLocaleString("en-US")}`}</span>
      </span>
      {warnings.length > 0 && (
        <Tooltip placement="top" content={warnings.slice(0, 3).map((w) => w.message).join(" · ") + (warnings.length > 3 ? ` · +${warnings.length - 3} more` : "")}>
          <span className="sb-vw__pill" data-tone="warn" tabIndex={0} aria-label={`${warnings.length} runtime ${warnings.length === 1 ? "warning" : "warnings"}`}>
            <TriangleAlert size={12} aria-hidden />
            <span className="sb-tabular">{warnings.length}</span>
          </span>
        </Tooltip>
      )}
      {lanPreviewUrl && <PhonePreviewButton url={lanPreviewUrl} open={phoneOpen} onOpenChange={onPhoneOpenChange} />}
    </div>
  );
}

export function ViewerPanel({ session: sessionProp, lanPreviewUrl = null, onPopOut, onCollapse, commands = true, className }: ViewerPanelProps) {
  const contextSession = useEditorSession();
  const session = sessionProp ?? contextSession;
  const device = useStore(session.document, (s) => s.doc.project.device);
  const [showFrame, setShowFrame] = useState(() => readString(FRAME_KEY) !== "off");
  const [zoom, setZoom] = useState<ViewerZoom>(() => (readString(ZOOM_KEY) === "actual" ? "actual" : "fit"));
  const [showHitTargets, setShowHitTargets] = useState(false);
  const [floating, setFloating] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const rootRef = useRef<HTMLDivElement>(null);
  const landscape = device.orientation === "landscape";

  const toggleFrame = useCallback(() => {
    setShowFrame((on) => {
      writeString(FRAME_KEY, on ? "off" : "on");
      return !on;
    });
  }, []);

  const toggleZoom = useCallback(() => {
    setZoom((z) => {
      const next = z === "fit" ? "actual" : "fit";
      writeString(ZOOM_KEY, next);
      return next;
    });
  }, []);

  const setDevice = useCallback(
    (id: string) => {
      const current = session.document.getState().doc.project.device;
      if (current.preset === id) return;
      session.document.getState().apply(devicePresetOps(current, id), { label: `Change device to ${getDevicePreset(id).name}` });
    },
    [session],
  );

  const rotate = useCallback(() => {
    const current = session.document.getState().doc.project.device;
    session.document.getState().apply(rotateDeviceOps(current), { label: current.orientation === "landscape" ? "Rotate device to portrait" : "Rotate device to landscape" });
  }, [session]);

  const popOut = useCallback(() => {
    if (onPopOut) onPopOut();
    else setFloating((f) => !f);
  }, [onPopOut]);

  const actions = useLatest({ toggleFrame, toggleZoom, rotate, popOut, lanPreviewUrl, toggleHitTargets: () => setShowHitTargets((v) => !v), openPhone: () => setPhoneOpen(true) });
  const cmds = useOptionalCommands();
  useEffect(() => {
    if (!commands || !cmds) return;
    const list: Command[] = [
      { id: "viewer.toggleDeviceFrame", title: "Show Device Frame", category: "Viewer", shortcut: "Alt+D", icon: Smartphone, keywords: ["bezel", "chrome"], run: () => actions.current.toggleFrame() },
      { id: "viewer.toggleHitTargets", title: "Show Hit Targets", category: "Viewer", icon: MousePointerClick, keywords: ["touch", "tap", "debug"], run: () => actions.current.toggleHitTargets() },
      { id: "viewer.actualSize", title: "Viewer: Actual Size or Fit", category: "Viewer", icon: Maximize, keywords: ["zoom", "1:1", "100%", "fit"], run: () => actions.current.toggleZoom() },
      { id: "viewer.rotateDevice", title: "Rotate Device", category: "Viewer", icon: RotateCw, keywords: ["landscape", "portrait", "orientation"], run: () => actions.current.rotate() },
      { id: "viewer.popOut", title: "Pop Out Viewer", category: "Viewer", icon: PictureInPicture2, keywords: ["window", "float", "detach", "dock"], run: () => actions.current.popOut() },
      { id: "viewer.previewOnDevice", title: "Preview on Phone", category: "Viewer", keywords: ["qr", "device", "mobile"], when: () => !!actions.current.lanPreviewUrl, run: () => actions.current.openPhone() },
    ];
    return cmds.registry.register(list.filter((c) => !cmds.registry.get(c.id)));
  }, [cmds, commands, actions]);

  const stage = <ViewerStage session={session} showFrame={showFrame} zoom={zoom} showHitTargets={showHitTargets} onScaleChange={setScale} />;
  const transport = <ViewerTransport session={session} lanPreviewUrl={lanPreviewUrl} phoneOpen={phoneOpen} onPhoneOpenChange={setPhoneOpen} />;

  return (
    <Panel
      title="Viewer"
      scope="viewer"
      surface="sunken"
      className={className}
      headerContent={
        <div className="sb-vw__header">
          <Select size="sm" variant="ghost" aria-label="Device" options={DEVICE_OPTIONS} value={device.preset} onChange={setDevice} searchable searchPlaceholder="Search devices…" menuWidth={272} className="sb-vw__device-select" />
          <span className="sb-vw__meta sb-tabular" aria-label="Viewer zoom">
            {zoom === "actual" ? "1:1" : `${Math.round(scale * 100)}%`}
          </span>
        </div>
      }
      actions={
        <>
          <IconButton size="sm" icon={<RotateCw size={14} />} label={landscape ? "Rotate to portrait" : "Rotate to landscape"} onClick={rotate} />
          <IconButton size="sm" icon={<Smartphone size={14} />} label="Device frame" shortcut="Alt+D" active={showFrame} onClick={toggleFrame} />
          <IconButton size="sm" icon={<MousePointerClick size={14} />} label="Show hit targets" active={showHitTargets} onClick={() => setShowHitTargets((v) => !v)} />
          <IconButton size="sm" icon={<Maximize size={14} />} label={zoom === "actual" ? "Fit to panel" : "Actual size (1:1)"} active={zoom === "actual"} onClick={toggleZoom} />
          <IconButton size="sm" icon={<PictureInPicture2 size={14} />} label={floating ? "Dock viewer" : "Pop out viewer"} active={floating} onClick={popOut} />
          {onCollapse && <IconButton size="sm" icon={<PanelLeftClose size={14} />} label="Hide viewer" shortcut="Mod+2" onClick={onCollapse} />}
        </>
      }
    >
      <div ref={rootRef} className={cx("sb-vw")} data-floating={floating || undefined}>
        {floating ? (
          <EmptyState
            className="sb-vw__floating-note"
            size="sm"
            icon={<PictureInPicture2 size={18} />}
            title="The viewer is floating"
            description="Drag it anywhere by its title bar. Dock it to bring it back here."
            actions={
              <Button size="sm" onClick={() => setFloating(false)}>
                Dock viewer
              </Button>
            }
          />
        ) : (
          <>
            {stage}
            {transport}
          </>
        )}
      </div>
      {floating && (
        <FloatingWindow
          title={`Viewer · ${getDevicePreset(device.preset).name}`}
          aria-label="Viewer"
          storageKey="sonobe.viewer.floating"
          themeFrom={rootRef.current}
          actions={<IconButton size="xs" icon={<Minimize2 size={13} />} label="Dock viewer" tooltipPlacement="bottom" onClick={() => setFloating(false)} />}
        >
          <div className="sb-vw">
            {stage}
            {transport}
          </div>
        </FloatingWindow>
      )}
    </Panel>
  );
}
