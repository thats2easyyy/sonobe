/**
 * RuntimeHost: the one live engine runtime for the open document. It follows document revisions
 * (hot-swapping the graph on the next frame), runs the frame loop with play/pause/restart, meters
 * fps, routes prototype logs to the console store, turns runtime issues into diagnostics, feeds
 * throttled live values and per-frame pulse fires to the UI, drives DOM renderers, and creates
 * independent deterministic simulations for MCP.
 */

import { deviceScreenSize, type Diagnostic, type Id, type SonobeDocument, type Value } from "@sonobe/core";
import { createRuntime, isLoop, valuesEqual, type EngineRegistry, type InputEvent, type Loop, type PatchContext, type PatchDefinition, type PlatformServices, type RuntimeIssue, type SceneFrame, type SonobeRuntime, type TextMeasurer } from "@sonobe/engine";
import { createDomRenderer, DomTextMeasurer, type DomRenderer, type MediaState } from "@sonobe/renderer";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConsoleStore } from "../state/console.ts";
import type { DocumentStore } from "../state/document.ts";
import { pulseOutputAddresses } from "../state/registry.ts";
import { createFpsMeter } from "./fpsMeter.ts";
import { createAnimationFrameScheduler, type FrameScheduler } from "./scheduler.ts";
import { createSimulation, type Simulation } from "./simulation.ts";

export interface RuntimeHostOptions {
  registry: EngineRegistry;
  /** A document store to follow, or a fixed document (use setDocument to change it). */
  document: DocumentStore | SonobeDocument;
  scheduler?: FrameScheduler;
  /** "dom" (default when a DOM exists), "approximate", or a measurer. */
  textMeasurer?: TextMeasurer | "dom" | "approximate";
  console?: ConsoleStore;
  resolveAssetUrl?: (assetId: Id) => string | undefined;
  platform?: PlatformServices;
  seed?: number;
  /** Start playing right away. Default true. */
  autoplay?: boolean;
  /** How often fps, frame counters, and runtime diagnostics publish. Default 250 ms. */
  statsIntervalMs?: number;
}

export interface RuntimeHostState {
  playing: boolean;
  fps: number;
  frame: number;
  /** Seconds since the prototype started. */
  time: number;
  /** Milliseconds the last frame took to evaluate. */
  frameMs: number;
  /** Runtime issues (script errors, loop limits, unimplemented patches...) as diagnostics. */
  diagnostics: Diagnostic[];
}

export type LiveValues = Record<string, Value | Loop | undefined>;

export interface ValueSubscriptionOptions {
  /** Maximum updates per second. Default 30. */
  hz?: number;
}

export interface PulseFire {
  frame: number;
  /** Pulse outputs that fired this frame ("tap_card.tap", "@field.submitted"). */
  addresses: string[];
}

export interface AttachRendererOptions {
  scale?: number;
  showHitTargets?: boolean;
  editorMode?: boolean;
  /** Let videos play sound. Default false (muted). */
  allowAudio?: boolean;
  captureInput?: boolean;
  devicePixelRatio?: number;
  onFocusChange?: (layerId: string | null) => void;
  /** This viewer answers viewer.bounds (screenshots). Default: the first attached viewer. */
  primary?: boolean;
}

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewerBounds extends RectLike {
  /** The prototype stage inside the container, in CSS pixels. */
  stage: RectLike;
  scale: number;
  devicePixelRatio: number;
  prototypeSize: [number, number];
}

export interface ViewerHandle {
  readonly renderer: DomRenderer;
  readonly container: HTMLElement;
  setScale(scale: number): void;
  setShowHitTargets(show: boolean, keys?: Iterable<string>): void;
  bounds(): ViewerBounds;
  dispose(): void;
}

