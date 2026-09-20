/**
 * @sonobe/engine contract types: patch definitions (spec + evaluator),
 * the per-evaluation context, runtime services, input events, scene frames,
 * and the Runtime API. See ARCHITECTURE.md §5–§6.
 */

import type {
  AssetRef,
  Color,
  Id,
  LayerRef,
  Literal,
  PatchNode,
  PatchSpec,
  Registry,
  SonobeDocument,
  Suggestion,
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

/**
 * What a muted patch outputs:
 * - "bypass" (default): evaluate is skipped. Variant outputs pass the first variant input; other
 *   outputs pass the first input of the same type; ports only pass to ports of the same shape
 *   (whole-loop to whole-loop); anything unmatched emits its zero value (an empty Loop for a
 *   whole-loop output) and pulses never fire.
 * - "zero": evaluate is skipped and every output emits its zero value.
 * - "evaluate": evaluate runs as usual and the patch checks `ctx.muted` itself.
 */
export type MutedBehavior = "bypass" | "zero" | "evaluate";

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
  /** How the patch behaves while muted. Default "bypass". */
  mutedBehavior?: MutedBehavior;
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
  /**
   * The node's repeated-port count: node.inputCount clamped to the spec's VariadicSpec range
   * (else its defaultCount); for specs with `inputCountRange` instead (keyframes, gradientBuilder),
   * clamped to that range (else its defaultCount); otherwise node.inputCount ?? 0.
   */
  readonly inputCount: number;
  /** Effective mute: this patch or an enclosing component instance is muted (for mutedBehavior "evaluate"). */
  readonly muted: boolean;
  /** Per instance × loop index; mutate freely. */
  state: S;
  /** Current value for this loop index, coerced to the port's declared type. */
  input<T = Value>(key: string): T;
  /** Whole loop for wholeLoop ports (scalars arrive as 1-item arrays). */
  inputItems<T = Value>(key: string): readonly T[];
  /** True if the input is driven by a link (vs literal/default). */
  isConnected(key: string): boolean;
  /** True when the input is driven by a pulse output (vs a held state), so first-frame pulses can be told from states that start on. */
  isPulseSource(key: string): boolean;
  /** True when the input's driver evaluates later in the frame, so the input reads last frame's value (a back-edge). */
  isFeedback(key: string): boolean;
  /**
   * True on the frame a pulse arrives OR a boolean input rises false→true. Rising-edge history
   * starts off: a boolean that is already true on frame 0 (or on a new loop index) counts as rising.
   */
  pulsed(key: string): boolean;
  /** Value changed since last frame for this loop index. */
  changed(key: string): boolean;
  output(key: string, value: Value): void;
  /** Emit a one-frame pulse on a pulse output. */
  pulse(key: string): void;
  /** Keep evaluating next frame even if nothing changes (animations in flight). */
  requestNextFrame(): void;
  /** Log a warning through services.log at most once per patch instance and key until the prototype restarts. */
  warnOnce(key: string, message: string): void;
  /**
   * Say why this frame's output is an empty loop when that is probably a mistake (Loop Select with
   * every index past the end). The runtime quotes `reason` in its `empty_loop` warning when a layer
   * or component ends up with 0 copies because of it, and turns `fixes` into ready-to-apply
   * suggestions. Optional: contexts outside the runtime may not have it.
   */
  explainEmpty?(reason: string, fixes?: readonly EmptyLoopFix[]): void;
  readonly services: RuntimeServices;
}

/** A change to one of the patch's own inputs that gives its empty output items again (PatchContext.explainEmpty). */
export interface EmptyLoopFix {
  /** Input key on the same patch. */
  input: string;
  /** The literal to set, encoded as in a document (an enum option's key, "#RRGGBBAA" for a color). */
  value: Literal;
  /** The change, then what it does ("Set Out of Range to Clamp: an index past the end takes the last item"). */
  description: string;
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
  /** Every press that ended this frame was cancelled (the browser took over the gesture). */
  cancelled: boolean;
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
  /** Pressure 0–1 of the tracked pointer while down (event pressure; else 0.5 for touch and pen, 0 for mouse). 0 when not down. */
  pressure: number;
  /** DOM `buttons` bitmask (1 primary, 2 secondary, 4 middle...) of the pressed pointers on this target. 0 when none. */
  buttons: number;
  /** Input device of the tracked pointer (pressed, else hovering, else last press). */
  pointerType?: "mouse" | "touch" | "pen";
  /** A mouse or pen is over the layer, including while its button is held. Touches never hover. */
  hovering: boolean;
  pointerCount: number;
}

