/**
 * @sonobe/core contract types.
 *
 * Everything a Sonobe document can contain, every operation that can change it,
 * and the declaration shapes (specs) that describe patch and layer types.
 * See ARCHITECTURE.md §3–§4 and §6–§7. Change this file deliberately: every
 * package and the MCP surface are built against it.
 */

export type Id = string;

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

export type ValueType =
  | "number"
  | "boolean"
  | "pulse"
  | "text"
  | "color"
  | "point" // [x, y]
  | "point3d" // [x, y, z]
  | "point4d" // [a, b, c, d] (also edges, corner radii)
  | "size" // [w, h]
  | "anchor" // [x, y] in 0..1
  | "index" // integer
  | "enum" // string key
  | "json"
  | "layer"
  | "image"
  | "video"
  | "sound"
  | "gradient"
  | "shape"
  | "textStyle"
  | "layerEffect"
  | "transform" // 4x4 column-major matrix
  | "any";

/** Port-level hint for UI + docs; does not change runtime representation. */
export type ValueSubtype =
  | "progress"
  | "angle" // degrees
  | "duration" // seconds
  | "percent"
  | "distance" // points
  | "velocity"
  | "multiline"
  | "code"
  | "url";

/** Runtime color: straight RGBA in 0..1. Serialized as "#RRGGBBAA". */
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface LayerRef {
  layerId: Id;
  /** Loop instance index when the layer is replicated by a loop. */
  instance?: number;
}

export interface AssetRef {
  assetId?: Id;
  url?: string;
}

export interface GradientStop {
  offset: number;
  color: Color;
}

export interface GradientValue {
  kind: "linear" | "radial" | "angular";
  stops: GradientStop[];
  /** Normalized 0..1 in layer bounds. */
  start: [number, number];
  end: [number, number];
}

export interface ShapeValue {
  /** SVG path data in layer-local points. */
  path: string;
}

export interface TextStyleValue {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  color?: Color;
  letterSpacing?: number;
  lineHeight?: number;
  alignment?: "left" | "center" | "right" | "justify";
  decoration?: "none" | "underline" | "strikethrough";
  transform?: "none" | "uppercase" | "lowercase" | "capitalize";
}

export interface LayerEffectValue {
  kind: string; // "blur" | "colorControls" | "shadow" | "glass" | ...
  params: Record<string, number | boolean | string | Color>;
}

/** A runtime value flowing through a port (for one loop index). */
export type Value =
  | number
  | boolean
  | string
  | Color
  | number[]
  | LayerRef
  | AssetRef
  | GradientValue
  | ShapeValue
  | TextStyleValue
  | LayerEffectValue
  | null
  | unknown;

// ---------------------------------------------------------------------------
// Document encoding (what lives in component files)
// ---------------------------------------------------------------------------

/**
 * A literal as stored in a document:
 * number/boolean/string (text, enum key, color "#RRGGBBAA") or number[] (vectors).
 */
export type Literal = number | boolean | string | number[] | null;

/** Driven by a patch output, a component input ("$in.key"), or nothing else. */
export interface LinkInput {
  link: string; // "patchId.portKey" | "$in.key" | "@layerId.key" (layer output or prop)
}
export interface LayerInput {
  layer: Id;
}
export interface AssetInput {
  asset: Id;
}
export interface LoopLiteral {
  loop: Literal[];
}
export interface JsonLiteral {
  json: unknown;
}
export interface GradientLiteral {
  gradient: { kind: GradientValue["kind"]; stops: [number, string][]; start: [number, number]; end: [number, number] };
}

/** Anything that can sit on an input port or a layer property in a file. */
export type InputValue =
  | Literal
  | LinkInput
  | LayerInput
  | AssetInput
  | LoopLiteral
  | JsonLiteral
  | GradientLiteral;

export interface LayerNode {
  id: Id;
  type: string; // layer type key, e.g. "rectangle"
  name: string;
  props: Record<string, InputValue>;
  children?: LayerNode[];
  /** Editor-only flags (never affect runtime). */
  locked?: boolean;
  collapsed?: boolean;
  /** For type "componentInstance": the component id this instance renders. */
  component?: Id;
}

