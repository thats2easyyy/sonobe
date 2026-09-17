/**
 * Lottie layers, drawn by lottie-web's SVG player. The "light" build is used: it has no
 * expression support, so opening a document never evaluates code embedded in animation JSON.
 * The player module is imported on first use, so documents without Lottie layers never load it.
 *
 * Playback follows SceneFrame time rather than a private clock: pausing or restarting the
 * prototype pauses or restarts the animation, and replaying the same frames shows the same
 * animation frames (simulation screenshots are reproducible).
 */

import type { AnimationItem, LottiePlayer } from "lottie-web";
import { NO_SHAPE, ensureState, partEl, placeholder, setParts } from "./host.ts";
import type { Drawer, Host, RenderContext } from "./host.ts";
import { setAttr } from "./style.ts";
import { fmt, readAssetUrl, readNumber } from "./values.ts";

/** The part of lottie-web the renderer uses. */
export type LottiePlayerLike = Pick<LottiePlayer, "loadAnimation">;

/** Resolves the Lottie player (lazy import by default; injectable for tests or other builds). */
export type LottieLoader = () => Promise<LottiePlayerLike>;

let playerPromise: Promise<LottiePlayerLike> | null = null;

function pickPlayer(mod: unknown): LottiePlayerLike | null {
  let m = mod as { default?: unknown; loadAnimation?: unknown } | null;
  for (let i = 0; i < 3 && m; i++) {
    if (typeof m.loadAnimation === "function") return m as LottiePlayerLike;
    m = m.default as typeof m;
  }
  return null;
}

/** Imports lottie-web once per page. A failed import is retried by the next call. */
export function loadLottiePlayer(): Promise<LottiePlayerLike> {
  playerPromise ??= import("lottie-web/build/player/lottie_light").then(
    (mod) => {
      const player = pickPlayer(mod);
      if (!player) throw new Error("lottie-web loaded without a player");
      return player;
    },
    (err: unknown) => {
      playerPromise = null;
      throw err;
    },
  );
  return playerPromise;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type LottieSource =
  | { kind: "url"; url: string; label: string }
  | { kind: "data"; data: Record<string, unknown>; label: string }
  | { kind: "missing"; label: string }
  | { kind: "invalid"; label: string; message: string };

/** True for objects shaped like Bodymovin JSON (frame rate, out point, layers). */
export function isLottieData(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const d = v as { fr?: unknown; op?: unknown; layers?: unknown };
  return typeof d.fr === "number" && typeof d.op === "number" && Array.isArray(d.layers);
}

function urlLabel(url: string): string {
  if (url.startsWith("data:")) return "inline data";
  if (url.startsWith("blob:")) return "animation";
  const path = url.split(/[?#]/)[0]!;
  const name = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(name) || url;
  } catch {
    return name || url;
  }
}

/**
 * Reads the `animation` prop: an asset reference ({ asset } / { assetId } / { url }), a URL,
 * inline Bodymovin JSON (object or JSON text), or `{ json }` wrapping either.
 */
export function readLottieSource(v: unknown, resolveAssetUrl: (assetId: string) => string | undefined): LottieSource | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const text = v.trim();
    if (!text.startsWith("{")) return { kind: "url", url: text, label: urlLabel(text) };
    try {
      return readLottieSource(JSON.parse(text), resolveAssetUrl);
    } catch {
      return { kind: "invalid", label: "inline JSON", message: "The animation JSON couldn't be parsed." };
    }
  }
  if (typeof v !== "object") return { kind: "invalid", label: String(v), message: "Not a Lottie animation." };
  if (isLottieData(v)) return { kind: "data", data: v, label: typeof v.nm === "string" && v.nm ? v.nm : "inline animation" };
  const o = v as { assetId?: unknown; asset?: unknown; url?: unknown; json?: unknown };
  if (o.json !== undefined) return readLottieSource(o.json, resolveAssetUrl);
  const url = readAssetUrl(v, resolveAssetUrl);
  if (url) return { kind: "url", url, label: typeof o.assetId === "string" ? o.assetId : typeof o.asset === "string" ? o.asset : urlLabel(url) };
  const id = typeof o.assetId === "string" ? o.assetId : typeof o.asset === "string" ? o.asset : null;
  if (id) return { kind: "missing", label: id };
  return { kind: "invalid", label: "animation", message: "Not a Lottie animation." };
}

const dataSignatures = new WeakMap<object, string>();

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Identity of a source; inline data is hashed once per object. */
function sourceSignature(source: LottieSource): string {
  switch (source.kind) {
    case "url":
      return `url:${source.url}`;
    case "data": {
      let sig = dataSignatures.get(source.data);
      if (sig === undefined) {
        let text = "";
        try {
          text = JSON.stringify(source.data);
        } catch {
          text = String(Math.random());
        }
        sig = `data:${text.length}:${hashString(text)}`;
        dataSignatures.set(source.data, sig);
      }
      return sig;
    }
    case "missing":
      return `missing:${source.label}`;
    case "invalid":
      return `invalid:${source.label}:${source.message}`;
  }
}

