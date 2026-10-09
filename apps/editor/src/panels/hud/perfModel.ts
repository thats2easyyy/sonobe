/** Performance tab helpers: frame samples, smoothness, document and scene counts, optional patch timings. */

import type { Id, Registry, SonobeDocument } from "@sonobe/core";
import { walkLayers } from "@sonobe/core";
import type { SceneFrame, SceneNode } from "@sonobe/engine";

export interface PerfSample {
  /** Sample time in ms (performance clock). */
  t: number;
  fps: number;
  /** Evaluate time of the last frame. */
  frameMs: number;
  playing: boolean;
  /** Playing with no frames running: nothing in the prototype moved (fps is 0, and nothing is wrong). */
  resting: boolean;
}

/** Append a sample, keeping the newest `capacity`. */
export function pushSample(samples: readonly PerfSample[], sample: PerfSample, capacity: number): PerfSample[] {
  const next = samples.length >= capacity ? samples.slice(samples.length - capacity + 1) : samples.slice();
  next.push(sample);
  return next;
}

export interface PerfSummary {
  fps: { latest: number; min: number; avg: number };
  frameMs: { latest: number; avg: number; max: number };
  /** Samples with frames running that fell under five sixths of the display's rate (50 fps at 60 Hz). */
  slowSamples: number;
  /** Samples with frames running: playing and not at rest. */
  playingSamples: number;
}

/** The rate smoothness is judged against: the display's, or 60 Hz until it is known. */
export const displayRateOr60 = (displayHz: number | undefined) => (displayHz && displayHz > 0 ? displayHz : 60);

/** Whether frames were running at a sample: paused and resting samples have no frame rate to judge. */
export const framesRan = (s: PerfSample) => s.playing && !s.resting && s.fps > 0;

export function summarizeSamples(samples: readonly PerfSample[], displayHz?: number): PerfSummary {
  const running = samples.filter(framesRan);
  const last = samples.at(-1);
  const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  const slow = displayRateOr60(displayHz) * (5 / 6);
  return {
    fps: { latest: last && framesRan(last) ? last.fps : 0, min: running.length ? Math.min(...running.map((s) => s.fps)) : 0, avg: avg(running.map((s) => s.fps)) },
    frameMs: { latest: last?.frameMs ?? 0, avg: avg(samples.map((s) => s.frameMs)), max: samples.length ? Math.max(...samples.map((s) => s.frameMs)) : 0 },
    slowSamples: running.filter((s) => s.fps < slow).length,
    playingSamples: running.length,
  };
}

export type SmoothnessTone = "success" | "warn" | "danger" | "neutral";

/**
 * Plain-language frame-rate status, judged against the display's rate (a 120 Hz display at 60 fps
 * drops every other frame). A prototype at rest runs no frames, which isn't a problem.
 */
export function smoothness(fps: number, playing: boolean, options: { resting?: boolean; displayHz?: number } = {}): { tone: SmoothnessTone; label: string } {
  if (!playing) return { tone: "neutral", label: "Paused" };
  if (options.resting) return { tone: "neutral", label: "At rest" };
  if (fps <= 0) return { tone: "neutral", label: "Starting" };
  const rate = displayRateOr60(options.displayHz);
  if (fps >= rate * 0.92) return { tone: "success", label: "Smooth" };
  if (fps >= rate * 0.5) return { tone: "warn", label: "Some dropped frames" };
  return { tone: "danger", label: "Choppy" };
}

/** Share of one frame at `fps` (16.7 ms at 60 Hz, 8.3 ms at 120 Hz) used by evaluation, 0..1+. */
export function frameBudgetShare(frameMs: number, fps = 60): number {
  return frameMs / (1000 / fps);
}

export interface DocumentStats {
  components: number;
  layers: number;
  patches: number;
  comments: number;
  /** Patch types used without a real evaluator, most used first. */
  unimplemented: { type: string; count: number }[];
}

export function documentStats(doc: SonobeDocument, isImplemented?: (type: string) => boolean, registry?: Registry): DocumentStats {
  let layers = 0;
  let patches = 0;
  let comments = 0;
  const missing = new Map<string, number>();
  for (const component of Object.values(doc.components)) {
    walkLayers(component.layers, () => {
      layers++;
    });
    comments += component.comments.length;
    for (const node of Object.values(component.patches)) {
      patches++;
      const known = registry ? registry.patches.has(node.type) : true;
      if (isImplemented && known && !isImplemented(node.type)) missing.set(node.type, (missing.get(node.type) ?? 0) + 1);
    }
  }
  const unimplemented = [...missing].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  return { components: Object.keys(doc.components).length, layers, patches, comments, unimplemented };
}

export interface ReplicatedLayer {
  layerId: Id;
  /** Scene instances drawn for this layer (loop replication). */
  count: number;
}

export interface SceneStats {
  nodes: number;
  visible: number;
  /** Nodes that are loop instances ("layerId#3"). */
  loopInstances: number;
  /** Replicated layers, most instances first. */
  replicated: ReplicatedLayer[];
}

export function sceneStats(scene: SceneFrame | null): SceneStats {
  if (!scene) return { nodes: 0, visible: 0, loopInstances: 0, replicated: [] };
  let nodes = 0;
  let visible = 0;
  let loopInstances = 0;
  const counts = new Map<Id, number>();
  const visit = (node: SceneNode) => {
    nodes++;
    if (node.visible && node.opacity > 0) visible++;
    const leaf = node.key.split("/").at(-1) ?? node.key;
    if (leaf.includes("#")) {
      loopInstances++;
      counts.set(node.layerId, (counts.get(node.layerId) ?? 0) + 1);
    }
    for (const child of node.children) visit(child);
  };
  for (const root of scene.roots) visit(root);
  const replicated = [...counts].map(([layerId, count]) => ({ layerId, count })).sort((a, b) => b.count - a.count || a.layerId.localeCompare(b.layerId));
  return { nodes, visible, loopInstances, replicated };
}

export interface PatchTiming {
  patchId: Id;
  /** Average evaluate time per frame in ms. */
  ms: number;
  componentPath?: string;
}

/**
 * Per-patch evaluate timings when the runtime exposes them (an optional `patchTimings()` method),
 * slowest first; null when it doesn't.
 */
export function patchTimingsOf(runtime: unknown, limit = 5): PatchTiming[] | null {
  const fn = (runtime as { patchTimings?: unknown } | null)?.patchTimings;
  if (typeof fn !== "function") return null;
  let raw: unknown;
  try {
    raw = (fn as () => unknown).call(runtime);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const timings: PatchTiming[] = [];
  for (const item of raw) {
    const t = item as Partial<PatchTiming> | null;
    if (!t || typeof t.patchId !== "string" || typeof t.ms !== "number" || !Number.isFinite(t.ms)) continue;
    timings.push({ patchId: t.patchId, ms: t.ms, ...(typeof t.componentPath === "string" ? { componentPath: t.componentPath } : {}) });
  }
  return timings.sort((a, b) => b.ms - a.ms).slice(0, limit);
}

/** "4.2 ms", "0.31 ms", "12 ms". */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "–";
  if (ms >= 10) return `${Math.round(ms)} ms`;
  if (ms >= 1) return `${ms.toFixed(1)} ms`;
  return `${ms.toFixed(2)} ms`;
}
