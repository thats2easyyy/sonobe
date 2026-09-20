/**
 * RuntimeHost: the one live engine runtime for the open document. It follows document revisions
 * (hot-swapping the graph on the next frame), runs the frame loop with play/pause/restart, meters
 * fps, routes prototype logs to the console store (with the engine's patch attribution), turns
 * runtime issues into diagnostics for the component they came from, feeds throttled live values and
 * per-frame pulse fires to the UI (inside component instances too), exposes per-patch timings,
 * drives DOM renderers, provides platform services with a global mute, gates project scripts on
 * trust, offers a restart when an edit leaves state from before it (staleState.ts), and creates
 * independent deterministic simulations for MCP.
 */

import { deviceScreenSize, type AssetRecord, type Diagnostic, type Id, type LayerRef, type SonobeDocument, type Value } from "@sonobe/core";
import {
  createRuntime,
  isLoop,
  valuesEqual,
  type EngineRegistry,
  type InputEvent,
  type Loop,
  type PatchTiming,
  type PlatformServices,
  type RuntimeIssue,
  type SceneFrame,
  type SceneNode,
  type SonobeRuntime,
  type TextMeasurer,
} from "@sonobe/engine";
import {
  createBrowserPlatform,
  createDomRenderer,
  createFontAssetRegistry,
  createLiveVideoOverlays,
  DomTextMeasurer,
  getMuteStore,
  type BrowserPlatform,
  type BrowserPlatformOptions,
  type DomRenderer,
  type LiveVideoOverlays,
  type MediaState,
  type MuteStore,
} from "@sonobe/renderer";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ConsoleStore } from "../state/console.ts";
import type { DocumentStore } from "../state/document.ts";
import { pulseOutputAddresses } from "../state/registry.ts";
import { createFpsMeter } from "./fpsMeter.ts";
import { componentIdForInstancePath, qualifyAddress } from "./instances.ts";
import { createMediaInfoCache, findSceneNode, type MediaInfoCache } from "./mediaInfo.ts";
import { createAnimationFrameScheduler, type FrameScheduler } from "./scheduler.ts";
import { createScriptTrustStore, withScriptTrust, type ScriptTrustStore } from "./scriptTrust.ts";
import { createSimulation, type Simulation } from "./simulation.ts";
import { freshStartDraws, stillStale, type StaleState } from "./staleState.ts";

export interface RuntimeHostOptions {
  registry: EngineRegistry;
  /** A document store to follow, or a fixed document (use setDocument to change it). */
  document: DocumentStore | SonobeDocument;
  scheduler?: FrameScheduler;
  /** "dom" (default when a DOM exists), "approximate", or a measurer. */
  textMeasurer?: TextMeasurer | "dom" | "approximate";
  console?: ConsoleStore;
  resolveAssetUrl?: (assetId: Id) => string | undefined;
  /** Asset records, for media names and sizes. */
  assetRecord?: (assetId: Id) => AssetRecord | undefined;
  /**
   * Platform services for patches: "browser" (default when a DOM exists), your own services, or null
   * for none. Simulations never get them.
   */
  platform?: PlatformServices | "browser" | null;
  /** Extra options for the browser platform (openExternal, readAssetBytes, fetch). */
  platformOptions?: Omit<BrowserPlatformOptions, "resolveAssetUrl" | "layerElement" | "mute">;
  /** Mute switch. Default: the app-wide switch (SONOBE_MUTE, ?mute=1, automation). */
  mute?: MuteStore;
  /** Trust gate for project scripts. Default: a store remembering trust in localStorage. */
  scriptTrust?: ScriptTrustStore;
  /**
   * Instance path of the component being edited ("" for the root, "card/badge" inside instances,
   * null when it isn't instantiated). Live values and pulses follow it. Call refreshScope() when it changes.
   */
  scope?: () => string | null;
  seed?: number;
  /** Start playing right away. Default true. */
  autoplay?: boolean;
  /** How often fps, frame counters, and runtime diagnostics publish. Default 250 ms. */
  statsIntervalMs?: number;
  /** Record per-patch timings from the start. Default false. */
  profile?: boolean;
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
  /** Speech and audio are silenced. */
  muted: boolean;
  /** Per-patch timings are being recorded. */
  profiling: boolean;
  /** Attached viewers. */
  viewers: number;
  /** Instance path live values and pulses follow ("" root, null when the component isn't instantiated). */
  scope: string | null;
  /** A layer this prototype draws no copies of since an edit, while a fresh start draws it: restarting helps. */
  staleState: StaleState | null;
}