const MAX_CACHED_TEXTS = 32;
const texts = new Map<string, Promise<string>>();

function fetchText(url: string): Promise<string> {
  const cached = texts.get(url);
  if (cached) return cached;
  const viaXhr = () =>
    new Promise<string>((resolve, reject) => {
      if (typeof XMLHttpRequest !== "function") return reject(new Error("Network loading is unavailable."));
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url);
      xhr.responseType = "text";
      xhr.onload = () => (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300) ? resolve(xhr.responseText) : reject(new Error(`HTTP ${xhr.status}`)));
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send();
    });
  const promise = (typeof fetch === "function" ? fetch(url).then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))), viaXhr) : viaXhr()).catch((err: unknown) => {
    texts.delete(url);
    throw err;
  });
  if (texts.size >= MAX_CACHED_TEXTS) texts.delete(texts.keys().next().value as string);
  texts.set(url, promise);
  return promise;
}

class LottieLoadError extends Error {}

/** Fresh animation data for one player instance (lottie-web mutates what it is given). */
async function loadData(source: LottieSource & { kind: "url" | "data" }): Promise<Record<string, unknown>> {
  if (source.kind === "data") {
    // A JSON round trip, not structuredClone: lottie-web mutates shape items in place, so objects
    // shared between groups in memory must become separate copies, exactly as if parsed from a file.
    try {
      return JSON.parse(JSON.stringify(source.data)) as Record<string, unknown>;
    } catch {
      throw new LottieLoadError("Not a Lottie animation\ninline animation");
    }
  }
  let text: string;
  try {
    text = await fetchText(source.url);
  } catch {
    throw new LottieLoadError(`Couldn't load Lottie\n${source.label}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new LottieLoadError(text.startsWith("PK") ? "dotLottie files aren't supported yet\nExport Lottie JSON instead" : `Not a Lottie animation\n${source.label}`);
  }
  if (!isLottieData(data)) throw new LottieLoadError(`Not a Lottie animation\n${source.label}`);
  return data;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

/** Moves a playhead by `delta` seconds: looping wraps within [0, duration), otherwise clamps to [0, duration]. */
export function advancePlayhead(t: number, delta: number, duration: number, loop: boolean): number {
  if (!(duration > 0)) return 0;
  const next = t + delta;
  if (loop) {
    const wrapped = next % duration;
    return wrapped < 0 ? wrapped + duration : wrapped;
  }
  return next < 0 ? 0 : next > duration ? duration : next;
}

/** Player frame for a playhead: continuous, but never past the last drawable frame. */
export function frameForTime(t: number, frameRate: number, totalFrames: number): number {
  const frame = t * frameRate;
  const last = Math.max(0, totalFrames - 1);
  return frame < 0 ? 0 : frame > last ? last : frame;
}

const ASPECT: Record<string, string> = { fit: "xMidYMid meet", fill: "xMidYMid slice", stretch: "none" };

interface LottieState {
  box: HTMLDivElement;
  signature: string;
  status: "empty" | "loading" | "ready" | "error";
  error: string;
  anim: AnimationItem | null;
  /** Bumped whenever the source changes or the host is disposed; stale loads compare against it. */
  token: number;
  playhead: number;
  lastTime: number | null;
  drawn: number;
  /** Latest props, so an animation that finishes loading between renders starts in the right place. */
  rate: number;
  scrubTime: number | null;
  aspect: string;
  hidden: boolean;
  reported: string;
}

function destroyAnimation(st: LottieState): void {
  st.token++;
  const anim = st.anim;
  st.anim = null;
  try {
    anim?.destroy();
  } catch {
    // A half-initialized player may throw while tearing down.
  }
  st.box.textContent = "";
}

function durationOf(anim: AnimationItem): number {
  return anim.frameRate > 0 && anim.totalFrames > 0 ? anim.totalFrames / anim.frameRate : 0;
}

function draw(st: LottieState): void {
  const anim = st.anim;
  if (!anim || st.status !== "ready" || st.hidden) return;
  const frame = frameForTime(st.playhead, anim.frameRate, anim.totalFrames);
  if (frame !== st.drawn) {
    st.drawn = frame;
    anim.goToAndStop(frame, true);
  }
  const svg = st.box.firstElementChild;
  if (svg && svg.getAttribute("preserveAspectRatio") !== st.aspect) svg.setAttribute("preserveAspectRatio", st.aspect);
}

function report(host: Host, ctx: RenderContext, st: LottieState): void {
  if (!ctx.onMediaState || !st.anim || st.status !== "ready") return;
  const duration = durationOf(st.anim);
  const currentTime = Math.min(st.playhead, duration);
  const signature = `${fmt(currentTime, 3)}|${fmt(duration, 3)}`;
  if (signature === st.reported) return;
  st.reported = signature;
  ctx.onMediaState(host.key, host.layerId, { currentTime, duration });
}

function startLoad(host: Host, ctx: RenderContext, st: LottieState, source: LottieSource & { kind: "url" | "data" }): void {
  const token = st.token;
  let stage: "load" | "play" = "load";
  st.status = "loading";
  const fail = (message: string) => {
    if (st.token !== token) return;
    destroyAnimation(st);
    st.status = "error";
    st.error = message;
    setParts(host, [st.box, placeholder(host, ctx, message, "neutral")]);
  };
  Promise.all([ctx.loadLottie(), loadData(source)])
    .then(([player, data]) => {
      if (st.token !== token) return;
      stage = "play";
      const assetsPath = source.kind === "url" && !source.url.startsWith("data:") ? source.url.slice(0, source.url.lastIndexOf("/") + 1) : "";
      const anim = player.loadAnimation({
        container: st.box,
        renderer: "svg",
        loop: false,
        autoplay: false,
        animationData: data,
        ...(assetsPath ? { assetsPath } : {}),
        rendererSettings: { preserveAspectRatio: st.aspect, progressiveLoad: false, hideOnTransparent: true },
      });
      st.anim = anim;
      const ready = () => {
        if (st.token !== token || st.status === "ready") return;
        const duration = durationOf(anim);
        st.status = "ready";
        st.playhead = st.scrubTime !== null ? advancePlayhead(0, st.scrubTime, duration, false) : st.rate < 0 ? duration : 0;
        // Playback starts from the last rendered frame, so the next render advances by one frame.
        st.lastTime = ctx.frame.time;
        st.drawn = Number.NaN;
        draw(st);
        report(host, ctx, st);
      };
      anim.addEventListener("DOMLoaded", ready);
      anim.addEventListener("data_failed", () => fail(`Couldn't load Lottie\n${source.label}`));
      anim.addEventListener("error", () => fail(`Couldn't play Lottie\n${source.label}`));
      if (anim.isLoaded) ready();
    })
    .catch((err: unknown) => {
      fail(err instanceof LottieLoadError ? err.message : stage === "play" ? `Couldn't play Lottie\n${source.label}` : "Lottie player failed to load");
    });
}

