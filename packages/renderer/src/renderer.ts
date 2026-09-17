/**
 * createDomRenderer: draws SceneFrames into nested DOM with keyed reconciliation and
 * minimal style writes, and captures input as engine InputEvents. See ARCHITECTURE.md §8.
 */

import type { LayerRef } from "@sonobe/core";
import type { InputEvent, SceneFrame, SceneNode } from "@sonobe/engine";
import { DRAWERS, FALLBACK_DRAWER, cssPath, hasSquircle, nodeHeight, nodeWidth } from "./drawers.ts";
import { SVG_NS } from "./host.ts";
import type { Drawer, Host, MediaState, RenderContext, RendererStats, ShaderErrorInfo, ShapeInfo } from "./host.ts";
import { attachInputCapture } from "./input.ts";
import type { PointerState } from "./input.ts";
import { loadLottiePlayer } from "./lottie.ts";
import type { LottieLoader } from "./lottie.ts";
import { IDENTITY, cssTransform, isMat4, translation } from "./matrix.ts";
import { cursorAt } from "./sceneQuery.ts";
import { ShaderHost } from "./shader.ts";
import { squirclePath } from "./squircle.ts";
import { setAttr, setStyle } from "./style.ts";
import { ensureStylesheet } from "./stylesheet.ts";
import { DomTextMeasurer } from "./textMeasurer.ts";
import { cssColor, fmt, parseColor, propReader, px, readLayerRef, readNumber } from "./values.ts";
import type { PropReader } from "./values.ts";

export interface DomRendererOptions {
  /** Maps asset ids to loadable URLs (object URLs, file URLs, dev-server paths). */
  resolveAssetUrl: (assetId: string) => string | undefined;
  /** Receives input captured on the container, in prototype coordinates. */
  onEvents?: (events: InputEvent[]) => void;
  /** Device pixel ratio for shader canvases. Defaults to window.devicePixelRatio. */
  devicePixelRatio?: number;
  /** Tint hit areas (and `hitTargetKeys`) so touch targets are visible. */
  showHitTargets?: boolean;
  /** Editor canvas mode: hit areas with "Show in Editor" are tinted and empty media shows a placeholder. */
  editorMode?: boolean;
  /** Let videos with volume > 0 play sound. Default false: media is always muted. */
  allowAudio?: boolean;
  /** Initial CSS scale of the stage. Default 1. */
  scale?: number;
  /** Attach pointer/wheel/keyboard capture to the container. Default true. */
  captureInput?: boolean;
  /** Share a measurer with the runtime so layout and drawing agree. */
  textMeasurer?: DomTextMeasurer;
  onShaderError?: (info: ShaderErrorInfo) => void;
  onMediaState?: (key: string, layerId: string, state: MediaState) => void;
  /** Called with the text field's layer id when it gains focus, and null on blur. */
  onFocusChange?: (layerId: string | null) => void;
  /** Supplies the Lottie player. Default: lazily imports lottie-web's SVG "light" build. */
  loadLottie?: LottieLoader;
}

export interface DomRenderer {
  /** The scaled element holding the prototype (prototype-size, clipped). */
  readonly stage: HTMLElement;
  render(frame: SceneFrame): void;
  setScale(scale: number): void;
  /** Toggle the hit-target overlay; `keys` adds overlays for interactive layers (by SceneNode key). */
  setShowHitTargets(show: boolean, keys?: Iterable<string>): void;
  /** Element rendered for a SceneNode key (devtools, tests, overlays). */
  elementForKey(key: string): HTMLElement | undefined;
  getStats(): RendererStats;
  dispose(): void;
}

