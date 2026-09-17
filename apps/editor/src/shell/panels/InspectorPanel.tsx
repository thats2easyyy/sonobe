import { BLEND_MODES } from "@sonobe/core";
import { ChevronRight, Ellipsis, PanelRightClose, Plus, Pointer, SquareRoundCorner } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "../../ui/Button.tsx";
import { ColorField } from "../../ui/ColorField.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Menu } from "../../ui/Menu.tsx";
import { ScrubNumberField } from "../../ui/ScrubNumberField.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { Select } from "../../ui/Select.tsx";
import { Toggle } from "../../ui/Toggle.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { VectorField } from "../../ui/VectorField.tsx";
import { LayerTypeIcon } from "../icons.tsx";
import { Panel } from "../Panel.tsx";

function Section({ title, children, defaultOpen = true, actions }: { title: string; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="sb-inspector__section" data-open={open || undefined}>
      <div className="sb-inspector__section-header">
        <button type="button" className="sb-inspector__section-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronRight size={12} strokeWidth={2} className="sb-inspector__chevron" aria-hidden />
          {title}
        </button>
        {actions && <div className="sb-inspector__section-actions">{actions}</div>}
      </div>
      {open && <div className="sb-inspector__section-body">{children}</div>}
    </section>
  );
}

function Row({ label, children, bindable = true, hint }: { label: string; children: ReactNode; bindable?: boolean; hint?: ReactNode }) {
  return (
    <div className="sb-inspector__row">
      <div className="sb-inspector__label">
        <span className="sb-inspector__label-text">{label}</span>
        {bindable && (
          <Tooltip content={`Drive ${label.toLowerCase()} with a patch`}>
            <button type="button" className="sb-inspector__bind" aria-label={`Drive ${label} with a patch`} onClick={() => toast({ title: `Added a ${label} property patch`, tone: "success" })}>
              <Plus size={10} strokeWidth={2.5} />
            </button>
          </Tooltip>
        )}
      </div>
      <div className="sb-inspector__control">
        {children}
        {hint && <div className="sb-inspector__hint">{hint}</div>}
      </div>
    </div>
  );
}

const ANCHORS = ["topLeft", "top", "topRight", "left", "center", "right", "bottomLeft", "bottom", "bottomRight"] as const;
type Anchor = (typeof ANCHORS)[number];
const ANCHOR_LABELS: Record<Anchor, string> = {
  topLeft: "Top left",
  top: "Top",
  topRight: "Top right",
  left: "Left",
  center: "Center",
  right: "Right",
  bottomLeft: "Bottom left",
  bottom: "Bottom",
  bottomRight: "Bottom right",
};

function AnchorPicker({ value, onChange }: { value: Anchor; onChange: (anchor: Anchor) => void }) {
  const index = ANCHORS.indexOf(value);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = Math.floor(index / 3);
    const col = index % 3;
    let next = index;
    if (event.key === "ArrowRight") next = row * 3 + Math.min(2, col + 1);
    else if (event.key === "ArrowLeft") next = row * 3 + Math.max(0, col - 1);
    else if (event.key === "ArrowDown") next = Math.min(2, row + 1) * 3 + col;
    else if (event.key === "ArrowUp") next = Math.max(0, row - 1) * 3 + col;
    else return;
    event.preventDefault();
    onChange(ANCHORS[next]!);
  };
  return (
    <div className="sb-anchor" role="radiogroup" aria-label="Anchor" tabIndex={0} onKeyDown={onKeyDown}>
      {ANCHORS.map((anchor) => (
        <button
          key={anchor}
          type="button"
          role="radio"
          tabIndex={-1}
          aria-checked={anchor === value}
          aria-label={ANCHOR_LABELS[anchor]}
          className="sb-anchor__point"
          data-selected={anchor === value || undefined}
          onClick={() => onChange(anchor)}
        />
      ))}
    </div>
  );
}

const BLEND_OPTIONS = BLEND_MODES.map((mode) => ({ value: mode.key, label: mode.name }));

