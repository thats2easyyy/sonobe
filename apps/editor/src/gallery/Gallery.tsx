import type { LayerNode, ValueType } from "@sonobe/core";
import { AlignCenter, AlignLeft, AlignRight, ArrowLeft, Bell, ChevronDown, CircleCheck, Copy, Eye, Group, Lock, LockOpen, Play, Plus, Pointer, RotateCcw, Search, Settings, Sparkles, Trash, Workflow } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { LayerTypeIcon } from "../shell/icons.tsx";
import { MOCK_LAYERS, MOCK_PATCH_TYPES } from "../shell/mockData.ts";
import { DevicePicker } from "../shell/Toolbar.tsx";
import {
  CATEGORY_LABELS,
  PATCH_CATEGORIES,
  PORT_COLOR_GROUPS,
  PORT_GROUP_COLORS,
  PORT_GROUP_LABELS,
  THEME_TOKENS,
  categoryColorVar,
  type PortColorGroup,
  type ThemeName,
  type ThemeTokenName,
} from "../theme/tokens.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { ColorField } from "../ui/ColorField.tsx";
import { ColorPicker } from "../ui/ColorPicker.tsx";
import { CommandPalette } from "../ui/CommandPalette.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { ContextMenu, Menu, MenuList, type MenuEntry } from "../ui/Menu.tsx";
import { Popover } from "../ui/Popover.tsx";
import { PortGlyph } from "../ui/PortGlyph.tsx";
import { ScrubNumberField } from "../ui/ScrubNumberField.tsx";
import { SearchList } from "../ui/SearchList.tsx";
import { SegmentedControl } from "../ui/SegmentedControl.tsx";
import { Select } from "../ui/Select.tsx";
import { Splitter } from "../ui/Splitter.tsx";
import { TabPanel, Tabs } from "../ui/Tabs.tsx";
import { TextArea, TextField } from "../ui/TextField.tsx";
import { Checkbox, Toggle } from "../ui/Toggle.tsx";
import { toast } from "../ui/Toast.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import { TreeView } from "../ui/TreeView.tsx";
import { VectorField } from "../ui/VectorField.tsx";
import { useRegisterCommands } from "../ui/commands/CommandProvider.tsx";
import { moveTreeNodes } from "../ui/lib/treeModel.ts";
import { SonobeMark } from "../shell/icons.tsx";
import "./Gallery.css";

const GROUP_SAMPLE: Record<PortColorGroup, ValueType> = {
  number: "number",
  boolean: "boolean",
  pulse: "pulse",
  text: "text",
  color: "color",
  vector: "point",
  index: "index",
  json: "json",
  layer: "layer",
  media: "image",
  style: "gradient",
  any: "any",
};

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="sb-gsection">
      <h2 className="sb-gsection__title">{title}</h2>
      <p className="sb-gsection__description">{description}</p>
      <div className="sb-gsection__grid">{children}</div>
    </section>
  );
}

