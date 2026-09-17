/**
 * @sonobe/engine contract types: patch definitions (spec + evaluator),
 * the per-evaluation context, runtime services, input events, scene frames,
 * and the Runtime API. See ARCHITECTURE.md §5–§6.
 */

import type {
  Color,
  Id,
  LayerRef,
  PatchNode,
  PatchSpec,
  Registry,
  SonobeDocument,
  Value,
} from "@sonobe/core";

// ---------------------------------------------------------------------------
// Loops
// ---------------------------------------------------------------------------

/**
 * A loop (Origami "indexed values"): a tagged array flowing on a cable.
 * core.decodeInput returns literal loops as { loop: true, items }; the runtime converts them to Loop.
 */
export interface Loop<T = Value> {
  readonly __loop: true;
  readonly items: readonly T[];
}

// ---------------------------------------------------------------------------
// Patch definitions
// ---------------------------------------------------------------------------

export interface PatchDefinition<S = any> extends PatchSpec {
  /** Create per-instance state (called once per patch × loop index). */
  state?: () => S;
  /**
   * Called once per frame per loop index (or once per frame with whole loops
   * when any port is `wholeLoop`). Must be deterministic given ctx.
   */
  evaluate: (ctx: PatchContext<S>) => void;
  /** Called when the prototype restarts or the patch is removed. */
  dispose?: (state: S, ctx: RuntimeServices) => void;
}

export interface PatchContext<S = any> {
  readonly id: Id;
  readonly node: PatchNode;
  readonly componentPath: string; // "main" or "main/card_instance" for nested components
  readonly frame: number;
  /** Seconds since prototype start. */
  readonly time: number;
  /** Seconds since previous frame (fixed in simulation, capped at 0.064 live). */
  readonly dt: number;
  readonly loopIndex: number;
  readonly loopCount: number;
  readonly typeParam: string | undefined;
  readonly inputCount: number;
  /** Per instance × loop index; mutate freely. */
  state: S;
  /** Current value for this loop index, coerced to the port's declared type. */
  input<T = Value>(key: string): T;
  /** Whole loop for wholeLoop ports (scalars arrive as 1-item arrays). */
  inputItems<T = Value>(key: string): readonly T[];
  /** True if the input is driven by a link (vs literal/default). */
  isConnected(key: string): boolean;
  /** True on the frame a pulse arrives OR a boolean input rises false→true. */
  pulsed(key: string): boolean;
  /** Value changed since last frame for this loop index. */
  changed(key: string): boolean;
  output(key: string, value: Value): void;
  /** Emit a one-frame pulse on a pulse output. */
  pulse(key: string): void;
  /** Keep evaluating next frame even if nothing changes (animations in flight). */
  requestNextFrame(): void;
  readonly services: RuntimeServices;
}

// ---------------------------------------------------------------------------
// Runtime services (platform/engine capabilities available to patches)
// ---------------------------------------------------------------------------

export interface PointerSnapshot {
  /** Pointer is currently pressed and its press began on (or bubbled to) this layer. */
  down: boolean;
  /** Press began this frame. */
  began: boolean;
  /** Press ended this frame (inside or outside). */
  ended: boolean;
  /** Released inside the layer this frame without moving beyond slop (10pt). */
  tapped: boolean;
  /** Current (or last, on the release frame) pointer position in prototype coordinates. */
  position: [number, number];
  /** Position relative to layer top-left. */
  localPosition: [number, number];
  startPosition: [number, number];
  translation: [number, number];
  /** Smoothed velocity in points/second. */
  velocity: [number, number];
  /** Pointer is over the layer (hover; desktop only). */
  hovering: boolean;
  pointerCount: number;
}

export interface KeyboardSnapshot {
  pressed: ReadonlySet<string>;
  /** Keys that went down this frame. */
  downThisFrame: ReadonlySet<string>;
  upThisFrame: ReadonlySet<string>;
  text: string; // characters typed this frame
}

export interface LayerInfoSnapshot {
  enabled: boolean;
  position: [number, number];
  size: [number, number];
  scale: [number, number];
  anchor: [number, number];
  parent: Id | null;
  /** Content size for scrollable / auto-sized groups. */
  contentSize: [number, number];
}

export interface DeviceInfo {
  preset: string;
  screenSize: [number, number];
  screenScale: number;
  safeArea: [number, number, number, number]; // top, right, bottom, left
  orientation: "portrait" | "landscape";
  darkMode: boolean;
  platform: "desktop" | "web" | "mobile";
}

export interface RuntimeServices {
  /** Seeded deterministic random in [0, 1). */
  random(): number;
  /** Wall-clock epoch ms (deterministic in simulation). */
  now(): number;
  pointer(layer: LayerRef | null): PointerSnapshot;
  keyboard(): KeyboardSnapshot;
  wheel(): { delta: [number, number]; position: [number, number]; velocity: [number, number] };
  /** Previous frame's resolved layer geometry. */
  layerInfo(layer: LayerRef): LayerInfoSnapshot | undefined;
  device(): DeviceInfo;
  log(level: "log" | "warn" | "error", ...args: unknown[]): void;
  restart(): void;
  resolveAssetUrl(assetId: Id): string | undefined;
  /** Platform extensions (network, audio, speech, motion...). Undefined when unsupported. */
  platform: PlatformServices;
}

