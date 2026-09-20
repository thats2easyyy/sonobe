/** Value editors for inspector fields, chosen by value type, plus the read-only live readout. */

import {
  allLayers,
  encodeValue,
  isAssetInput,
  isColor,
  isGradientLiteral,
  isJsonLiteral,
  isLayerInput,
  isLoopLiteral,
  MAX_REPEAT,
  roundNumber,
  vectorSize,
  type AssetKind,
  type Color,
  type GradientLiteral,
  type Id,
  type InputValue,
  type ValueType,
} from "@sonobe/core";
import { Image as ImageIcon, Plus, Trash, Upload } from "lucide-react";
import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { LayerTypeIcon } from "../../shell/icons.tsx";
import { useCurrentComponent, useDocument, useEditorSession } from "../../state/EditorProvider.tsx";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { ColorField } from "../../ui/ColorField.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { ScrubNumberField } from "../../ui/ScrubNumberField.tsx";
import { SegmentedControl } from "../../ui/SegmentedControl.tsx";
import { Select, type SelectOption } from "../../ui/Select.tsx";
import { TextArea, TextField } from "../../ui/TextField.tsx";
import { toast } from "../../ui/Toast.tsx";
import { Checkbox, Toggle } from "../../ui/Toggle.tsx";
import { VectorField } from "../../ui/VectorField.tsx";
import { clamp01, parseHexColor, toCssColor, toHex8 } from "../../ui/lib/colorMath.ts";
import { useLatest, usePointerDrag } from "../../ui/lib/hooks.ts";
import { decimalsOf } from "../../ui/lib/scrubMath.ts";
import { acceptAttribute, assetKindsFor, importAssetForField, KIND_NOUNS, type FieldImportResult } from "./assetImport.ts";
import { formatCopies, formatLiveValue, literalValue, sameInputValue, updateVectorComponent, type FieldUpdate, type InspectorField } from "./model.ts";

/** What a control can do to its field. */
export interface FieldActions {
  /** A change within a gesture (scrubbing, dragging a color); merges into one undo step until `commit`. */
  change: (update: FieldUpdate) => void;
  /** A discrete change: its own undo step, or part of the step with the same `coalesceKey` (an import this sets). */
  set: (update: FieldUpdate, options?: { coalesceKey?: string }) => void;
  /** End the current gesture. */
  commit: () => void;
  reset: () => void;
  disconnect: () => void;
}

export interface ValueControlProps {
  field: InspectorField;
  actions: FieldActions;
  /** Accessible name (the property name). */
  label: string;
  /** Layers a layer picker leaves out (e.g. the layer being edited). */
  excludeLayers?: readonly Id[];
}

export type ControlKind = "number" | "index" | "boolean" | "pulse" | "text" | "multiline" | "code" | "color" | "vector" | "anchor" | "enum" | "layer" | "asset" | "gradient" | "json" | "count";

/** Which editor a field gets. "any" fields follow their current literal. */
export function controlKind(field: Pick<InspectorField, "type" | "value" | "port" | "key">): ControlKind {
  const { type, value, port } = field;
  // A copy count (Repeat) is "any" so it can take a loop, but people type a whole number or leave it on Auto.
  if (port.subtype === "count") return "count";
  if (isLoopLiteral(value)) return "json";
  switch (type) {
    case "number":
      return "number";
    case "index":
      return "index";
    case "boolean":
      return "boolean";
    case "pulse":
      return "pulse";
    case "text":
      return port.subtype === "code" ? "code" : port.subtype === "multiline" ? "multiline" : "text";
    case "enum":
      return port.enumOptions?.length ? "enum" : "text";
    case "color":
      return "color";
    case "point":
    case "size":
    case "point3d":
    case "point4d":
      return "vector";
    case "anchor":
      return "anchor";
    case "layer":
      return "layer";
    case "image":
    case "video":
    case "sound":
      return "asset";
    case "gradient":
      return "gradient";
    case "shape":
      return "code";
    case "json":
      return isAssetInput(value) || field.key === "animation" ? "asset" : "json";
    case "any":
      if (typeof value === "number") return "number";
      if (typeof value === "boolean") return "boolean";
      if (typeof value === "string") return "text";
      if (Array.isArray(value) && value.length >= 2 && value.length <= 4) return "vector";
      return "json";
    default:
      return "json";
  }
}