function Demo({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="sb-demo" data-wide={wide || undefined}>
      <div className="sb-demo__label">{label}</div>
      <div className="sb-demo__content">{children}</div>
    </div>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div className="sb-demo__row">{children}</div>;
const Stack = ({ children }: { children: ReactNode }) => <div className="sb-demo__stack">{children}</div>;

function Foundations({ theme }: { theme: ThemeName }) {
  const surfaces: ThemeTokenName[] = ["bg-window", "bg-toolbar", "bg-panel", "bg-sunken", "bg-elevated", "bg-field", "bg-selected"];
  const statuses: [string, ThemeTokenName, ThemeTokenName, ThemeTokenName][] = [
    ["Accent", "accent", "accent-soft", "text-accent"],
    ["Success", "success", "success-soft", "success-text"],
    ["Warning", "warn", "warn-soft", "warn-text"],
    ["Danger", "danger", "danger-soft", "danger-text"],
    ["Info", "info", "info-soft", "info-text"],
    ["AI", "ai", "ai-soft", "ai-text"],
  ];
  const type: [string, string, string][] = [
    ["2xl · 28", "var(--font-size-2xl)", "Popular Events"],
    ["xl · 20", "var(--font-size-xl)", "Tap to zoom"],
    ["lg · 15", "var(--font-size-lg)", "Pop Animation"],
    ["md · 13", "var(--font-size-md)", "Insert patch…"],
    ["sm · 12", "var(--font-size-sm)", "Default UI text for panels and menus"],
    ["xs · 11", "var(--font-size-xs)", "Labels, hints, and metadata"],
  ];
  return (
    <Section title="Foundations" description="The tokens every widget is built from. Themes change the values, never the names.">
      <Demo label="Surfaces" wide>
        <div className="sb-swatches">
          {surfaces.map((token) => (
            <div key={token} className="sb-swatch">
              <span className="sb-swatch__chip" style={{ background: `var(--${token})` }} />
              <span className="sb-swatch__name">{token}</span>
              <span className="sb-swatch__value">{THEME_TOKENS[theme][token]}</span>
            </div>
          ))}
        </div>
      </Demo>
      <Demo label="Text">
        <Stack>
          <span style={{ color: "var(--text-primary)" }}>Primary · names and values</span>
          <span style={{ color: "var(--text-secondary)" }}>Secondary · labels</span>
          <span style={{ color: "var(--text-tertiary)" }}>Tertiary · hints and metadata</span>
          <span style={{ color: "var(--text-disabled)" }}>Disabled</span>
          <span style={{ color: "var(--text-accent)" }}>Accent · links and bound values</span>
        </Stack>
      </Demo>
      <Demo label="Accent and status">
        <div className="sb-statuses">
          {statuses.map(([label, solid, soft, text]) => (
            <span key={label} className="sb-status" style={{ background: `var(--${soft})`, color: `var(--${text})` }}>
              <i style={{ background: `var(--${solid})` }} />
              {label}
            </span>
          ))}
        </div>
      </Demo>
      <Demo label="Type scale · system UI font, ui-monospace for values" wide>
        <div className="sb-typescale">
          {type.map(([name, size, sample]) => (
            <div key={name} className="sb-typescale__row">
              <span className="sb-typescale__name">{name}</span>
              <span style={{ fontSize: size, fontWeight: name.startsWith("2xl") || name.startsWith("xl") ? 600 : 400 }}>{sample}</span>
            </div>
          ))}
          <div className="sb-typescale__row">
            <span className="sb-typescale__name">mono · 11</span>
            <span className="sb-mono" style={{ fontSize: "var(--font-size-xs)" }}>
              pop.output = 1.0482 · 358 × 220 · #5F74E4FF
            </span>
          </div>
        </div>
      </Demo>
      <Demo label="Port types · color by value type, shape by structure" wide>
        <div className="sb-portpalette">
          {PORT_COLOR_GROUPS.map((group) => (
            <div key={group} className="sb-portpalette__item">
              <span className="sb-portpalette__glyph">
                <PortGlyph type={GROUP_SAMPLE[group]} size={10} />
              </span>
              <span className="sb-portpalette__cable" style={{ background: `var(--port-${group})` }} />
              <span className="sb-portpalette__label">{PORT_GROUP_LABELS[group]}</span>
              <span className="sb-portpalette__hex">{PORT_GROUP_COLORS[theme][group]}</span>
            </div>
          ))}
        </div>
      </Demo>
      <Demo label="Patch categories" wide>
        <div className="sb-categories">
          {PATCH_CATEGORIES.map((category) => (
            <div key={category} className="sb-category" style={{ "--sb-cat": categoryColorVar(category) } as CSSProperties}>
              <span className="sb-category__dot" />
              {CATEGORY_LABELS[category]}
            </div>
          ))}
        </div>
      </Demo>
      <Demo label="Radii and elevation" wide>
        <div className="sb-radii">
          {["xs", "sm", "md", "lg", "xl"].map((r) => (
            <div key={r} className="sb-radii__item" style={{ borderRadius: `var(--radius-${r})` }}>
              {r}
            </div>
          ))}
          <div className="sb-radii__item sb-surface" data-elevated>
            popover
          </div>
        </div>
      </Demo>
    </Section>
  );
}

function Buttons() {
  return (
    <Section title="Buttons" description="One primary action per area. Ghost buttons for toolbars; the AI variant marks work Claude does.">
      <Demo label="Variants" wide>
        <Row>
          <Button variant="primary" icon={<Plus size={13} />}>
            Insert patch
          </Button>
          <Button>Duplicate</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger" icon={<Trash size={13} />}>
            Delete
          </Button>
          <Button variant="ai" icon={<Sparkles size={13} />}>
            Explain this
          </Button>
        </Row>
      </Demo>
      <Demo label="Sizes and states" wide>
        <Row>
          <Button size="sm" variant="primary">
            Small
          </Button>
          <Button variant="primary">Medium</Button>
          <Button size="lg" variant="primary">
            Large
          </Button>
          <Button variant="primary" loading>
            Saving
          </Button>
          <Button disabled>Disabled</Button>
        </Row>
      </Demo>
      <Demo label="Icon buttons · hover for tooltips with shortcuts" wide>
        <Row>
          <IconButton icon={<Play size={15} fill="currentColor" strokeWidth={0} />} label="Play prototype" shortcut="Mod+Alt+P" />
          <IconButton icon={<RotateCcw size={15} />} label="Restart prototype" shortcut="Mod+R" />
          <IconButton icon={<Eye size={15} />} label="Show hit targets" active />
          <IconButton icon={<Bell size={15} />} label="Notifications" badge />
          <IconButton icon={<Plus size={15} />} label="Add layer" variant="secondary" />
          <IconButton icon={<Workflow size={15} />} label="Patches" variant="solid" />
          <IconButton icon={<Settings size={15} />} label="Settings" disabled />
          <IconButton size="sm" icon={<Copy size={13} />} label="Copy" />
          <IconButton size="xs" icon={<Lock size={11} />} label="Lock" />
        </Row>
      </Demo>
    </Section>
  );
}

function Inputs() {
  const [rotation, setRotation] = useState(45);
  const [opacity, setOpacity] = useState(0.8);
  const [position, setPosition] = useState<number[]>([16, 132]);
  const [size, setSize] = useState<number[]>([358, 220]);
  const [proportional, setProportional] = useState(true);
  const [point3d, setPoint3d] = useState<number[]>([0, 12, -4]);
  const [padding, setPadding] = useState<number[]>([16, 20, 16, 20]);
  const [fill, setFill] = useState("#5F74E4FF");
  const [tint, setTint] = useState("#F2555A80");
  const [pickerColor, setPickerColor] = useState("#3FC1C9FF");
  const [name, setName] = useState("Event Card");
  return (
    <Section title="Inputs" description="Scrub on drag (Shift ×10, Alt ×0.1), click to type (math works: 667-49-64.5), arrows to nudge, Escape to revert.">
      <Demo label="Scrub number fields">
        <Stack>
          <ScrubNumberField aria-label="Rotation" label="R" value={rotation} onChange={setRotation} unit="°" />
          <ScrubNumberField aria-label="Opacity" value={opacity} onChange={setOpacity} scale={100} unit="%" min={0} max={1} step={0.01} precision={0} />
          <ScrubNumberField aria-label="Width" label="W" value={0} mixed />
          <ScrubNumberField aria-label="Scale" value={1.05} linked precision={2} />
          <ScrubNumberField aria-label="Height" label="H" value={220} disabled />
        </Stack>
      </Demo>
      <Demo label="Vector fields · 2, 3, and 4 components">
        <Stack>
          <VectorField aria-label="Position" value={position} onChange={setPosition} />
          <VectorField aria-label="Size" labels={["W", "H"]} value={size} onChange={setSize} proportional={proportional} onProportionalChange={setProportional} />
          <VectorField aria-label="Rotation 3D" value={point3d} onChange={setPoint3d} unit="°" />
          <VectorField aria-label="Padding" labels={["T", "R", "B", "L"]} value={padding} onChange={setPadding} size="sm" />
        </Stack>
      </Demo>
      <Demo label="Color fields">
        <Stack>
          <ColorField aria-label="Fill" value={fill} onChange={setFill} />
          <ColorField aria-label="Tint" value={tint} onChange={setTint} />
          <ColorField aria-label="Stroke" value="#000000FF" mixed />
          <ColorField aria-label="Background" value="#FFFFFFFF" linked size="sm" />
        </Stack>
      </Demo>
      <Demo label="Color picker">
        <div className="sb-surface sb-gallery__picker">
          <ColorPicker value={pickerColor} onChange={setPickerColor} />
        </div>
      </Demo>
      <Demo label="Text fields" wide>
        <div className="sb-gallery__two">
          <Stack>
            <TextField aria-label="Layer name" value={name} onChange={(e) => setName(e.target.value)} />
            <TextField aria-label="Search" leading={<Search size={13} strokeWidth={2} />} placeholder="Search patches" />
            <div>
              <TextField aria-label="Layer id" mono invalid defaultValue="card title" />
              <div className="sb-gallery__error">Ids can use letters, numbers, and underscores.</div>
            </div>
          </Stack>
          <TextArea aria-label="Notes" placeholder="Notes for this prototype…" defaultValue="Tap the card to expand it. Springs should feel like the iOS sheet." rows={4} />
        </div>
      </Demo>
    </Section>
  );
}

function Selection() {
  const [layout, setLayout] = useState("row");
  const [align, setAlign] = useState("left");
  const [blend, setBlend] = useState("normal");
  const [device, setDevice] = useState("iphone-17-pro");
  const [touch, setTouch] = useState(true);
  const [clip, setClip] = useState(false);
  const [loop, setLoop] = useState(true);
  return (
    <Section title="Selection" description="Segmented controls for a few visible options, selects for many, toggles for settings that apply immediately.">
      <Demo label="Segmented controls">
        <Stack>
          <SegmentedControl aria-label="Layout" value={layout} onChange={setLayout} options={[{ value: "none", label: "None" }, { value: "row", label: "Row" }, { value: "column", label: "Column" }, { value: "grid", label: "Grid" }]} />
          <SegmentedControl
            aria-label="Alignment"
            size="sm"
            value={align}
            onChange={setAlign}
            options={[
              { value: "left", icon: <AlignLeft size={13} />, tooltip: "Align left" },
              { value: "center", icon: <AlignCenter size={13} />, tooltip: "Align center" },
              { value: "right", icon: <AlignRight size={13} />, tooltip: "Align right" },
            ]}
          />
          <SegmentedControl aria-label="Theme" fullWidth size="sm" value="dark" onChange={() => undefined} options={[{ value: "system", label: "System" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
        </Stack>
      </Demo>
      <Demo label="Selects · searchable when long">
        <Stack>
          <Select aria-label="Blend mode" value={blend} onChange={setBlend} searchable={false} options={[{ value: "normal", label: "Normal" }, { value: "multiply", label: "Multiply" }, { value: "screen", label: "Screen" }, { value: "overlay", label: "Overlay" }]} />
          <DevicePicker value={device} onChange={setDevice} />
          <Select aria-label="Curve" value={null} onChange={() => undefined} placeholder="Choose a curve…" options={[{ value: "linear", label: "Linear" }, { value: "easeOut", label: "Ease out", description: "Fast start, gentle stop" }]} />
          <Select aria-label="Font" value="inter" mixed onChange={() => undefined} options={[{ value: "inter", label: "Inter" }]} />
        </Stack>
      </Demo>
      <Demo label="Toggles and checkboxes">
        <Stack>
          <Toggle label="Receives touches" checked={touch} onChange={setTouch} />
          <Toggle label="Clip contents" size="sm" checked={clip} onChange={setClip} />
          <Checkbox label="Loop" checked={loop} onChange={setLoop} />
          <Checkbox label="Some layers are locked" checked={false} indeterminate />
          <Checkbox label="Disabled" checked disabled />
        </Stack>
      </Demo>
    </Section>
  );
}

const MENU_ENTRIES: MenuEntry[] = [
  { id: "dup", label: "Duplicate", icon: <Copy size={14} />, shortcut: "Mod+D" },
  { id: "group", label: "Group Selection", icon: <Group size={14} />, shortcut: "Mod+G" },
  { type: "separator" },
  {
    id: "touch",
    label: "Add Interaction",
    icon: <Pointer size={14} />,
    submenu: [
      { id: "tap", label: "Tap" },
      { id: "long", label: "Long Press" },
      { id: "drag", label: "Drag" },
      { id: "scroll", label: "Scroll Y" },
    ],
  },
  { id: "snap", label: "Snap to Pixel Grid", checked: true, keepOpen: true },
  { id: "lock", label: "Lock", icon: <LockOpen size={14} />, shortcut: "Mod+Shift+L", disabled: true },
  { type: "separator" },
  { id: "delete", label: "Delete", icon: <Trash size={14} />, shortcut: "Backspace", danger: true },
];

function Overlays({ onOpenPalette }: { onOpenPalette: () => void }) {
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLButtonElement | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <Section title="Overlays" description="Popovers, menus, tooltips, toasts, and dialogs. Escape closes the top-most one; focus returns where it was.">
      <Demo label="Menu with submenu">
        <Row>
          <Menu entries={MENU_ENTRIES} aria-label="Layer actions">
            <Button trailingIcon={<ChevronDown size={12} />}>Layer actions</Button>
          </Menu>
          <Tooltip content="Tooltips show shortcuts too" shortcut="Mod+Shift+/">
            <Button variant="ghost">Hover me</Button>
          </Tooltip>
        </Row>
      </Demo>
      <Demo label="Context menu">
        <ContextMenu entries={MENU_ENTRIES}>
          <div className="sb-gallery__context" tabIndex={0}>
            Right-click here (or Shift+F10)
          </div>
        </ContextMenu>
      </Demo>
      <Demo label="Popover and dialog">
        <Row>
          <Button ref={setPopoverAnchor} onClick={() => setPopoverOpen((o) => !o)} aria-expanded={popoverOpen}>
            Spring presets
          </Button>
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen} anchor={popoverAnchor} aria-label="Spring presets" className="sb-gallery__popover">
            <div className="sb-gallery__popover-body">
              <div className="sb-gallery__popover-title">Feel</div>
              <SegmentedControl size="sm" fullWidth aria-label="Spring feel" value="snappy" onChange={() => undefined} options={[{ value: "smooth", label: "Smooth" }, { value: "snappy", label: "Snappy" }, { value: "bouncy", label: "Bouncy" }]} />
              <div className="sb-gallery__popover-grid">
                <ScrubNumberField size="sm" aria-label="Bounciness" label="B" value={3} />
                <ScrubNumberField size="sm" aria-label="Speed" label="S" value={14} />
              </div>
              <Button size="sm" variant="primary" onClick={() => setPopoverOpen(false)}>
                Apply
              </Button>
            </div>
          </Popover>
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen} aria-labelledby="sb-gallery-dialog-title" width={420}>
            <div className="sb-gallery__dialog">
              <h3 id="sb-gallery-dialog-title" className="sb-gallery__dialog-title">
                Delete “Event Card”?
              </h3>
              <p className="sb-gallery__dialog-text">It has 5 layers and 4 connected patches. You can undo this.</p>
              <div className="sb-gallery__dialog-actions">
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => setDialogOpen(false)}>
                  Delete
                </Button>
              </div>
            </div>
          </Dialog>
          <Button icon={<Search size={13} />} onClick={onOpenPalette}>
            Command palette <Kbd shortcut="Mod+K" variant="plain" />
          </Button>
        </Row>
      </Demo>
      <Demo label="Toasts">
        <Row>
          <Button size="sm" onClick={() => toast.success("Tidied 9 patches")}>
            Success
          </Button>
          <Button size="sm" onClick={() => toast.warn("Loop lengths don’t match", { description: "Shorter loops wrap around to fill." })}>
            Warning
          </Button>
          <Button size="sm" onClick={() => toast.error("Couldn’t load events.json", { description: "The file was moved or renamed.", action: { label: "Locate", onClick: () => undefined } })}>
            Error
          </Button>
          <Button size="sm" variant="ai" onClick={() => toast({ title: "Claude added a press animation", description: "12 changes to Event Card.", tone: "ai", action: { label: "Undo", onClick: () => undefined } })}>
            AI
          </Button>
        </Row>
      </Demo>
      <Demo label="Menu · static preview">
        <div className="sb-surface sb-gallery__menu">
          <MenuList entries={MENU_ENTRIES} autoFocus="none" onClose={() => undefined} aria-label="Preview menu" />
        </div>
      </Demo>
    </Section>
  );
}

function Navigation() {
  const [tab, setTab] = useState("console");
  const [pill, setPill] = useState("recipes");
  return (
    <Section title="Navigation" description="Tabs switch views of the same place. Arrow keys move between tabs.">
      <Demo label="Underline tabs" wide>
        <div className="sb-gallery__tabs">
          <Tabs
            idBase="gallery-tabs"
            aria-label="Console panels"
            value={tab}
            onChange={setTab}
            items={[
              { value: "console", label: "Console", badge: <Badge size="sm" tone="danger">1</Badge> },
              { value: "diagnostics", label: "Diagnostics", badge: <Badge size="sm" tone="warn">3</Badge> },
              { value: "ai", label: "AI Activity" },
              { value: "performance", label: "Performance" },
              { value: "network", label: "Network", disabled: true },
            ]}
          />
          <TabPanel idBase="gallery-tabs" value={tab} active className="sb-gallery__tabpanel">
            Showing the {tab} panel.
          </TabPanel>
        </div>
      </Demo>
      <Demo label="Pill tabs" wide>
        <Tabs
          idBase="gallery-pills"
          aria-label="Learn sections"
          variant="pill"
          value={pill}
          onChange={setPill}
          items={[
            { value: "lessons", label: "Lessons" },
            { value: "recipes", label: "Recipes" },
            { value: "patches", label: "Patch reference" },
          ]}
        />
      </Demo>
    </Section>
  );
}

function TreeDemo() {
  const [layers, setLayers] = useState<LayerNode[]>(MOCK_LAYERS.slice(0, 5));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["card"]));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(["event_title"]));
  const rename = (list: LayerNode[], id: string, name: string): LayerNode[] =>
    list.map((n) => (n.id === id ? { ...n, name } : n.children ? { ...n, children: rename(n.children, id, name) } : n));
  return (
    <TreeView<LayerNode>
      aria-label="Layers demo"
      nodes={layers}
      getLabel={(n) => n.name}
      expanded={expanded}
      onExpandedChange={setExpanded}
      selected={selected}
      onSelectedChange={setSelected}
      canHaveChildren={(n) => n.type === "group"}
      onRename={(id, name) => setLayers((l) => rename(l, id, name))}
      onMove={(ids, target) => setLayers((l) => moveTreeNodes(l, ids, target, (n, children) => ({ ...n, children })))}
      renderIcon={(n) => <LayerTypeIcon type={n.type} />}
      renderTrailing={(n) => (n.locked ? <Lock size={12} aria-label="Locked" /> : null)}
      renderActions={() => (
        <>
          <IconButton size="xs" icon={<Pointer size={12} />} label="Add interaction" />
          <IconButton size="xs" icon={<Eye size={12} />} label="Hide layer" />
        </>
      )}
    />
  );
}

