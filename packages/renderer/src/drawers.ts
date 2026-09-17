/** Per-layer-type drawing. Prop keys follow packages/core/src/layerTypes.ts. */

import type { Color, GradientValue } from "@sonobe/core";
import type { SceneNode } from "@sonobe/engine";
import { cssGradient } from "./gradient.ts";
import { NO_SHAPE, SVG_NS, ensureState, partEl, setParts } from "./host.ts";
import type { Drawer, Host, RenderContext, ShapeInfo } from "./host.ts";
import { approxScale, isMat4, unprojectPoint } from "./matrix.ts";
import { squirclePath } from "./squircle.ts";
import { setAttr, setStyle } from "./style.ts";
import { clampWeight, fontStack } from "./textMeasurer.ts";
import type { TextStyle } from "./textMeasurer.ts";
import { cssColor, fmt, px, readAssetUrl, readGradient, readShapePath, readVec } from "./values.ts";
import type { PropReader } from "./values.ts";

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const finite = (n: unknown, fallback = 0) => (typeof n === "number" && Number.isFinite(n) ? n : fallback);

export const nodeWidth = (node: SceneNode) => Math.max(0, finite(node.width));
export const nodeHeight = (node: SceneNode) => Math.max(0, finite(node.height));

/** Corner radii [topLeft, topRight, bottomRight, bottomLeft]: cornerRadii when set, else cornerRadius. */
export function readRadii(p: PropReader): [number, number, number, number] {
  const raw = p.raw("cornerRadii");
  if (Array.isArray(raw) && raw.length > 0) return readVec(raw, 4, [0, 0, 0, 0]).map((r) => Math.max(0, r)) as [number, number, number, number];
  const r = Math.max(0, p.num("cornerRadius", 0));
  return [r, r, r, r];
}

export const hasSquircle = (radii: readonly number[], smoothing: number) => smoothing > 0 && radii.some((r) => r > 0);

/** CSS path() argument with characters that could break out of the string removed. */
export const cssPath = (d: string) => `path("${d.replace(/["\\;{}]/g, "")}")`;

function paintFill(host: Host, ctx: RenderContext, w: number, h: number, color: Color | null, gradient: GradientValue | null, squircleD: string | null): HTMLElement | null {
  const s = ctx.stats;
  const bgColor = !gradient && color && color.a > 0 ? cssColor(color) : "";
  const bgImage = gradient ? cssGradient(gradient, w, h) : "";
  if (squircleD === null) {
    setStyle(host.body, "background-color", bgColor, s);
    setStyle(host.body, "background-image", bgImage, s);
    return null;
  }
  setStyle(host.body, "background-color", "", s);
  setStyle(host.body, "background-image", "", s);
  const fill = partEl(host, "fill", "div", "sonobe-fill");
  setStyle(fill, "background-color", bgColor, s);
  setStyle(fill, "background-image", bgImage, s);
  setStyle(fill, "clip-path", cssPath(squircleD), s);
  return fill;
}