/** Controls that take the full row width under their label. */
export const STACKED_CONTROLS: ReadonlySet<ControlKind> = new Set(["multiline", "code", "gradient", "json"]);

export function ValueControl(props: ValueControlProps) {
  switch (controlKind(props.field)) {
    case "number":
      return <NumberControl {...props} />;
    case "index":
      return <NumberControl {...props} integer />;
    case "boolean":
      return <BooleanControl {...props} />;
    case "pulse":
      return <span className="sb-insp-hint">Fires only from a connection</span>;
    case "text":
      return <TextControl {...props} variant="text" />;
    case "multiline":
      return <TextControl {...props} variant="multiline" />;
    case "code":
      return <TextControl {...props} variant="code" />;
    case "color":
      return <ColorControl {...props} />;
    case "vector":
      return <VectorControl {...props} />;
    case "anchor":
      return <AnchorControl {...props} />;
    case "enum":
      return <EnumControl {...props} />;
    case "layer":
      return <LayerControl {...props} />;
    case "asset":
      return <AssetControl {...props} />;
    case "gradient":
      return <GradientControl {...props} />;
    case "json":
      return <JsonControl {...props} />;
    case "count":
      return <CountControl {...props} />;
  }
}

function NumberControl({ field, actions, label, integer = false }: ValueControlProps & { integer?: boolean }) {
  const { port } = field;
  const percent = port.subtype === "progress" && port.min === 0 && port.max === 1;
  const unit = percent ? "%" : port.subtype === "angle" ? "°" : port.subtype === "duration" ? "s" : undefined;
  const step = port.step ?? (integer ? 1 : 1);
  const precision = integer ? 0 : percent ? 1 : Math.max(2, decimalsOf(step) + 1);
  const min = integer ? Math.max(0, port.min ?? 0) : port.min;
  const fit = (n: number) => {
    let v = integer ? Math.round(n) : roundNumber(n);
    if (min !== undefined) v = Math.max(min, v);
    if (port.max !== undefined) v = Math.min(port.max, v);
    return v;
  };
  return (
    <ScrubNumberField
      size="sm"
      aria-label={label}
      value={typeof field.value === "number" ? field.value : 0}
      mixed={field.mixed}
      min={min}
      max={port.max}
      step={step}
      scale={percent ? 100 : 1}
      unit={unit}
      precision={precision}
      onChange={(value, meta) => actions.change(field.mixed && meta.source !== "input" ? (current) => (typeof current === "number" ? fit(current + meta.delta) : current) : fit(value))}
      onCommit={() => actions.commit()}
    />
  );
}

/**
 * Repeat: a whole number of copies, or empty for Auto (one per item of the longest loop on the
 * layer's own properties). Auto shows like a mixed value: no number, and scrubbing starts from 0.
 * Reset to Default goes back to Auto; linking a loop makes one copy per item.
 */
function CountControl({ field, actions, label }: ValueControlProps) {
  const auto = field.value === null || typeof field.value !== "number";
  const fit = (n: number) => Math.min(MAX_REPEAT, Math.max(0, Math.round(n)));
  return (
    <ScrubNumberField
      size="sm"
      aria-label={label}
      value={auto ? 0 : (field.value as number)}
      mixed={field.mixed || auto}
      placeholder={field.mixed ? "Mixed" : "Auto"}
      min={0}
      max={MAX_REPEAT}
      step={1}
      precision={0}
      onChange={(value) => actions.change(fit(value))}
      onCommit={() => actions.commit()}
    />
  );
}

function BooleanControl({ field, actions, label }: ValueControlProps) {
  if (field.mixed) return <Checkbox aria-label={`${label} (mixed)`} checked={false} indeterminate onChange={() => actions.set(true)} />;
  return <Toggle size="sm" aria-label={label} checked={field.value === true} onChange={(checked) => actions.set(checked)} />;
}