function Data() {
  return (
    <Section title="Data" description="Trees and search lists stay fast with hundreds of items and work entirely from the keyboard.">
      <Demo label="Tree view · drag to reorder, Enter or double-click to rename, ⌥-click to expand all" wide>
        <div className="sb-gallery__box" style={{ height: 250 }}>
          <TreeDemo />
        </div>
      </Demo>
      <Demo label="Search list · try “spring”, “flip”, or “ca”" wide>
        <div className="sb-gallery__box" style={{ height: 320 }}>
          <SearchList
            aria-label="Patch search demo"
            placeholder="Search patches…"
            autoFocus={false}
            defaultQuery="spring"
            items={MOCK_PATCH_TYPES}
            keys={[
              { name: "name", get: (p) => p.name },
              { name: "aliases", get: (p) => p.aliases, weight: 0.75 },
              { name: "ports", get: (p) => [...p.inputs, ...p.outputs].map((x) => x.name), weight: 0.45 },
            ]}
            getId={(p) => p.type}
            groupBy={(p) => CATEGORY_LABELS[p.category]}
            onSelect={(p) => toast({ title: `Picked ${p.name}` })}
            renderItem={(p, ctx) => (
              <div className="sb-gallery__result">
                <span className="sb-gallery__result-dot" style={{ background: categoryColorVar(p.category) }} />
                {ctx.highlight("name", p.name)}
                {ctx.matches.aliases && !ctx.matches.name && <span className="sb-gallery__result-alias">{ctx.highlight("aliases", ctx.matches.aliases.value)}</span>}
              </div>
            )}
            renderPreview={(p) =>
              p && (
                <div className="sb-gallery__preview">
                  <div className="sb-gallery__preview-title">{p.name}</div>
                  <p>{p.summary}</p>
                  <div className="sb-gallery__preview-ports">
                    {p.outputs.map((o) => (
                      <span key={o.name}>
                        <PortGlyph type={o.type} size={8} /> {o.name}
                      </span>
                    ))}
                  </div>
                </div>
              )
            }
          />
        </div>
      </Demo>
    </Section>
  );
}