export interface PatchNode {
  type: string; // patch type key, e.g. "popAnimation" or "component"
  name?: string;
  /** Selected variant for type-variant patches (e.g. "number" | "point" | "color"). */
  typeParam?: string;
  /** Instance count for variadic patches (Add, Or, Option Picker, Loop Builder...). */
  inputCount?: number;
  /** Bypass: matching inputs pass through to outputs. */
  muted?: boolean;
  inputs: Record<string, InputValue>;
  /** Non-port configuration (math expression text, script file, enum options...). */
  settings?: Record<string, Literal | Record<string, unknown> | unknown[]>;
  /** For type "component": component id. */
  component?: Id;
  ui: { x: number; y: number; collapsed?: boolean; color?: string };
}

export interface CommentNode {
  id: Id;
  text: string;
  rect: [number, number, number, number]; // x, y, w, h in patch-editor space
  color?: string;
}

export interface InterfacePort {
  key: string;
  name: string;
  type: ValueType;
  default?: InputValue;
  category?: string;
  enumOptions?: string[];
  /** Inputs: whether an incoming loop replicates the component or is passed in whole. */
  loopBehavior?: "loop" | "pass";
  /** Outputs only: which inner patch output drives this port ("patch.port"). */
  link?: string;
}

export type ComponentKind = "prototype" | "layerComponent" | "patchComponent";

export interface Component {
  formatVersion: number;
  id: Id;
  name: string;
  kind: ComponentKind;
  notes?: string;
  /** Artboard/root size in points (prototype + layer components). */
  size?: [number, number];
  interface: { inputs: Record<string, InterfacePort>; outputs: Record<string, InterfacePort> };
  layers: LayerNode[];
  patches: Record<Id, PatchNode>;
  comments: CommentNode[];
  meta?: Record<string, unknown>;
}

export interface DeviceSettings {
  preset: string; // e.g. "iphone-17-pro"
  size?: [number, number]; // override screen size (points)
  orientation?: "portrait" | "landscape";
}

export interface ProjectManifest {
  formatVersion: number;
  minReaderVersion?: number;
  name: string;
  generator?: string;
  root: Id; // component id of the root prototype
  device: DeviceSettings;
  fps?: 60 | 120;
  background?: string; // "#RRGGBBAA"
  meta?: Record<string, unknown>;
}

export type AssetKind = "image" | "video" | "sound" | "font" | "lottie" | "json";

export interface AssetRecord {
  id: Id;
  kind: AssetKind;
  name: string;
  file: string; // path relative to assets/
  mime?: string;
  width?: number;
  height?: number;
  duration?: number;
  sha256?: string;
}

export interface SonobeDocument {
  project: ProjectManifest;
  components: Record<Id, Component>;
  /** Script sources keyed by file name relative to scripts/ (e.g. "js_1.js"). */
  scripts: Record<string, string>;
  assets: Record<Id, AssetRecord>;
}

// ---------------------------------------------------------------------------
// Specs: declarations for patch types and layer types
// ---------------------------------------------------------------------------

export type PatchCategory =
  | "interaction"
  | "animation"
  | "state"
  | "logic"
  | "math"
  | "loops"
  | "text"
  | "color"
  | "data"
  | "device"
  | "media"
  | "shapes"
  | "layers"
  | "utility"
  | "components"
  | "scripting";

export interface EnumOption {
  key: string;
  name: string;
  description?: string;
}

export interface PortSpec {
  key: string; // stable camelCase key, never localized
  name: string; // display label
  /** "variant" = takes the patch's typeParam type. */
  type: ValueType | "variant";
  subtype?: ValueSubtype;
  default?: Value;
  min?: number;
  max?: number;
  step?: number;
  enumOptions?: EnumOption[];
  description: string;
  /** Receives/produces the whole loop instead of per-index evaluation. */
  wholeLoop?: boolean;
  /** Hidden from UI unless connected (advanced ports). */
  advanced?: boolean;
}

export interface VariadicSpec {
  /** Expanded keys are `${key}${n}` starting at 1, e.g. value1, value2. */
  key: string;
  name: string; // expanded names `${name} ${n}`
  type: ValueType | "variant";
  default?: Value;
  min: number;
  max: number;
  defaultCount: number;
  /** First expanded index: 0 when ports map to 0-based options or loop items. Default 1. */
  startIndex?: 0 | 1;
  /** Which side repeats. Default "inputs". */
  direction?: "inputs" | "outputs";
  description: string;
}