/** One pressed pointer (services.pointers). */
export interface PointerInfo {
  id: number;
  /** Prototype coordinates. */
  position: [number, number];
  pressure: number;
  /** Prototype time in seconds when the press began. */
  startTime: number;
  /** DOM `buttons` bitmask. */
  buttons: number;
}

export interface KeyboardSnapshot {
  pressed: ReadonlySet<string>;
  /** Keys that went down this frame. */
  downThisFrame: ReadonlySet<string>;
  upThisFrame: ReadonlySet<string>;
  text: string; // characters typed this frame
}

export interface LayerInfoSnapshot {
  /** Layer type key, e.g. "video". */
  type: string;
  enabled: boolean;
  position: [number, number];
  size: [number, number];
  scale: [number, number];
  anchor: [number, number];
  /**
   * The parent layer in the scene tree (a component instance layer for a component's top-level
   * layers), with its loop instance. The reference is scoped like the child's, so services resolve it.
   */
  parent: LayerRef | null;
  /** 4x4 column-major; maps layer-local points (origin top-left) to prototype coordinates. */
  worldTransform: number[];
  /** Content size for scrollable / auto-sized groups. */
  contentSize: [number, number];
}

export interface DeviceInfo {
  preset: string;
  screenSize: [number, number];
  screenScale: number;
  safeArea: [number, number, number, number]; // top, right, bottom, left
  orientation: "portrait" | "landscape";
  /** Physical rotation in degrees counterclockwise: 0, 90, 180, 270. Undefined when unknown. */
  orientationAngle?: number;
  darkMode: boolean;
  platform: "desktop" | "web" | "mobile";
  /** IANA time zone of the device; "UTC" in deterministic simulation. */
  timeZone: string;
}

/** Style accepted by TextMeasurer.measure and services.measureText. */
export type TextMeasureStyle = Parameters<TextMeasurer["measure"]>[1];

/** What the runtime knows about an image, video, or sound reference. */
export interface MediaInfo {
  status: "loading" | "ready" | "error";
  /** Intrinsic pixel size (0 when unknown or not visual). */
  width: number;
  height: number;
  /** Seconds (0 when unknown or not timed). */
  duration: number;
  name: string;
}

export interface RuntimeServices {
  /** Seeded deterministic random in [0, 1). */
  random(): number;
  /** Wall-clock epoch ms (deterministic in simulation). */
  now(): number;
  /** True when the runtime uses a fixed dt and a deterministic clock (simulation, trace): UTC clocks, no platform effects. */
  readonly deterministic: boolean;
  /** Restarts performed since the runtime was created (0 before the first restart). */
  readonly restartCount: number;
  pointer(layer: LayerRef | null): PointerSnapshot;
  /** Every pressed pointer whose press hit chain contains the layer (null = all), by press time then id. */
  pointers(layer: LayerRef | null): PointerInfo[];
  keyboard(): KeyboardSnapshot;
  wheel(): { delta: [number, number]; position: [number, number]; velocity: [number, number] };
  /** Previous frame's resolved layer geometry. */
  layerInfo(layer: LayerRef): LayerInfoSnapshot | undefined;
  /** A layer output (host-reported via setLayerOutputs, or derived: textSize, text field value...). Undefined when unknown. */
  layerOutput?(layer: LayerRef, key: string): Value | undefined;
  /** Status, size, duration, and name of a media reference. Undefined when the runtime knows nothing about it. */
  mediaInfo?(ref: AssetRef): MediaInfo | undefined;
  device(): DeviceInfo;
  /** Measure text with the runtime's injected TextMeasurer (same rules as Text layer layout). */
  measureText(text: string, style: TextMeasureStyle, maxWidth: number | null): { width: number; height: number };
  /** Source of scripts/<file> from the document, or undefined when it doesn't exist. */
  readScript(file: string): string | undefined;
  log(level: "log" | "warn" | "error", ...args: unknown[]): void;
  /** Raise a runtime issue attributed to the evaluating patch, deduplicated by code and message until restart. */
  issue(code: string, severity: "error" | "warning", message: string): void;
  restart(): void;
  resolveAssetUrl(assetId: Id): string | undefined;
  /** Platform extensions (network, audio, speech, motion...). Undefined when unsupported. */
  platform: PlatformServices;
}

