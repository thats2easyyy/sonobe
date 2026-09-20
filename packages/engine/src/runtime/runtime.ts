/**
 * createRuntime: the frame loop (ARCHITECTURE.md §5.1). Each step applies queued input (hit tests
 * use the previous frame's scene), evaluates patches in compiled order, resolves layers, lays them
 * out, and emits a SceneFrame. Layer geometry and replication counts become readable next frame.
 */

import {
  deviceScreenSize,
  formatAddress,
  getDevicePreset,
  parseAddress,
  parseColor,
  type AssetRef,
  type Color,
  type Id,
  type LayerRef,
  type ParsedAddress,
  type SonobeDocument,
  type Value,
} from "@sonobe/core";
import { InputTracker } from "../gestures/index.ts";
import { hitTest as hitTestScene } from "../hittest/hitTest.ts";
import { approximateTextMeasurer } from "../layout/textMeasurer.ts";
import { planeInverse } from "../math/matrix.ts";
import type {
  DeviceInfo,
  DeviceMotionSample,
  InputEvent,
  Loop,
  LogSource,
  MediaInfo,
  PatchTiming,
  PlatformServices,
  PointerSnapshot,
  Runtime,
  RuntimeIssue,
  RuntimeOptions,
  RuntimeServices,
  SceneFrame,
  TraceInput,
  TraceResult,
  TraceSummary,
  ValueInspection,
} from "../types.ts";
import { compileDocument, updateLiterals, type CompiledGraph } from "./compile.ts";
import {
  describeEmpty,
  emptyInstanceInput,
  instanceLabel,
  isSuspicious,
  traceEmpty,
  traceEmptyInstance,
  type Collapse,
  type EmptyEntry,
  type EmptyExplanation,
  type EmptyLoopEnv,
  type EmptyReport,
  type EmptyStep,
} from "./emptyLoops.ts";
import { beginInputs, createRecord, disposeRecord, evaluateRecord, type EvalEnv, type NodeRecord } from "./evaluate.ts";
import type { Binding, CLayer, CNode, CProp, InstancePath, Scope } from "./graph.ts";
import { isLoop, makeLoop, MAX_LOOP_LENGTH } from "./loop.ts";
import { mulberry32 } from "./random.ts";
import { buildScene, isCount, repeatCount, type SceneBuild } from "./scene.ts";
import { summarizeSeries } from "./trace.ts";
import { coerceValue, truthy, valuesEqual } from "./values.ts";

/** services.now() in deterministic mode: 2026-01-01T00:00:00Z plus prototype time. */
export const DETERMINISTIC_EPOCH_MS = 1_767_225_600_000;
/** Live frames are capped at this many seconds. */
export const MAX_LIVE_DT = 0.064;
/** Frames of input history kept since the last restart so trace() can clone the live state. */
export const MAX_REPLAY_FRAMES = 7_200;
/** Runtime issues kept (oldest dropped first). */
export const MAX_RUNTIME_ISSUES = 200;

/**
 * Thrown by `trace` when the runtime has run more than MAX_REPLAY_FRAMES since its last restart:
 * its input log was dropped, so no copy of the current state can be built. Restart the prototype,
 * or trace a simulation host that keeps its own log.
 */
export class TraceUnavailableError extends Error {
  readonly code = "trace_unavailable";
  /** The live runtime's frame when the trace was refused. */
  readonly frame: number;

  constructor(frame: number) {
    super(`The prototype has run for more than ${MAX_REPLAY_FRAMES} frames since it last restarted, so a copy of its current state can't be traced.`);
    this.name = "TraceUnavailableError";
    this.frame = frame;
  }
}

/** True for TraceUnavailableError, including copies that crossed a realm or lost their class. */
export function isTraceUnavailable(err: unknown): err is TraceUnavailableError {
  return err instanceof TraceUnavailableError || (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "trace_unavailable");
}

/** The engine runtime: the contract `Runtime` plus inspection members. */
export interface SonobeRuntime extends Runtime {
  readonly document: SonobeDocument;
  readonly deterministic: boolean;
  readonly fps: number;
  /** Something is still moving: a patch called requestNextFrame() during the last step, or a feedback loop's back-edge would read a different value next step. */
  readonly needsNextFrame: boolean;
  readonly services: RuntimeServices;
  /** Turn per-patch evaluate timing on or off (off discards what was collected). */
  setProfiling(on: boolean): void;
  /** Average evaluate time per patch over the last ~1 s of frames, slowest first; empty when profiling is off. */
  patchTimings(): PatchTiming[];
  /**
   * Read an address like getValue, plus what a person needs when it reads as nothing: a note saying
   * the layer drew 0 copies (and why), that "#n" is past its copies ("Card has 1 copy"), that the
   * instance path runs into a component with 0 copies, or why the value is an empty loop. Layer
   * addresses report `copies`, and reading a copied layer without "#n" says which copy it read.
   */
  inspect(address: string): ValueInspection;
}

/** Create a runtime for a document. */
export function createRuntime(doc: SonobeDocument, options: RuntimeOptions): SonobeRuntime {
  return new RuntimeImpl(doc, options);
}

type ReplayEntry =
  | { kind: "step"; dt: number; events: InputEvent[] }
  | { kind: "update"; doc: SonobeDocument }
  | { kind: "refresh" }
  | { kind: "layerOutputs"; key: string; values: Record<string, Value> };

/** A Text Field's command pulses, as bits of the commands one frame fired for one field. */
const FIELD_PULSES: Readonly<Record<string, number>> = { setText: 1, beginEditing: 2, endEditing: 4 };

/** Nodes with at least one back-edge input (their driver evaluates later in the frame). */
const feedbackNodesOf = (graph: CompiledGraph): CNode[] => graph.order.filter((n) => n.kind !== "copies" && n.feedback.some(Boolean));

interface CopiesInfo {
  paths: InstancePath[];
  replicated: boolean;
  frame: number;
}

interface ResolvedTarget {
  parsed: ParsedAddress;
  scope: Scope;
  path: InstancePath;
}

/** Where an instance path ran out: `scope` (an instance at `host`) has no copy `copy`. */
interface MissingCopy {
  scope: Scope;
  host: InstancePath;
  copy: number;
  copies: number;
}

