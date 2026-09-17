import type { DevicePreset } from "@sonobe/core";
import { ExternalLink, PanelLeftClose, QrCode, Scan, Smartphone } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { IconButton } from "../../ui/IconButton.tsx";
import { toast } from "../../ui/Toast.tsx";
import { useElementSize } from "../../ui/lib/useElementSize.ts";
import { MockScreen } from "../mock/MockScreen.tsx";
import { Panel } from "../Panel.tsx";

const BEZEL = 12;

export interface ViewerPanelProps {
  device: DevicePreset;
  playing: boolean;
  /** Changes on restart to replay the prototype from its first frame. */
  restartKey: number;
  onCollapse?: () => void;
}

/** The live prototype in a CSS device frame, scaled to fit. */
export function ViewerPanel({ device, playing, restartKey, onCollapse }: ViewerPanelProps) {
  const [bodyRef, box] = useElementSize<HTMLDivElement>();
  const [frame, setFrame] = useState(true);
  const [hitTargets, setHitTargets] = useState(false);
  const bezel = frame ? BEZEL : 0;
  const [w, h] = device.size;
  const outerW = w + bezel * 2;
  const outerH = h + bezel * 2;
  const scale = box.width > 0 ? Math.max(0.1, Math.min(1, (box.width - 36) / outerW, (box.height - 72) / outerH)) : 0.3;
  const deviceStyle = { width: outerW, height: outerH, transform: `scale(${scale})`, "--sb-device-radius": `${device.cornerRadius}px` } as CSSProperties;

  return (
    <Panel
      title="Viewer"
      scope="viewer"
      surface="sunken"
      headerContent={
        <span className="sb-viewer__meta sb-tabular">
          {device.name} · {Math.round(scale * 100)}%
        </span>
      }
      actions={
        <>
          <IconButton size="sm" icon={<Scan size={14} />} label="Show hit targets" active={hitTargets} onClick={() => setHitTargets((v) => !v)} />
          <IconButton size="sm" icon={<Smartphone size={14} />} label="Device frame" shortcut="Alt+D" active={frame} onClick={() => setFrame((v) => !v)} />
          <IconButton size="sm" icon={<ExternalLink size={14} />} label="Open in its own window" />
          {onCollapse && <IconButton size="sm" icon={<PanelLeftClose size={14} />} label="Hide viewer" shortcut="Mod+2" onClick={onCollapse} />}
        </>
      }
    >
      <div ref={bodyRef} className="sb-viewer" data-hit-targets={hitTargets || undefined}>
        <div className="sb-viewer__stage">
          <div className="sb-device-fit" style={{ width: outerW * scale, height: outerH * scale }}>
            <div className="sb-device" data-frame={frame ? "on" : "off"} style={deviceStyle}>
              <div className="sb-device__screen">
                <MockScreen key={restartKey} device={device} animate={restartKey > 0} />
                {frame && device.cutout === "island" && <span className="sb-device__island" aria-hidden />}
                {frame && device.cutout === "punchHole" && <span className="sb-device__punch" aria-hidden />}
              </div>
            </div>
          </div>
        </div>
        <div className="sb-viewer__footer">
          <span className="sb-viewer__live" data-playing={playing || undefined}>
            <span className="sb-viewer__live-dot" aria-hidden />
            {playing ? "Live" : "Paused"}
            <span className="sb-viewer__live-fps sb-tabular">{playing ? "60 fps" : "frame 1,284"}</span>
          </span>
          <button
            type="button"
            className="sb-viewer__device-link"
            onClick={() => toast({ title: "Scan to preview on your phone", description: "Your phone and computer need to be on the same Wi-Fi.", tone: "info" })}
          >
            <QrCode size={12} strokeWidth={2} aria-hidden /> On phone
          </button>
        </div>
      </div>
    </Panel>
  );
}