// ---- platform services ------------------------------------------------------

/** A multipart form field; media values upload the referenced file. */
export interface FetchFormField {
  name: string;
  value: string | { assetId?: Id; url?: string; filename?: string; mime?: string };
}

export interface FetchInit {
  /** Uppercase HTTP method. Default "GET". */
  method?: string;
  headers?: Record<string, string>;
  /** Text body, or multipart form data built by the host. */
  body?: string | { form: FetchFormField[] };
  signal?: AbortSignal;
  /** Called with each chunk of response text as it arrives (streams); text() still resolves with the whole body. */
  onChunk?: (text: string) => void;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  /** Final URL after redirects. */
  url?: string;
  /** Response headers with lowercase names. */
  headers?: Record<string, string>;
  text(): Promise<string>;
}

/** A socket opened through platform.webSocket. Hosts call the handlers; patches assign them. */
export interface PlatformWebSocket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  readonly bufferedAmount?: number;
  onopen?: (() => void) | null;
  onmessage?: ((text: string) => void) | null;
  onclose?: ((code: number, reason?: string) => void) | null;
  /** Hosts report blocked or failed connections here (ws:// from https, refused...). */
  onerror?: ((message?: string) => void) | null;
}

export interface SpeechOptions {
  /** 0.1–10, 1 = normal. */
  rate?: number;
  /** 0–2, 1 = normal. */
  pitch?: number;
  voice?: string;
  /** 0–1. */
  volume?: number;
}

export interface AudioVoiceOptions {
  loop: boolean;
  /** 0–1. */
  volume: number;
  /** Playback rate, 1 = normal. */
  rate: number;
  /** Semitones, 0 = unchanged. */
  pitch: number;
  /** -1 (left) … 1 (right). */
  pan: number;
}

export type AudioVoiceStatus = "loading" | "blocked" | "playing" | "paused" | "ended" | "error";

/** A platform voice's clock. */
export interface AudioVoiceState {
  status: AudioVoiceStatus;
  currentTime: number;
  duration: number;
  ended: boolean;
  /** Completed loop iterations. */
  loops: number;
}

/** What an audio meter listens to: a live source (microphone, player) or a layer's sound. */
export type AudioMeterSource = { live: string } | { layer: LayerRef };

export interface AudioMeterReading {
  /** 0–1. */
  rms: number;
  /** 0–1. */
  peak: number;
  /** Per-band levels 0–1, low → high. */
  bands: readonly number[];
}

/** Keyed voices: one voice per key (the patch picks keys such as "audio/main/player#0"). */
export interface AudioServices {
  play(key: string, source: AssetRef, opts: AudioVoiceOptions & { from: number }): void;
  pause(key: string): void;
  seek(key: string, seconds: number): void;
  update(key: string, opts: AudioVoiceOptions): void;
  stop(key: string): void;
  state(key: string): AudioVoiceState | undefined;
  meter?(source: AudioMeterSource, bands: number): AudioMeterReading | undefined;
}

export interface HapticServices {
  supports(type: string): boolean;
  play(type: string, pattern?: unknown): void;
}

export interface GeoFix {
  latitude: number;
  longitude: number;
  /** Meters. */
  accuracy: number;
}

export interface GeolocationServices {
  watch(onFix: (fix: GeoFix) => void, onError: (message: string) => void): { stop(): void };
}

