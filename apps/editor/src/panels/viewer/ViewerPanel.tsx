/**
 * The Viewer panel: the live prototype in a device frame. The header keeps zoom (fit or 1:1), restart
 * (⌘R), the device frame (⌥D), and hit targets within reach and tucks rotate, device, pop-out, and
 * phone preview into a menu, so nothing truncates at narrow widths. Play/pause and fps sit under the
 * prototype, next to "On phone" (a QR code for the LAN web player). While the running prototype has
 * an empty_loop warning, a notice above the stage says what draws no copies, with Why? to reveal it,
 * or, when a fresh start would draw it (an edit left old state), offers Restart instead. Switching the
 * knob preset shows its name over the stage for a moment.
 */

import { DEVICE_PRESETS, getDevicePreset, type DevicePreset } from "@sonobe/core";
import { ChevronDown, Frame, Maximize, Minimize2, Monitor, MoreHorizontal, MousePointerClick, PanelLeftClose, Pause, PictureInPicture2, Play, QrCode, RotateCcw, RotateCw, Smartphone, Tablet, TriangleAlert, Watch } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { staleLayerName } from "../../runtime/staleState.ts";
import { Panel } from "../../shell/Panel.tsx";
import { useEditorSession } from "../../state/EditorProvider.tsx";
import type { EditorSession } from "../../state/session.ts";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Menu, type MenuEntry } from "../../ui/Menu.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { useOptionalCommands } from "../../ui/commands/CommandProvider.tsx";
import type { Command } from "../../ui/commands/commandRegistry.ts";
import { cx } from "../../ui/lib/cx.ts";
import { useLatest } from "../../ui/lib/hooks.ts";
import { readString, writeString } from "../../ui/lib/storage.ts";
import { toast } from "../../ui/Toast.tsx";
import { revealItems } from "../hud/reveal.ts";
import { FloatingWindow } from "./FloatingWindow.tsx";
import { getViewerWindowApi, toPreviewStatus, type ViewerWindowStatus } from "./hostBridge.ts";
import { PhonePreviewButton, usePhonePreview, type PhonePreviewController } from "./PhonePreview.tsx";
import { PresetCaption } from "./PresetCaption.tsx";
import { ViewerStage } from "./ViewerStage.tsx";
import { devicePresetOps, emptyLoopNotice, formatFps, presetForDevice, rotateDeviceOps, type ViewerZoom } from "./viewerModel.ts";
import "./viewer.css";

export interface ViewerPanelProps {
  /** Default: the session from the nearest EditorProvider. */
  session?: EditorSession;
  /**
   * A fixed LAN web player URL for "On phone" (null hides it). Leave it out to use the desktop host's
   * phone preview server (start, stop, QR code) when the host has one.
   */
  lanPreviewUrl?: string | null;
  /** Open the viewer in its own window. Default: `sonobeHost.popOutViewer` when available, else a floating in-app window. */
  onPopOut?: () => void;
  /** Shows a "Hide viewer" button. */
  onCollapse?: () => void;
  /** Register viewer.* commands and shortcuts (⌥D...) and the viewer.showPhonePreview RPC. Default true. */
  commands?: boolean;
  className?: string;
}

const KIND_ICONS: Record<DevicePreset["kind"], typeof Smartphone> = { phone: Smartphone, tablet: Tablet, computer: Monitor, watch: Watch, custom: Frame };
const KIND_LABELS: Record<DevicePreset["kind"], string> = { phone: "Phones", tablet: "Tablets", computer: "Desktop", watch: "Watch", custom: "Custom" };

const DEVICE_GROUPS: { kind: DevicePreset["kind"]; devices: DevicePreset[] }[] = (() => {
  const kinds: DevicePreset["kind"][] = [];
  for (const device of DEVICE_PRESETS) if (!kinds.includes(device.kind)) kinds.push(device.kind);
  return kinds.map((kind) => ({ kind, devices: DEVICE_PRESETS.filter((d) => d.kind === kind) }));
})();

/** Device presets grouped by kind, with the current one checked. */
function deviceMenuEntries(current: string, onSelect: (id: string) => void): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const group of DEVICE_GROUPS) {
    out.push({ type: "label", id: `kind-${group.kind}`, label: KIND_LABELS[group.kind] });
    for (const device of group.devices) {
      out.push({ id: `device-${device.id}`, label: device.name, description: `${device.size[0]} × ${device.size[1]}`, checked: device.id === current, onSelect: () => onSelect(device.id) });
    }
  }
  return out;
}

const FRAME_KEY = "sonobe.viewer.frame";
const ZOOM_KEY = "sonobe.viewer.zoom";

