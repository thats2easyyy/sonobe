import type { DevicePreset } from "@sonobe/core";
import { Circle, Frame, MousePointer2, PenTool, Square, Type } from "lucide-react";
import { useState } from "react";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { Select } from "../../ui/Select.tsx";
import { useElementSize } from "../../ui/lib/useElementSize.ts";
import { MockScreen } from "../mock/MockScreen.tsx";
import { Panel } from "../Panel.tsx";

type Tool = "select" | "artboard" | "rectangle" | "oval" | "text" | "pen";
type Zoom = "fit" | "0.5" | "1" | "2";

/** Design surface: the artboard with direct-manipulation selection. */
export function CanvasPanel({ device }: { device: DevicePreset }) {
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [bodyRef, box] = useElementSize<HTMLDivElement>();
  const [w, h] = device.size;
  const fit = box.width > 0 ? Math.max(0.1, Math.min(1, (box.width - 64) / w, (box.height - 60) / h)) : 0.4;
  const scale = zoom === "fit" ? fit : Number(zoom);

  return (
    <Panel
      title="Canvas"
      scope="canvas"
      surface="sunken"
      headerContent={
        <SegmentedControl<Tool>
          size="sm"
          aria-label="Tool"
          value={tool}
          onChange={setTool}
          options={[
            { value: "select", icon: <MousePointer2 size={13} />, tooltip: "Select", shortcut: "V" },
            { value: "artboard", icon: <Frame size={13} />, tooltip: "Artboard", shortcut: "A" },
            { value: "rectangle", icon: <Square size={13} />, tooltip: "Rectangle", shortcut: "R" },
            { value: "oval", icon: <Circle size={13} />, tooltip: "Oval", shortcut: "O" },
            { value: "text", icon: <Type size={13} />, tooltip: "Text", shortcut: "T" },
            { value: "pen", icon: <PenTool size={13} />, tooltip: "Pen", shortcut: "P" },
          ]}
        />
      }
      actions={
        <Select<Zoom>
          size="sm"
          variant="ghost"
          aria-label="Zoom"
          value={zoom}
          onChange={setZoom}
          renderValue={() => <span className="sb-tabular">{Math.round(scale * 100)}%</span>}
          options={[
            { value: "fit", label: "Zoom to fit", trailing: "⇧1" },
            { value: "0.5", label: "50%" },
            { value: "1", label: "100%", trailing: "⇧0" },
            { value: "2", label: "200%" },
          ]}
          placement="bottom-end"
          menuWidth={168}
        />
      }
    >
      <div ref={bodyRef} className="sb-canvas" data-tool={tool}>
        <div className="sb-canvas__artboard-wrap" style={{ width: w * scale, height: h * scale }}>
          <div className="sb-canvas__label">
            <span className="sb-canvas__label-name">Main</span>
            <span className="sb-canvas__label-meta sb-tabular">
              {w} × {h}
            </span>
          </div>
          <div className="sb-canvas__artboard" style={{ width: w, height: h, transform: `scale(${scale})` }}>
            <MockScreen device={device} selected="card" inverseScale={1 / scale} />
          </div>
        </div>
      </div>
    </Panel>
  );
}