export interface GamepadSnapshot {
  connected: boolean;
  mapping: string;
  buttons: readonly ({ pressed: boolean; value: number } | undefined)[];
  axes: readonly number[];
  motion?: { acceleration?: readonly number[]; rotationRate?: readonly number[] };
}

export interface SoftKeyboardSnapshot {
  visible: boolean;
  /** Points. */
  height: number;
  keyboardType?: string;
}

/** A connected Bluetooth LE characteristic. */
export interface BluetoothLink {
  name: string;
  canRead: boolean;
  canNotify: boolean;
  read(): Promise<Uint8Array>;
  write(bytes: Uint8Array): Promise<void>;
  setNotifications(on: boolean): Promise<void>;
  onValue(callback: (bytes: Uint8Array) => void): void;
  onDisconnect(callback: () => void): void;
  disconnect(): void;
}

export interface BluetoothServices {
  available: boolean;
  connect(options: { service: string; characteristic: string; namePrefix?: string }): Promise<BluetoothLink>;
}

export interface PickedMedia {
  kind: "image" | "video";
  image: AssetRef | null;
  video: AssetRef | null;
  width: number;
  height: number;
  name: string;
}

export interface PixelReading {
  width: number;
  height: number;
  /** RGBA bytes, row by row. */
  data: ArrayLike<number>;
  /** Changes whenever the picture changes. */
  frameId: number;
  /** The picture's own pixel size. */
  contentSize: [number, number];
  /** Where the picture sits inside the layer, in local points: [x, y, w, h]. */
  contentRect: [number, number, number, number];
}

/** Camera and microphone capture, keyed by the requesting patch instance. */
export interface MediaCaptureServices {
  /** Start a camera; resolves with a live video reference. */
  openCamera?(key: string, opts: { facing: "front" | "back"; quality: "low" | "medium" | "high" }): Promise<AssetRef>;
  /** Start a microphone; resolves with a live sound reference. */
  openMicrophone?(key: string): Promise<AssetRef>;
  /** Stop the camera or microphone opened under `key` (and any recording). */
  close(key: string): void;
  /** Capture a still image from the camera opened under `key`. */
  captureFrame?(key: string): Promise<AssetRef>;
  startRecording(key: string, opts: { audio: boolean }): void;
  /** Resolves null for clips shorter than 0.1 s. */
  stopRecording(key: string): Promise<AssetRef | null>;
  /** Microphone input level 0–1 for `key`. */
  level?(key: string): number | undefined;
  /** Changes whenever the layer's picture changes. */
  frameId?(layer: LayerRef): number | undefined;
  readPixels?(layer: LayerRef, maxSize: number): PixelReading | undefined;
}

export type DetectionPositioning = "relative" | "absolute";

export interface DetectServices {
  faces?(layer: LayerRef, opts: { maxDimension: number; positioning: DetectionPositioning }): Promise<readonly { box: [number, number, number, number]; angle?: number; leftEye?: [number, number]; rightEye?: [number, number]; mouth?: [number, number] }[]>;
  hands?(layer: LayerRef, opts: { maxHands: number; maxDimension: number; positioning: DetectionPositioning }): Promise<readonly { box?: [number, number, number, number]; handedness?: "left" | "right"; confidence?: number; landmarks: [number, number][] }[]>;
  qrCodes?(layer: LayerRef, opts: { maxDimension: number }): Promise<readonly { message: string; corners: [number, number][] }[]>;
}

/** A device motion sample: accelerations in g including gravity, rotation rates in degrees/second, attitude in degrees. */
export interface DeviceMotionSample {
  acceleration: [number, number, number];
  rotationRate: [number, number, number];
  /** Omitted when the host has no attitude (simulation). */
  attitude?: [number, number, number];
}