function TextControl({ field, actions, label, variant }: ValueControlProps & { variant: "text" | "multiline" | "code" }) {
  const text = typeof field.value === "string" ? field.value : field.value === null ? "" : String(field.value);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (field.mixed ? "" : text);
  const placeholder = field.mixed ? "Mixed" : field.type === "shape" ? "M0 0 L100 0 L100 100 Z" : undefined;
  const commit = (next: string) => {
    setDraft(null);
    if (!field.mixed && next === text) return;
    actions.set(field.type === "shape" && next.trim() === "" ? null : next);
  };
  if (variant === "text") {
    return (
      <TextField
        size="sm"
        aria-label={label}
        value={shown}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft !== null && commit(draft)}
        onCommit={commit}
        onCancel={() => setDraft(null)}
      />
    );
  }
  return (
    <TextArea
      aria-label={label}
      mono={variant === "code"}
      rows={variant === "code" ? 5 : 3}
      value={shown}
      placeholder={placeholder}
      className="sb-insp-textarea"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== null && commit(draft)}
      onCommit={commit}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || draft === null) return;
        event.preventDefault();
        event.stopPropagation();
        setDraft(null);
      }}
    />
  );
}

function ColorControl({ field, actions, label }: ValueControlProps) {
  return (
    <ColorField
      size="sm"
      aria-label={label}
      value={typeof field.value === "string" ? field.value : "#000000FF"}
      mixed={field.mixed}
      pickerPlacement="left-start"
      onChange={(hex) => actions.change(hex)}
      onCommit={(hex) => {
        actions.change(hex);
        actions.commit();
      }}
    />
  );
}

const VECTOR_LABELS: Readonly<Record<string, readonly string[]>> = {
  padding: ["T", "R", "B", "L"],
  cornerRadii: ["TL", "TR", "BR", "BL"],
};

function VectorControl({ field, actions, label }: ValueControlProps) {
  const [proportional, setProportional] = useState(false);
  const size = vectorSize(field.type) ?? (Array.isArray(field.value) ? field.value.length : 2);
  const vec = Array.isArray(field.value) ? (field.value as number[]) : null;
  if (!vec) {
    return (
      <Button size="sm" variant="ghost" icon={<Plus size={13} />} className="sb-insp-add" onClick={() => actions.set(new Array<number>(size).fill(0))}>
        Add {label}
      </Button>
    );
  }
  const literals = field.targets.map(literalValue);
  const mixed = vec.map((_, i) => literals.some((v) => !Array.isArray(v) || v[i] !== vec[i]));
  const step = field.port.step ?? (field.type === "anchor" ? 0.01 : 1);
  return (
    <VectorField
      size="sm"
      aria-label={label}
      value={vec}
      labels={VECTOR_LABELS[field.key] ?? (field.type === "size" ? ["W", "H"] : undefined)}
      min={field.port.min}
      max={field.port.max}
      step={step}
      precision={step < 1 ? 2 : 3}
      mixed={mixed}
      proportional={proportional}
      onProportionalChange={field.type === "size" ? setProportional : undefined}
      onChange={(next, meta) =>
        actions.change(field.targets.length === 1 ? next : updateVectorComponent(meta.component, next[meta.component] ?? 0, meta.delta, (mixed[meta.component] ?? false) && meta.source !== "input"))
      }
      onCommit={() => actions.commit()}
    />
  );
}

const ANCHOR_POINTS: readonly [number, number, string][] = [
  [0, 0, "Top left"],
  [0.5, 0, "Top"],
  [1, 0, "Top right"],
  [0, 0.5, "Left"],
  [0.5, 0.5, "Center"],
  [1, 0.5, "Right"],
  [0, 1, "Bottom left"],
  [0.5, 1, "Bottom"],
  [1, 1, "Bottom right"],
];

function AnchorControl(props: ValueControlProps) {
  const { field, actions, label } = props;
  const vec = Array.isArray(field.value) ? field.value : [0, 0];
  const index = field.mixed ? -1 : ANCHOR_POINTS.findIndex(([x, y]) => x === vec[0] && y === vec[1]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Math.max(0, index);
    const row = Math.floor(current / 3);
    const col = current % 3;
    let next: number;
    if (event.key === "ArrowRight") next = row * 3 + Math.min(2, col + 1);
    else if (event.key === "ArrowLeft") next = row * 3 + Math.max(0, col - 1);
    else if (event.key === "ArrowDown") next = Math.min(2, row + 1) * 3 + col;
    else if (event.key === "ArrowUp") next = Math.max(0, row - 1) * 3 + col;
    else return;
    event.preventDefault();
    const point = ANCHOR_POINTS[next]!;
    actions.set([point[0], point[1]]);
  };
  return (
    <div className="sb-insp-anchor">
      <div role="radiogroup" aria-label={`${label} presets`} tabIndex={0} className="sb-insp-anchor__grid" onKeyDown={onKeyDown}>
        {ANCHOR_POINTS.map(([x, y, name], i) => (
          <button key={name} type="button" role="radio" tabIndex={-1} aria-checked={i === index} aria-label={name} className="sb-insp-anchor__point" data-selected={i === index || undefined} onClick={() => actions.set([x, y])} />
        ))}
      </div>
      <VectorControl {...props} />
    </div>
  );
}