/**
 * While the running prototype has an empty_loop warning: "Card has no copies · Why?". Why? opens the
 * Diagnostics tab and selects the layer or component. Restart usually doesn't help (the wiring empties
 * the loop again), so the notice offers it only when an edit left state from before it: a fresh start
 * of the same document draws the layer (runtime/staleState.ts).
 */
function EmptyLoopNote({ session }: { session: EditorSession }) {
  const diagnostics = useStore(session.runtime.state, (s) => s.diagnostics);
  const stale = useStore(session.runtime.state, (s) => s.staleState);
  const doc = useStore(session.document, (s) => s.doc);
  const notice = useMemo(() => emptyLoopNotice(diagnostics, doc), [diagnostics, doc]);
  const cmds = useOptionalCommands();
  if (stale) {
    const name = staleLayerName(stale, doc);
    return (
      <div className="sb-vw__window-note" data-tone="warn" data-wrap="" role="status" title={`Started fresh, ${name} draws ${stale.copies} ${stale.copies === 1 ? "copy" : "copies"}. Restart to see your edit from the start.`}>
        <RotateCcw size={13} aria-hidden />
        <span className="sb-vw__window-note-text">The prototype kept state from before your edit</span>
        <Button size="sm" variant="ghost" onClick={() => session.runtime.restart()}>
          Restart
        </Button>
      </div>
    );
  }
  if (!notice) return null;
  const why = () => {
    cmds?.registry.run("view.showDiagnostics");
    revealItems(session, notice.diagnostic.component, notice.diagnostic.itemIds);
  };
  return (
    <div className="sb-vw__window-note" data-tone="warn" role="status" title={`${notice.diagnostic.message}\n\nRestarting won't bring the copies back while the wiring stays the same.`}>
      <TriangleAlert size={13} aria-hidden />
      <span className="sb-vw__window-note-text">
        {notice.label}
        {notice.count > 1 ? ` (+${notice.count - 1} more)` : ""}
      </span>
      <Button size="sm" variant="ghost" onClick={why}>
        Why?
      </Button>
    </div>
  );
}

function ViewerTransport({ session, phone, phoneOpen, onPhoneOpenChange }: { session: EditorSession; phone: PhonePreviewController; phoneOpen: boolean; onPhoneOpenChange: (open: boolean) => void }) {
  const playing = useStore(session.runtime.state, (s) => s.playing);
  const fps = useStore(session.runtime.state, (s) => s.fps);
  const frame = useStore(session.runtime.state, (s) => s.frame);
  const diagnostics = useStore(session.runtime.state, (s) => s.diagnostics);
  const warnings = useMemo(() => diagnostics.filter((d) => d.severity === "warning"), [diagnostics]);

  return (
    <div className="sb-vw__footer">
      <div className="sb-vw__transport" role="group" aria-label="Prototype playback">
        <IconButton size="sm" icon={playing ? <Pause size={14} /> : <Play size={14} />} label={playing ? "Pause prototype" : "Play prototype"} shortcut="Mod+Alt+P" tooltipPlacement="top" onClick={() => session.runtime.togglePlay()} />
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
      {phone.available && <PhonePreviewButton preview={phone} open={phoneOpen} onOpenChange={onPhoneOpenChange} />}
    </div>
  );
}