/** Host capabilities. Every member is optional; patches log once and output idle values when one is missing. */
export interface PlatformServices {
  fetch?: (url: string, init?: FetchInit) => Promise<FetchResponse>;
  /** Read a media reference's bytes (asset, URL, or live capture). */
  readBytes?: (ref: AssetRef) => Promise<ArrayBuffer>;
  webSocket?: (url: string, opts: { headers?: Record<string, string>; protocols?: string[] }) => PlatformWebSocket;
  /** false (or a promise resolving false) means the link didn't open. */
  openUrl?: (url: string) => void | boolean | Promise<boolean>;
  /** Hosts that track completion return a promise with how the utterance ended. */
  speak?: (text: string, opts?: SpeechOptions) => void | Promise<"ended" | "interrupted">;
  stopSpeaking?: () => void;
  vibrate?: (pattern: number | number[]) => void;
  haptic?: HapticServices;
  deviceMotion?: () => DeviceMotionSample | undefined;
  geolocation?: GeolocationServices;
  gamepads?: () => readonly (GamepadSnapshot | null)[];
  softKeyboard?: () => SoftKeyboardSnapshot | undefined;
  bluetooth?: BluetoothServices;
  audio?: AudioServices;
  /** Let the person pick photos or videos. */
  pickMedia?: (opts: { accept: "all" | "photos" | "videos"; multiple: boolean }) => Promise<readonly PickedMedia[]>;
  /** Release a blob URL or buffer the host created for a reference a patch no longer uses. */
  releaseMedia?: (ref: AssetRef) => void;
  /** Render a layer (null = the whole prototype) to an image. */
  snapshot?: (layer: LayerRef | null, opts: { scale: number }) => Promise<AssetRef>;
  media?: MediaCaptureServices;
  detect?: DetectServices;
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
      /** DOM `button` of the button that changed (0 primary, 1 middle, 2 secondary). */
      button?: number;
      /** DOM `buttons` bitmask of buttons held after the event. */
      buttons?: number;
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
  /**
   * Fire a layer's pulse property on this step, as a connection would (the editor's Inspector Fire
   * button): a Text Field's setText, beginEditing or endEditing. Other props are ignored.
   */
  | { kind: "layerPulse"; layerId: Id; key?: string; prop: string }
  | { kind: "deviceMotion"; acceleration: [number, number, number]; rotationRate: [number, number, number]; attitude?: [number, number, number] }
  /** angle = physical rotation in degrees counterclockwise (DeviceInfo.orientationAngle). */
  | { kind: "orientation"; orientation: "portrait" | "landscape"; angle?: number };

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
  /** Stacking among siblings: higher draws in front and hits first; ties keep document order (see paintOrder). */
  zPosition?: number;
  opacity: number;
  visible: boolean;
  clip: boolean;
  /**
   * Resolved drawable props for this type (color, cornerRadius, text, image...). Props whose declared
   * default is null (cornerRadii, gradient, image...) stay null while unset.
   */
  /**
   * Read props by key. Defaults are inherited from one shared object per layer (only bound values are
   * own properties), so enumerate with for...in and copy with plainProps / plainSceneFrame before
   * JSON or structured clone.
   */
  props: Record<string, Value>;
  /** Document order. Draw and hit test them in paintOrder(children) (zPosition first). */
  children: SceneNode[];
  /** Text Field only, once it holds state its props don't show: typed text, focus, or a Set Text or Begin/End Editing pulse. */
  textField?: TextFieldState;
}

/**
 * What a Text Field holds beyond its props. Renderers push `text` into the field when `textRevision`
 * changes and focus or blur it when `editRevision` changes, so no pulse has to be caught on its frame.
 */
export interface TextFieldState {
  /** What the field holds: typed, set by its Text property, or by Set Text. */
  text: string;
  /** Changes each time Set Text replaced the text (0 until it first does). */
  textRevision: number;
  /** Changes each time Begin Editing or End Editing fired (0 until one does). */
  editRevision: number;
  /** What the last of those asked for: true after Begin Editing, false after End Editing. */
  editing: boolean;
}