function Feedback() {
  return (
    <Section title="Feedback" description="Badges for status and counts, keycaps for shortcuts, and empty states that say what to do next.">
      <Demo label="Badges" wide>
        <Row>
          <Badge>Draft</Badge>
          <Badge tone="accent">Selected</Badge>
          <Badge tone="success" dot>
            Connected
          </Badge>
          <Badge tone="warn">2 warnings</Badge>
          <Badge tone="danger" variant="solid">
            Error
          </Badge>
          <Badge tone="ai" dot>
            Claude
          </Badge>
          <Badge tone="info" variant="outline">
            Beta
          </Badge>
          <Badge size="sm">×6</Badge>
        </Row>
      </Demo>
      <Demo label="Keyboard shortcuts · adapt to ⌘ or Ctrl" wide>
        <Row>
          <Kbd shortcut="Mod+K" />
          <Kbd shortcut="Alt+Enter" />
          <Kbd shortcut="Mod+Shift+Z" />
          <Kbd shortcut="Ctrl+T" />
          <Kbd>Esc</Kbd>
          <Kbd shortcut="Mod+Alt+ArrowUp" />
          <span className="sb-gallery__inline">
            Inline: <Kbd shortcut="Mod+R" variant="plain" />
          </span>
        </Row>
      </Demo>
      <Demo label="Empty state" wide>
        <div className="sb-gallery__box">
          <EmptyState
            icon={<CircleCheck size={18} />}
            title="No problems found"
            description="Your prototype has no errors or warnings. Diagnostics update as you edit."
            actions={
              <Button size="sm" onClick={() => toast.success("Checked 24 layers and 18 patches")}>
                Check again
              </Button>
            }
          />
        </div>
      </Demo>
    </Section>
  );
}