/** Non-port configuration stored in PatchNode.settings (expression text, variable name, script file...). */
export interface SettingSpec {
  key: string;
  name: string;
  type: "text" | "number" | "boolean" | "enum" | "json";
  default: Literal | Record<string, unknown> | unknown[];
  enumOptions?: EnumOption[];
  description: string;
}

export interface PatchExample {
  title: string;
  description?: string;
  /** Outline notation snippet (see ARCHITECTURE.md §10). */
  outline: string;
}

export interface PatchSpec {
  type: string;
  name: string;
  category: PatchCategory;
  aliases?: string[];
  summary: string; // one sentence, plain language
  docs?: string; // markdown: behavior, edge cases, tips
  inputs: PortSpec[];
  outputs: PortSpec[];
  variadic?: VariadicSpec;
  /** Allowed typeParam values when any port is "variant". First is default. */
  variants?: ValueType[];
  /** Platforms where the patch functions; omitted = everywhere. */
  platforms?: ("desktop" | "web" | "mobile")[];
  /** Single-key insert shortcut in the patch editor, e.g. "A". */
  shortcut?: string;
  pairsWellWith?: string[];
  commonMistakes?: string[];
  examples?: PatchExample[];
  /** Non-port configuration (PatchNode.settings). */
  settings?: SettingSpec[];
  /** Per-variant default overrides: { color: { start: "#FFFFFFFF" } }. */
  variantDefaults?: Partial<Record<ValueType, Record<string, Value>>>;
  /** 1 = everyday essentials, 2 = breadth, 3 = hardware/platform specific. */
  tier?: 1 | 2 | 3;
  status?: "supported" | "web-limited" | "unsupported-web";
  statusReason?: string;
  /** Compatibility mapping for importers and docs. */
  origami?: { id?: string; name: string } | null;
  /** Evaluated every frame even without input changes (time, animation, gestures). */
  alwaysEvaluate?: boolean;
  /** Node-dependent ports (JS patch, math expression, component instance). */
  dynamicPorts?: (node: PatchNode, doc: SonobeDocument) => { inputs: PortSpec[]; outputs: PortSpec[] };
}

export type PropCategory =
  | "basics"
  | "layout"
  | "content"
  | "text"
  | "fill"
  | "stroke"
  | "shadow"
  | "transform"
  | "filters"
  | "interaction";

export interface PropSpec extends PortSpec {
  category: PropCategory;
  /** Can be driven by a link / animated. Defaults to true. */
  bindable?: boolean;
}

export interface LayerTypeSpec {
  type: string;
  name: string;
  category: "basic" | "shape" | "media" | "container" | "advanced" | "component";
  summary: string;
  docs?: string;
  props: PropSpec[];
  /** Read-only outputs a patch can read (e.g. video currentTime). */
  outputs?: PortSpec[];
  canHaveChildren: boolean;
  origami?: { id?: string; name: string };
}

export interface Registry {
  patches: Map<string, PatchSpec>;
  layers: Map<string, LayerTypeSpec>;
}

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

/**
 * Port / property address strings:
 *   "patchId.portKey"   patch port
 *   "@layerId.propKey"  layer property
 *   "$in.key"           component published input (source side)
 *   "$out.key"          component published output (target side)
 */
export type PortAddress = string;

export interface NewLayer {
  /** Temp reference usable by later ops in the same batch as "$ref". */
  ref?: string;
  id?: Id;
  type: string;
  name?: string;
  props?: Record<string, InputValue>;
  children?: NewLayer[];
  component?: Id;
}

export interface NewPatch {
  ref?: string;
  id?: Id;
  type: string;
  name?: string;
  typeParam?: string;
  inputCount?: number;
  inputs?: Record<string, InputValue>;
  settings?: PatchNode["settings"];
  component?: Id;
  ui?: { x: number; y: number };
}

interface OpBase {
  /** Target component; defaults to ApplyOptions.defaultComponent or project.root. */
  component?: Id;
}