/** A labelled placeholder (missing media, lottie without a player, shader errors). */
function placeholder(host: Host, ctx: RenderContext, label: string, tone: "neutral" | "error"): HTMLElement {
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

type BoxKind = "group" | "rectangle" | "oval" | "colorFill" | "gradient" | "componentInstance";

function boxDrawer(kind: BoxKind): Drawer {
  return {
    update(host, node, p, ctx) {
      const w = nodeWidth(node);
      const h = nodeHeight(node);
      const ellipse = kind === "oval";
      const radii: [number, number, number, number] = ellipse || kind === "colorFill" || kind === "componentInstance" ? [0, 0, 0, 0] : readRadii(p);
      const smoothing = ellipse ? 0 : clamp01(p.num("cornerSmoothing", 0));
      const squircle = !ellipse && hasSquircle(radii, smoothing);
      const container = kind === "group" || kind === "componentInstance";
      const clip = container ? node.clip ?? p.bool("clip", false) : false;
      const color = kind === "gradient" || kind === "componentInstance" ? null : p.color("color");
      const gradient = readGradient(kind === "gradient" ? p.raw("gradient") : node.props?.gradient);
      // A smooth-cornered group that doesn't clip must not clip its children with clip-path,
      // so its fill is drawn by a separate shaped element.
      const separateFill = squircle && container && !clip;
      const fillPart = paintFill(host, ctx, w, h, color, gradient, separateFill ? squirclePath(0, 0, w, h, radii, smoothing) : null);
      setParts(host, fillPart ? [fillPart] : []);
      const visibleFill = gradient ? gradient.stops.some((st) => st.color.a > 0) : !!color && color.a > 0;
      return {
        shape: ellipse ? "ellipse" : "box",
        radii,
        smoothing,
        boxShadow: visibleFill,
        stroke: kind === "group" || kind === "rectangle" || kind === "oval",
        clip,
        squircleClip: squircle && !separateFill,
      };
    },
  };
}

const VALIGN: Record<string, string> = { top: "flex-start", center: "center", bottom: "flex-end" };
const DECORATION: Record<string, string> = { underline: "underline", strikethrough: "line-through" };
const TEXT_TRANSFORMS = new Set(["uppercase", "lowercase", "capitalize"]);

export function readTextStyle(p: PropReader): TextStyle {
  const transform = p.str("textTransform", "none");
  return {
    fontFamily: p.str("fontFamily", "Inter"),
    fontSize: Math.max(0, p.num("fontSize", 17)),
    fontWeight: p.num("fontWeight", 400),
    letterSpacing: p.num("letterSpacing", 0),
    lineHeight: Math.max(0, p.num("lineHeight", 0)),
    italic: p.bool("italic", false),
    textTransform: TEXT_TRANSFORMS.has(transform) ? (transform as TextStyle["textTransform"]) : "none",
  };
}

function applyTextStyle(el: HTMLElement, ctx: RenderContext, style: TextStyle, lineHeight: number, color: Color | null, align: string, withTransform: boolean): void {
  const s = ctx.stats;
  setStyle(el, "font-family", fontStack(style.fontFamily), s);
  setStyle(el, "font-size", px(style.fontSize), s);
  setStyle(el, "font-weight", String(clampWeight(style.fontWeight)), s);
  setStyle(el, "font-style", style.italic ? "italic" : "", s);
  setStyle(el, "color", color ? cssColor(color) : "", s);
  setStyle(el, "text-align", align === "center" || align === "right" || align === "justify" ? align : "", s);
  setStyle(el, "letter-spacing", style.letterSpacing ? px(style.letterSpacing) : "", s);
  setStyle(el, "line-height", px(lineHeight), s);
  setStyle(el, "text-transform", withTransform && style.textTransform !== "none" ? style.textTransform! : "", s);
}

const textDrawer: Drawer = {
  update(host, node, p, ctx) {
    const s = ctx.stats;
    const style = readTextStyle(p);
    const lineHeight = ctx.measurer.lineHeightFor(style);
    const maxLines = Math.max(0, Math.floor(p.num("maxLines", 0)));
    const truncation = p.str("truncation", "end");
    const middle = maxLines > 0 && truncation === "middle";
    const clampEnd = maxLines > 0 && truncation !== "middle" && truncation !== "clip";
    const textEl = partEl(host, "text", "div", "sonobe-text");
    setParts(host, [textEl]);
    setStyle(host.body, "display", "flex", s);
    setStyle(host.body, "flex-direction", "column", s);
    setStyle(host.body, "justify-content", VALIGN[p.str("verticalAlignment", "top")] ?? "flex-start", s);
    applyTextStyle(textEl, ctx, style, lineHeight, p.color("textColor"), p.str("textAlignment", "left"), !middle);
    setStyle(textEl, "text-decoration-line", DECORATION[p.str("textDecoration", "none")] ?? "", s);
    setStyle(textEl, "display", clampEnd ? "-webkit-box" : "", s);
    setStyle(textEl, "-webkit-box-orient", clampEnd ? "vertical" : "", s);
    setStyle(textEl, "-webkit-line-clamp", clampEnd ? String(maxLines) : "", s);
    setStyle(textEl, "overflow", maxLines > 0 ? "hidden" : "", s);
    setStyle(textEl, "max-height", maxLines > 0 ? px(lineHeight * maxLines) : "", s);
    const text = p.str("text", "");
    const content = middle ? ctx.measurer.truncateMiddleLines(text, style, nodeWidth(node), maxLines) : text;
    const st = ensureState(host, "text", () => ({ content: null as string | null }));
    if (st.content !== content) {
      textEl.textContent = content;
      st.content = content;
    }
    return NO_SHAPE;
  },
};

const OBJECT_FIT: Record<string, string> = { fill: "cover", fit: "contain", stretch: "fill", tile: "none" };

const cssUrl = (url: string) => `url("${url.replace(/["\\\n]/g, (c) => (c === "\n" ? "" : `\\${c}`))}")`;

const imageDrawer: Drawer = {
  update(host, node, p, ctx) {
    const s = ctx.stats;
    const url = readAssetUrl(p.raw("image"), ctx.resolveAssetUrl);
    const mode = p.str("fillMode", "fill");
    const radii = readRadii(p);
    const smoothing = clamp01(p.num("cornerSmoothing", 0));
    if (!url) {
      setStyle(host.body, "background-image", "", s);
      setParts(host, ctx.editorMode ? [placeholder(host, ctx, "No image", "neutral")] : []);
    } else if (mode === "tile") {
      setParts(host, []);
      setStyle(host.body, "background-image", cssUrl(url), s);
      setStyle(host.body, "background-repeat", "repeat", s);
    } else {
      setStyle(host.body, "background-image", "", s);
      setStyle(host.body, "background-repeat", "", s);
      const img = ensureState(host, "img", () => {
        const el = host.body.ownerDocument.createElement("img");
        el.className = "sonobe-media";
        el.alt = "";
        el.draggable = false;
        el.decoding = "async";
        const report = (loading: boolean) => ctx.onMediaState?.(host.key, host.layerId, { naturalSize: [el.naturalWidth, el.naturalHeight], loading });
        el.addEventListener("load", () => report(false));
        el.addEventListener("error", () => report(false));
        return el;
      });
      setAttr(img, "src", url, s);
      setStyle(img, "object-fit", OBJECT_FIT[mode] ?? "cover", s);
      setParts(host, [img]);
    }
    return { shape: "box", radii, smoothing, boxShadow: false, stroke: true, clip: true, squircleClip: hasSquircle(radii, smoothing) };
  },
};

interface VideoState {
  el: HTMLVideoElement;
  src: string | null;
  scrubTime: number | null;
  blockedAtGesture: number | null;
  pending: boolean;
  reported: string;
}

const videoDrawer: Drawer = {
  update(host, node, p, ctx) {
    const s = ctx.stats;
    const st = ensureState<VideoState>(host, "video", () => {
      const el = host.body.ownerDocument.createElement("video");
      el.className = "sonobe-media";
      el.muted = true;
      el.defaultMuted = true;
      el.playsInline = true;
      el.preload = "auto";
      el.setAttribute("muted", "");
      el.setAttribute("playsinline", "");
      el.disablePictureInPicture = true;
      return { el, src: null, scrubTime: null, blockedAtGesture: null, pending: false, reported: "" };
    });
    const video = st.el;
    setParts(host, [video]);
    const url = readAssetUrl(p.raw("video"), ctx.resolveAssetUrl);
    if (url !== st.src) {
      st.src = url;
      st.scrubTime = null;
      st.blockedAtGesture = null;
      if (url) video.src = url;
      else {
        video.removeAttribute("src");
        video.load?.();
      }
    }
    setStyle(video, "object-fit", OBJECT_FIT[p.str("fillMode", "fill")] ?? "cover", s);
    const volume = clamp01(p.num("volume", 1));
    const muted = !(ctx.allowAudio && volume > 0);
    if (video.muted !== muted) video.muted = muted;
    if (!muted && Math.abs(video.volume - volume) > 1e-3) video.volume = volume;
    const loop = p.bool("loop", true);
    if (video.loop !== loop) video.loop = loop;
    const rate = p.num("rate", 1);
    if (rate > 0) {
      const r = Math.max(0.0625, Math.min(16, rate));
      if (Math.abs(video.playbackRate - r) > 1e-3) video.playbackRate = r;
    }
    if (url) {
      if (p.bool("scrub", false)) {
        if (!video.paused) video.pause();
        const t = Math.max(0, p.num("scrubTime", 0));
        if (st.scrubTime === null || Math.abs(st.scrubTime - t) > 1e-4) {
          st.scrubTime = t;
          try {
            video.currentTime = t;
          } catch {
            st.scrubTime = null; // Not seekable until metadata loads; retry next frame.
          }
        }
      } else {
        st.scrubTime = null;
        const shouldPlay = p.bool("playing", true) && rate > 0 && !ctx.hidden;
        if (shouldPlay && video.paused && !st.pending && st.blockedAtGesture !== ctx.pointer.gestures) {
          st.pending = true;
          const gesture = ctx.pointer.gestures;
          Promise.resolve(video.play?.())
            .catch(() => {
              st.blockedAtGesture = gesture;
            })
            .finally(() => {
              st.pending = false;
            });
        } else if (!shouldPlay && !video.paused) {
          video.pause();
        }
      }
    }
    if (ctx.onMediaState && video.readyState > 0) {
      const state = { currentTime: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0, naturalSize: [video.videoWidth, video.videoHeight] as [number, number] };
      const signature = `${fmt(state.currentTime, 3)}|${fmt(state.duration, 3)}|${state.naturalSize.join("x")}`;
      if (signature !== st.reported) {
        st.reported = signature;
        ctx.onMediaState(host.key, host.layerId, state);
      }
    }
    const radii = readRadii(p);
    const smoothing = clamp01(p.num("cornerSmoothing", 0));
    return { shape: "box", radii, smoothing, boxShadow: true, stroke: false, clip: true, squircleClip: hasSquircle(radii, smoothing) };
  },
  dispose(host) {
    const st = host.state.video as VideoState | undefined;
    if (!st) return;
    try {
      st.el.pause();
      st.el.removeAttribute("src");
      st.el.load?.();
    } catch {
      // Element already torn down.
    }
  },
};

interface ShapeState {
  svg: SVGSVGElement;
  path: SVGPathElement;
}

const shapeDrawer: Drawer = {
  update(host, node, p, ctx) {
    const s = ctx.stats;
    const d = readShapePath(p.raw("shape"));
    if (!d) {
      setParts(host, []);
      return NO_SHAPE;
    }
    const st = ensureState<ShapeState>(host, "shape", () => {
      const doc = host.body.ownerDocument;
      const svg = doc.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "sonobe-shape");
      const path = doc.createElementNS(SVG_NS, "path");
      svg.appendChild(path);
      return { svg, path };
    });
    const { svg, path } = st;
    setAttr(svg, "width", fmt(nodeWidth(node)), s);
    setAttr(svg, "height", fmt(nodeHeight(node)), s);
    setAttr(path, "d", d, s);
    const gradient = readGradient(node.props?.gradient);
    const color = p.color("color");
    let gradientPart: HTMLElement | null = null;
    if (gradient) {
      gradientPart = partEl(host, "gradient", "div", "sonobe-fill");
      setStyle(gradientPart, "background-image", cssGradient(gradient, nodeWidth(node), nodeHeight(node)), s);
      setStyle(gradientPart, "clip-path", cssPath(d), s);
      setAttr(path, "fill", "none", s);
    } else {
      setAttr(path, "fill", color && color.a > 0 ? cssColor(color) : "none", s);
    }
    const sw = Math.max(0, p.num("strokeWidth", 0));
    const strokeColor = p.color("strokeColor");
    const start = clamp01(p.num("strokeStart", 0));
    const end = clamp01(p.num("strokeEnd", 1));
    const stroked = sw > 0 && !!strokeColor && strokeColor.a > 0 && end > start;
    setAttr(path, "stroke", stroked ? cssColor(strokeColor!) : null, s);
    setAttr(path, "stroke-width", stroked ? fmt(sw) : null, s);
    setAttr(path, "stroke-linecap", stroked ? p.str("lineCap", "round") : null, s);
    setAttr(path, "stroke-linejoin", stroked ? p.str("lineJoin", "round") : null, s);
    const trimmed = stroked && (start > 0 || end < 1);
    // pathLength normalizes the path to 1000 units so the dash pattern trims by fraction.
    setAttr(path, "pathLength", trimmed ? "1000" : null, s);
    setAttr(path, "stroke-dasharray", trimmed ? `${fmt((end - start) * 1000)} 2000` : null, s);
    setAttr(path, "stroke-dashoffset", trimmed ? fmt(-start * 1000) : null, s);
    setParts(host, gradientPart ? [gradientPart, svg] : [svg]);
    return NO_SHAPE;
  },
};