function LayoutDemo() {
  const [width, setWidth] = useState(180);
  return (
    <Section title="Layout" description="Splitters resize panes by drag or keyboard (arrows, Shift for bigger steps, double-click to reset).">
      <Demo label="Splitter" wide>
        <div className="sb-gallery__split">
          <div className="sb-gallery__pane" style={{ width }}>
            <span className="sb-tabular">{width}px</span>
          </div>
          <Splitter orientation="vertical" size={width} min={96} max={420} defaultSize={180} label="Resize demo pane" onResize={setWidth} />
          <div className="sb-gallery__pane" data-fill>
            Drag the line
          </div>
        </div>
      </Demo>
    </Section>
  );
}

function GalleryColumn({ theme, onOpenPalette }: { theme: ThemeName; onOpenPalette: () => void }) {
  return (
    <div className="sb-gallery__column" data-theme={theme}>
      <div className="sb-gallery__theme-label">
        <span className="sb-gallery__theme-dot" data-theme-dot={theme} />
        {theme === "dark" ? "Dark" : "Light"}
      </div>
      <Foundations theme={theme} />
      <Buttons />
      <Inputs />
      <Selection />
      <Overlays onOpenPalette={onOpenPalette} />
      <Navigation />
      <Data />
      <Feedback />
      <LayoutDemo />
    </div>
  );
}