export interface RuntimeHost {
  readonly runtime: SonobeRuntime;
  readonly state: StoreApi<RuntimeHostState>;
  readonly textMeasurer: TextMeasurer | undefined;
  /** The document the runtime is (or will be, next frame) running. */
  document(): SonobeDocument;
  /** Swap in a document on the next frame. */
  setDocument(doc: SonobeDocument): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  isPlaying(): boolean;
  /** Start the prototype over on the next frame. */
  restart(): void;
  /** Advance one frame now (for stepping while paused). */
  stepFrame(dtSeconds?: number): SceneFrame;
  /** Last produced scene, if any. */
  scene(): SceneFrame | null;
  /** Live values for addresses, at most `hz` times a second and only when something changed. */
  subscribeValues(addresses: readonly string[], cb: (values: LiveValues, frame: number) => void, options?: ValueSubscriptionOptions): () => void;
  /** Pulse outputs that fired, once per frame that had any (for spark animations). */
  subscribePulses(cb: (fire: PulseFire) => void): () => void;
  /** Every produced frame. */
  subscribeFrame(cb: (scene: SceneFrame) => void): () => void;
  /** Draw the prototype into `container` and forward its input to the runtime. */
  attachRenderer(container: HTMLElement, options?: AttachRendererOptions): ViewerHandle;
  /** Bounds of the primary viewer, or null when none is attached. */
  viewerBounds(): ViewerBounds | null;
  /** An independent deterministic runtime (defaults to the current document). */
  createSimulation(options?: { document?: SonobeDocument; seed?: number; fps?: 60 | 120; textMeasurer?: TextMeasurer }): Simulation;
  dispose(): void;
}

function isDocumentStore(value: DocumentStore | SonobeDocument): value is DocumentStore {
  return typeof (value as Partial<DocumentStore>).getState === "function" && typeof (value as Partial<DocumentStore>).subscribe === "function";
}

/** Wrap evaluators so logs can be attributed to the patch being evaluated. */
function withLogAttribution(registry: EngineRegistry, track: { current: PatchContext | null }): EngineRegistry {
  const definitions = new Map<string, PatchDefinition>();
  for (const [type, def] of registry.definitions) {
    const evaluate = def.evaluate;
    definitions.set(type, {
      ...def,
      evaluate(ctx) {
        const previous = track.current;
        track.current = ctx;
        try {
          evaluate.call(def, ctx);
        } finally {
          track.current = previous;
        }
      },
    });
  }
  return { patches: registry.patches, layers: registry.layers, definitions };
}

/** Copy arrays and plain objects so later in-place writes don't hide changes. */
function snapshotValue(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== "object" || depth > 6) return v;
  if (Array.isArray(v)) return v.map((item) => snapshotValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, item] of Object.entries(v)) out[k] = snapshotValue(item, depth + 1);
  return out;
}

function mediaOutputs(state: MediaState): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [key, value] of Object.entries(state)) if (value !== undefined) out[key] = value as Value;
  return out;
}

const issueKey = (issues: readonly RuntimeIssue[]) => issues.map((i) => `${i.code}|${i.severity}|${i.patchId ?? ""}|${i.layerId ?? ""}|${i.message}`).join("\n");

/** Runtime issues as editor diagnostics (root component; the engine reports root-level ids). */
export function issuesToDiagnostics(issues: readonly RuntimeIssue[], component: Id): Diagnostic[] {
  return issues.map((issue) => {
    const itemIds = [issue.patchId, issue.layerId].filter((id): id is Id => typeof id === "string");
    return { code: issue.code, severity: issue.severity, message: issue.message, component, itemIds };
  });
}