const NO_TARGET = " none";
const SEGMENT = /^([A-Za-z_][A-Za-z0-9_]*)(?:#(\d+))?$/;

function sanitizeDt(dt: number | undefined, fps: number): number {
  const v = dt === undefined ? 1 / fps : dt;
  return Number.isFinite(v) && v > 0 ? Math.min(v, MAX_LIVE_DT) : 0;
}

function formatLogArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.message;
  if (typeof arg !== "object" || arg === null) return String(arg);
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

function hostTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function mediaName(url: string): string {
  const path = url.split(/[?#]/)[0] ?? "";
  const last = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

class RuntimeImpl implements SonobeRuntime {
  frame = -1;
  time = 0;
  document: SonobeDocument;
  readonly deterministic: boolean;
  needsNextFrame = false;
  readonly services: RuntimeServices;

  private readonly options: RuntimeOptions;
  private readonly seed: number;
  private readonly env: EvalEnv;
  private readonly input = new InputTracker();
  private readonly layerOutputs = new Map<string, Record<string, Value>>();
  private readonly runtimeIssues = new Map<string, RuntimeIssue>();
  private readonly refPrefix = new WeakMap<object, string>();
  private graph: CompiledGraph;
  private feedbackNodes: CNode[];
  private rootPath: InstancePath | null = null;
  private rootPaths: InstancePath[] = [];
  private queue: InputEvent[] = [];
  private rng: () => number;
  private produced: SceneBuild | null = null;
  private snapshot: SceneBuild | null = null;
  private copies = new WeakMap<CNode, Map<string, CopiesInfo>>();
  private restartRequested = false;
  private restarts = 0;
  private disposed = false;
  private currentPath: InstancePath | null = null;
  private currentPatch: Id | undefined;
  private orientation: DeviceInfo["orientation"] | undefined;
  private orientationAngle: number | undefined;
  private motion: DeviceMotionSample | undefined;
  private timeZone: string | undefined;
  private requested = false;
  private tick = 0;
  private log: ReplayEntry[] = [];
  private logSteps = 0;
  private logBase: SonobeDocument;
  private logBaseOutputs = new Map<string, Record<string, Value>>();
  private logTruncated = false;
  private profiling: boolean;
  private timingSums = new Map<string, PatchTiming>();
  private timingFrames = 0;
  private publishedTimings: PatchTiming[] | null = null;
  /** This frame's per-item evaluations an empty loop erased, and patches that explained an empty output. */
  private collapses = new Map<NodeRecord, Collapse>();
  private explained = new Map<NodeRecord, EmptyExplanation>();
  /** Active empty_loop warnings by static site ("layer|main|card", "copies|main/swipe:$copies"); dropped once the site has copies again. */
  private emptyIssues = new Map<string, RuntimeIssue>();
  /** Sites that made 0 copies this frame (each is looked into once per frame). */
  private emptySites = new Set<string>();
  /** First frame of each site's current run of suspicious empty frames. */
  private emptySince = new Map<string, number>();
  /** The scene being built belongs to a step (not refreshScene), so its layers are checked for empty loops and fire their pulses. */
  private checkingEmpty = false;
  /** Active loop_length_mismatch warnings by layer site ("main|card"), dropped once the loops fit again. */
  private mismatchIssues = new Map<string, RuntimeIssue>();
  /** Layer sites whose copies met a loop of another length this frame. */
  private mismatchSites = new Set<string>();
  /** First frame of each site's current run of mismatched frames. */
  private mismatchSince = new Map<string, number>();
  /** Text Field commands this step's scene fired, by scene key (FIELD_PULSES bits). */
  private fieldPulses = new Map<string, number>();
  private readonly emptyLoops: EmptyLoopEnv;

  constructor(doc: SonobeDocument, options: RuntimeOptions) {
    this.document = doc;
    this.logBase = doc;
    this.options = options;
    this.deterministic = options.deterministic === true;
    this.profiling = options.profile === true;
    this.seed = options.seed ?? 1;
    this.rng = mulberry32(this.seed);
    this.services = this.createServices();
    this.env = {
      frame: -1,
      time: 0,
      dt: 0,
      services: this.services,
      requestFrame: () => {
        this.requested = true;
      },
      issue: (code, severity, message, patchId) => this.addIssue(code, severity, message, patchId, undefined, this.currentPath),
      once: new Set(),
      collapsed: (_spec, record, emptySlot, fullSlot, count) => {
        this.collapses.set(record, { emptySlot, fullSlot, count });
      },
      explainEmpty: (_spec, record, reason, fixes) => {
        this.explained.set(record, { reason, fixes: [...fixes] });
      },
    };
    const runtime = this;
    this.emptyLoops = {
      get doc() {
        return runtime.graph.doc;
      },
      get registry() {
        return runtime.graph.registry;
      },
      read: (b, path, whole) => this.read(b, path, whole),
      instancePaths: (scope, host) => this.instancePaths(scope, host),
      collapse: (record) => this.collapses.get(record),
      explanation: (record) => this.explained.get(record),
    };
    this.graph = compileDocument(doc, options.registry);
    this.feedbackNodes = feedbackNodesOf(this.graph);
    this.resetRootPath();
  }

  get fps(): number {
    return this.options.fps ?? this.document.project.fps ?? 60;
  }

  // ---- Runtime API ------------------------------------------------------------

  dispatch(events: InputEvent[]): void {
    if (this.disposed) return;
    for (const event of events) this.queue.push(event);
  }

  step(dt?: number): SceneFrame {
    if (this.disposed) return this.produced?.scene ?? this.emptyScene();
    if (this.restartRequested) this.performRestart();
    const h = this.frame < 0 ? 0 : this.deterministic ? 1 / this.fps : sanitizeDt(dt, this.fps);
    return this.advance(h);
  }

  scene(): SceneFrame {
    return this.produced ? this.produced.scene : this.step();
  }

  getValue(address: string): Value {
    const target = this.resolveTarget(address);
    if (!target) return undefined;
    const v = this.readTarget(target);
    const copies = this.propCopies(target);
    if (copies !== undefined) return this.copyItem(target, v, copies);
    if (!isLoop(v)) return v;
    return v.items[target.parsed.index ?? 0];
  }

  getRawValue(address: string): Value | Loop | undefined {
    const target = this.resolveTarget(address);
    return target ? this.readTarget(target) : undefined;
  }

  updateDocument(doc: SonobeDocument): void {
    if (this.disposed || doc === this.document) return;
    this.document = doc;
    // empty_loop warnings come back when the edit didn't fix them. What the last frame recorded stays
    // for inspect, which reads that frame's values until the next step.
    this.clearEmptyWarnings();
    this.clearMismatches();
    // A scrub, a canvas drag or a small literal write only changes constant values: patch them in place.
    if (updateLiterals(this.graph, doc)) {
      this.record({ kind: "update", doc });
      return;
    }
    const previous = this.graph;
    this.graph = compileDocument(doc, this.options.registry);
    this.feedbackNodes = feedbackNodesOf(this.graph);
    this.resetRootPath();
    this.copies = new WeakMap();
    const old = new Map<string, CNode>();
    for (const node of previous.order) if (node.kind !== "copies") old.set(node.identity, node);
    for (const node of this.graph.order) {
      if (node.kind === "copies") continue;
      const match = old.get(node.identity);
      if (!match || match.type !== node.type || match.kind !== node.kind) continue;
      old.delete(node.identity);
      this.transferRecords(match, node);
    }
    for (const node of old.values()) for (const record of node.records.values()) disposeRecord(node, record, this.env);
    this.record({ kind: "update", doc });
  }

  refreshScene(): void {
    if (this.disposed) return;
    const before = this.snapshot;
    const build = this.build();
    if (before) this.syncTextFields(before, build);
    this.tick++;
    this.snapshot = build;
    if (this.produced) this.produced = build;
    // The next step hit-tests against this layout, so trace replays must refresh at the same point.
    this.record({ kind: "refresh" });
  }

  restart(): void {
    if (!this.disposed) this.performRestart();
  }

  hitTest(x: number, y: number): { key: string; layerId: Id }[] {
    const build = this.produced ?? this.snapshot;
    if (!build) return [];
    return hitTestScene(build.scene.roots, x, y).map((n) => ({ key: n.key, layerId: n.layerId }));
  }

  setLayerOutputs(key: string, values: Record<string, Value>): void {
    if (this.disposed) return;
    this.layerOutputs.set(key, { ...this.layerOutputs.get(key), ...values });
    this.record({ kind: "layerOutputs", key, values: { ...values } });
  }

  issues(): RuntimeIssue[] {
    return [...this.graph.issues, ...this.runtimeIssues.values(), ...this.emptyIssues.values(), ...this.mismatchIssues.values()];
  }

  setProfiling(on: boolean): void {
    this.profiling = on === true;
    this.timingSums.clear();
    this.timingFrames = 0;
    this.publishedTimings = null;
  }

  patchTimings(): PatchTiming[] {
    if (!this.profiling) return [];
    if (this.publishedTimings) return this.publishedTimings.map((t) => ({ ...t }));
    const frames = Math.max(1, this.timingFrames);
    return [...this.timingSums.values()].map((t) => ({ ...t, ms: t.ms / frames })).sort((a, b) => b.ms - a.ms);
  }

  dispose(): void {
    if (this.disposed) return;
    for (const node of this.graph.order) {
      for (const record of node.records.values()) disposeRecord(node, record, this.env);
      node.records.clear();
    }
    this.disposed = true;
    this.queue = [];
    this.log = [];
  }

  trace(targets: readonly string[], durationMs: number, events: readonly TraceInput[] = []): TraceResult {
    // Past the replay log there's no way to rebuild the current state; a fresh copy would trace a restarted prototype.
    if (this.logTruncated) throw new TraceUnavailableError(this.frame);
    const options: RuntimeOptions = { ...this.options, deterministic: true, platform: {}, onLog: undefined, profile: false };
    const clone = new RuntimeImpl(this.logBase, options);
    for (const [key, values] of this.logBaseOutputs) clone.layerOutputs.set(key, { ...values });
    for (const entry of this.log) {
      if (entry.kind === "step") {
        if (clone.restartRequested) clone.performRestart();
        clone.queue = [...entry.events];
        clone.advance(entry.dt);
      } else if (entry.kind === "update") clone.updateDocument(entry.doc);
      else if (entry.kind === "refresh") clone.refreshScene();
      else clone.setLayerOutputs(entry.key, entry.values);
    }
    clone.restartRequested = this.restartRequested;
    clone.queue = [...this.queue];

    const schedule = events
      .map((e, i): { atMs: number; events: readonly InputEvent[]; i: number } => ("kind" in e ? { atMs: 0, events: [e], i } : { atMs: e.atMs, events: e.events, i }))
      .sort((a, b) => a.atMs - b.atMs || a.i - b.i);
    const dt = 1 / clone.fps;
    const fresh = clone.frame < 0 || clone.restartRequested;
    const frames = Math.floor(Math.max(0, durationMs) / 1000 / dt + 1e-9);
    const steps = Math.max(1, frames + (fresh ? 1 : 0));
    const start = fresh ? 0 : clone.time;
    const times: number[] = [];
    const values: Record<string, Value[]> = {};
    for (const target of targets) values[target] = [];
    let next = 0;
    for (let i = 0; i < steps; i++) {
      const tMs = (fresh ? i : i + 1) * dt * 1000;
      while (next < schedule.length && schedule[next]!.atMs <= tMs + 1e-6) clone.dispatch([...schedule[next++]!.events]);
      clone.step();
      times.push(clone.time - start);
      for (const target of targets) values[target]!.push(clone.getValue(target));
    }
    const summaries: Record<string, TraceSummary | null> = {};
    for (const target of targets) summaries[target] = summarizeSeries(times, values[target]!);
    clone.dispose();
    return { targets: [...targets], times, values, summaries };
  }

  // ---- frame loop -----------------------------------------------------------------

  private advance(h: number): SceneFrame {
    const events = this.queue;
    this.queue = [];
    this.record({ kind: "step", dt: h, events });
    const snapshot = this.ensureSnapshot();
    this.tick++;
    this.frame += 1;
    this.time += h;
    for (const event of events) {
      if (event.kind === "orientation") {
        this.orientation = event.orientation;
        if (finite(event.angle)) this.orientationAngle = event.angle;
      } else if (event.kind === "deviceMotion") {
        const sample: DeviceMotionSample = { acceleration: [...event.acceleration], rotationRate: [...event.rotationRate] };
        if (event.attitude) sample.attitude = [...event.attitude];
        this.motion = sample;
      } else if (event.kind === "layerPulse") {
        // Applied with this step's scene pulses (syncTextFields); a key that isn't a Text Field is dropped there.
        const bit = Object.hasOwn(FIELD_PULSES, event.prop) ? FIELD_PULSES[event.prop]! : 0;
        const key = event.key ?? event.layerId;
        if (bit) this.fieldPulses.set(key, (this.fieldPulses.get(key) ?? 0) | bit);
      }
    }
    this.input.update(events, (x, y) => hitTestScene(snapshot.scene.roots, x, y), h);
    this.requested = false;
    this.env.frame = this.frame;
    this.env.time = this.time;
    this.env.dt = h;
    this.evaluate();
    this.checkingEmpty = true;
    this.mismatchSites.clear();
    const build = this.build();
    this.checkingEmpty = false;
    this.pruneEmptyLoops();
    this.pruneMismatches();
    this.syncTextFields(snapshot, build);
    this.produced = build;
    this.snapshot = build;
    this.input.endFrame();
    this.needsNextFrame = this.requested;
    if (this.profiling) this.endTimingFrame();
    return build.scene;
  }

  private ensureSnapshot(): SceneBuild {
    if (!this.snapshot) this.snapshot = this.build();
    return this.snapshot;
  }

  private build(): SceneBuild {
    const size = this.deviceInfo().screenSize;
    const root = this.graph.root;
    const rootPath = this.rootPath;
    if (!root || !rootPath) {
      return { scene: { frame: this.frame, time: this.time, size, background: this.background(), roots: [] }, nodes: new Map(), info: new Map(), counts: new Map() };
    }
    this.currentPath = null;
    return buildScene({
      root,
      rootPath,
      frame: this.frame,
      time: this.time,
      size,
      background: this.background(),
      measurer: this.options.textMeasurer ?? approximateTextMeasurer,
      read: (b, p, whole) => this.read(b, p, whole === true),
      instancePaths: (s, h) => this.instancePaths(s, h),
      issue: (code, message, layerId) => this.addIssue(code, "warning", message, undefined, layerId),
      emptyCopies: (layer, path, emptyProp, erased) => {
        if (this.checkingEmpty) this.reportEmptyLayer(layer, path, emptyProp, erased);
      },
      lengthMismatch: (root, path, count, layer, prop, length) => {
        if (this.checkingEmpty) this.reportMismatch(root, path, count, layer, prop, length);
      },
      pulseProp: (key, prop, value, pulseSource) => {
        if (this.checkingEmpty) this.noteFieldPulse(key, prop, value, pulseSource);
      },
      layerRef: (layerId, instance, prefix) => this.makeRef(layerId, instance, prefix),
    });
  }

  /**
   * A layer pulse prop fires like a pulse input: a pulse output's true, or a boolean turning on (a
   * copy that wasn't drawn last frame counts as turning on). The previous build is still `snapshot`.
   */
  private noteFieldPulse(key: string, prop: string, value: Value, pulseSource: boolean): void {
    const bit = FIELD_PULSES[prop];
    if (!bit || !truthy(value)) return;
    if (!pulseSource && truthy(this.snapshot?.nodes.get(key)?.props[prop])) return;
    this.fieldPulses.set(key, (this.fieldPulses.get(key) ?? 0) | bit);
  }

  /**
   * A Text Field whose Text property changed replaces what was typed into it, then this step's Set
   * Text, Begin Editing and End Editing pulses apply. Fields with state their props don't show get it
   * on their SceneNode, with revisions renderers follow.
   */
  private syncTextFields(before: SceneBuild, after: SceneBuild): void {
    const text = this.input.text;
    for (const [key, node] of after.nodes) {
      if (node.type !== "textField") continue;
      const previous = before.nodes.get(key)?.props.text;
      if (previous !== undefined && previous !== node.props.text && typeof node.props.text === "string") text.setValue(key, node.props.text);
      const pulses = this.fieldPulses.get(key);
      if (pulses) {
        if (pulses & FIELD_PULSES.setText!) text.setText(key, typeof node.props.textToSet === "string" ? node.props.textToSet : "");
        if (pulses & FIELD_PULSES.beginEditing!) text.setEditing(key, true);
        if (pulses & FIELD_PULSES.endEditing!) text.setEditing(key, false);
      }
      if (!text.has(key)) continue;
      const field = text.snapshot(key);
      node.textField = {
        text: field.value ?? (typeof node.props.text === "string" ? node.props.text : ""),
        textRevision: field.textRevision,
        editRevision: field.editRevision,
        editing: field.editing,
      };
    }
    this.fieldPulses.clear();
  }

  private evaluate(): void {
    this.collapses.clear();
    this.explained.clear();
    this.emptySites.clear();
    const order = this.graph.order;
    const profiling = this.profiling;
    for (let i = 0; i < order.length; i++) {
      const node = order[i]!;
      if (node.kind === "copies") {
        this.evaluateCopies(node);
        continue;
      }
      if (node.scope.muted) continue;
      const paths = node.scope.copies ? node.scope.active : this.rootPaths;
      if (!profiling) {
        for (let p = 0; p < paths.length; p++) this.evaluateAt(node, paths[p]!);
        continue;
      }
      const started = nowMs();
      for (let p = 0; p < paths.length; p++) this.evaluateAt(node, paths[p]!);
      this.addTiming(node, nowMs() - started);
    }
    this.currentPath = null;
    this.currentPatch = undefined;
    if (!this.requested && this.feedbackMoving()) this.requested = true;
    this.sweep();
  }

  /**
   * True while a feedback loop keeps changing: some back-edge input would read a different value
   * next frame than it read this frame, because its driver changed after the consumer read it.
   * Loops need no patch that requests frames (Delay One Frame on a back-edge and plain cycles alike).
   */
  private feedbackMoving(): boolean {
    for (const node of this.feedbackNodes) {
      if (node.scope.muted) continue;
      const paths = node.scope.copies ? node.scope.active : this.rootPaths;
      for (let p = 0; p < paths.length; p++) {
        const path = paths[p]!;
        const record = node.records.get(path.stateKey);
        if (!record || record.frame !== this.frame) continue;
        for (let i = 0; i < node.feedback.length; i++) {
          if (node.feedback[i] && !valuesEqual(record.cur[i], this.readInput(node, i, path))) return true;
        }
      }
    }
    return false;
  }

  /** An input slot's value now: its literal, else the driver's value coerced to the slot type (the slot default when undriven). */
  private readInput(node: CNode, i: number, path: InstancePath): Value | Loop {
    const b = node.bindings[i]!;
    if (b.kind === "const") return b.value;
    const s = node.inputs[i]!;
    const v = this.read(b, path, s.wholeLoop);
    if (v === undefined) return s.default;
    // Last frame's empty loop never erases this frame's copies (ARCHITECTURE.md §5.2): through a
    // back-edge, an empty loop at a per-item input reads as "no value yet", like on the first frame.
    if (node.feedback[i] && !s.wholeLoop && isLoop(v) && v.items.length === 0) return s.default;
    return b.type === s.type ? v : coerceValue(v, b.type, s.type);
  }

  private evaluateAt(node: CNode, path: InstancePath): void {
    let record = node.records.get(path.stateKey);
    if (!record) {
      record = createRecord(node, path.stateKey);
      node.records.set(path.stateKey, record);
    }
    const cur = beginInputs(record);
    for (let i = 0; i < node.bindings.length; i++) cur[i] = this.readInput(node, i, path);
    this.currentPath = path;
    this.currentPatch = node.id;
    if (node.kind === "receiver") {
      record.frame = this.frame;
      if (node.outputs.length) record.values[0] = node.muted ? node.outputs[0]!.zero : cur[0];
      record.prevCount = 1;
      return;
    }
    evaluateRecord(node, record, this.env, path.key);
  }

  private evaluateCopies(node: CNode): void {
    const child = node.copiesOf!;
    const host = node.scope;
    if (host.muted) return;
    let infos = this.copies.get(node);
    if (!infos) this.copies.set(node, (infos = new Map()));
    const hostPaths = host.copies ? host.active : this.rootPaths;
    const active: InstancePath[] = [];
    for (const hostPath of hostPaths) {
      this.currentPath = hostPath;
      let looping = false;
      let empty = false;
      let max = 0;
      const consider = (v: Value | Loop | undefined) => {
        if (!isLoop(v)) return;
        looping = true;
        if (v.items.length === 0) empty = true;
        else if (v.items.length > max) max = v.items.length;
      };
      // Like a patch's back-edge: an empty loop read from last frame doesn't take this frame's copies away.
      const inputs = child.inputs;
      for (let k = 0; k < inputs.length; k++) {
        const input = inputs[k]!;
        if (!input.loop) continue;
        const v = input.binding.kind === "const" ? input.binding.value : this.read(input.binding, hostPath);
        if (!(input.feedback && isLoop(v) && v.items.length === 0)) consider(v);
      }
      for (let k = 0; k < child.replicators.length; k++) {
        const r = child.replicators[k]!;
        const v = r.kind === "const" ? r.value : this.read(r, hostPath);
        if (!(node.feedback[inputs.length + k] && isLoop(v) && v.items.length === 0)) consider(v);
      }
      // Repeat, when set, alone decides the count (an empty loop through a back-edge reads as unset).
      if (child.repeat) {
        const r = child.repeat;
        const v = r.kind === "const" ? r.value : this.read(r, hostPath);
        const back = node.feedback[inputs.length + child.replicators.length] && isLoop(v) && v.items.length === 0;
        const repeat = back || !isCount(v) ? null : repeatCount(v);
        if (repeat !== null) {
          looping = true;
          empty = repeat === 0;
          max = repeat;
        }
      }
      let count = looping ? (empty ? 0 : max) : 1;
      // A layer component instance is reported by the scene, with the layer.
      if (looping && count === 0 && child.kind === "patchInstance") this.reportEmptyInstance(node, child, hostPath, max);
      if (count > MAX_LOOP_LENGTH) {
        const label = child.kind === "patchInstance" ? { patchId: child.instanceId! } : { layerId: child.instanceId! };
        this.addIssue("loop_limit", "warning", `Component "${child.instanceId}" was looped ${count} times; components replicate at most ${MAX_LOOP_LENGTH} times.`, label.patchId, label.layerId);
        count = MAX_LOOP_LENGTH;
      }
      const previous = infos.get(hostPath.key);
      const paths = new Array<InstancePath>(count);
      for (let k = 0; k < count; k++) {
        const copy = looping ? k : undefined;
        const old = previous?.paths[k];
        paths[k] = old && old.copy === copy && old.parent === hostPath ? old : this.makePath(child, hostPath, copy);
      }
      infos.set(hostPath.key, { paths, replicated: looping, frame: this.frame });
      for (const p of paths) active.push(p);
    }
    child.active = active;
  }

  /** Drop the state of instance paths that didn't evaluate this frame (loops shrank, copies removed). */
  private sweep(): void {
    for (const node of this.graph.order) {
      const scope = node.scope;
      if (scope.muted || (!scope.copies && node.kind !== "copies")) continue;
      if (node.kind === "copies") {
        const infos = this.copies.get(node);
        if (infos && scope.copies) for (const [key, info] of infos) if (info.frame !== this.frame) infos.delete(key);
        continue;
      }
      for (const [key, record] of node.records) {
        if (record.frame === this.frame) continue;
        disposeRecord(node, record, this.env);
        node.records.delete(key);
      }
    }
  }

  private performRestart(): void {
    for (const node of this.graph.order) {
      for (const record of node.records.values()) disposeRecord(node, record, this.env);
      node.records.clear();
    }
    for (const scope of this.graph.scopes) {
      scope.active = [];
      scope.defaultPaths.clear();
    }
    this.copies = new WeakMap();
    this.frame = -1;
    this.time = 0;
    this.rng = mulberry32(this.seed);
    this.input.reset();
    this.orientation = undefined;
    this.orientationAngle = undefined;
    this.motion = undefined;
    this.produced = null;
    this.snapshot = null;
    this.runtimeIssues.clear();
    this.clearEmptyLoops();
    this.clearMismatches();
    this.env.once.clear();
    this.restartRequested = false;
    this.restarts++;
    this.needsNextFrame = false;
    this.tick++;
    this.log = [];
    this.logSteps = 0;
    this.logBase = this.document;
    this.logBaseOutputs = new Map([...this.layerOutputs].map(([k, v]) => [k, { ...v }]));
    this.logTruncated = false;
  }

  private transferRecords(from: CNode, to: CNode): void {
    const inMap = to.inputs.map((s) => from.inputIndex.get(s.key));
    const outMap = to.outputs.map((s) => {
      const j = from.outputIndex.get(s.key);
      return j !== undefined && from.outputs[j]!.type === s.type && from.outputs[j]!.wholeLoop === s.wholeLoop ? j : undefined;
    });
    const resetState = to.kind === "delay1" && from.typeParam !== to.typeParam;
    for (const [key, rec] of from.records) {
      const next = createRecord(to, key);
      next.frame = rec.frame;
      next.hasPrev = rec.hasPrev;
      next.prevCount = rec.prevCount;
      if (resetState) disposeRecord(from, rec, this.env);
      else {
        next.states = rec.states;
        next.outs = rec.outs.map((o) => to.outputs.map((s, j) => (outMap[j] === undefined ? s.initial : o[outMap[j]!]!)));
      }
      next.values = to.outputs.map((s, j) => (outMap[j] === undefined ? s.initial : rec.values[outMap[j]!]));
      next.cur = to.inputs.map((s, i) => (inMap[i] === undefined ? s.default : rec.cur[inMap[i]!]!));
      next.prev = to.inputs.map((s, i) => (inMap[i] === undefined ? s.default : rec.prev[inMap[i]!]!));
      to.records.set(key, next);
    }
    from.records.clear();
  }

  private record(entry: ReplayEntry): void {
    if (this.logTruncated) return;
    if (entry.kind === "step") {
      if (this.logSteps >= MAX_REPLAY_FRAMES) {
        this.logTruncated = true;
        this.log = [];
        return;
      }
      this.logSteps++;
    }
    this.log.push(entry);
  }

  // ---- profiling --------------------------------------------------------------------

  private addTiming(node: CNode, ms: number): void {
    let entry = this.timingSums.get(node.identity);
    if (!entry) this.timingSums.set(node.identity, (entry = { patchId: node.id, componentPath: node.scope.key, ms: 0 }));
    entry.ms += ms;
  }

  private endTimingFrame(): void {
    this.timingFrames++;
    if (this.timingFrames < Math.max(1, Math.round(this.fps))) return;
    const frames = this.timingFrames;
    this.publishedTimings = [...this.timingSums.values()].map((t) => ({ ...t, ms: t.ms / frames })).sort((a, b) => b.ms - a.ms);
    this.timingSums.clear();
    this.timingFrames = 0;
  }

  // ---- values ---------------------------------------------------------------------

  private resetRootPath(): void {
    const root = this.graph.root;
    this.rootPath = root ? { key: root.key, stateKey: root.key, parent: null, scope: root, copy: undefined, layerPrefix: "" } : null;
    this.rootPaths = this.rootPath ? [this.rootPath] : [];
  }

  /**
   * Parse "patch.port", "@layer.prop", "instancePath/patch.port" or "@instancePath/layer.prop"
   * (instancePath like "card#2/badge", optionally starting with the root component id) into the
   * address, the scope it lives in, and the instance path to read.
   */
  private resolveTarget(address: string): ResolvedTarget | undefined {
    return this.locate(address).target;
  }

  /** resolveTarget, saying which instance on the path has no such copy when it fails there. */
  private locate(address: string): { target?: ResolvedTarget; missing?: MissingCopy } {
    const root = this.graph.root;
    const rootPath = this.rootPath;
    if (typeof address !== "string" || !root || !rootPath) return {};
    const text = address.trim();
    const at = text.startsWith("@") ? "@" : "";
    const body = at ? text.slice(1) : text;
    const slash = body.lastIndexOf("/");
    const parsed = parseAddress(at + body.slice(slash + 1));
    if (!parsed || parsed.kind === "componentOutput") return {};
    // A knob is one project-wide value: "$knob.<id>", never inside an instance path.
    if (parsed.kind === "knob") return slash < 0 ? { target: { parsed, scope: root, path: rootPath } } : {};
    let scope = root;
    let path = rootPath;
    if (slash >= 0) {
      const segments = body.slice(0, slash).split("/");
      if (segments.length > 1 && segments[0] === root.key && !this.childScope(root, root.key)) segments.shift();
      else if (segments.length === 1 && segments[0] === root.key && !this.childScope(root, root.key)) segments.length = 0;
      for (const segment of segments) {
        const m = SEGMENT.exec(segment);
        const child = m ? this.childScope(scope, m[1]!) : null;
        if (!m || !child) return {};
        const { paths, replicated } = this.instancePaths(child, path);
        const copy = m[2] === undefined ? 0 : Number(m[2]);
        const next = replicated ? paths[copy] : paths[0];
        if (!next) return { missing: { scope: child, host: path, copy, copies: paths.length } };
        scope = child;
        path = next;
      }
    }
    if (parsed.kind === "componentInput" && scope === root) return {};
    return { target: { parsed, scope, path } };
  }

  private childScope(scope: Scope, id: string): Scope | null {
    return scope.instances.get(id) ?? scope.layerIndex.get(id)?.instance ?? null;
  }

  private readTarget({ parsed, scope, path }: ResolvedTarget): Value | Loop | undefined {
    if (parsed.kind === "knob") return this.graph.knobs.values.get(parsed.key);
    // A layer's Repeat reads as the copies it drew last frame, not the loop it counts.
    if (parsed.kind === "layer" && parsed.key === "repeat" && this.snapshot && scope.layerIndex.get(parsed.id)?.props.has("repeat")) {
      return this.snapshot.counts.get(path.layerPrefix + parsed.id) ?? 1;
    }
    if (parsed.kind === "patch") {
      const node = scope.nodes.get(parsed.id);
      if (node) {
        const record = node.records.get(path.stateKey);
        const out = node.outputIndex.get(parsed.key);
        if (out !== undefined) return record?.values[out];
        const inp = node.inputIndex.get(parsed.key);
        return inp !== undefined && record && record.frame >= 0 ? record.cur[inp] : undefined;
      }
    }
    const { index: _index, ...rest } = parsed;
    const link = this.graph.resolveLink(formatAddress(rest as ParsedAddress), scope);
    if (!link) return undefined;
    const savedPath = this.currentPath;
    this.currentPath = null;
    const v = this.read(link.binding, path, true);
    this.currentPath = savedPath;
    if (v === undefined) return undefined;
    return link.binding.type === link.type ? v : coerceValue(v, link.binding.type, link.type);
  }

  private makePath(scope: Scope, host: InstancePath, copy: number | undefined): InstancePath {
    const suffix = copy === undefined ? "" : `#${copy}`;
    return {
      key: `${host.key}/${scope.instanceId}${suffix}`,
      stateKey: `${host.stateKey}/${scope.instanceId}${copy ? suffix : ""}`,
      parent: host,
      scope,
      copy,
      layerPrefix: scope.kind === "layerInstance" ? `${host.layerPrefix}${scope.instanceId}${suffix}/` : host.layerPrefix,
    };
  }

  private instancePaths(scope: Scope, host: InstancePath): { paths: readonly InstancePath[]; replicated: boolean } {
    const info = scope.copies ? this.copies.get(scope.copies)?.get(host.key) : undefined;
    if (info) return info;
    let path = scope.defaultPaths.get(host.key);
    if (!path || path.parent !== host) {
      path = this.makePath(scope, host, undefined);
      scope.defaultPaths.set(host.key, path);
    }
    return { paths: [path], replicated: false };
  }

  /**
   * A binding's value at `path`. `whole`: the reader takes whole loops, so a layer that drew 0 copies
   * last frame reads as an empty loop; per-item readers get one reference instead (readLayerRef).
   */
  private read(b: Binding, path: InstancePath, whole = false): Value | Loop | undefined {
    switch (b.kind) {
      case "const":
        return b.value;
      case "output":
        return b.node.records.get(path.stateKey)?.values[b.slot];
      case "input": {
        let own: InstancePath | null = path;
        while (own && own.scope !== b.scope) own = own.parent;
        const host = own?.parent;
        if (!own || !host) return undefined;
        const input = b.input;
        const hb = input.binding;
        let v = hb.kind === "const" ? hb.value : this.read(hb, host, whole);
        if (v === undefined) v = input.default;
        else if (hb.type !== input.port.type) v = coerceValue(v, hb.type, input.port.type);
        if (input.loop && isLoop(v)) {
          const n = v.items.length;
          if (own.copy !== undefined) return n ? v.items[own.copy % n] : undefined;
          // An empty loop read through a back-edge took no copies away (evaluateCopies): no value yet.
          if (n === 0 && input.feedback) return undefined;
        }
        return v;
      }
      case "instanceOutput":
        return this.readInstanceOutput(b, path, whole);
      case "variable": {
        if (!b.source) return b.zero;
        let ancestor: InstancePath | null = path;
        while (ancestor && ancestor.scope.depth > b.depth) ancestor = ancestor.parent;
        return ancestor ? this.read(b.source, ancestor, whole) : undefined;
      }
      case "layerRef":
        return this.readLayerRef(b, path, whole);
      case "layerOutput":
        return this.readLayerOutput(b, path, whole);
    }
  }

  private readInstanceOutput(b: Extract<Binding, { kind: "instanceOutput" }>, host: InstancePath, whole: boolean): Value | Loop | undefined {
    const scope = b.scope;
    if (scope.selfMuted) {
      if (b.type === "pulse") return false;
      const input = scope.inputs.find((i) => i.port.type === b.type);
      if (!input) return b.zero;
      const hb = input.binding;
      const v = hb.kind === "const" ? hb.value : this.read(hb, host, whole);
      return v === undefined ? input.default : hb.type === b.type ? v : coerceValue(v, hb.type, b.type);
    }
    const { paths, replicated } = this.instancePaths(scope, host);
    const inner = b.inner;
    if (!replicated) {
      if (!inner) return b.zero;
      const v = this.read(inner, paths[0]!, whole);
      return v === undefined || inner.type === b.type ? v : coerceValue(v, inner.type, b.type);
    }
    const items: Value[] = [];
    for (const p of paths) {
      let v = inner ? this.read(inner, p, whole) : b.zero;
      if (v === undefined) v = b.zero;
      else if (inner && inner.type !== b.type) v = coerceValue(v, inner.type, b.type);
      if (isLoop(v)) for (const item of v.items) items.push(item);
      else items.push(v);
      if (items.length > MAX_LOOP_LENGTH) {
        items.length = MAX_LOOP_LENGTH;
        this.addIssue("loop_limit", "warning", `Component "${scope.instanceId}" output "${b.key}" passed ${MAX_LOOP_LENGTH} items and was cut off.`);
        break;
      }
    }
    return makeLoop(items);
  }

  private makeRef(layerId: Id, instance: number | undefined, prefix: string): LayerRef {
    const ref: LayerRef = instance === undefined ? { layerId } : { layerId, instance };
    this.refPrefix.set(ref, prefix);
    return ref;
  }

  private readLayerRef(b: Extract<Binding, { kind: "layerRef" }>, path: InstancePath, whole: boolean): Value | Loop {
    const count = this.snapshot?.counts.get(path.layerPrefix + b.layerId);
    // A layer that drew no copies last frame reads, for a per-item reader, like it does before the
    // first frame: one reference. Otherwise the patches that listen to it run 0 times, and whatever
    // they feed (often the layer's own copies) could never come back (ARCHITECTURE.md §5.2).
    if (count === 0 && !whole) return this.makeRef(b.layerId, undefined, path.layerPrefix);
    const cached = b.cache.get(path.key);
    if (cached && cached.frame === this.tick) return cached.value;
    const value =
      count === undefined
        ? this.makeRef(b.layerId, undefined, path.layerPrefix)
        : makeLoop(Array.from({ length: count }, (_, i) => this.makeRef(b.layerId, i, path.layerPrefix)));
    b.cache.set(path.key, { frame: this.tick, value });
    return value;
  }

  private readLayerOutput(b: Extract<Binding, { kind: "layerOutput" }>, path: InstancePath, whole: boolean): Value | Loop {
    const base = path.layerPrefix + b.layerId;
    const count = this.snapshot?.counts.get(base);
    // Like readLayerRef: 0 copies last frame reads as the unreplicated output for per-item readers.
    if (count === undefined || (count === 0 && !whole)) return this.layerOutputFor(b, base);
    const items = new Array<Value>(count);
    for (let i = 0; i < count; i++) items[i] = this.layerOutputFor(b, `${base}#${i}`);
    return makeLoop(items);
  }

  private layerOutputFor(b: Extract<Binding, { kind: "layerOutput" }>, key: string): Value {
    const reported = this.layerOutputs.get(key)?.[b.key];
    if (reported !== undefined) return reported;
    return this.derivedLayerOutput(b.layerType, b.key, key) ?? b.default;
  }

  /** Layer outputs the runtime derives itself: Text textSize from the previous layout, Text Field state from input events. */
  private derivedLayerOutput(layerType: string, outKey: string, sceneKey: string): Value | undefined {
    const snap = this.snapshot;
    if (layerType === "text" && outKey === "textSize") {
      const info = snap?.info.get(sceneKey);
      return info ? [info.contentSize[0], info.contentSize[1]] : undefined;
    }
    if (layerType === "textField") {
      const field = this.input.text.snapshot(sceneKey);
      const props = snap?.nodes.get(sceneKey)?.props;
      if (outKey === "value") return field.value ?? (typeof props?.text === "string" ? props.text : undefined);
      if (outKey === "isFocused") return field.focused ?? props?.focused === true;
      if (outKey === "submitted") return field.submitted;
    }
    return undefined;
  }

  // ---- services -------------------------------------------------------------------

  private createServices(): RuntimeServices {
    const runtime = this;
    const platform: PlatformServices = { ...this.options.platform };
    if (!platform.deviceMotion) {
      platform.deviceMotion = () => {
        const m = this.motion;
        if (!m) return undefined;
        const sample: DeviceMotionSample = { acceleration: [...m.acceleration], rotationRate: [...m.rotationRate] };
        if (m.attitude) sample.attitude = [...m.attitude];
        return sample;
      };
    }
    return {
      random: () => this.rng(),
      now: () => (this.deterministic ? DETERMINISTIC_EPOCH_MS + this.time * 1000 : Date.now()),
      get deterministic() {
        return runtime.deterministic;
      },
      get restartCount() {
        return runtime.restarts;
      },
      pointer: (ref) => this.pointerFor(ref),
      pointers: (ref) => {
        if (ref === null || ref === undefined) return this.input.pointer.pointers(null);
        const key = this.resolveLayerKey(ref);
        return key === null ? [] : this.input.pointer.pointers(key, true);
      },
      keyboard: () => this.input.keyboard.snapshot(),
      wheel: () => this.input.wheel.snapshot(),
      layerInfo: (ref) => {
        const key = this.resolveLayerKey(ref);
        return key === null ? undefined : this.snapshot?.info.get(key);
      },
      layerOutput: (ref, outKey) => {
        const key = this.resolveLayerKey(ref);
        if (key === null || typeof outKey !== "string") return undefined;
        const reported = this.layerOutputs.get(key)?.[outKey];
        if (reported !== undefined) return reported;
        const node = this.snapshot?.nodes.get(key);
        return node ? this.derivedLayerOutput(node.type, outKey, key) : undefined;
      },
      mediaInfo: (ref) => this.mediaInfoFor(ref),
      device: () => this.deviceInfo(),
      measureText: (text, style, maxWidth) => (this.options.textMeasurer ?? approximateTextMeasurer).measure(String(text), style, maxWidth),
      readScript: (file) => {
        const scripts = this.document.scripts;
        if (typeof file !== "string" || !scripts) return undefined;
        const name = file.startsWith("scripts/") ? file.slice("scripts/".length) : file;
        return Object.prototype.hasOwnProperty.call(scripts, name) ? scripts[name] : undefined;
      },
      log: (level, ...args) => this.logMessage(level, args),
      issue: (code, severity, message) => this.addIssue(String(code), severity === "error" ? "error" : "warning", String(message), this.currentPatch, undefined, this.currentPath),
      restart: () => {
        this.restartRequested = true;
      },
      resolveAssetUrl: (assetId) => this.options.resolveAssetUrl?.(assetId),
      platform,
    };
  }

  /** Scene key for a layer reference, relative to the component instance that created it. */
  private resolveLayerKey(ref: LayerRef | null | undefined): string | null {
    const snap = this.snapshot;
    if (!snap || !ref) return null;
    // Callers written against the old `LayerInfoSnapshot.parent: Id` wrap the new parent reference as
    // `{ layerId: info.parent, instance }`. Resolve the inner reference, keeping its scope and instance.
    const nested = ref.layerId as unknown;
    if (typeof nested === "object" && nested !== null && typeof (nested as LayerRef).layerId === "string") {
      const inner = nested as LayerRef;
      const instance = typeof inner.instance === "number" ? inner.instance : ref.instance;
      const unwrapped = this.makeRef(inner.layerId, instance, this.refPrefix.get(inner) ?? this.refPrefix.get(ref) ?? this.currentPath?.layerPrefix ?? "");
      return this.resolveLayerKey(unwrapped);
    }
    if (typeof ref.layerId !== "string") return null;
    const prefix = this.refPrefix.get(ref) ?? this.currentPath?.layerPrefix ?? "";
    const base = prefix + ref.layerId;
    if (typeof ref.instance === "number") {
      const key = `${base}#${ref.instance}`;
      if (snap.nodes.has(key)) return key;
    }
    if (snap.nodes.has(base)) return base;
    const first = `${base}#0`;
    return snap.nodes.has(first) ? first : null;
  }

  private pointerFor(ref: LayerRef | null): PointerSnapshot {
    if (ref === null || ref === undefined) return this.input.pointer.snapshot(null);
    const key = this.resolveLayerKey(ref);
    if (key === null) return this.input.pointer.snapshot(NO_TARGET, null, true);
    return this.input.pointer.snapshot(key, planeInverse(this.snapshot!.nodes.get(key)!.worldTransform), true);
  }

  /**
   * Media status: the host's `options.mediaInfo` first; then what a layer showing the reference
   * reported through setLayerOutputs (naturalSize, loading, duration) merged with the document's
   * asset record. An asset id the document doesn't have reads as "error"; an unseen URL is unknown.
   */
  private mediaInfoFor(ref: AssetRef): MediaInfo | undefined {
    if (!ref || typeof ref !== "object") return undefined;
    const hosted = this.options.mediaInfo?.(ref);
    if (hosted) return hosted;
    const assetId = typeof ref.assetId === "string" ? ref.assetId : undefined;
    const url = typeof ref.url === "string" ? ref.url : undefined;
    if (assetId === undefined && url === undefined) return undefined;
    const record = assetId !== undefined ? this.document.assets?.[assetId] : undefined;
    const reported = this.reportedMediaOutputs(assetId, url);
    if (!record && !reported) return assetId !== undefined ? { status: "error", width: 0, height: 0, duration: 0, name: "" } : undefined;
    const natural = reported?.naturalSize;
    const size: [number, number] =
      Array.isArray(natural) && finite(natural[0]) && finite(natural[1]) ? [natural[0], natural[1]] : [finite(record?.width) ? record.width : 0, finite(record?.height) ? record.height : 0];
    const duration = finite(reported?.duration) ? reported.duration : finite(record?.duration) ? record.duration : 0;
    return {
      status: reported?.loading === true ? "loading" : "ready",
      width: size[0],
      height: size[1],
      duration,
      name: record?.name ?? (url !== undefined ? mediaName(url) : ""),
    };
  }

  private reportedMediaOutputs(assetId: string | undefined, url: string | undefined): Record<string, Value> | undefined {
    const snap = this.snapshot;
    if (!snap) return undefined;
    for (const [key, node] of snap.nodes) {
      const outputs = this.layerOutputs.get(key);
      if (!outputs) continue;
      for (const key in node.props) {
        const v = node.props[key];
        if (!v || typeof v !== "object" || Array.isArray(v)) continue;
        const media = v as { assetId?: unknown; url?: unknown };
        if ((assetId !== undefined && media.assetId === assetId) || (assetId === undefined && url !== undefined && media.url === url)) return outputs;
      }
    }
    return undefined;
  }

  private deviceInfo(): DeviceInfo {
    const settings = this.document.project.device;
    const preset = getDevicePreset(settings.preset);
    const o = this.options.device ?? {};
    const orientation = this.orientation ?? o.orientation ?? settings.orientation ?? "portrait";
    const screenSize: [number, number] = o.screenSize ? [o.screenSize[0], o.screenSize[1]] : deviceScreenSize({ ...settings, orientation });
    const [t, r, b, l] = preset.safeArea;
    const safeArea: DeviceInfo["safeArea"] = o.safeArea ? [...o.safeArea] : orientation === "landscape" ? [r, b, l, t] : [t, r, b, l];
    const info: DeviceInfo = {
      preset: o.preset ?? preset.id,
      screenSize,
      screenScale: o.screenScale ?? preset.scale,
      safeArea,
      orientation,
      darkMode: o.darkMode ?? false,
      platform: o.platform ?? "desktop",
      timeZone: o.timeZone ?? (this.deterministic ? "UTC" : (this.timeZone ??= hostTimeZone())),
    };
    const angle = this.orientationAngle ?? o.orientationAngle;
    if (finite(angle)) info.orientationAngle = angle;
    return info;
  }

  private background(): Color {
    const text = this.document.project.background;
    return (text ? parseColor(text) : undefined) ?? { r: 1, g: 1, b: 1, a: 1 };
  }

  private emptyScene(): SceneFrame {
    return { frame: this.frame, time: this.time, size: this.deviceInfo().screenSize, background: this.background(), roots: [] };
  }

  private logMessage(level: "log" | "warn" | "error", args: unknown[]): void {
    const patchId = this.currentPatch;
    if (this.options.onLog) {
      const source: LogSource | undefined = patchId !== undefined ? { patchId, componentPath: this.currentPath?.key ?? this.graph.root?.key ?? "" } : undefined;
      this.options.onLog(level, args, source);
    }
    if (level === "log") return;
    this.addIssue(level === "error" ? "patch_error" : "patch_warning", level === "error" ? "error" : "warning", args.map(formatLogArg).join(" "), patchId, undefined, this.currentPath);
  }

  // ---- empty loops ----------------------------------------------------------------

  private clearEmptyWarnings(): void {
    this.emptyIssues.clear();
    this.emptySites.clear();
    this.emptySince.clear();
  }

  private clearEmptyLoops(): void {
    this.collapses.clear();
    this.explained.clear();
    this.clearEmptyWarnings();
  }

  /** Drop the empty_loop warnings of sites that made copies again this frame. */
  private pruneEmptyLoops(): void {
    for (const site of this.emptyIssues.keys()) if (!this.emptySites.has(site)) this.emptyIssues.delete(site);
    for (const site of this.emptySince.keys()) if (!this.emptySites.has(site)) this.emptySince.delete(site);
  }

  /**
   * A site made 0 copies: look into it once per frame. On a frame where nothing looks wrong (no empty
   * loop erased items, no patch explained an empty output) that costs a set lookup and retires its
   * warning; otherwise follow the trail, and warn while it still looks like a mistake.
   */
  private checkEmpty(site: string, erased: number, trail: () => { head: string; entry: EmptyEntry; steps: EmptyStep[] } | null, label: { patchId?: Id; layerId?: Id }, path: InstancePath): void {
    if (this.emptySites.has(site)) return;
    this.emptySites.add(site);
    const found = erased > 0 || this.collapses.size > 0 || this.explained.size > 0 ? trail() : null;
    if (!found || !isSuspicious(found.steps, erased)) {
      this.emptyIssues.delete(site);
      this.emptySince.delete(site);
      return;
    }
    // A list that just became empty meets last frame's items for one frame on its way to nothing, so
    // after the first frame a warning waits for a second frame in a row.
    const since = this.emptySince.get(site);
    if (since === undefined) this.emptySince.set(site, this.frame);
    if (this.frame > 0 && (since === undefined || since === this.frame)) return;
    // Keep the first wording while the site stays empty, so the warning doesn't churn every frame.
    if (!this.emptyIssues.has(site)) this.setEmptyIssue(site, describeEmpty(this.emptyLoops, found.head, found.entry, erased, found.steps), label, path);
  }

  private reportEmptyInstance(node: CNode, scope: Scope, host: InstancePath, erased: number): void {
    this.checkEmpty(`copies|${node.identity}`, erased, () => this.instanceTrail(scope, host), { patchId: scope.instanceId! }, host);
  }

  private reportEmptyLayer(layer: CLayer, path: InstancePath, emptyProp: number, erased: number): void {
    this.checkEmpty(`layer|${layer.scope.key}|${layer.id}`, erased, () => this.layerTrail(layer, path, emptyProp), { layerId: layer.id }, path);
  }

  private instanceTrail(scope: Scope, host: InstancePath): { head: string; entry: EmptyEntry; steps: EmptyStep[] } {
    const found = emptyInstanceInput(this.emptyLoops, scope, host);
    const site = instanceLabel(scope);
    return {
      head: `${site} has 0 copies`,
      entry: { phrase: found ? `its ${found.name} input` : "one of its loop inputs", port: found?.name ?? "a loop input", noun: "inputs", site },
      steps: found ? traceEmpty(this.emptyLoops, found.binding, host) : [],
    };
  }

  private layerTrail(layer: CLayer, path: InstancePath, emptyProp: number): { head: string; entry: EmptyEntry; steps: EmptyStep[] } | null {
    const site = `Layer "${layer.node.name || layer.id}"`;
    const head = `${site} has 0 copies`;
    const prop = layer.bound[emptyProp];
    if (prop) {
      const name = layer.props.get(prop.key)?.name || prop.key;
      return { head, entry: { phrase: `its ${name}`, port: name, noun: "properties", site }, steps: traceEmpty(this.emptyLoops, prop.binding, path) };
    }
    if (!layer.instance) return null;
    const found = emptyInstanceInput(this.emptyLoops, layer.instance, path);
    return {
      head,
      entry: { phrase: found ? `its ${found.name}` : "one of its looped inputs", port: found?.name ?? "a looped input", noun: "properties", site },
      steps: found ? traceEmpty(this.emptyLoops, found.binding, path) : [],
    };
  }

  private setEmptyIssue(site: string, report: EmptyReport, label: { patchId?: Id; layerId?: Id }, path: InstancePath): void {
    const issue: RuntimeIssue = { code: "empty_loop", severity: "warning", message: report.message, hint: report.hint };
    if (label.patchId !== undefined) issue.patchId = label.patchId;
    if (label.layerId !== undefined) issue.layerId = label.layerId;
    if (path.parent) issue.componentPath = path.key;
    if (report.suggestions.length) issue.suggestions = report.suggestions;
    this.emptyIssues.set(site, issue);
  }

  // ---- copies -----------------------------------------------------------------------

  /**
   * How many copies the layer of a layer-property address drew last frame (1 when it isn't copied);
   * undefined for other addresses, layer outputs, and before the first frame.
   */
  private propCopies({ parsed, scope, path }: ResolvedTarget): number | undefined {
    if (parsed.kind !== "layer" || !this.snapshot) return undefined;
    const layer = scope.layerIndex.get(parsed.id);
    if (!layer?.props.has(parsed.key) || layer.outputs.some((o) => o.key === parsed.key) || layer.instance?.component.interface.outputs[parsed.key]) return undefined;
    return this.snapshot.counts.get(path.layerPrefix + parsed.id) ?? 1;
  }

  /**
   * A layer property as copy "#n" draws it: loops wrap and an empty loop reads the default. Past the
   * last copy it reads like any value (inspect's note says there's no such copy).
   */
  private copyItem(target: ResolvedTarget, v: Value | Loop | undefined, copies: number): Value {
    const index = target.parsed.index ?? 0;
    if (!isLoop(v)) return v;
    if (index >= copies) return v.items[index];
    const n = v.items.length;
    const p = target.parsed;
    return n ? v.items[index % n] : p.kind === "layer" ? target.scope.layerIndex.get(p.id)?.defaults[p.key] : undefined;
  }

  private clearMismatches(): void {
    this.mismatchIssues.clear();
    this.mismatchSites.clear();
    this.mismatchSince.clear();
  }

  /** Drop the loop_length_mismatch warnings of layers whose loops fit their copies this frame. */
  private pruneMismatches(): void {
    for (const site of this.mismatchIssues.keys()) if (!this.mismatchSites.has(site)) this.mismatchIssues.delete(site);
    for (const site of this.mismatchSince.keys()) if (!this.mismatchSites.has(site)) this.mismatchSince.delete(site);
  }

  /**
   * A layer's copies met a loop of another length that only the running prototype knows (a filtered
   * list, a count from data). Right after a count changes, patches reading the layer still see last
   * frame's copies, so the warning waits for the second frame in a row.
   */
  private reportMismatch(root: CLayer, path: InstancePath, count: number, layer: CLayer, prop: CProp, length: number): void {
    const site = `${root.scope.key}|${root.id}`;
    if (this.mismatchSites.has(site)) return;
    this.mismatchSites.add(site);
    const since = this.mismatchSince.get(site);
    if (since === undefined) this.mismatchSince.set(site, this.frame);
    if (since === undefined || since === this.frame || this.mismatchIssues.has(site)) return;
    const name = (l: CLayer) => `"${l.node.name || l.id}"`;
    const what = `the ${layer.props.get(prop.key)?.name ?? prop.key} of ${name(layer)}`;
    const effect = length < count ? `so copy #${length} shows item #0 again` : length - count === 1 ? `so item #${count} doesn't show` : `so items #${count} to #${length - 1} don't show`;
    const issue: RuntimeIssue = {
      code: "loop_length_mismatch",
      severity: "warning",
      message: `Layer ${name(root)} makes ${plural(count, "copy", "copies")}, but ${what} is a loop of ${length} right now, ${effect}.`,
      hint: "These lengths come from the running prototype, like a filtered list or a count from data. Give the loops the same number of items, or link Repeat to the loop the copies should follow.",
      layerId: root.id,
    };
    if (path.parent) issue.componentPath = path.key;
    this.mismatchIssues.set(site, issue);
  }

  inspect(address: string): ValueInspection {
    const { target, missing } = this.locate(address);
    if (!target) return { value: undefined, ...(missing ? { note: this.missingCopyNote(missing) } : {}) };
    const raw = this.readTarget(target);
    const index = target.parsed.index;
    const copies = this.propCopies(target);
    const out: ValueInspection = { value: copies !== undefined ? this.copyItem(target, raw, copies) : isLoop(raw) ? raw.items[index ?? 0] : raw };
    // A component patch's port counts the copies of its instance that ran this frame (1 when it isn't looped).
    const instance = target.parsed.kind === "patch" ? target.scope.instances.get(target.parsed.id) : undefined;
    if (instance) {
      const { paths, replicated } = this.instancePaths(instance, target.path);
      out.copies = replicated ? paths.length : 1;
    }
    if (target.parsed.kind === "layer") {
      const layer = target.scope.layerIndex.get(target.parsed.id);
      const drawn = this.snapshot?.counts.get(target.path.layerPrefix + target.parsed.id);
      const count = drawn ?? (this.snapshot && layer ? 1 : undefined);
      if (count !== undefined) out.copies = count;
      const name = `Layer "${layer?.node.name || target.parsed.id}"`;
      if (count === 0) {
        out.note = `Not drawn: ${layer ? (this.emptyLayerNote(layer, target.path) ?? `${name} has 0 copies.`) : `${name} has 0 copies.`}`;
        return out;
      }
      if (count !== undefined && index !== undefined && index >= count) {
        out.note = count === 1 ? `${name} has 1 copy, so there's no #${index}.` : `${name} has ${count} copies (#0 to #${count - 1}), so there's no #${index}.`;
        return out;
      }
      if (copies !== undefined && count !== undefined && count > 0) {
        if (isLoop(raw) && raw.items.length === 0) {
          out.note = `Every copy of "${layer?.node.name || target.parsed.id}" uses the default. ${this.emptyValueNote(target)}`;
          return out;
        }
        // Reading a copied layer without "#n" reads its first copy.
        if (index === undefined && count > 1 && target.parsed.key !== "repeat") out.note = `copy #0 of ${count}`;
        return out;
      }
    }
    if (isLoop(raw)) {
      const n = raw.items.length;
      if (n === 0) out.note = this.emptyValueNote(target);
      else if (index !== undefined && index >= n) out.note = `It's a loop of ${plural(n, "item", "items")} (#0 to #${n - 1}), so there's no #${index}.`;
    }
    return out;
  }

  private missingCopyNote({ scope, host, copy, copies }: MissingCopy): string {
    const name = instanceLabel(scope);
    if (copies > 0) return `${name} has ${plural(copies, "copy", "copies")} (#0 to #${copies - 1}), so there's no #${copy} to read inside.`;
    const steps = traceEmptyInstance(this.emptyLoops, scope, host);
    const first = steps[0];
    if (first?.kind !== "instance") return `${name} has 0 copies, so there's nothing inside it to read.`;
    const entry = { phrase: first.input ? `its ${first.input} input` : "one of its loop inputs", port: first.input ?? "a loop input", noun: "inputs", site: name };
    return describeEmpty(this.emptyLoops, `Nothing to read: ${name} has 0 copies`, entry, first.erased, steps.slice(1)).message;
  }

  /** Why a layer drew 0 copies: its active warning, else the trail of its first empty property. */
  private emptyLayerNote(layer: CLayer, path: InstancePath): string | undefined {
    const inside = path.parent ? path : null;
    const issue = [...this.emptyIssues.values()].find((i) => i.layerId === layer.id && (i.componentPath ?? null) === (inside?.key ?? null));
    if (issue) return issue.message;
    let emptyProp = -1;
    let erased = 0;
    layer.bound.forEach((p, j) => {
      const v = p.binding.kind === "const" ? p.binding.value : this.read(p.binding, path, p.wholeLoop);
      if (p.wholeLoop || !isLoop(v)) return;
      if (v.items.length === 0) {
        if (emptyProp < 0) emptyProp = j;
      } else erased = Math.max(erased, v.items.length);
    });
    const trail = this.layerTrail(layer, path, emptyProp);
    return trail ? describeEmpty(this.emptyLoops, trail.head, trail.entry, erased, trail.steps).message : undefined;
  }

  /** Why an address reads as an empty loop: the trail of the output, input or property it names. */
  private emptyValueNote({ parsed, scope, path }: ResolvedTarget): string {
    const node = parsed.kind === "patch" ? scope.nodes.get(parsed.id) : undefined;
    const slot = node && node.outputIndex.get(parsed.key) === undefined ? node.inputIndex.get(parsed.key) : undefined;
    let binding: Binding | null;
    if (node && slot !== undefined) binding = node.bindings[slot] ?? null;
    else {
      const { index: _index, ...rest } = parsed;
      binding = this.graph.resolveLink(formatAddress(rest as ParsedAddress), scope)?.binding ?? null;
    }
    const steps = traceEmpty(this.emptyLoops, binding, path);
    if (!steps.length) return "It's an empty loop (0 items).";
    return describeEmpty(this.emptyLoops, "It's an empty loop", { phrase: "it", port: "", noun: "" }, 0, steps).message;
  }

  /**
   * Record a runtime issue once until restart. Issues raised inside a component instance carry its
   * instance path and dedupe per static scope, so replicated copies report once.
   */
  private addIssue(code: string, severity: RuntimeIssue["severity"], message: string, patchId?: Id, layerId?: Id, path?: InstancePath | null): void {
    const inside = path?.parent ? path : null;
    const key = `${code}|${patchId ?? ""}|${layerId ?? ""}|${inside?.scope.key ?? ""}|${message}`;
    if (this.runtimeIssues.has(key)) return;
    if (this.runtimeIssues.size >= MAX_RUNTIME_ISSUES) this.runtimeIssues.delete(this.runtimeIssues.keys().next().value!);
    const issue: RuntimeIssue = { code, severity, message };
    if (patchId !== undefined) issue.patchId = patchId;
    if (layerId !== undefined) issue.layerId = layerId;
    if (inside) issue.componentPath = inside.key;
    this.runtimeIssues.set(key, issue);
  }
}