/** #gallery: every widget, in both themes side by side. */
export function Gallery() {
  const [mode, setMode] = useState<"both" | ThemeName>("both");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const themes: ThemeName[] = mode === "both" ? ["dark", "light"] : [mode];

  useRegisterCommands(
    () => [
      { id: "gallery.back", title: "Back to Editor", category: "Gallery", icon: ArrowLeft, run: () => void (window.location.hash = "") },
      { id: "gallery.both", title: "Show Both Themes", category: "Gallery", run: () => setMode("both") },
      { id: "gallery.palette", title: "Show Command Palette", category: "General", shortcut: "Mod+K", allowInInput: true, run: () => setPaletteOpen(true) },
      { id: "demo.duplicate", title: "Duplicate Layer", category: "Layers", shortcut: "Mod+D", icon: Copy, run: () => void toast.success("Duplicated Event Card") },
      { id: "demo.group", title: "Group Selection", category: "Layers", shortcut: "Mod+G", icon: Group, run: () => void toast.success("Grouped 2 layers") },
      { id: "demo.restart", title: "Restart Prototype", category: "Prototype", shortcut: "Mod+R", icon: RotateCcw, run: () => void toast({ title: "Restarted" }) },
      { id: "demo.explain", title: "Explain Selection", category: "AI", icon: Sparkles, keywords: ["why", "describe"], run: () => void toast({ title: "Claude is explaining…", tone: "ai" }) },
    ],
    [],
  );

  return (
    <div className="sb-app sb-gallery">
      <header className="sb-gallery__bar">
        <SonobeMark size={20} />
        <div className="sb-gallery__bar-text">
          <div className="sb-gallery__bar-title">Sonobe design system</div>
          <div className="sb-gallery__bar-subtitle">Widgets, tokens, and patterns used across the editor</div>
        </div>
        <div className="sb-gallery__bar-actions">
          <SegmentedControl
            size="sm"
            aria-label="Themes shown"
            value={mode}
            onChange={setMode}
            options={[
              { value: "both", label: "Side by side" },
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
          />
          <Button size="sm" variant="ghost" icon={<ArrowLeft size={13} />} onClick={() => (window.location.hash = "")}>
            Back to editor
          </Button>
        </div>
      </header>
      <div className="sb-gallery__columns" style={{ "--sb-gallery-count": themes.length } as CSSProperties}>
        {themes.map((theme) => (
          <GalleryColumn key={theme} theme={theme} onOpenPalette={() => setPaletteOpen(true)} />
        ))}
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