const RENDERER_CSS = `
.sonobe-stage{position:absolute;left:0;top:0;overflow:hidden;transform-origin:0 0;pointer-events:none;user-select:none;-webkit-user-select:none;
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;-webkit-tap-highlight-color:transparent}
.sonobe-layer{position:absolute;left:0;top:0;transform-origin:0 0;box-sizing:border-box}
.sonobe-body{position:absolute;left:0;top:0;width:100%;height:100%;box-sizing:border-box;background-repeat:no-repeat}
.sonobe-fill{position:absolute;left:0;top:0;width:100%;height:100%}
.sonobe-media{position:absolute;left:0;top:0;width:100%;height:100%;display:block;margin:0;padding:0;border:0}
.sonobe-lottie>svg{display:block}
.sonobe-shape{position:absolute;left:0;top:0;overflow:visible}
.sonobe-text{margin:0;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;font-kerning:normal}
.sonobe-stroke{position:absolute;box-sizing:border-box;border-style:solid;pointer-events:none}
.sonobe-stroke-svg{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.sonobe-input{position:absolute;left:0;top:0;width:100%;height:100%;margin:0;padding:0;border:0;outline:none;background:transparent;box-shadow:none;
  resize:none;appearance:none;-webkit-appearance:none;pointer-events:auto;user-select:text;-webkit-user-select:text;overflow:hidden}
.sonobe-input::placeholder{color:var(--sonobe-placeholder,rgba(0,0,0,.4));opacity:1}
.sonobe-hit{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;background:rgba(124,92,255,.2);box-shadow:inset 0 0 0 1px rgba(124,92,255,.8)}
.sonobe-hit[data-slop]{outline:1px dashed rgba(124,92,255,.75)}
.sonobe-placeholder{position:absolute;left:0;top:0;width:100%;height:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:6px;
  font:500 11px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.01em;color:rgba(60,60,67,.75);text-align:center;overflow:hidden;
  white-space:pre-wrap;word-break:break-word;background:repeating-linear-gradient(135deg,rgba(120,120,128,.16) 0 6px,rgba(120,120,128,.07) 6px 12px);
  box-shadow:inset 0 0 0 1px rgba(120,120,128,.35)}
.sonobe-placeholder[data-tone="error"]{color:rgba(196,0,20,.95);background:repeating-linear-gradient(135deg,rgba(255,59,48,.16) 0 6px,rgba(255,59,48,.06) 6px 12px);
  box-shadow:inset 0 0 0 1px rgba(255,59,48,.5);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px}
`;

const BLEND_MODES: Record<string, string> = {
  multiply: "multiply", screen: "screen", overlay: "overlay", darken: "darken", lighten: "lighten",
  colorDodge: "color-dodge", colorBurn: "color-burn", hardLight: "hard-light", softLight: "soft-light",
  difference: "difference", exclusion: "exclusion", hue: "hue", saturation: "saturation", color: "color",
  luminosity: "luminosity", plusLighter: "plus-lighter",
};

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Longest increasing subsequence over `sources` (ignoring -1); returns the kept indices. */
export function lisIndices(sources: readonly number[]): Set<number> {
  const tails: number[] = [];
  const prev = new Array<number>(sources.length).fill(-1);
  for (let i = 0; i < sources.length; i++) {
    const v = sources[i]!;
    if (v < 0) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sources[tails[mid]!]! < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const keep = new Set<number>();
  let k = tails.length ? tails[tails.length - 1]! : -1;
  while (k >= 0) {
    keep.add(k);
    k = prev[k]!;
  }
  return keep;
}

function effectFilters(raw: unknown): string[] {
  const items: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && "__loop" in raw
      ? [...((raw as unknown as { items?: readonly unknown[] }).items ?? [])]
      : raw
        ? [raw]
        : [];
  const out: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const { kind, params = {} } = item as { kind?: unknown; params?: Record<string, unknown> };
    const n = (key: string, fallback: number) => readNumber(params[key], fallback);
    switch (kind) {
      case "blur":
        if (n("radius", 0) > 0) out.push(`blur(${px(n("radius", 0))})`);
        break;
      case "colorControls":
        if (n("brightness", 0) !== 0) out.push(`brightness(${fmt(1 + n("brightness", 0))})`);
        if (n("contrast", 1) !== 1) out.push(`contrast(${fmt(n("contrast", 1))})`);
        if (n("saturation", 1) !== 1) out.push(`saturate(${fmt(n("saturation", 1))})`);
        if (n("hue", 0) !== 0) out.push(`hue-rotate(${fmt(n("hue", 0))}deg)`);
        break;
      case "invert":
      case "grayscale":
      case "sepia":
        out.push(`${kind}(${fmt(clamp01(n("amount", 1)))})`);
        break;
      case "shadow": {
        const color = parseColor(params.color) ?? { r: 0, g: 0, b: 0, a: 1 };
        out.push(`drop-shadow(${px(n("offsetX", 0))} ${px(n("offsetY", 0))} ${px(Math.max(0, n("radius", 0)))} ${cssColor(color, clamp01(n("opacity", 1)))})`);
        break;
      }
    }
  }
  return out;
}