export interface SceneFrame {
  frame: number;
  time: number;
  size: [number, number];
  background: Color;
  /** Root-level nodes in document order. Draw and hit test them in paintOrder(roots) (zPosition first). */
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

/** Where a console line came from: the evaluating patch and its instance path. */
export interface LogSource {
  patchId?: Id;
  /** Instance path, e.g. "main" or "main/card#2". */
  componentPath?: string;
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
  /** Host knowledge about media (natural sizes, durations); consulted before the runtime's own data. */
  mediaInfo?: (ref: AssetRef) => MediaInfo | undefined;
  /** `source` is set for lines logged while a patch evaluates. */
  onLog?: (level: "log" | "warn" | "error", args: unknown[], source?: LogSource) => void;
  /** Starting device info overrides. */
  device?: Partial<DeviceInfo>;
  /** Record per-patch evaluate timings (Runtime.patchTimings). Default false. */
  profile?: boolean;
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

/** Events to dispatch during a trace, `atMs` after the trace starts. */
export interface ScheduledInput {
  atMs: number;
  events: readonly InputEvent[];
}

/** A plain InputEvent is dispatched on the first traced frame. */
export type TraceInput = InputEvent | ScheduledInput;

export interface RuntimeIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  patchId?: Id;
  layerId?: Id;
  /** Instance path of the patch when it's inside a component instance ("main/card#2"); omitted at the root. */
  componentPath?: string;
  /** What to try, in plain words. */
  hint?: string;
  /** Ready-to-apply fixes (ops for core applyOps). */
  suggestions?: Suggestion[];
}

/** What an address reads right now, with a plain-words note when it reads as missing or empty (SonobeRuntime.inspect). */
export interface ValueInspection {
  /** What getValue returns: loop item 0 unless the address ends in "#n"; undefined when nothing is there. */
  value: Value;
  /** For a layer bound to a loop: how many copies it drew last frame. For a component patch's port: how many copies of the instance ran. */
  copies?: number;
  /** Why the value is missing or empty ("Layer "Card" drew 0 copies..."), when it is. */
  note?: string;
}

/** Average evaluate time of one patch (all instances and loop indices), per frame. */
export interface PatchTiming {
  patchId: Id;
  /** Static scope path: "main", "main/card". */
  componentPath: string;
  ms: number;
}

export interface Runtime {
  /** Last produced frame; -1 before the first step and after restart. */
  readonly frame: number;
  readonly time: number;
  /** Queue input events for the next step. */
  dispatch(events: InputEvent[]): void;
  /** Advance one frame (dt ignored in deterministic mode) and return the scene. */
  step(dt?: number): SceneFrame;
  /** Last produced frame (step() once if none). */
  scene(): SceneFrame;
  /**
   * Read a value (current frame, loop index 0 unless "#n"):
   * "patchId.port" | "@layerId.prop", or inside component instances
   * "instancePath/patchId.port" | "@instancePath/layerId.prop" (instancePath like "card#2/badge"),
   * or a knob's running value, "$knob.<id>".
   */
  getValue(address: string): Value;
  /** Like getValue, but returns whole loops instead of one item. */
  getRawValue(address: string): Value | Loop | undefined;
  /**
   * Simulate `durationMs` on a deterministic clone of this runtime (same document, state reached
   * by replaying this runtime's input since its last restart) and sample `targets` every frame.
   * The live runtime is never touched and the clone performs no platform side effects.
   * Throws TraceUnavailableError (code "trace_unavailable") once the runtime has run longer than its
   * replay log (MAX_REPLAY_FRAMES since the last restart), instead of tracing a restarted copy.
   */
  trace(targets: readonly string[], durationMs: number, events?: readonly TraceInput[]): TraceResult;
  /** Swap in an edited document, keeping state for patches whose type is unchanged. */
  updateDocument(doc: SonobeDocument): void;
  /** Rebuild layout and the scene from current values (after updateDocument) without advancing time. */
  refreshScene(): void;
  restart(): void;
  /** Hit test in prototype coordinates; front-most first, with bubbling chain. */
  hitTest(x: number, y: number): { key: string; layerId: Id }[];
  /** Report DOM-measured layer outputs (image naturalSize/loading, video currentTime/duration...) by SceneNode key. */
  setLayerOutputs(key: string, values: Record<string, Value>): void;
  /** Runtime issues raised while evaluating (script errors, loop limits...). */
  issues(): RuntimeIssue[];
  /** Average evaluate time per patch over the last ~1 s, slowest first (empty when profiling is off). */
  patchTimings?(): PatchTiming[];
  dispose(): void;
}
