/** Internal renderer types shared by the reconciler and the per-type drawers. */

import type { LayerRef } from "@sonobe/core";
import type { InputEvent, SceneFrame, SceneNode } from "@sonobe/engine";
import type { PointerState } from "./input.ts";
import type { LottieLoader } from "./lottie.ts";
import type { ShaderCompileError, ShaderHost } from "./shader.ts";
import { setAttr } from "./style.ts";
import type { WriteStats } from "./style.ts";
import type { DomTextMeasurer } from "./textMeasurer.ts";
import type { PropReader } from "./values.ts";

export const SVG_NS = "http://www.w3.org/2000/svg";

/** One rendered SceneNode: an outer transformed element and an inner body holding content and children. */
export interface Host {
  readonly key: string;
  readonly type: string;
  layerId: string;
  /** Transform, size, opacity, blend, filters. */
  readonly el: HTMLElement;
  /** Fill, radius, clip; contains type content (parts) followed by child hosts. */
  readonly body: HTMLElement;
  /** Type content elements at the start of `body`, in order. */
  parts: Element[];
  stroke: HTMLElement | null;
  strokeSvg: SVGSVGElement | null;
  overlay: HTMLElement | null;
  children: Host[];
  /** z-index rank among siblings when zPosition reorders them ("" when they draw in document order). */
  zIndex: string;
  /** Children carry z-index ranks, so `body` is isolated and the ranks stay inside it. */
  stacked: boolean;
  /** Render generation in which this host was last visited. */
  gen: number;
  /** Drawer-private state. */
  state: Record<string, unknown>;
}

export interface RendererStats extends WriteStats {
  frames: number;
  created: number;
  removed: number;
  moved: number;
}

/** Media readouts a host can feed back into layer outputs (naturalSize, currentTime...). */
export interface MediaState {
  naturalSize?: [number, number];
  loading?: boolean;
  currentTime?: number;
  duration?: number;
}

export interface ShaderErrorInfo {
  key: string;
  layerId: string;
  /** null when a previously failing shader compiles again. */
  error: ShaderCompileError | null;
}

/** Mutable per-renderer context handed to drawers. */
export interface RenderContext {
  readonly doc: Document;
  readonly stats: RendererStats;
  frame: SceneFrame;
  prevTime: number;
  scale: number;
  dpr: number;
  editorMode: boolean;
  allowAudio: boolean;
  showHitTargets: boolean;
  hitTargetKeys: ReadonlySet<string>;
  /** True while drawing inside a hidden subtree (expensive draws are skipped). */
  hidden: boolean;
  readonly pointer: PointerState;
  readonly measurer: DomTextMeasurer;
  readonly shaders: ShaderHost;
  readonly loadLottie: LottieLoader;
  resolveAssetUrl(assetId: string): string | undefined;
  emit(events: InputEvent[]): void;
  findNode(ref: LayerRef): SceneNode | undefined;
  onShaderError?: (info: ShaderErrorInfo) => void;
  onMediaState?: (key: string, layerId: string, state: MediaState) => void;
  onFocusChange?: (layerId: string | null) => void;
}

/** What the common pass needs to know about a layer's drawn shape. */
export interface ShapeInfo {
  shape: "box" | "ellipse" | "none";
  radii: [number, number, number, number];
  smoothing: number;
  /** Shadows may use box-shadow on the body (the box has a visible fill). Otherwise drop-shadow on content alpha. */
  boxShadow: boolean;
  /** The type draws the common stroke props (strokeColor/strokeWidth/strokePosition). */
  stroke: boolean;
  /** Clip body contents to the box. */
  clip: boolean;
  /** Squircle corners shape the body via clip-path (false when the fill is shaped by a separate part). */
  squircleClip: boolean;
}

export interface Drawer {
  update(host: Host, node: SceneNode, p: PropReader, ctx: RenderContext): ShapeInfo;
  /** Children to reconcile instead of node.children (clone layers). */
  children?(host: Host, node: SceneNode, p: PropReader, ctx: RenderContext): readonly SceneNode[];
  dispose?(host: Host, ctx: RenderContext): void;
}

export const NO_SHAPE: ShapeInfo = Object.freeze({
  shape: "none",
  radii: [0, 0, 0, 0],
  smoothing: 0,
  boxShadow: false,
  stroke: false,
  clip: false,
  squircleClip: false,
}) as ShapeInfo;

/** Drawer state slot, created on first use. */
export function ensureState<T>(host: Host, name: string, init: () => T): T {
  if (!(name in host.state)) host.state[name] = init();
  return host.state[name] as T;
}

/** A named content element owned by the host (created once). */
export function partEl<K extends keyof HTMLElementTagNameMap>(host: Host, name: string, tag: K, className: string): HTMLElementTagNameMap[K] {
  return ensureState(host, `part:${name}`, () => {
    const el = host.body.ownerDocument.createElement(tag);
    el.className = className;
    return el;
  });
}

/** Ensures `body` starts with exactly these content parts, in order, ahead of child hosts. */
export function setParts(host: Host, parts: Element[]): void {
  const prev = host.parts;
  if (prev.length === parts.length && prev.every((p, i) => p === parts[i])) return;
  for (const old of prev) if (!parts.includes(old) && old.parentNode === host.body) host.body.removeChild(old);
  let ref: Node | null = host.body.firstChild;
  for (const part of parts) {
    if (part === ref) ref = ref.nextSibling;
    else host.body.insertBefore(part, ref);
  }
  host.parts = parts;
}

/** A labelled placeholder (missing media, failed Lottie loads, shader errors). */
export function placeholder(host: Host, ctx: RenderContext, label: string, tone: "neutral" | "error"): HTMLElement {
  const el = partEl(host, "placeholder", "div", "sonobe-placeholder");
  const st = ensureState(host, "placeholder", () => ({ label: "", tone: "" }));
  if (st.label !== label) {
    el.textContent = label;
    st.label = label;
  }
  if (st.tone !== tone) {
    setAttr(el, "data-tone", tone, ctx.stats);
    st.tone = tone;
  }
  setAttr(el, "title", label, ctx.stats);
  return el;
}