const hitAreaDrawer: Drawer = {
  update(host) {
    setParts(host, []);
    return NO_SHAPE;
  },
};

interface TextFieldState {
  input: HTMLInputElement | HTMLTextAreaElement;
  multiline: boolean;
  lastText: string | null;
  lastFocused: boolean | null;
}

const KEYBOARD_MODES: Record<string, string> = { number: "decimal", email: "email", url: "url", phone: "tel" };

function createInput(host: Host, ctx: RenderContext, multiline: boolean): HTMLInputElement | HTMLTextAreaElement {
  const doc = host.body.ownerDocument;
  const input = multiline ? doc.createElement("textarea") : doc.createElement("input");
  input.className = "sonobe-input";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "off");
  input.spellcheck = false;
  input.addEventListener("input", () => ctx.emit([{ kind: "text", layerId: host.layerId, value: input.value }]));
  input.addEventListener("focus", () => ctx.onFocusChange?.(host.layerId));
  input.addEventListener("blur", () => ctx.onFocusChange?.(null));
  return input;
}

const textFieldDrawer: Drawer = {
  update(host, node, p, ctx) {
    const s = ctx.stats;
    const multiline = p.bool("multiline", false);
    let st = host.state.field as TextFieldState | undefined;
    if (!st || st.multiline !== multiline) {
      const previous = st;
      st = { input: createInput(host, ctx, multiline), multiline, lastText: null, lastFocused: null };
      host.state.field = st;
      if (previous) previous.input.remove();
    }
    const input = st.input;
    setParts(host, [input]);
    const style = readTextStyle(p);
    applyTextStyle(input, ctx, style, ctx.measurer.lineHeightFor(style), p.color("textColor"), p.str("textAlignment", "left"), true);
    const placeholderColor = p.color("placeholderColor");
    setStyle(input, "--sonobe-placeholder", placeholderColor ? cssColor(placeholderColor) : "", s);
    const textColor = p.color("textColor");
    setStyle(input, "caret-color", textColor ? cssColor(textColor, 1 / Math.max(textColor.a, 1e-3)) : "", s);
    setAttr(input, "placeholder", p.str("placeholder", ""), s);
    const keyboard = p.str("keyboardType", "default");
    setAttr(input, "inputmode", KEYBOARD_MODES[keyboard] ?? null, s);
    if (!multiline) setAttr(input, "type", p.bool("secure", false) ? "password" : "text", s);
    setAttr(input, "aria-label", node.layerId, s);
    // Text and focus are edge-triggered: only changes to the props push into the field,
    // so typing isn't overwritten by the unchanged authored value every frame.
    const text = p.str("text", "");
    if (st.lastText !== text) {
      if (input.value !== text) input.value = text;
      st.lastText = text;
    }
    const focused = p.bool("focused", false);
    if (st.lastFocused !== focused) {
      if (focused) input.focus({ preventScroll: true });
      else if (st.lastFocused !== null && input.ownerDocument.activeElement === input) input.blur();
      st.lastFocused = focused;
    }
    return NO_SHAPE;
  },
};