/** Properties of the selected layer, grouped the way designers think about them. */
export function InspectorPanel({ onCollapse }: { onCollapse?: () => void }) {
  const [position, setPosition] = useState<number[]>([20, 204]);
  const [size, setSize] = useState<number[]>([362, 260]);
  const [proportional, setProportional] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>("topLeft");
  const [rotation, setRotation] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const [radius, setRadius] = useState(28);
  const [smoothing, setSmoothing] = useState(0.6);
  const [blend, setBlend] = useState("normal");
  const [fill, setFill] = useState("#FFFFFF00");
  const [shadowColor, setShadowColor] = useState("#3C1946FF");
  const [shadowOpacity, setShadowOpacity] = useState(0.45);
  const [shadowRadius, setShadowRadius] = useState(36);
  const [shadowOffset, setShadowOffset] = useState<number[]>([0, 18]);
  const [layout, setLayout] = useState("none");
  const [clip, setClip] = useState(true);
  const [touches, setTouches] = useState(true);
  const [hitSlop, setHitSlop] = useState(8);

  return (
    <Panel
      title="Inspector"
      scope="inspector"
      actions={onCollapse && <IconButton size="sm" icon={<PanelRightClose size={14} />} label="Hide inspector" shortcut="Mod+7" onClick={onCollapse} />}
    >
      <div className="sb-inspector sb-scroll">
        <div className="sb-inspector__layer">
          <span className="sb-inspector__layer-icon" aria-hidden>
            <LayerTypeIcon type="group" size={15} />
          </span>
          <div className="sb-inspector__layer-text">
            <div className="sb-inspector__layer-name">Event Card</div>
            <div className="sb-inspector__layer-type">Group · 5 layers</div>
          </div>
          <Button size="sm" variant="secondary" icon={<Pointer size={13} />} onClick={() => toast({ title: "Added Tap to “Event Card”", tone: "success" })}>
            Touch
          </Button>
          <Menu
            aria-label="Layer options"
            placement="bottom-end"
            entries={[
              { id: "reset", label: "Reset to Defaults" },
              { id: "copy", label: "Copy Properties", shortcut: "Mod+Alt+C" },
              { id: "paste", label: "Paste Properties", shortcut: "Mod+Alt+V", disabled: true },
            ]}
          >
            <IconButton size="sm" icon={<Ellipsis size={14} />} label="Layer options" />
          </Menu>
        </div>

        <Section title="Position and size">
          <Row label="Position">
            <VectorField size="sm" aria-label="Position" value={position} onChange={setPosition} />
          </Row>
          <Row label="Size">
            <VectorField size="sm" aria-label="Size" labels={["W", "H"]} min={0} value={size} onChange={setSize} proportional={proportional} onProportionalChange={setProportional} />
          </Row>
          <Row label="Anchor" hint={ANCHOR_LABELS[anchor]}>
            <AnchorPicker value={anchor} onChange={setAnchor} />
          </Row>
          <Row label="Rotation">
            <ScrubNumberField size="sm" aria-label="Rotation" value={rotation} onChange={setRotation} unit="°" precision={1} />
          </Row>
          <Row label="Scale" hint={<span className="sb-inspector__link">← grow.output</span>}>
            <ScrubNumberField size="sm" aria-label="Scale" value={1.05} linked precision={2} onLinkedClick={() => toast({ title: "Revealed “grow” in the patch editor" })} />
          </Row>
        </Section>

        <Section title="Appearance">
          <Row label="Opacity">
            <ScrubNumberField size="sm" aria-label="Opacity" value={opacity} onChange={setOpacity} scale={100} unit="%" min={0} max={1} step={0.01} precision={0} />
          </Row>
          <Row label="Corners">
            <div className="sb-inspector__pair">
              <ScrubNumberField size="sm" aria-label="Corner radius" label={<SquareRoundCorner size={12} strokeWidth={2} />} value={radius} onChange={setRadius} min={0} />
              <ScrubNumberField size="sm" aria-label="Corner smoothing" label="S" value={smoothing} onChange={setSmoothing} scale={100} unit="%" min={0} max={1} step={0.01} precision={0} />
            </div>
          </Row>
          <Row label="Blend">
            <Select size="sm" aria-label="Blend mode" options={BLEND_OPTIONS} value={blend} onChange={setBlend} searchable={false} className="sb-inspector__select" />
          </Row>
          <Row label="Fill">
            <ColorField size="sm" aria-label="Fill" value={fill} onChange={setFill} pickerPlacement="left-start" />
          </Row>
        </Section>

        <Section title="Shadow">
          <Row label="Color">
            <ColorField size="sm" aria-label="Shadow color" value={shadowColor} onChange={setShadowColor} showAlpha={false} pickerPlacement="left-start" />
          </Row>
          <Row label="Opacity">
            <ScrubNumberField size="sm" aria-label="Shadow opacity" value={shadowOpacity} onChange={setShadowOpacity} scale={100} unit="%" min={0} max={1} step={0.01} precision={0} />
          </Row>
          <Row label="Blur">
            <ScrubNumberField size="sm" aria-label="Shadow radius" value={shadowRadius} onChange={setShadowRadius} min={0} unit="pt" />
          </Row>
          <Row label="Offset">
            <VectorField size="sm" aria-label="Shadow offset" value={shadowOffset} onChange={setShadowOffset} />
          </Row>
        </Section>

        <Section title="Layout">
          <Row label="Direction" bindable={false}>
            <SegmentedControl
              size="sm"
              fullWidth
              aria-label="Layout direction"
              value={layout}
              onChange={setLayout}
              options={[
                { value: "none", label: "None" },
                { value: "row", label: "Row" },
                { value: "column", label: "Column" },
                { value: "grid", label: "Grid" },
              ]}
            />
          </Row>
          <Row label="Clip">
            <Toggle size="sm" aria-label="Clip contents" checked={clip} onChange={setClip} />
          </Row>
        </Section>

        <Section title="Interaction" defaultOpen={false}>
          <Row label="Touches">
            <Toggle size="sm" aria-label="Receives touches" checked={touches} onChange={setTouches} />
          </Row>
          <Row label="Hit slop">
            <ScrubNumberField size="sm" aria-label="Hit slop" value={hitSlop} onChange={setHitSlop} min={0} unit="pt" />
          </Row>
        </Section>
      </div>
    </Panel>
  );
}