export const lottieDrawer: Drawer = {
  update(host, node, p, ctx) {
    const st = ensureState<LottieState>(host, "lottie", () => ({
      box: partEl(host, "lottie", "div", "sonobe-media sonobe-lottie"),
      signature: "",
      status: "empty",
      error: "",
      anim: null,
      token: 0,
      playhead: 0,
      lastTime: null,
      drawn: Number.NaN,
      rate: 1,
      scrubTime: null,
      aspect: ASPECT.fit!,
      hidden: false,
      reported: "",
    }));
    const rate = p.num("rate", 1);
    const loop = p.bool("loop", true);
    st.rate = rate;
    st.scrubTime = p.bool("scrub", false) ? Math.max(0, p.num("scrubTime", 0)) : null;
    st.aspect = ASPECT[p.str("fillMode", "fit")] ?? ASPECT.fit!;
    st.hidden = ctx.hidden || !(readNumber(node.opacity, 1) > 0);

    const source = readLottieSource(p.raw("animation"), ctx.resolveAssetUrl);
    const signature = source ? sourceSignature(source) : "";
    if (signature !== st.signature) {
      destroyAnimation(st);
      st.signature = signature;
      st.playhead = 0;
      st.lastTime = null;
      st.drawn = Number.NaN;
      st.reported = "";
      st.error = "";
      if (!source) st.status = "empty";
      else if (source.kind === "missing") {
        st.status = "error";
        st.error = `Lottie · missing asset\n${source.label}`;
      } else if (source.kind === "invalid") {
        st.status = "error";
        st.error = `${source.message}\n${source.label}`;
      } else startLoad(host, ctx, st, source);
    }

    // The clock starts once the animation is ready; a time jump backwards is a restart.
    const now = ctx.frame.time;
    if (st.status === "ready" && st.anim) {
      const duration = durationOf(st.anim);
      const dt = st.lastTime === null ? 0 : now - st.lastTime;
      if (dt < -1e-6) st.playhead = rate < 0 ? duration : 0;
      if (st.scrubTime !== null) st.playhead = advancePlayhead(0, st.scrubTime, duration, false);
      else if (p.bool("playing", true) && dt > 0) st.playhead = advancePlayhead(st.playhead, dt * rate, duration, loop);
      draw(st);
      report(host, ctx, st);
    }
    st.lastTime = st.status === "ready" ? now : null;

    if (st.status === "error") setParts(host, [st.box, placeholder(host, ctx, st.error, "neutral")]);
    else if (st.status === "empty") setParts(host, ctx.editorMode ? [placeholder(host, ctx, "No animation", "neutral")] : []);
    else setParts(host, [st.box]);
    setAttr(st.box, "aria-hidden", "true", ctx.stats);
    return { ...NO_SHAPE, clip: true };
  },
  dispose(host) {
    const st = host.state.lottie as LottieState | undefined;
    if (st) destroyAnimation(st);
  },
};