export type LiveValues = Record<string, Value | Loop | undefined>;

/** Where unqualified addresses resolve: the component being edited, the root, or an explicit instance path. */
export type ValueScope = "current" | "root" | { instancePath: string };

export interface ValueSubscriptionOptions {
  /** Maximum updates per second. Default 30. */
  hz?: number;
  /** Default "current". Addresses that already contain an instance path ("card/pop.output") are read as given. */
  scope?: ValueScope;
}

export interface PulseFire {
  frame: number;
  /** Pulse outputs that fired this frame ("tap_card.tap", "@field.submitted"), relative to the scope. */
  addresses: string[];
  /** The component those addresses belong to. */
  component?: Id;
  /** Instance path of the scope ("" for the root). */
  instancePath?: string;
}

export interface AttachRendererOptions {
  scale?: number;
  showHitTargets?: boolean;
  editorMode?: boolean;
  /** Let videos play sound. Default false (muted). Ignored while muted. */
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
  /** Effective CSS pixels per prototype point (includes CSS zoom outside the renderer). */
  scale: number;
  devicePixelRatio: number;
  prototypeSize: [number, number];
}

export interface LayerBounds extends RectLike {
  /** CSS pixels per prototype point. */
  scale: number;
  /** Scene node key that was measured. */
  key: string;
}

export interface ViewerHandle {
  readonly renderer: DomRenderer;
  readonly container: HTMLElement;
  setScale(scale: number): void;
  setShowHitTargets(show: boolean, keys?: Iterable<string>): void;
  bounds(): ViewerBounds;
  /** Viewport rect of a layer drawn in this viewer (by scene key or layer id). */
  layerBounds(target: { layerId?: Id; key?: string }): LayerBounds | null;
  dispose(): void;
}

export interface RuntimeHost {
  readonly runtime: SonobeRuntime;
  readonly state: StoreApi<RuntimeHostState>;
  readonly textMeasurer: TextMeasurer | undefined;
  /** Services patches use (empty when there's no platform). */
  readonly platform: PlatformServices;
  readonly scriptTrust: ScriptTrustStore;
  readonly mediaInfo: MediaInfoCache;
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
  /** Called whenever restart() is asked for (the desktop restarts phones with it). Returns unsubscribe. */
  subscribeRestart(cb: () => void): () => void;
  /** Advance one frame now (for stepping while paused). */
  stepFrame(dtSeconds?: number): SceneFrame;
  /** Last produced scene, if any. */
  scene(): SceneFrame | null;
  /** Silence (or unsilence) speech and audio app-wide. */
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Record per-patch timings (off discards them). */
  setProfiling(on: boolean): void;
  /** Record timings while the returned function hasn't been called (reference counted, for panels). */
  profilePatches(): () => void;
  /** Average evaluate time per patch over the last ~1 s, slowest first (empty while not profiling). */
  patchTimings(): PatchTiming[];
  /** Ask the person to trust the project's scripts (restarts the prototype when they do). */
  requestScriptTrust(): Promise<boolean>;
  /** The instance path live values follow. */
  instancePath(): string | null;
  /** Re-read the scope provider (the component being edited changed). */
  refreshScope(): void;
  /** Read a value now, resolving unqualified addresses in `scope` (default "current"). */
  readValue(address: string, scope?: ValueScope): Value | Loop | undefined;
  /** Live values for addresses, at most `hz` times a second and only when something changed. */
  subscribeValues(addresses: readonly string[], cb: (values: LiveValues, frame: number) => void, options?: ValueSubscriptionOptions): () => void;
  /** Pulse outputs that fired in the current scope, once per frame that had any (for spark animations). */
  subscribePulses(cb: (fire: PulseFire) => void): () => void;
  /** Every produced frame. */
  subscribeFrame(cb: (scene: SceneFrame) => void): () => void;
  /** Draw the prototype into `container` and forward its input to the runtime. */
  attachRenderer(container: HTMLElement, options?: AttachRendererOptions): ViewerHandle;
  /** Bounds of the primary viewer, or null when none is attached. */
  viewerBounds(): ViewerBounds | null;
  /** Viewport rect of a layer in the primary viewer, or null. */
  layerBounds(target: { layerId?: Id; key?: string }): LayerBounds | null;
  /** An independent deterministic runtime (defaults to the current document). */
  createSimulation(options?: { document?: SonobeDocument; seed?: number; fps?: 60 | 120; textMeasurer?: TextMeasurer }): Simulation;
  dispose(): void;
}