interface ShaderState {
  canvas: HTMLCanvasElement;
  signature: string;
  error: string | null;
  reportedError: string | undefined;
}

const DEFAULT_SHADER = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec2 uv = fragCoord / iResolution.xy;\n  fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);\n}\n";

const shaderDrawer: Drawer = {
  update(host, node, p, ctx) {
    const st = ensureState<ShaderState>(host, "shader", () => {
      const canvas = host.body.ownerDocument.createElement("canvas");
      canvas.className = "sonobe-media";
      return { canvas, signature: "", error: null, reportedError: undefined };
    });
    const radii = readRadii(p);
    const smoothing = clamp01(p.num("cornerSmoothing", 0));
    const info: ShapeInfo = { shape: "box", radii, smoothing, boxShadow: false, stroke: false, clip: true, squircleClip: hasSquircle(radii, smoothing) };
    const w = nodeWidth(node);
    const h = nodeHeight(node);
    if (ctx.hidden || w <= 0 || h <= 0 || node.opacity <= 0) {
      setParts(host, st.error ? [st.canvas, placeholder(host, ctx, st.error, "error")] : [st.canvas]);
      return info;
    }
    const code = p.str("code", DEFAULT_SHADER);
    const world = isMat4(node.worldTransform) ? node.worldTransform : null;
    const worldScale = world ? approxScale(world) : 1;
    const ratio = Math.max(0.25, ctx.scale * ctx.dpr * worldScale);
    const pw = Math.max(1, Math.round(w * ratio));
    const ph = Math.max(1, Math.round(h * ratio));
    const sx = pw / w;
    const sy = ph / h;
    let mouse: [number, number, number, number] = [0, 0, 0, 0];
    if (world) {
      const cur = unprojectPoint(world, ctx.pointer.x, ctx.pointer.y);
      const down = unprojectPoint(world, ctx.pointer.downX, ctx.pointer.downY);
      if (cur && down) {
        const sign = ctx.pointer.down ? 1 : -1;
        mouse = [cur[0] * sx, cur[1] * sy, sign * Math.abs(down[0] * sx), sign * Math.abs(down[1] * sy)];
      }
    }
    const uniformsRaw = p.raw("uniforms");
    const uniforms = uniformsRaw && typeof uniformsRaw === "object" ? (uniformsRaw as Record<string, unknown>) : null;
    const signature = `${code.length}:${hashString(code)}|${pw}x${ph}|${ctx.frame.time}|${ctx.frame.frame}|${mouse.map((m) => fmt(m, 1)).join(",")}|${uniforms ? safeJson(uniforms) : ""}`;
    if (signature !== st.signature) {
      st.signature = signature;
      const err = ctx.shaders.draw(code, st.canvas, pw, ph, {
        resolution: [pw, ph, ratio],
        time: ctx.frame.time,
        timeDelta: Math.max(0, ctx.frame.time - ctx.prevTime),
        frame: ctx.frame.frame,
        mouse,
        uniform: (name) => (uniforms && name in uniforms ? uniforms[name] : node.props?.[name]),
      });
      st.error = err ? err.message : null;
      const key = err ? `${err.line ?? ""}:${err.message}` : "";
      if (st.reportedError !== key) {
        st.reportedError = key;
        ctx.onShaderError?.({ key: host.key, layerId: host.layerId, error: err });
      }
    }
    setParts(host, st.error ? [st.canvas, placeholder(host, ctx, st.error.split("\n")[0]!, "error")] : [st.canvas]);
    return info;
  },
};

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