export interface PlatformServices {
  fetch?: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  openUrl?: (url: string) => void;
  speak?: (text: string, opts?: { rate?: number; pitch?: number; voice?: string }) => void;
  vibrate?: (pattern: number | number[]) => void;
  deviceMotion?: () => { acceleration: [number, number, number]; rotationRate: [number, number, number]; attitude: [number, number, number] } | undefined;
  audio?: {
    play(key: string, assetId: Id, opts: { loop?: boolean; volume?: number; rate?: number }): void;
    stop(key: string): void;
    currentTime(key: string): number;
  };
}

// ---------------------------------------------------------------------------
// Input events
// ---------------------------------------------------------------------------

export type InputEvent =
  | {
      kind: "pointer";
      /** "leave" = the pointer left the viewer (ends hover). */
      phase: "down" | "move" | "up" | "cancel" | "leave";
      pointerId: number;
      /** Input device; hover semantics and slop differ for touch. */
      pointerType?: "mouse" | "touch" | "pen";
      /** Event time in ms (same clock as frames); improves velocity estimates. */
      timeStamp?: number;
      /** Prototype coordinates (points, origin top-left of root). */
      x: number;
      y: number;
      button?: number;
      pressure?: number;
    }
  | { kind: "wheel"; x: number; y: number; dx: number; dy: number }
  | {
      kind: "key";
      phase: "down" | "up";
      key: string;
      code?: string;
      shift?: boolean;
      alt?: boolean;
      meta?: boolean;
      ctrl?: boolean;
    }
  /** key = SceneNode key for looped / component-instanced fields. */
  | { kind: "text"; layerId: Id; key?: string; value: string }
  | { kind: "focus"; layerId: Id; key?: string; focused: boolean }
  | { kind: "submit"; layerId: Id; key?: string }
  | { kind: "deviceMotion"; acceleration: [number, number, number]; rotationRate: [number, number, number] }
  | { kind: "orientation"; orientation: "portrait" | "landscape" };

// ---------------------------------------------------------------------------
// Scene frame (engine → renderer)
// ---------------------------------------------------------------------------

export interface SceneNode {
  /** Stable key: layerId, "layerId#3" for loop instances, "instanceId/innerId" inside components. */
  key: string;
  layerId: Id;
  type: string;
  parentKey: string | null;
  /** Local frame relative to parent's top-left (after layout), in points. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Local transform relative to the parent's top-left, INCLUDING translation to (x, y) and pivot math:
   * T(x,y)·T(pivot)·R·S·T(-pivot), 4x4 column-major. Renderers apply it as-is with transform-origin 0 0.
   */
  transform: number[];
  /** Maps node-local points (origin top-left, bounds [0,width]×[0,height]) to prototype coordinates. */
  worldTransform: number[];
  /** Stacking/depth among siblings (higher is in front). */
  zPosition?: number;
  opacity: number;
  visible: boolean;
  clip: boolean;
  /** Resolved drawable props for this type (color, cornerRadius, text, image...). */
  props: Record<string, Value>;
  children: SceneNode[];
}

export interface SceneFrame {
  frame: number;
  time: number;
  size: [number, number];
  background: Color;
  /** Root-level nodes back → front. */
  roots: SceneNode[];
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export interface TextMeasurer {
  measure(
    text: string,
    style: {
      fontFamily: string;
      fontSize: number;
      fontWeight: number;
      letterSpacing: number;
      lineHeight: number;
      italic?: boolean;
      textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
    },
    maxWidth: number | null,
  ): { width: number; height: number };
}

export interface RuntimeOptions {
  registry: EngineRegistry;
  textMeasurer?: TextMeasurer;
  seed?: number;
  /** Simulation mode uses a fixed dt = 1/fps and deterministic now(). */
  fps?: 60 | 120;
  deterministic?: boolean;
  platform?: PlatformServices;
  resolveAssetUrl?: (assetId: Id) => string | undefined;
  onLog?: (level: "log" | "warn" | "error", args: unknown[]) => void;
  /** Starting device info overrides. */
  device?: Partial<DeviceInfo>;
}

export interface EngineRegistry extends Registry {
  definitions: Map<string, PatchDefinition>;
}

export interface TraceSummary {
  min: number;
  max: number;
  start: number;
  end: number;
  /** Seconds until the value stayed within 0.1% of its final value. */
  settleTime: number | null;
  overshoot: number;
}

export interface TraceResult {
  targets: string[];
  /** Columnar: times[i] with values[target][i]. */
  times: number[];
  values: Record<string, Value[]>;
  summaries: Record<string, TraceSummary | null>;
}

export interface RuntimeIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  patchId?: Id;
  layerId?: Id;
}

export interface Runtime {
  readonly frame: number;
  readonly time: number;
  /** Queue input events for the next step. */
  dispatch(events: InputEvent[]): void;
  /** Advance one frame (dt ignored in deterministic mode) and return the scene. */
  step(dt?: number): SceneFrame;
  /** Last produced frame (step() once if none). */
  scene(): SceneFrame;
  /** Read a value: "patchId.port" | "@layerId.prop" (current frame, loop index 0 unless "#n"). */
  getValue(address: string): Value;
  /** Swap in an edited document, keeping state for patches whose type is unchanged. */
  updateDocument(doc: SonobeDocument): void;
  restart(): void;
  /** Hit test in prototype coordinates; front-most first, with bubbling chain. */
  hitTest(x: number, y: number): { key: string; layerId: Id }[];
  /** Report DOM-measured layer outputs (image naturalSize/loading, video currentTime/duration...) by SceneNode key. */
  setLayerOutputs(key: string, values: Record<string, Value>): void;
  /** Runtime issues raised while evaluating (script errors, loop limits...). */
  issues(): RuntimeIssue[];
  dispose(): void;
}