export function createRuntimeHost(options: RuntimeHostOptions): RuntimeHost {
  const scheduler = options.scheduler ?? createAnimationFrameScheduler();
  const docStore = isDocumentStore(options.document) ? options.document : null;
  const statsInterval = options.statsIntervalMs ?? 250;
  const logSink = options.console;
  const track: { current: PatchContext | null } = { current: null };

  let domMeasurer: DomTextMeasurer | undefined;
  let measurer: TextMeasurer | undefined;
  if (options.textMeasurer && typeof options.textMeasurer === "object") {
    measurer = options.textMeasurer;
    if (options.textMeasurer instanceof DomTextMeasurer) domMeasurer = options.textMeasurer;
  } else if (options.textMeasurer !== "approximate" && typeof document !== "undefined") {
    domMeasurer = new DomTextMeasurer();
    measurer = domMeasurer;
  }
  const ownsMeasurer = domMeasurer !== undefined && domMeasurer !== options.textMeasurer;

  let currentDoc: SonobeDocument = docStore ? docStore.getState().doc : (options.document as SonobeDocument);
  const resolveAssetUrl = (assetId: Id) => options.resolveAssetUrl?.(assetId);

  const runtime = createRuntime(currentDoc, {
    registry: withLogAttribution(options.registry, track),
    ...(measurer ? { textMeasurer: measurer } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(options.platform ? { platform: options.platform } : {}),
    resolveAssetUrl,
    onLog: (level, args) => {
      const ctx = track.current;
      logSink?.getState().push(level, args, ctx ? { source: ctx.id, componentPath: ctx.componentPath } : { source: "prototype" });
    },
  });

  const state = createStore<RuntimeHostState>()(() => ({ playing: false, fps: 0, frame: -1, time: 0, frameMs: 0, diagnostics: [] }));
  const meter = createFpsMeter();
  const viewers = new Set<ViewerHandle>();
  const frameListeners = new Set<(scene: SceneFrame) => void>();
  const pulseListeners = new Set<(fire: PulseFire) => void>();
  interface ValueSub {
    addresses: string[];
    cb: (values: LiveValues, frame: number) => void;
    intervalMs: number;
    lastEmit: number;
    last: Map<string, unknown>;
    primed: boolean;
  }
  const valueSubs = new Set<ValueSub>();

  let primaryViewer: ViewerHandle | null = null;
  let handle: number | null = null;
  let playing = false;
  let disposed = false;
  let lastNow: number | null = null;
  let pendingDoc: SonobeDocument | null = null;
  let pendingRestart = false;
  let refreshQueued = false;
  let lastScene: SceneFrame | null = null;
  let frameMs = 0;
  let lastStatsAt = -Infinity;
  let lastIssues = "";
  let pulseAddresses: string[] | null = null;

  const schedule = () => {
    if (handle === null && !disposed) handle = scheduler.request(tick);
  };

  const refresh = () => {
    if (playing) return;
    refreshQueued = true;
    schedule();
  };

  const publishStats = (now: number, force: boolean) => {
    if (!force && now - lastStatsAt < statsInterval) return;
    lastStatsAt = now;
    const issues = runtime.issues();
    const key = issueKey(issues);
    const next: Partial<RuntimeHostState> = { fps: playing ? Math.round(meter.fps() * 10) / 10 : 0, frame: runtime.frame, time: runtime.time, frameMs };
    if (key !== lastIssues) {
      lastIssues = key;
      next.diagnostics = issuesToDiagnostics(issues, currentDoc.project.root);
    }
    state.setState(next);
  };

  const readValues = (sub: ValueSub): { values: LiveValues; changed: boolean } => {
    const values: LiveValues = {};
    let changed = false;
    for (const address of sub.addresses) {
      const v = runtime.getRawValue(address);
      values[address] = v;
      if (!sub.primed || !sub.last.has(address) || !valuesEqual(sub.last.get(address), v)) {
        changed = true;
        sub.last.set(address, snapshotValue(v));
      }
    }
    return { values, changed };
  };

  const emitValues = (now: number, force: boolean) => {
    for (const sub of valueSubs) {
      if (!force && sub.primed && now - sub.lastEmit < sub.intervalMs) continue;
      sub.lastEmit = now;
      const { values, changed } = readValues(sub);
      if (changed || !sub.primed) {
        sub.primed = true;
        sub.cb(values, runtime.frame);
      }
    }
  };

  const emitPulses = (frame: number) => {
    if (pulseListeners.size === 0) return;
    pulseAddresses ??= pulseOutputAddresses(currentDoc, currentDoc.project.root, options.registry);
    const fired: string[] = [];
    for (const address of pulseAddresses) {
      const v = runtime.getRawValue(address);
      if (v === true || (isLoop(v) && v.items.some((item) => item === true))) fired.push(address);
    }
    if (fired.length === 0) return;
    const fire: PulseFire = { frame, addresses: fired };
    for (const cb of [...pulseListeners]) cb(fire);
  };

  const runFrame = (dt: number, now: number, force: boolean): SceneFrame => {
    if (pendingDoc) {
      const doc = pendingDoc;
      pendingDoc = null;
      runtime.updateDocument(doc);
      pulseAddresses = null;
    }
    if (pendingRestart) {
      pendingRestart = false;
      runtime.restart();
      meter.reset();
    }
    const t0 = scheduler.now();
    let scene: SceneFrame;
    try {
      scene = runtime.step(dt);
    } catch (err) {
      logSink?.getState().push("error", [`The prototype stopped: ${err instanceof Error ? err.message : String(err)}`], { source: "prototype" });
      pause();
      publishStats(now, true);
      return lastScene ?? runtime.scene();
    }
    frameMs = scheduler.now() - t0;
    lastScene = scene;
    for (const viewer of viewers) viewer.renderer.render(scene);
    for (const cb of [...frameListeners]) cb(scene);
    emitPulses(scene.frame);
    emitValues(now, force);
    publishStats(now, force);
    return scene;
  };

  function tick(now: number) {
    handle = null;
    if (disposed) return;
    if (playing) {
      const dt = lastNow === null ? 0 : (now - lastNow) / 1000;
      lastNow = now;
      meter.tick(now);
      runFrame(dt, now, false);
      if (playing) schedule();
    } else if (refreshQueued) {
      refreshQueued = false;
      runFrame(0, now, true);
    }
  }

  function play() {
    if (playing || disposed) return;
    playing = true;
    lastNow = null;
    refreshQueued = false;
    meter.reset();
    state.setState({ playing: true });
    schedule();
  }

  function pause() {
    if (!playing) return;
    playing = false;
    if (handle !== null) {
      scheduler.cancel(handle);
      handle = null;
    }
    state.setState({ playing: false, fps: 0 });
  }

  const setDocument = (doc: SonobeDocument) => {
    if (disposed || doc === currentDoc) return;
    currentDoc = doc;
    pendingDoc = doc;
    refresh();
  };

  const unsubscribeDoc = docStore?.getState().subscribeRevision((s, previous) => {
    if (s.lastChange && s.lastChange !== previous.lastChange && s.lastChange.kind === "replace") pendingRestart = true;
    setDocument(s.doc);
  });

  const dispatchInput = (events: InputEvent[]) => {
    if (disposed || events.length === 0) return;
    if (playing) {
      runtime.dispatch(events);
      return;
    }
    const kept = events.filter((e) => e.kind === "text" || e.kind === "focus" || e.kind === "submit");
    if (kept.length) {
      runtime.dispatch(kept);
      refresh();
    }
  };

  const host: RuntimeHost = {
    runtime,
    state,
    textMeasurer: measurer,
    document: () => currentDoc,
    setDocument,
    play,
    pause,
    togglePlay: () => (playing ? pause() : play()),
    isPlaying: () => playing,

    restart() {
      if (disposed) return;
      pendingRestart = true;
      logSink?.getState().push("info", "Prototype restarted", { source: "prototype" });
      refresh();
    },

    stepFrame(dtSeconds = 1 / 60) {
      return runFrame(dtSeconds, scheduler.now(), true);
    },

    scene: () => lastScene,

    subscribeValues(addresses, cb, subOptions = {}) {
      const hz = Math.min(60, Math.max(1, subOptions.hz ?? 30));
      const sub: ValueSub = { addresses: [...new Set(addresses)], cb, intervalMs: 1000 / hz, lastEmit: -Infinity, last: new Map(), primed: false };
      valueSubs.add(sub);
      if (runtime.frame >= 0) {
        const { values } = readValues(sub);
        sub.primed = true;
        sub.lastEmit = scheduler.now();
        cb(values, runtime.frame);
      }
      return () => {
        valueSubs.delete(sub);
      };
    },

    subscribePulses(cb) {
      pulseListeners.add(cb);
      return () => {
        pulseListeners.delete(cb);
      };
    },

    subscribeFrame(cb) {
      frameListeners.add(cb);
      return () => {
        frameListeners.delete(cb);
      };
    },

    attachRenderer(container, attachOptions = {}) {
      let scale = attachOptions.scale ?? 1;
      const renderer = createDomRenderer(container, {
        resolveAssetUrl,
        onEvents: dispatchInput,
        showHitTargets: attachOptions.showHitTargets ?? false,
        editorMode: attachOptions.editorMode ?? false,
        allowAudio: attachOptions.allowAudio ?? false,
        scale,
        captureInput: attachOptions.captureInput ?? true,
        ...(domMeasurer ? { textMeasurer: domMeasurer } : {}),
        ...(attachOptions.devicePixelRatio !== undefined ? { devicePixelRatio: attachOptions.devicePixelRatio } : {}),
        onMediaState: (key, _layerId, media) => runtime.setLayerOutputs(key, mediaOutputs(media)),
        onShaderError: (info) => {
          if (info.error) logSink?.getState().push("error", [`Shader error${info.error.line !== null ? ` on line ${info.error.line}` : ""}: ${info.error.message}`], { source: info.layerId });
        },
        ...(attachOptions.onFocusChange ? { onFocusChange: attachOptions.onFocusChange } : {}),
      });
      let disposedViewer = false;
      const viewer: ViewerHandle = {
        renderer,
        container,
        setScale(next) {
          scale = next;
          renderer.setScale(next);
        },
        setShowHitTargets: (show, keys) => renderer.setShowHitTargets(show, keys),
        bounds() {
          const rect = container.getBoundingClientRect();
          const stage = renderer.stage.getBoundingClientRect();
          const win = container.ownerDocument.defaultView;
          return {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            stage: { x: stage.left, y: stage.top, width: stage.width, height: stage.height },
            scale,
            devicePixelRatio: win?.devicePixelRatio ?? 1,
            prototypeSize: lastScene ? [lastScene.size[0], lastScene.size[1]] : deviceScreenSize(currentDoc.project.device),
          };
        },
        dispose() {
          if (disposedViewer) return;
          disposedViewer = true;
          viewers.delete(viewer);
          if (primaryViewer === viewer) primaryViewer = viewers.values().next().value ?? null;
          renderer.dispose();
        },
      };
      viewers.add(viewer);
      if (attachOptions.primary || !primaryViewer) primaryViewer = viewer;
      if (lastScene) renderer.render(lastScene);
      else refresh();
      return viewer;
    },

    viewerBounds: () => primaryViewer?.bounds() ?? null,

    createSimulation(simOptions = {}) {
      return createSimulation({
        registry: options.registry,
        document: simOptions.document ?? currentDoc,
        ...(simOptions.seed !== undefined ? { seed: simOptions.seed } : {}),
        ...(simOptions.fps !== undefined ? { fps: simOptions.fps } : {}),
        ...(simOptions.textMeasurer ? { textMeasurer: simOptions.textMeasurer } : {}),
        resolveAssetUrl,
      });
    },

    dispose() {
      if (disposed) return;
      pause();
      disposed = true;
      unsubscribeDoc?.();
      for (const viewer of [...viewers]) viewer.dispose();
      frameListeners.clear();
      pulseListeners.clear();
      valueSubs.clear();
      runtime.dispose();
      if (ownsMeasurer) domMeasurer?.dispose();
    },
  };

  if (options.autoplay !== false) play();
  return host;
}