export function ViewerPanel({ session: sessionProp, lanPreviewUrl, onPopOut, onCollapse, commands = true, className }: ViewerPanelProps) {
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
  const preset = useMemo(() => presetForDevice(device), [device]);
  const phone = usePhonePreview(lanPreviewUrl);
  const viewerWindow = useMemo(() => (onPopOut ? null : getViewerWindowApi()), [onPopOut]);
  const [windowStatus, setWindowStatus] = useState<ViewerWindowStatus | null>(null);

  // The desktop's pop-out viewer window: follow it opening, closing, and staying on top.
  useEffect(() => {
    setWindowStatus(null);
    if (!viewerWindow) return;
    let cancelled = false;
    viewerWindow.getStatus?.().then(
      (status) => {
        if (!cancelled) setWindowStatus(status);
      },
      () => undefined,
    );
    const off = viewerWindow.onStatus?.((status) => {
      if (!cancelled) setWindowStatus(status);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [viewerWindow]);

  const toggleFrame = useCallback(() => {
    setShowFrame((on) => {
      writeString(FRAME_KEY, on ? "off" : "on");
      return !on;
    });
  }, []);

  const setZoomMode = useCallback((next: ViewerZoom) => {
    writeString(ZOOM_KEY, next);
    setZoom(next);
  }, []);

  const toggleZoom = useCallback(() => {
    setZoom((z) => {
      const next = z === "fit" ? "actual" : "fit";
      writeString(ZOOM_KEY, next);
      return next;
    });
  }, []);

  const toggleHitTargets = useCallback(() => setShowHitTargets((v) => !v), []);

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

  const restart = useCallback(() => session.runtime.restart(), [session]);

  const popOut = useCallback(() => {
    if (onPopOut) {
      onPopOut();
      return;
    }
    if (floating) {
      setFloating(false);
      return;
    }
    if (viewerWindow) {
      const declined = (reason: string | null) => {
        toast({ title: "Couldn't open the viewer window", description: reason ? `${reason} The viewer is floating here instead.` : "The viewer is floating here instead.", tone: "warn" });
        setFloating(true);
      };
      viewerWindow.popOut().then(
        (status) => {
          setWindowStatus(status);
          if (!status.open) declined(status.error);
        },
        (err: unknown) => declined(err instanceof Error ? err.message : null),
      );
      return;
    }
    setFloating(true);
  }, [onPopOut, floating, viewerWindow]);

  const setWindowOnTop = useCallback(
    (alwaysOnTop: boolean) => {
      viewerWindow?.popOut({ alwaysOnTop }).then(setWindowStatus, () => undefined);
    },
    [viewerWindow],
  );

  const closeViewerWindow = useCallback(() => {
    viewerWindow?.close?.().then(setWindowStatus, () => undefined);
  }, [viewerWindow]);

  const openPhone = useCallback(() => setPhoneOpen(true), []);

  const actions = useLatest({ toggleFrame, toggleZoom, rotate, popOut, toggleHitTargets, openPhone, phoneAvailable: phone.available });
  const cmds = useOptionalCommands();
  useEffect(() => {
    if (!commands || !cmds) return;
    const list: Command[] = [
      { id: "viewer.toggleDeviceFrame", title: "Show Device Frame", category: "Viewer", shortcut: "Alt+D", icon: Smartphone, keywords: ["bezel", "chrome"], run: () => actions.current.toggleFrame() },
      { id: "viewer.toggleHitTargets", title: "Show Hit Targets", category: "Viewer", icon: MousePointerClick, keywords: ["touch", "tap", "debug"], run: () => actions.current.toggleHitTargets() },
      { id: "viewer.actualSize", title: "Viewer: Actual Size or Fit", category: "Viewer", icon: Maximize, keywords: ["zoom", "1:1", "100%", "fit"], run: () => actions.current.toggleZoom() },
      { id: "viewer.rotateDevice", title: "Rotate Device", category: "Viewer", icon: RotateCw, keywords: ["landscape", "portrait", "orientation"], run: () => actions.current.rotate() },
      { id: "viewer.popOut", title: "Pop Out Viewer", category: "Viewer", icon: PictureInPicture2, keywords: ["window", "float", "detach", "dock"], run: () => actions.current.popOut() },
      { id: "viewer.previewOnDevice", title: "Preview on Phone", category: "Viewer", icon: QrCode, keywords: ["qr", "device", "mobile", "lan", "wifi"], when: () => actions.current.phoneAvailable, run: () => actions.current.openPhone() },
    ];
    return cmds.registry.register(list.filter((c) => !cmds.registry.get(c.id)));
  }, [cmds, commands, actions]);

  // Viewer → Preview on Phone in the desktop menu starts the server, then asks the editor to show the QR panel.
  const phoneRef = useLatest(phone);
  useEffect(() => {
    const rpc = session.host?.rpc;
    if (!commands || !rpc) return;
    return rpc.handle("viewer.showPhonePreview", (params) => {
      const status = toPreviewStatus(params);
      if (status) phoneRef.current.adopt(status);
      setPhoneOpen(true);
      return { shown: true };
    });
  }, [session, commands, phoneRef]);

  const zoomLabel = zoom === "actual" ? "1:1" : `${Math.round(scale * 100)}%`;
  const zoomEntries: MenuEntry[] = [
    { id: "fit", label: "Fit to Panel", checked: zoom === "fit", onSelect: () => setZoomMode("fit") },
    { id: "actual", label: "Actual Size (1:1)", checked: zoom === "actual", onSelect: () => setZoomMode("actual") },
  ];
  const DeviceIcon = KIND_ICONS[preset.kind];
  const moreEntries: MenuEntry[] = [
    { id: "rotate", label: landscape ? "Rotate to Portrait" : "Rotate to Landscape", icon: <RotateCw size={14} />, onSelect: rotate },
    { id: "device", label: "Device", description: preset.name, icon: <DeviceIcon size={14} />, submenu: deviceMenuEntries(device.preset, setDevice) },
    { type: "separator" },
    { id: "frame", label: "Show Device Frame", shortcut: "Alt+D", checked: showFrame, onSelect: toggleFrame },
    { id: "hitTargets", label: "Show Hit Targets", checked: showHitTargets, onSelect: toggleHitTargets },
    { type: "separator" },
    ...(viewerWindow && windowStatus?.open
      ? ([
          { id: "showWindow", label: "Show Viewer Window", icon: <PictureInPicture2 size={14} />, onSelect: popOut },
          { id: "windowOnTop", label: "Keep Viewer Window on Top", checked: windowStatus.alwaysOnTop, onSelect: () => setWindowOnTop(!windowStatus.alwaysOnTop) },
          ...(viewerWindow.close ? [{ id: "closeWindow", label: "Close Viewer Window", icon: <Minimize2 size={14} />, onSelect: closeViewerWindow } satisfies MenuEntry] : []),
        ] satisfies MenuEntry[])
      : [{ id: "popOut", label: floating ? "Dock Viewer" : viewerWindow || onPopOut ? "Open in New Window" : "Pop Out Viewer", icon: floating ? <Minimize2 size={14} /> : <PictureInPicture2 size={14} />, onSelect: popOut } satisfies MenuEntry]),
    ...(phone.available ? [{ id: "phone", label: "Preview on Phone…", icon: <QrCode size={14} />, onSelect: openPhone } satisfies MenuEntry] : []),
  ];

  const loopNote = <EmptyLoopNote session={session} />;
  const caption = <PresetCaption session={session} />;
  const stage = <ViewerStage session={session} showFrame={showFrame} zoom={zoom} showHitTargets={showHitTargets} onScaleChange={setScale} />;
  const transport = <ViewerTransport session={session} phone={phone} phoneOpen={phoneOpen} onPhoneOpenChange={setPhoneOpen} />;

  return (
    <Panel
      title="Viewer"
      scope="viewer"
      surface="sunken"
      className={cx("sb-vw-panel", className)}
      headerContent={
        <span className="sb-vw__device-name" title={`${preset.name} · ${landscape ? `${preset.size[1]} × ${preset.size[0]}` : `${preset.size[0]} × ${preset.size[1]}`}`}>
          {preset.name}
        </span>
      }
      actions={
        <>
          <Menu aria-label="Viewer zoom" placement="bottom-end" entries={zoomEntries}>
            <button type="button" className="sb-vw__zoom" aria-label={`Viewer zoom: ${zoomLabel}`}>
              <span className="sb-tabular">{zoomLabel}</span>
              <ChevronDown size={12} strokeWidth={2} aria-hidden />
            </button>
          </Menu>
          <IconButton size="sm" icon={<RotateCcw size={14} />} label="Restart prototype" shortcut="Mod+R" onClick={restart} />
          <IconButton size="sm" className="sb-vw__hdr-frame" icon={<Smartphone size={14} />} label="Device frame" shortcut="Alt+D" active={showFrame} onClick={toggleFrame} />
          <IconButton size="sm" className="sb-vw__hdr-hit" icon={<MousePointerClick size={14} />} label="Show hit targets" active={showHitTargets} onClick={toggleHitTargets} />
          <Menu aria-label="Viewer options" placement="bottom-end" entries={moreEntries}>
            <button type="button" className="sb-iconbtn sb-vw__more" data-variant="ghost" data-size="sm" aria-label="More viewer options">
              <MoreHorizontal size={14} />
            </button>
          </Menu>
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
            {viewerWindow && windowStatus?.open && (
              <div className="sb-vw__window-note" role="status" title="The viewer window plays the prototype's sound and speech, so this viewer stays quiet while it's open.">
                <PictureInPicture2 size={13} aria-hidden />
                <span className="sb-vw__window-note-text">Also showing in its own window, which plays the sound</span>
                <Button size="sm" variant="ghost" onClick={popOut}>
                  Show
                </Button>
                {viewerWindow.close && (
                  <Button size="sm" variant="ghost" onClick={closeViewerWindow}>
                    Close
                  </Button>
                )}
              </div>
            )}
            {loopNote}
            {caption}
            {stage}
            {transport}
          </>
        )}
      </div>
      {floating && (
        <FloatingWindow
          title={`Viewer · ${preset.name}`}
          aria-label="Viewer"
          storageKey="sonobe.viewer.floating"
          themeFrom={rootRef.current}
          actions={
            <>
              <IconButton size="xs" icon={<RotateCcw size={13} />} label="Restart prototype" shortcut="Mod+R" tooltipPlacement="bottom" onClick={restart} />
              <IconButton size="xs" icon={<Minimize2 size={13} />} label="Dock viewer" tooltipPlacement="bottom" onClick={() => setFloating(false)} />
            </>
          }
        >
          <div className="sb-vw">
            {loopNote}
            {caption}
            {stage}
            {transport}
          </div>
        </FloatingWindow>
      )}
    </Panel>
  );
}