function isDocumentStore(value: DocumentStore | SonobeDocument): value is DocumentStore {
  return typeof (value as Partial<DocumentStore>).getState === "function" && typeof (value as Partial<DocumentStore>).subscribe === "function";
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

/** How long after an edit the restart offer's fresh copy runs (edits in a burst run it once). */
const STALE_CHECK_DELAY_MS = 300;

const issueKey = (issues: readonly RuntimeIssue[]) => issues.map((i) => `${i.code}|${i.severity}|${i.patchId ?? ""}|${i.layerId ?? ""}|${i.componentPath ?? ""}|${i.message}`).join("\n");

/**
 * Runtime issues as editor diagnostics. With the document, issues raised inside component instances
 * are attributed to the component they came from; otherwise to `component`.
 */
export function issuesToDiagnostics(issues: readonly RuntimeIssue[], component: Id, doc?: SonobeDocument): Diagnostic[] {
  return issues.map((issue) => {
    const itemIds = [issue.patchId, issue.layerId].filter((id): id is Id => typeof id === "string");
    const owner = doc && issue.componentPath ? (componentIdForInstancePath(doc, issue.componentPath) ?? component) : component;
    const d: Diagnostic = { code: issue.code, severity: issue.severity, message: issue.message, component: owner, itemIds };
    if (issue.hint) d.hint = issue.hint;
    if (issue.suggestions?.length) d.suggestions = issue.suggestions;
    return d;
  });
}

/** True when an address already names an instance path ("card/pop.output", "@card/badge.scale"). */
const isQualified = (address: string) => address.includes("/");

/** The scene key of a layer: exact key, or the first node drawing that layer (preferring the scope). */
function sceneKeyFor(scene: SceneFrame | null, target: { layerId?: Id; key?: string }, prefix: string): string | undefined {
  if (target.key) return target.key;
  if (!target.layerId || !scene) return undefined;
  const scoped = prefix ? `${prefix}/${target.layerId}` : target.layerId;
  if (findSceneNode(scene, scoped)) return scoped;
  if (findSceneNode(scene, target.layerId)) return target.layerId;
  const stack: SceneNode[] = [...scene.roots];
  while (stack.length) {
    const node = stack.shift()!;
    if (node.layerId === target.layerId) return node.key;
    stack.push(...node.children);
  }
  return undefined;
}

export function createRuntimeHost(options: RuntimeHostOptions): RuntimeHost {
  const scheduler = options.scheduler ?? createAnimationFrameScheduler();
  const docStore = isDocumentStore(options.document) ? options.document : null;
  const statsInterval = options.statsIntervalMs ?? 250;
  const logSink = options.console;
  const mute = options.mute ?? getMuteStore();

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
  const assetRecord = (assetId: Id) => options.assetRecord?.(assetId) ?? currentDoc.assets[assetId];

  const trust = options.scriptTrust ?? createScriptTrustStore();
  trust.evaluate(currentDoc, docStore?.getState().projectPath ?? null);
  const registry = withScriptTrust(options.registry, () => trust.allowed());

  const mediaInfo = createMediaInfoCache({ resolveAssetUrl, assetRecord });
  // Imported web fonts: every surface on this page (viewers, canvas) draws their families.
  const fontAssets = createFontAssetRegistry(resolveAssetUrl);
  fontAssets.sync(currentDoc.assets);

  const viewers = new Set<ViewerHandle>();
  let primaryViewer: ViewerHandle | null = null;
  let lastScene: SceneFrame | null = null;
  let scope: string | null = options.scope?.() ?? "";

  let browserPlatform: BrowserPlatform | null = null;
  let platform: PlatformServices;
  if (options.platform === null) platform = {};
  else if (options.platform === undefined || options.platform === "browser") {
    if (options.platform === "browser" || typeof window !== "undefined") {
      browserPlatform = createBrowserPlatform({
        ...options.platformOptions,
        resolveAssetUrl,
        mute,
        layerElement: (ref: LayerRef) => {
          const key = ref.instance !== undefined ? `${ref.layerId}#${ref.instance}` : undefined;
          const found = sceneKeyFor(lastScene, key ? { key } : { layerId: ref.layerId }, scope ?? "");
          return found ? primaryViewer?.renderer.elementForKey(found) : undefined;
        },
      });
      platform = browserPlatform;
    } else platform = {};
  } else platform = options.platform;

  const runtime = createRuntime(currentDoc, {
    registry,
    ...(measurer ? { textMeasurer: measurer } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    platform,
    resolveAssetUrl,
    mediaInfo: (ref) => mediaInfo.info(ref),
    onLog: (level, args, source) => {
      logSink?.getState().push(level, args, source?.patchId !== undefined ? { source: source.patchId, ...(source.componentPath ? { componentPath: source.componentPath } : {}) } : { source: "prototype" });
    },
  });

  let explicitProfiling = options.profile === true;
  let profileRefs = 0;
  const applyProfiling = () => {
    const on = explicitProfiling || profileRefs > 0;
    runtime.setProfiling(on);
    if (state.getState().profiling !== on) state.setState({ profiling: on });
  };

  const state = createStore<RuntimeHostState>()(() => ({ playing: false, fps: 0, frame: -1, time: 0, frameMs: 0, diagnostics: [], muted: mute.getState().muted, profiling: false, viewers: 0, scope, staleState: null }));
  if (explicitProfiling) applyProfiling();
  const meter = createFpsMeter();
  const frameListeners = new Set<(scene: SceneFrame) => void>();
  const restartListeners = new Set<() => void>();
  const pulseListeners = new Set<(fire: PulseFire) => void>();
  interface ValueSub {
    addresses: string[];
    cb: (values: LiveValues, frame: number) => void;
    intervalMs: number;
    lastEmit: number;
    last: Map<string, unknown>;
    primed: boolean;
    scope: ValueScope;
    prefix: string | null | undefined;
  }
  const valueSubs = new Set<ValueSub>();

  let handle: number | null = null;
  let playing = false;
  let disposed = false;
  let lastNow: number | null = null;
  let pendingDoc: SonobeDocument | null = null;
  let pendingRestart = false;
  let refreshQueued = false;
  let frameMs = 0;
  let lastStatsAt = -Infinity;
  let lastIssues = "";
  let pulseAddresses: { component: Id; addresses: string[] } | null = null;
  /** The restart offer: an edit arrived while an empty_loop warning (or the offer) was up. */
  let staleArmed = false;
  /** Check once the swapped-in document has run a few frames: warnings come back after two. */
  let staleCheck: { afterFrame: number; notBefore: number } | null = null;

  const schedule = () => {
    if (handle === null && !disposed) handle = scheduler.request(tick);
  };

  const refresh = () => {
    if (playing) return;
    refreshQueued = true;
    schedule();
  };

  const prefixFor = (valueScope: ValueScope): string | null => (valueScope === "current" ? scope : valueScope === "root" ? "" : valueScope.instancePath);

  const read = (address: string, valueScope: ValueScope): Value | Loop | undefined => {
    if (isQualified(address)) return runtime.getRawValue(address);
    const prefix = prefixFor(valueScope);
    return prefix === null ? undefined : runtime.getRawValue(qualifyAddress(address, prefix));
  };

  const publishStats = (now: number, force: boolean) => {
    if (!force && now - lastStatsAt < statsInterval) return;
    lastStatsAt = now;
    const issues = runtime.issues();
    const key = issueKey(issues);
    const next: Partial<RuntimeHostState> = { fps: playing ? Math.round(meter.fps() * 10) / 10 : 0, frame: runtime.frame, time: runtime.time, frameMs };
    if (key !== lastIssues) {
      lastIssues = key;
      next.diagnostics = issuesToDiagnostics(issues, currentDoc.project.root, currentDoc);
    }
    // The copies came back without a restart (a pending check decides after an edit).
    const stale = state.getState().staleState;
    if (stale && !staleCheck && !stillStale(stale, issues)) next.staleState = null;
    state.setState(next);
  };

  const checkStale = (now: number) => {
    if (!staleCheck || runtime.frame < staleCheck.afterFrame || now < staleCheck.notBefore) return;
    staleCheck = null;
    const found = freshStartDraws(currentDoc, runtime.issues(), { registry, ...(measurer ? { textMeasurer: measurer } : {}), resolveAssetUrl, mediaInfo: (ref) => mediaInfo.info(ref) });
    const shown = state.getState().staleState;
    if (found?.layerId !== shown?.layerId || found?.componentPath !== shown?.componentPath || found?.copies !== shown?.copies) state.setState({ staleState: found });
  };

  const readValues = (sub: ValueSub): { values: LiveValues; changed: boolean } => {
    const values: LiveValues = {};
    const prefix = prefixFor(sub.scope);
    let changed = false;
    if (sub.prefix !== prefix) {
      sub.prefix = prefix;
      sub.last.clear();
      changed = true;
    }
    for (const address of sub.addresses) {
      const v = read(address, sub.scope);
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
    if (pulseListeners.size === 0 || scope === null) return;
    if (!pulseAddresses) {
      const component = componentIdForInstancePath(currentDoc, scope) ?? currentDoc.project.root;
      pulseAddresses = { component, addresses: pulseOutputAddresses(currentDoc, component, options.registry) };
    }
    const fired: string[] = [];
    for (const address of pulseAddresses.addresses) {
      const v = runtime.getRawValue(qualifyAddress(address, scope));
      if (v === true || (isLoop(v) && v.items.some((item) => item === true))) fired.push(address);
    }
    if (fired.length === 0) return;
    const fire: PulseFire = { frame, addresses: fired, component: pulseAddresses.component, instancePath: scope };
    for (const cb of [...pulseListeners]) cb(fire);
  };

  const runFrame = (dt: number, now: number, force: boolean): SceneFrame => {
    if (pendingDoc) {
      const doc = pendingDoc;
      pendingDoc = null;
      runtime.updateDocument(doc);
      pulseAddresses = null;
      if (staleArmed) {
        staleArmed = false;
        staleCheck = { afterFrame: runtime.frame + 3, notBefore: now + STALE_CHECK_DELAY_MS };
      }
    }
    if (pendingRestart) {
      pendingRestart = false;
      runtime.restart();
      browserPlatform?.reset();
      meter.reset();
      staleArmed = false;
      staleCheck = null;
      if (state.getState().staleState) state.setState({ staleState: null });
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
    for (const viewer of viewers) {
      viewer.renderer.render(scene);
      syncLiveMediaSafely(viewer, scene);
    }
    for (const cb of [...frameListeners]) cb(scene);
    emitPulses(scene.frame);
    emitValues(now, force);
    checkStale(now);
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
    if (!staleArmed) staleArmed = staleCheck !== null || state.getState().staleState !== null || runtime.issues().some((i) => i.code === "empty_loop");
    if (doc.assets !== currentDoc.assets) fontAssets.sync(doc.assets);
    currentDoc = doc;
    pendingDoc = doc;
    pulseAddresses = null;
    refresh();
  };

  const restart = () => {
    if (disposed) return;
    pendingRestart = true;
    logSink?.getState().push("info", "Prototype restarted", { source: "prototype" });
    refresh();
    for (const cb of [...restartListeners]) cb();
  };

  const unsubscribeDoc = docStore?.getState().subscribeRevision((s, previous) => {
    const change = s.lastChange;
    const opened = !!change && change !== previous.lastChange && (change.kind === "replace" || change.kind === "reload");
    if (opened) {
      if (change.kind === "replace") {
        pendingRestart = true;
        mediaInfo.clear();
      }
      trust.evaluate(s.doc, s.projectPath);
    } else {
      trust.noteDocument(s.doc);
    }
    setDocument(s.doc);
    if (opened) refreshScopeNow();
  });

  const unsubscribeTrust = trust.subscribeAllowed((allowed) => {
    if (allowed) restart();
  });

  const unsubscribeMute = mute.subscribe((s, previous) => {
    if (s.muted !== previous.muted) state.setState({ muted: s.muted });
  });

  function refreshScopeNow() {
    const next = options.scope?.() ?? "";
    if (next === scope) return;
    scope = next;
    pulseAddresses = null;
    state.setState({ scope });
    if (runtime.frame >= 0) emitValues(scheduler.now(), true);
  }

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

  // Camera feeds (live references) drawn as <video> overlays inside video layers.
  const liveOverlays = new WeakMap<ViewerHandle, LiveVideoOverlays>();
  let liveMediaWarned = false;
  function syncLiveMediaSafely(viewer: ViewerHandle, scene: SceneFrame) {
    if (!browserPlatform) return;
    try {
      let overlays = liveOverlays.get(viewer);
      if (!overlays) {
        overlays = createLiveVideoOverlays(viewer.renderer, browserPlatform);
        liveOverlays.set(viewer, overlays);
      }
      overlays.sync(scene);
    } catch (err) {
      if (liveMediaWarned) return;
      liveMediaWarned = true;
      logSink?.getState().push("warn", [`The viewer couldn't show a camera feed: ${err instanceof Error ? err.message : String(err)}`], { source: "prototype" });
    }
  }

  const host: RuntimeHost = {
    runtime,
    state,
    textMeasurer: measurer,
    platform,
    scriptTrust: trust,
    mediaInfo,
    document: () => currentDoc,
    setDocument,
    play,
    pause,
    togglePlay: () => (playing ? pause() : play()),
    isPlaying: () => playing,
    restart,

    subscribeRestart(cb) {
      restartListeners.add(cb);
      return () => {
        restartListeners.delete(cb);
      };
    },

    stepFrame(dtSeconds = 1 / 60) {
      return runFrame(dtSeconds, scheduler.now(), true);
    },

    scene: () => lastScene,

    setMuted(muted) {
      mute.setState({ muted, reason: muted ? "user" : null });
    },
    isMuted: () => mute.getState().muted,

    setProfiling(on) {
      explicitProfiling = on;
      applyProfiling();
    },

    profilePatches() {
      profileRefs++;
      applyProfiling();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        profileRefs = Math.max(0, profileRefs - 1);
        if (!disposed) applyProfiling();
      };
    },

    patchTimings: () => runtime.patchTimings(),

    requestScriptTrust: () => trust.request(),

    instancePath: () => scope,
    refreshScope: refreshScopeNow,
    readValue: (address, valueScope = "current") => read(address, valueScope),

    subscribeValues(addresses, cb, subOptions = {}) {
      const hz = Math.min(60, Math.max(1, subOptions.hz ?? 30));
      const sub: ValueSub = { addresses: [...new Set(addresses)], cb, intervalMs: 1000 / hz, lastEmit: -Infinity, last: new Map(), primed: false, scope: subOptions.scope ?? "current", prefix: undefined };
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
        allowAudio: (attachOptions.allowAudio ?? false) && !mute.getState().muted,
        scale,
        captureInput: attachOptions.captureInput ?? true,
        ...(domMeasurer ? { textMeasurer: domMeasurer } : {}),
        ...(attachOptions.devicePixelRatio !== undefined ? { devicePixelRatio: attachOptions.devicePixelRatio } : {}),
        onMediaState: (key, _layerId, media) => {
          runtime.setLayerOutputs(key, mediaOutputs(media));
          mediaInfo.reportForNode(lastScene, key, media);
        },
        onShaderError: (info) => {
          if (info.error) logSink?.getState().push("error", [`Shader error${info.error.line !== null ? ` on line ${info.error.line}` : ""}: ${info.error.message}`], { source: info.layerId });
        },
        ...(attachOptions.onFocusChange ? { onFocusChange: attachOptions.onFocusChange } : {}),
      });
      let disposedViewer = false;
      const prototypeSize = (): [number, number] => (lastScene ? [lastScene.size[0], lastScene.size[1]] : deviceScreenSize(currentDoc.project.device));
      const cssPerPoint = (stageWidth: number, size: [number, number]) => (size[0] > 0 && stageWidth > 0 ? stageWidth / size[0] : scale);
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
          const size = prototypeSize();
          return {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            stage: { x: stage.left, y: stage.top, width: stage.width, height: stage.height },
            scale: cssPerPoint(stage.width, size),
            devicePixelRatio: win?.devicePixelRatio ?? 1,
            prototypeSize: size,
          };
        },
        layerBounds(target) {
          const key = sceneKeyFor(lastScene, target, scope ?? "");
          const el = key ? renderer.elementForKey(key) : undefined;
          if (!key || !el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height, scale: cssPerPoint(renderer.stage.getBoundingClientRect().width, prototypeSize()), key };
        },
        dispose() {
          if (disposedViewer) return;
          disposedViewer = true;
          liveOverlays.get(viewer)?.dispose();
          liveOverlays.delete(viewer);
          viewers.delete(viewer);
          if (primaryViewer === viewer) primaryViewer = viewers.values().next().value ?? null;
          renderer.dispose();
          if (!disposed) state.setState({ viewers: viewers.size });
        },
      };
      viewers.add(viewer);
      if (attachOptions.primary || !primaryViewer) primaryViewer = viewer;
      state.setState({ viewers: viewers.size });
      if (lastScene) {
        renderer.render(lastScene);
        syncLiveMediaSafely(viewer, lastScene);
      } else refresh();
      return viewer;
    },

    viewerBounds: () => primaryViewer?.bounds() ?? null,
    layerBounds: (target) => primaryViewer?.layerBounds(target) ?? null,

    createSimulation(simOptions = {}) {
      return createSimulation({
        registry,
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
      unsubscribeTrust();
      unsubscribeMute();
      for (const viewer of [...viewers]) viewer.dispose();
      frameListeners.clear();
      restartListeners.clear();
      pulseListeners.clear();
      valueSubs.clear();
      runtime.dispose();
      browserPlatform?.dispose();
      mediaInfo.dispose();
      fontAssets.dispose();
      if (ownsMeasurer) domMeasurer?.dispose();
    },
  };

  if (options.autoplay !== false) play();
  return host;
}