export type Op =
  | (OpBase & { op: "addLayer"; parent?: Id | null; index?: number; layer: NewLayer })
  | (OpBase & {
      op: "updateLayer";
      id: Id;
      /** null removes the prop (reset to default). */
      props?: Record<string, InputValue | null>;
      name?: string;
      locked?: boolean;
      collapsed?: boolean;
    })
  | (OpBase & { op: "moveLayer"; id: Id; parent?: Id | null; index?: number })
  | (OpBase & { op: "removeLayer"; id: Id })
  | (OpBase & { op: "addPatch"; patch: NewPatch })
  | (OpBase & {
      op: "updatePatch";
      id: Id;
      name?: string;
      /** null clears the field. */
      typeParam?: string | null;
      inputCount?: number | null;
      muted?: boolean;
      settings?: PatchNode["settings"];
      ui?: Partial<PatchNode["ui"]>;
    })
  | (OpBase & { op: "removePatch"; id: Id })
  /** Set a literal (or link object) on a patch input or layer prop. null resets to default. */
  | (OpBase & { op: "setInput"; target: PortAddress; value: InputValue | null })
  | (OpBase & { op: "connect"; from: PortAddress; to: PortAddress })
  | (OpBase & { op: "disconnect"; to: PortAddress })
  | (OpBase & { op: "rename"; id: Id; name: string })
  | (OpBase & { op: "addComment"; comment: Omit<CommentNode, "id"> & { id?: Id; ref?: string } })
  | (OpBase & { op: "updateComment"; id: Id; text?: string; rect?: CommentNode["rect"]; color?: string })
  | (OpBase & { op: "removeComment"; id: Id })
  | {
      op: "addComponent";
      component: Partial<Component> & { name: string; kind: ComponentKind };
      ref?: string;
    }
  | { op: "removeComponent"; id: Id }
  /** Move the given layers + patches out of `component` into a new component and leave an instance. */
  | (OpBase & {
      op: "createComponent";
      name: string;
      layerIds?: Id[];
      patchIds?: Id[];
      ref?: string;
    })
  | {
      op: "updateInterface";
      component: Id;
      inputs?: Record<string, InterfacePort | null>;
      outputs?: Record<string, InterfacePort | null>;
    }
  | (OpBase & { op: "updateComponent"; id: Id; name?: string; notes?: string | null; size?: [number, number] | null })
  | { op: "setScript"; file: string; source: string | null }
  | { op: "addAsset"; asset: AssetRecord }
  | { op: "removeAsset"; id: Id }
  | { op: "setProject"; changes: { [K in keyof Omit<ProjectManifest, "formatVersion">]?: ProjectManifest[K] | null } };

export type OpKind = Op["op"];

// ---------------------------------------------------------------------------
// Errors, diagnostics, results
// ---------------------------------------------------------------------------

export interface Suggestion {
  description: string;
  ops?: Op[];
}

export interface SonobeError {
  code: string; // e.g. "unknown_port", "type_mismatch", "not_found", "cycle"
  message: string; // human-first, actionable
  hint?: string;
  /** Where: op index in batch and/or address. */
  opIndex?: number;
  address?: string;
  suggestions?: Suggestion[];
}

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  hint?: string;
  component: Id;
  itemIds: Id[];
  port?: string;
  suggestions?: Suggestion[];
}

export interface OpResult {
  index: number;
  ok: boolean;
  error?: SonobeError;
  /** Ids created or touched by this op. */
  ids?: Id[];
}

export interface Affected {
  components: Id[];
  layers: Id[];
  patches: Id[];
}

export interface ApplyOptions {
  registry: Registry;
  /** Default true: any failing op rolls back the whole batch. */
  atomic?: boolean;
  /** Validate and compute results without producing a new document. */
  dryRun?: boolean;
  defaultComponent?: Id;
  /** Skip registry strictness (used when replaying undo/redo onto documents with diagnostics). */
  lenient?: boolean;
  /** Ids that must not be generated (e.g. soft-deleted items in the trash). */
  reservedIds?: Iterable<Id>;
}

export interface ApplyResult {
  ok: boolean;
  /** Resulting document (unchanged input doc when !ok && atomic, or dryRun). */
  doc: SonobeDocument;
  results: OpResult[];
  errors: SonobeError[];
  /** "$ref" / ref name → assigned id. */
  idMap: Record<string, Id>;
  /** Ops that undo this batch when applied to the resulting doc. */
  inverse: Op[];
  /** The resolved ops actually applied (refs replaced by ids) — store these for redo. */
  applied: Op[];
  /** dryRun only: the would-be document. */
  preview?: SonobeDocument;
  affected: Affected;
}

export interface Author {
  kind: "human" | "agent";
  name: string; // "You", "Claude", client name...
}

export interface HistoryEntry {
  txnId: string;
  label: string;
  author: Author;
  revision: number;
  ops: Op[];
  inverse: Op[];
  timestamp: number;
}