function EnumControl({ field, actions, label }: ValueControlProps) {
  const options = field.port.enumOptions ?? [];
  const value = typeof field.value === "string" ? field.value : "";
  const compact = options.length <= 4 && options.reduce((n, o) => n + o.name.length, 0) <= 22;
  if (compact) {
    return (
      <SegmentedControl
        size="sm"
        fullWidth
        aria-label={label}
        value={field.mixed ? "" : value}
        options={options.map((o) => ({ value: o.key, label: o.name, ...(o.description ? { tooltip: o.description } : {}) }))}
        onChange={(next) => actions.set(next)}
      />
    );
  }
  return (
    <Select
      size="sm"
      aria-label={label}
      className="sb-insp-select"
      value={field.mixed ? null : value}
      mixed={field.mixed}
      options={options.map((o) => ({ value: o.key, label: o.name, ...(o.description ? { description: o.description } : {}) }))}
      onChange={(next) => actions.set(next)}
    />
  );
}

function LayerControl({ field, actions, label, excludeLayers = [] }: ValueControlProps) {
  const component = useCurrentComponent();
  const options: SelectOption[] = [
    { value: "", label: "None" },
    ...allLayers(component?.layers ?? [])
      .filter((l) => !excludeLayers.includes(l.id))
      .map((l): SelectOption => ({ value: l.id, label: l.name, icon: <LayerTypeIcon type={l.type} size={13} />, keywords: [l.id, l.type] })),
  ];
  const value = isLayerInput(field.value) ? field.value.layer : "";
  return (
    <Select
      size="sm"
      aria-label={label}
      className="sb-insp-select"
      placeholder="Pick a layer"
      value={field.mixed ? null : value}
      mixed={field.mixed}
      options={options}
      searchPlaceholder="Search layers…"
      onChange={(next) => actions.set(next ? { layer: next } : null)}
    />
  );
}

const URL_OPTION = "__url";
const IMPORT_OPTION = "__import";

export interface AssetFieldImport {
  /** A file is being read and imported. */
  importing: boolean;
  /** Import a file as an asset and set the field to it; problems show as a toast. */
  importFile: (file: File) => Promise<FieldImportResult>;
}

/** Import files into an asset field (the picker's Import File… and files dropped on the row). */
export function useAssetFieldImport(field: InspectorField, actions: FieldActions): AssetFieldImport {
  const session = useEditorSession();
  const [importing, setImporting] = useState(false);
  const latest = useLatest({ field, actions });
  const importFile = useCallback(
    async (file: File): Promise<FieldImportResult> => {
      const { field: current } = latest.current;
      setImporting(true);
      // Importing the file and setting the field undo together.
      const coalesceKey = `inspector-import:${current.key}:${Date.now()}`;
      let result: FieldImportResult;
      try {
        result = await importAssetForField(session, file, assetKindsFor(current.type), current.port.name, { coalesceKey });
      } catch (err) {
        result = { ok: false, error: `Couldn't import “${file.name}”: ${err instanceof Error ? err.message : String(err)}` };
      }
      setImporting(false);
      if (result.ok) latest.current.actions.set({ asset: result.assetId }, { coalesceKey });
      else toast({ id: "inspector-import", title: result.error, tone: "warn" });
      return result;
    },
    [session, latest],
  );
  return { importing, importFile };
}