function radiusCss(info: ShapeInfo): string {
  if (info.shape === "ellipse") return "50%";
  if (info.shape !== "box") return "";
  const r = info.radii;
  if (r.every((v) => v === 0)) return "";
  return r.every((v) => v === r[0]) ? px(r[0]) : r.map(px).join(" ");
}

export function createDomRenderer(container: HTMLElement, opts: DomRendererOptions): DomRenderer {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  ensureStylesheet(container, "renderer", RENDERER_CSS);

  const stage = doc.createElement("div");
  stage.className = "sonobe-stage";
  container.appendChild(stage);

  const restoreStyles = { touchAction: container.style.touchAction, position: container.style.position, cursor: container.style.cursor };
  const addedTabIndex = !container.hasAttribute("tabindex");
  container.style.touchAction = "none";
  if (win && win.getComputedStyle(container).position === "static") container.style.position = "relative";
  if (addedTabIndex) container.tabIndex = 0;

  const stats: RendererStats = { frames: 0, created: 0, removed: 0, moved: 0, styleWrites: 0, attrWrites: 0 };
  const pointer: PointerState = { x: -1e6, y: -1e6, down: false, downX: -1e6, downY: -1e6, gestures: 0 };
  const ownsMeasurer = !opts.textMeasurer;
  const measurer = opts.textMeasurer ?? new DomTextMeasurer({ document: doc });
  const shaders = new ShaderHost(doc);
  const hosts = new Map<string, Host>();
  const rootHost: Host = { key: "", type: "stage", layerId: "", el: stage, body: stage, parts: [], stroke: null, strokeSvg: null, overlay: null, children: [], gen: 0, state: {} };

  let gen = 0;
  let lastFrame: SceneFrame | null = null;
  let scale = opts.scale ?? 1;
  let index: { byKey: Map<string, SceneNode>; byLayer: Map<string, SceneNode> } | null = null;
  let hasCursors = false;
  let cloneDepth = 0;
  let visited = 0;
  let disposed = false;
  let maskCounter = 0;
  const plusDarker = win?.CSS?.supports?.("mix-blend-mode", "plus-darker") ? "plus-darker" : "color-burn";

  const ctx: RenderContext = {
    doc,
    stats,
    frame: { frame: 0, time: 0, size: [0, 0], background: { r: 0, g: 0, b: 0, a: 0 }, roots: [] },
    prevTime: 0,
    scale,
    dpr: opts.devicePixelRatio ?? win?.devicePixelRatio ?? 1,
    editorMode: opts.editorMode ?? false,
    allowAudio: opts.allowAudio ?? false,
    showHitTargets: opts.showHitTargets ?? false,
    hitTargetKeys: new Set(),
    hidden: false,
    pointer,
    measurer,
    shaders,
    loadLottie: opts.loadLottie ?? loadLottiePlayer,
    resolveAssetUrl: opts.resolveAssetUrl,
    emit: (events) => {
      if (!disposed && events.length) opts.onEvents?.(events);
    },
    findNode: (ref: LayerRef) => {
      if (!index) {
        index = { byKey: new Map(), byLayer: new Map() };
        const walk = (nodes: readonly SceneNode[]) => {
          for (const n of nodes) {
            index!.byKey.set(n.key, n);
            if (!index!.byLayer.has(n.layerId)) index!.byLayer.set(n.layerId, n);
            if (n.children?.length) walk(n.children);
          }
        };
        walk(ctx.frame.roots);
      }
      const key = ref.instance !== undefined ? `${ref.layerId}#${ref.instance}` : ref.layerId;
      return index.byKey.get(key) ?? index.byLayer.get(ref.layerId);
    },
    onShaderError: opts.onShaderError,
    onMediaState: opts.onMediaState,
    onFocusChange: opts.onFocusChange,
  };

  const updateCursor = () => {
    const cursor = hasCursors && lastFrame ? cursorAt(lastFrame, pointer.x, pointer.y) : "";
    setStyle(container, "cursor", cursor === "none" ? "none" : cursor, stats);
  };

  const detachInput =
    opts.captureInput === false
      ? () => {}
      : attachInputCapture({
          container,
          stage,
          pointer,
          getSize: () => lastFrame?.size ?? null,
          getScale: () => scale,
          emit: ctx.emit,
          onPointerMove: () => {
            if (hasCursors) updateCursor();
          },
        });

  const drawerFor = (type: string): Drawer => DRAWERS[type] ?? FALLBACK_DRAWER;

  function createHost(key: string, node: SceneNode): Host {
    const el = doc.createElement("div");
    el.className = "sonobe-layer";
    const body = doc.createElement("div");
    body.className = "sonobe-body";
    el.appendChild(body);
    el.dataset.key = key;
    el.dataset.layer = node.layerId;
    el.dataset.type = node.type;
    const host: Host = { key, type: node.type, layerId: node.layerId, el, body, parts: [], stroke: null, strokeSvg: null, overlay: null, children: [], gen, state: {} };
    hosts.set(key, host);
    stats.created++;
    return host;
  }

  function destroyHost(host: Host): void {
    drawerFor(host.type).dispose?.(host, ctx);
    host.el.remove();
    hosts.delete(host.key);
    stats.removed++;
  }

  function acquire(node: SceneNode): Host {
    let key = node.key;
    let existing = hosts.get(key);
    // Duplicate keys in one frame get a stable suffix instead of stealing the element.
    for (let n = 2; existing && existing.gen === gen; n++) {
      key = `${node.key}~${n}`;
      existing = hosts.get(key);
    }
    if (existing && existing.type !== node.type) {
      destroyHost(existing);
      existing = undefined;
    }
    const host = existing ?? createHost(key, node);
    host.gen = gen;
    host.layerId = node.layerId;
    visited++;
    return host;
  }

  function arrange(parent: Host, next: Host[]): void {
    const container = parent.body;
    // Fast path: same children, same order, still attached here (the common animated frame).
    const prev = parent.children;
    if (prev.length === next.length) {
      let same = true;
      for (let k = 0; k < next.length; k++) {
        if (prev[k] !== next[k] || next[k]!.el.parentNode !== container) {
          same = false;
          break;
        }
      }
      if (same) {
        parent.children = next;
        return;
      }
    }
    const nextSet = new Set(next);
    for (const h of parent.children) {
      if (!nextSet.has(h) && h.el.parentNode === container) container.removeChild(h.el);
    }
    const oldIndex = new Map<Host, number>();
    let i = 0;
    for (const h of parent.children) if (nextSet.has(h) && h.el.parentNode === container) oldIndex.set(h, i++);
    const sources = next.map((h) => oldIndex.get(h) ?? -1);
    const keep = lisIndices(sources);
    let anchor: Node | null = null;
    for (let k = next.length - 1; k >= 0; k--) {
      const h = next[k]!;
      if (!keep.has(k)) {
        container.insertBefore(h.el, anchor);
        if (sources[k] !== -1) stats.moved++;
      }
      anchor = h.el;
    }
    parent.children = next;
  }

  function reconcile(parent: Host, nodes: readonly SceneNode[]): void {
    const next = nodes.map(acquire);
    arrange(parent, next);
    for (let k = 0; k < nodes.length; k++) {
      const node = nodes[k]!;
      const host = next[k]!;
      const drawer = drawerFor(node.type);
      const p = propReader(node.type, node.props ?? {});
      const visible = updateHost(host, node, p, drawer);
      const hiddenBefore = ctx.hidden;
      ctx.hidden = hiddenBefore || !visible;
      if (node.type === "clone") {
        cloneDepth++;
        reconcile(host, cloneChildren(node, p));
        cloneDepth--;
      } else {
        reconcile(host, drawer.children ? drawer.children(host, node, p, ctx) : (node.children ?? []));
      }
      ctx.hidden = hiddenBefore;
    }
  }

  /** A clone draws a keyed copy of its source subtree, placed at the clone's origin. */
  function cloneChildren(node: SceneNode, p: PropReader): SceneNode[] {
    if (cloneDepth > 4) return [];
    const ref = readLayerRef(p.raw("source"));
    const source = ref ? ctx.findNode(ref) : undefined;
    if (!source || source.key === node.key) return [];
    const prefix = `${node.key}⧉`;
    const copy = (n: SceneNode, parentKey: string, isRoot: boolean): SceneNode => {
      const key = prefix + n.key;
      return {
        ...n,
        key,
        parentKey,
        ...(isRoot ? { x: 0, y: 0, transform: [...IDENTITY], worldTransform: node.worldTransform, opacity: 1, visible: true } : {}),
        children: (n.children ?? []).map((c) => copy(c, key, false)),
      };
    };
    return [copy(source, node.key, true)];
  }

  /** Common pass: transform, size, visibility, blending, filters, shadows, radius, clip, stroke, overlay. */
  function updateHost(host: Host, node: SceneNode, p: PropReader, drawer: Drawer): boolean {
    const { el, body } = host;
    const w = nodeWidth(node);
    const h = nodeHeight(node);
    setStyle(el, "width", px(w), stats);
    setStyle(el, "height", px(h), stats);
    setStyle(el, "transform", cssTransform(isMat4(node.transform) ? node.transform : translation(node.x || 0, node.y || 0)), stats);
    const visible = node.visible !== false && p.bool("enabled", true);
    setStyle(el, "display", visible ? "" : "none", stats);
    const opacity = clamp01(readNumber(node.opacity, 1));
    setStyle(el, "opacity", opacity >= 1 ? "" : fmt(opacity), stats);
    const blend = p.str("blendMode", "normal");
    setStyle(el, "mix-blend-mode", blend === "plusDarker" ? plusDarker : (BLEND_MODES[blend] ?? ""), stats);
    if (typeof node.props?.cursor === "string" && node.props.cursor !== "auto") hasCursors = true;

    const hiddenBefore = ctx.hidden;
    ctx.hidden = hiddenBefore || !visible;
    const info = drawer.update(host, node, p, ctx);
    ctx.hidden = hiddenBefore;
    const squircle = info.shape === "box" && hasSquircle(info.radii, info.smoothing);
    const radius = squircle ? "" : radiusCss(info);
    setStyle(body, "border-radius", radius, stats);
    setStyle(body, "clip-path", squircle && info.squircleClip ? cssPath(squirclePath(0, 0, w, h, info.radii, info.smoothing)) : "", stats);
    setStyle(body, "overflow", info.clip ? "hidden" : "", stats);

    // Shadow and filter strings are only built when a layer has them (most don't).
    const shadowOpacity = clamp01(p.num("shadowOpacity", 0));
    const shadowColor = shadowOpacity > 0 ? p.color("shadowColor") : null;
    const hasShadow = !!shadowColor && shadowColor.a > 0;
    let shadow = "";
    if (hasShadow) {
      const [ox, oy] = p.vec("shadowOffset", 2, [0, 0]);
      shadow = `${px(ox!)} ${px(oy!)} ${px(Math.max(0, p.num("shadowRadius", 0)))} ${cssColor(shadowColor, shadowOpacity)}`;
    }
    const boxShadow = hasShadow && info.boxShadow && !squircle;
    setStyle(body, "box-shadow", boxShadow ? shadow : "", stats);

    const blur = Math.max(0, p.num("blur", 0));
    let filter = blur > 0 ? `blur(${px(blur)})` : "";
    const effects = p.raw("effects");
    if (effects) {
      const list = effectFilters(effects);
      if (list.length) filter = filter ? `${filter} ${list.join(" ")}` : list.join(" ");
    }
    if (hasShadow && !boxShadow) filter = filter ? `${filter} drop-shadow(${shadow})` : `drop-shadow(${shadow})`;
    setStyle(el, "filter", filter, stats);

    const backdrop = Math.max(0, p.num("backgroundBlur", 0));
    const backdropCss = backdrop > 0 ? `blur(${px(backdrop)})` : "";
    setStyle(el, "backdrop-filter", backdropCss, stats);
    setStyle(el, "-webkit-backdrop-filter", backdropCss, stats);
    setStyle(el, "border-radius", backdrop > 0 ? radius || (squircle ? radiusCss({ ...info, smoothing: 0 }) : "") : "", stats);

    if (info.stroke) updateStroke(host, p, info, w, h, squircle);
    else removeStroke(host);
    updateOverlay(host, node, p, radius || (squircle ? radiusCss({ ...info, smoothing: 0 }) : ""));
    return visible;
  }

  function removeStroke(host: Host): void {
    host.stroke?.remove();
    host.strokeSvg?.remove();
    host.stroke = null;
    host.strokeSvg = null;
  }

  function updateStroke(host: Host, p: PropReader, info: ShapeInfo, w: number, h: number, squircle: boolean): void {
    const sw = Math.max(0, p.num("strokeWidth", 0));
    const color = p.color("strokeColor");
    if (!(sw > 0) || !color || color.a <= 0) {
      removeStroke(host);
      return;
    }
    const position = p.str("strokePosition", "inside");
    const outset = position === "center" ? sw / 2 : position === "outside" ? sw : 0;
    if (!squircle) {
      host.strokeSvg?.remove();
      host.strokeSvg = null;
      if (!host.stroke) {
        host.stroke = doc.createElement("div");
        host.stroke.className = "sonobe-stroke";
        host.el.insertBefore(host.stroke, host.overlay);
      }
      const s = host.stroke;
      setStyle(s, "left", px(-outset), stats);
      setStyle(s, "top", px(-outset), stats);
      setStyle(s, "width", px(w + outset * 2), stats);
      setStyle(s, "height", px(h + outset * 2), stats);
      setStyle(s, "border-width", px(sw), stats);
      setStyle(s, "border-color", cssColor(color), stats);
      const radius = info.shape === "ellipse" ? "50%" : info.radii.every((r) => r === 0) ? "" : info.radii.map((r) => px(r > 0 ? r + outset : 0)).join(" ");
      setStyle(s, "border-radius", radius, stats);
      return;
    }
    // Smooth corners: fill an even-odd ring between the outer and inner squircle outlines.
    host.stroke?.remove();
    host.stroke = null;
    if (!host.strokeSvg) {
      const svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "sonobe-stroke-svg");
      svg.setAttribute("data-mask", String(++maskCounter));
      svg.appendChild(doc.createElementNS(SVG_NS, "path"));
      host.strokeSvg = svg;
      host.el.insertBefore(svg, host.overlay);
    }
    const inset = sw - outset;
    const outer = squirclePath(-outset, -outset, w + outset * 2, h + outset * 2, info.radii.map((r) => (r > 0 ? r + outset : 0)) as unknown as [number, number, number, number], info.smoothing);
    const inner = squirclePath(inset, inset, Math.max(0, w - inset * 2), Math.max(0, h - inset * 2), info.radii.map((r) => Math.max(0, r - inset)) as unknown as [number, number, number, number], info.smoothing);
    const svg = host.strokeSvg;
    setAttr(svg, "width", fmt(w), stats);
    setAttr(svg, "height", fmt(h), stats);
    const path = svg.firstChild as SVGPathElement;
    setAttr(path, "d", `${outer} ${inner}`, stats);
    setAttr(path, "fill", cssColor(color), stats);
    setAttr(path, "fill-rule", "evenodd", stats);
  }

  function updateOverlay(host: Host, node: SceneNode, p: PropReader, radius: string): void {
    const isHitArea = node.type === "hitArea";
    const show = ctx.showHitTargets ? isHitArea || ctx.hitTargetKeys.has(node.key) : isHitArea && ctx.editorMode && p.bool("showInEditor", true);
    if (!show) {
      host.overlay?.remove();
      host.overlay = null;
      return;
    }
    if (!host.overlay) {
      host.overlay = doc.createElement("div");
      host.overlay.className = "sonobe-hit";
      host.el.appendChild(host.overlay);
    }
    const slop = Math.max(0, p.num("hitSlop", 0));
    setAttr(host.overlay, "data-slop", slop > 0 ? "" : null, stats);
    setStyle(host.overlay, "outline-offset", slop > 0 ? px(slop) : "", stats);
    setStyle(host.overlay, "border-radius", radius, stats);
  }

  function render(frame: SceneFrame): void {
    if (disposed) return;
    gen++;
    stats.frames++;
    ctx.frame = frame;
    index = null;
    hasCursors = false;
    cloneDepth = 0;
    visited = 0;
    const [fw, fh] = frame.size;
    setStyle(stage, "width", px(fw), stats);
    setStyle(stage, "height", px(fh), stats);
    setStyle(stage, "transform", scale === 1 ? "" : `scale(${fmt(scale, 6)})`, stats);
    const bg = parseColor(frame.background);
    setStyle(stage, "background-color", bg && bg.a > 0 ? cssColor(bg) : "", stats);
    rootHost.gen = gen;
    reconcile(rootHost, frame.roots ?? []);
    // Every host was visited: nothing to sweep. (Deleting during Map iteration is safe.)
    if (visited !== hosts.size) for (const host of hosts.values()) if (host.gen !== gen) destroyHost(host);
    ctx.prevTime = frame.time;
    lastFrame = frame;
    if (hasCursors || container.style.cursor) updateCursor();
  }

  const rerender = () => {
    if (lastFrame) render(lastFrame);
  };
  const unsubscribeFonts = measurer.onInvalidate(rerender);
  const unsubscribeTextures = shaders.onTextureChange(rerender);

  return {
    stage,
    render,
    setScale(next: number) {
      if (!(next > 0) || !Number.isFinite(next)) return;
      scale = next;
      ctx.scale = next;
      setStyle(stage, "transform", scale === 1 ? "" : `scale(${fmt(scale, 6)})`, stats);
      if (lastFrame) render(lastFrame);
    },
    setShowHitTargets(show: boolean, keys?: Iterable<string>) {
      ctx.showHitTargets = show;
      if (keys) ctx.hitTargetKeys = new Set(keys);
      if (lastFrame) render(lastFrame);
    },
    elementForKey: (key) => hosts.get(key)?.el,
    getStats: () => ({ ...stats }),
    dispose() {
      if (disposed) return;
      for (const host of [...hosts.values()]) destroyHost(host);
      disposed = true;
      detachInput();
      unsubscribeFonts();
      unsubscribeTextures();
      shaders.dispose();
      if (ownsMeasurer) measurer.dispose();
      stage.remove();
      container.style.touchAction = restoreStyles.touchAction;
      container.style.position = restoreStyles.position;
      container.style.cursor = restoreStyles.cursor;
      if (addedTabIndex) container.removeAttribute("tabindex");
    },
  };
}