const cloneDrawer: Drawer = {
  update(host) {
    setParts(host, []);
    return NO_SHAPE;
  },
};

const lottieDrawer: Drawer = {
  update(host, _node, p, ctx) {
    const raw = p.raw("animation");
    const ref = raw && typeof raw === "object" ? ((raw as { assetId?: unknown; asset?: unknown }).assetId ?? (raw as { asset?: unknown }).asset) : null;
    const label = typeof ref === "string" ? `Lottie · ${ref}` : "Lottie";
    setParts(host, [placeholder(host, ctx, label, "neutral")]);
    return { ...NO_SHAPE, clip: true };
  },
};

export const DRAWERS: Readonly<Record<string, Drawer>> = {
  group: boxDrawer("group"),
  componentInstance: boxDrawer("componentInstance"),
  rectangle: boxDrawer("rectangle"),
  oval: boxDrawer("oval"),
  colorFill: boxDrawer("colorFill"),
  gradient: boxDrawer("gradient"),
  text: textDrawer,
  image: imageDrawer,
  video: videoDrawer,
  shape: shapeDrawer,
  hitArea: hitAreaDrawer,
  textField: textFieldDrawer,
  shader: shaderDrawer,
  clone: cloneDrawer,
  lottie: lottieDrawer,
};

/** Unknown types render as plain containers so their children still show. */
export const FALLBACK_DRAWER: Drawer = {
  update(host) {
    setParts(host, []);
    return NO_SHAPE;
  },
};