function AssetControl({ field, actions, label }: ValueControlProps) {
  const session = useEditorSession();
  const assets = useDocument((s) => s.doc.assets);
  const fileRef = useRef<HTMLInputElement>(null);
  const { importing, importFile } = useAssetFieldImport(field, actions);
  const kinds = assetKindsFor(field.type);
  const noun = KIND_NOUNS[kinds[0] ?? "image"];
  const list = Object.values(assets)
    .filter((a) => kinds.includes(a.kind))
    .sort((a, b) => a.name.localeCompare(b.name));
  const url = typeof field.value === "string" ? field.value : null;
  const [urlMode, setUrlMode] = useState(url !== null);
  const value = field.mixed ? null : isAssetInput(field.value) ? field.value.asset : url !== null || urlMode ? URL_OPTION : "";
  const chooseFile = () => fileRef.current?.click();
  const options: SelectOption[] = [
    { value: "", label: "None" },
    ...list.map(
      (a): SelectOption => ({
        value: a.id,
        label: a.name,
        description: a.width && a.height ? `${a.width}×${a.height}` : a.kind,
        icon: a.kind === "image" ? <AssetThumb url={session.resolveAssetUrl(a.id)} /> : undefined,
        keywords: [a.file, a.id],
      }),
    ),
    { value: IMPORT_OPTION, label: "Import File…", description: `Choose ${noun} from your computer`, icon: <Upload size={13} />, keywords: ["upload", "add", "file"] },
    { value: URL_OPTION, label: "Web Address…", description: "Load it from a URL" },
  ];
  return (
    <div className="sb-insp-stack">
      <Select
        size="sm"
        aria-label={label}
        className="sb-insp-select"
        value={value}
        mixed={field.mixed}
        options={options}
        onChange={(next) => {
          if (next === IMPORT_OPTION) {
            chooseFile();
            return;
          }
          if (next === URL_OPTION) {
            setUrlMode(true);
            return;
          }
          setUrlMode(false);
          actions.set(next ? { asset: next } : null);
        }}
      />
      <input
        ref={fileRef}
        type="file"
        hidden
        tabIndex={-1}
        accept={acceptAttribute(kinds)}
        aria-label={`Import a file for ${label}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importFile(file);
        }}
      />
      {value === URL_OPTION && <UrlField initial={url ?? ""} label={label} onCommit={(text) => actions.set(text.trim() ? text.trim() : null)} />}
      {value === "" && (
        <button type="button" className="sb-insp-dropzone" disabled={importing} aria-busy={importing || undefined} onClick={chooseFile}>
          <Upload size={13} strokeWidth={1.75} aria-hidden />
          <span className="sb-insp-dropzone__text">
            <span className="sb-insp-dropzone__title">{importing ? "Importing…" : `Import ${noun}…`}</span>
            {!importing && <span className="sb-insp-dropzone__meta">or drop a file here</span>}
          </span>
        </button>
      )}
      {importing && value !== "" && <p className="sb-insp-hint">Importing…</p>}
    </div>
  );
}

function AssetThumb({ url }: { url: string | undefined }) {
  return url ? <img className="sb-insp-thumb" src={url} alt="" draggable={false} /> : <ImageIcon size={13} aria-hidden />;
}

function UrlField({ initial, label, onCommit }: { initial: string; label: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    setDraft(null);
    if (text !== initial) onCommit(text);
  };
  return (
    <TextField
      size="sm"
      mono
      aria-label={`${label} web address`}
      placeholder="https://…"
      value={draft ?? initial}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft !== null && commit(draft)}
      onCommit={commit}
      onCancel={() => setDraft(null)}
    />
  );
}

type GradientData = GradientLiteral["gradient"];
type Stop = [number, string];

const BLACK: Color = { r: 0, g: 0, b: 0, a: 1 };
const DEFAULT_GRADIENT: GradientData = { kind: "linear", stops: [[0, "#FFFFFFFF"], [1, "#000000FF"]], start: [0.5, 0], end: [0.5, 1] };

const cssColorOf = (hex: string) => toCssColor(parseHexColor(hex) ?? BLACK);
const sortedStops = (stops: readonly Stop[]) => [...stops].sort((a, b) => a[0] - b[0]);

/** A left-to-right CSS preview of a gradient's stops. */
export function gradientPreviewCss(gradient: GradientData): string {
  const stops = sortedStops(gradient.stops);
  return `linear-gradient(90deg, ${stops.map(([offset, color]) => `${cssColorOf(color)} ${roundNumber(offset * 100, 2)}%`).join(", ")})`;
}

/** The color a gradient shows at `offset` (for new stops). */
export function colorAtOffset(stops: readonly Stop[], offset: number): string {
  const sorted = sortedStops(stops);
  if (sorted.length === 0) return "#000000FF";
  if (offset <= sorted[0]![0]) return sorted[0]![1];
  for (let i = 1; i < sorted.length; i++) {
    const [o0, c0] = sorted[i - 1]!;
    const [o1, c1] = sorted[i]!;
    if (offset > o1) continue;
    const t = o1 === o0 ? 0 : (offset - o0) / (o1 - o0);
    const a = parseHexColor(c0) ?? BLACK;
    const b = parseHexColor(c1) ?? BLACK;
    return toHex8({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a + (b.a - a.a) * t });
  }
  return sorted.at(-1)![1];
}

function GradientControl({ field, actions, label }: ValueControlProps) {
  const [active, setActive] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const gradient = isGradientLiteral(field.value) ? field.value.gradient : null;
  if (!gradient) {
    return (
      <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => actions.set({ gradient: DEFAULT_GRADIENT })}>
        Add Gradient
      </Button>
    );
  }
  const stops = gradient.stops as Stop[];
  const index = Math.max(0, Math.min(active, stops.length - 1));
  const stop = stops[index] ?? [0, "#000000FF"];
  const write = (patch: Partial<GradientData>, continuous = false) => {
    const value: GradientLiteral = { gradient: { ...gradient, ...patch } };
    if (continuous) actions.change(value);
    else actions.set(value);
  };
  const setStop = (i: number, next: Stop, continuous: boolean) => write({ stops: stops.map((s, j) => (j === i ? next : s)) }, continuous);
  const addStop = (offset: number) => {
    const o = roundNumber(offset, 4);
    write({ stops: [...stops, [o, colorAtOffset(stops, o)]] });
    setActive(stops.length);
  };
  const removeStop = (i: number) => {
    if (stops.length <= 2) return;
    write({ stops: stops.filter((_, j) => j !== i) });
    setActive(Math.max(0, i - 1));
  };
  const barWidth = () => barRef.current?.getBoundingClientRect().width ?? 0;
  return (
    <div className="sb-insp-gradient">
      <SegmentedControl
        size="sm"
        fullWidth
        aria-label={`${label} kind`}
        value={gradient.kind}
        options={[
          { value: "linear", label: "Linear" },
          { value: "radial", label: "Radial" },
          { value: "angular", label: "Angular" },
        ]}
        onChange={(kind) => write({ kind })}
      />
      <div
        ref={barRef}
        className="sb-insp-gradient__bar sb-checker"
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget && !(event.target as Element).classList.contains("sb-insp-gradient__fill")) return;
          const rect = event.currentTarget.getBoundingClientRect();
          addStop(rect.width > 0 ? clamp01((event.clientX - rect.left) / rect.width) : 0.5);
        }}
      >
        <div className="sb-insp-gradient__fill" style={{ background: gradientPreviewCss(gradient) }} />
        {stops.map((s, i) => (
          <GradientHandle
            key={i}
            stop={s}
            index={i}
            active={i === index}
            label={label}
            barWidth={barWidth}
            onSelect={() => setActive(i)}
            onMove={(offset) => setStop(i, [offset, s[1]], true)}
            onEnd={() => actions.commit()}
            onRemove={() => removeStop(i)}
          />
        ))}
      </div>
      <div className="sb-insp-gradient__stop">
        <ColorField
          size="sm"
          aria-label={`${label} stop ${index + 1} color`}
          value={stop[1]}
          pickerPlacement="left-start"
          onChange={(hex) => setStop(index, [stop[0], hex], true)}
          onCommit={(hex) => {
            setStop(index, [stop[0], hex], true);
            actions.commit();
          }}
        />
        <ScrubNumberField
          size="sm"
          aria-label={`${label} stop ${index + 1} position`}
          value={stop[0]}
          min={0}
          max={1}
          step={0.01}
          scale={100}
          unit="%"
          precision={0}
          onChange={(offset) => setStop(index, [offset, stop[1]], true)}
          onCommit={() => actions.commit()}
        />
        <IconButton size="xs" icon={<Trash size={12} />} label="Remove stop" disabled={stops.length <= 2} onClick={() => removeStop(index)} />
      </div>
      <div className="sb-insp-gradient__points">
        {(["start", "end"] as const).map((key) => (
          <div key={key} className="sb-insp-gradient__point">
            <span className="sb-insp-gradient__point-label">{key === "start" ? "Start" : "End"}</span>
            <VectorField
              size="sm"
              aria-label={`${label} ${key}`}
              value={gradient[key]}
              step={0.01}
              precision={2}
              onChange={(next) => write({ [key]: [next[0] ?? 0, next[1] ?? 0] }, true)}
              onCommit={() => actions.commit()}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

interface GradientHandleProps {
  stop: Stop;
  index: number;
  active: boolean;
  label: string;
  barWidth: () => number;
  onSelect: () => void;
  onMove: (offset: number) => void;
  onEnd: () => void;
  onRemove: () => void;
}

function GradientHandle({ stop, index, active, label, barWidth, onSelect, onMove, onEnd, onRemove }: GradientHandleProps) {
  const start = useRef({ x: 0, offset: 0 });
  const drag = usePointerDrag<HTMLButtonElement>({
    onStart: (event) => {
      start.current = { x: event.clientX, offset: stop[0] };
      onSelect();
    },
    onMove: (event) => {
      const width = barWidth();
      if (width > 0) onMove(clamp01(roundNumber(start.current.offset + (event.clientX - start.current.x) / width, 4)));
    },
    onEnd: () => onEnd(),
  });
  return (
    <button
      type="button"
      role="slider"
      aria-label={`${label} stop ${index + 1}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(stop[0] * 100)}
      className="sb-insp-gradient__handle"
      data-active={active || undefined}
      style={{ left: `${stop[0] * 100}%`, "--sb-stop-color": cssColorOf(stop[1]) } as CSSProperties}
      {...drag}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const step = event.shiftKey ? 0.1 : 0.01;
          onMove(clamp01(roundNumber(stop[0] + (event.key === "ArrowRight" ? step : -step), 4)));
          onEnd();
        } else if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          event.stopPropagation();
          onRemove();
        }
      }}
    />
  );
}

function jsonText(value: InputValue): string {
  if (value === null) return "";
  if (isJsonLiteral(value)) return JSON.stringify(value.json, null, 2);
  if (isLoopLiteral(value)) return JSON.stringify(value.loop);
  return JSON.stringify(value, null, 2);
}

function JsonControl({ field, actions, label }: ValueControlProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const loop = isLoopLiteral(field.value) ? field.value : null;
  const text = field.mixed ? "" : jsonText(field.value);
  const commit = (next: string) => {
    try {
      const parsed: unknown = next.trim() === "" ? null : JSON.parse(next);
      setInvalid(false);
      setDraft(null);
      const value: InputValue = parsed === null ? null : loop && Array.isArray(parsed) ? { loop: parsed } : encodeValue(parsed, field.type === "any" ? "json" : field.type);
      if (field.mixed || !sameInputValue(value, field.value)) actions.set(value);
    } catch {
      setInvalid(true);
    }
  };
  return (
    <div className="sb-insp-stack">
      {loop && (
        <Badge size="sm" tone="info">
          Loop · {loop.loop.length} {loop.loop.length === 1 ? "item" : "items"}
        </Badge>
      )}
      <TextArea
        aria-label={label}
        mono
        rows={3}
        invalid={invalid}
        className="sb-insp-textarea"
        placeholder={field.mixed ? "Mixed" : "null"}
        value={draft ?? text}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft !== null && commit(draft)}
        onCommit={commit}
      />
      {invalid && (
        <p className="sb-insp-hint" data-tone="danger">
          That isn't valid JSON yet. Check for missing quotes or commas.
        </p>
      )}
    </div>
  );
}

/** A read-only value (a linked property's current value, or a patch output). */
export function LiveReadout({ value, type, copies = false }: { value: unknown; type: ValueType; copies?: boolean }) {
  const color = type === "color" && isColor(value) ? toCssColor(value) : undefined;
  const text = copies ? formatCopies(value) : formatLiveValue(value, type);
  return (
    <span className="sb-insp-live sb-mono" title={text}>
      {color && (
        <span className="sb-insp-live__swatch sb-checker" aria-hidden>
          <span style={{ background: color }} />
        </span>
      )}
      <span className="sb-insp-live__text">{text}</span>
    </span>
  );
}
