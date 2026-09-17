/**
 * Renderer demo: static SceneFrames that exercise every layer type, a sample app screen
 * inside a CSS device frame, a gallery of device frames, and a 500-node stress list.
 *
 * Views: ?view=specimens | prototype | hit-targets | devices | stress   (&static=1 freezes time)
 */

import type { GradientValue } from "@sonobe/core";
import { getDevicePreset } from "@sonobe/core";
import type { SceneFrame, SceneNode } from "@sonobe/engine";
import { DomTextMeasurer, createDeviceFrame, createDomRenderer } from "../src/index.ts";
import type { DomRenderer, TextStyle } from "../src/index.ts";

type Props = Record<string, unknown>;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  scale?: number;
  pivot?: [number, number];
  opacity?: number;
  visible?: boolean;
  clip?: boolean;
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function localMatrix(b: Box): number[] {
  const [px, py] = b.pivot ?? [0.5, 0.5];
  const ox = b.w * px;
  const oy = b.h * py;
  const rad = ((b.rotation ?? 0) * Math.PI) / 180;
  const s = b.scale ?? 1;
  const a = Math.cos(rad) * s;
  const bb = Math.sin(rad) * s;
  const c = -bb;
  const d = a;
  return [a, bb, 0, 0, c, d, 0, 0, 0, 0, 1, 0, b.x + ox - (a * ox + c * oy), b.y + oy - (bb * ox + d * oy), 0, 1];
}

function multiply(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function L(key: string, type: string, box: Box, props: Props = {}, children: SceneNode[] = []): SceneNode {
  return {
    key,
    layerId: key,
    type,
    parentKey: null,
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    transform: localMatrix(box),
    worldTransform: IDENTITY,
    opacity: box.opacity ?? 1,
    visible: box.visible ?? true,
    clip: box.clip ?? false,
    props,
    children,
  };
}

function finalize(nodes: SceneNode[], parentWorld: readonly number[] = IDENTITY, parentKey: string | null = null): SceneNode[] {
  for (const n of nodes) {
    n.parentKey = parentKey;
    n.worldTransform = multiply(parentWorld, n.transform);
    finalize(n.children, n.worldTransform, n.key);
  }
  return nodes;
}

const grad = (kind: GradientValue["kind"], stops: [number, string][], start: [number, number], end: [number, number]) => ({ gradient: { kind, stops, start, end } });

const measurer = new DomTextMeasurer();
const FONT = "Inter";
const textWidth = (text: string, style: Partial<TextStyle>) =>
  measurer.measure(text, { fontFamily: FONT, fontSize: 17, fontWeight: 400, letterSpacing: 0, lineHeight: 0, ...style }, null).width;

// ---------------------------------------------------------------------------
// Generated assets (no network, no bundled bitmaps)
// ---------------------------------------------------------------------------

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function drawLandscape(g: CanvasRenderingContext2D, w: number, h: number, t = 0): void {
  const sky = g.createLinearGradient(0, 0, 0, h * 0.72);
  sky.addColorStop(0, "#23264f");
  sky.addColorStop(0.45, "#8a4f7d");
  sky.addColorStop(0.8, "#f08a5d");
  sky.addColorStop(1, "#f9c784");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const sunX = w * (0.68 - 0.04 * Math.sin(t)), sunY = h * 0.55;
  const sun = g.createRadialGradient(sunX, sunY, 0, sunX, sunY, h * 0.36);
  sun.addColorStop(0, "rgba(255,241,196,1)");
  sun.addColorStop(0.18, "rgba(255,222,150,.95)");
  sun.addColorStop(0.5, "rgba(255,170,110,.25)");
  sun.addColorStop(1, "rgba(255,170,110,0)");
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);
  const ridge = (color: string, base: number, amp: number, freq: number, phase: number) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) {
      const y = h * base - amp * h * (0.55 * Math.sin((x / w) * freq + phase) + 0.3 * Math.sin((x / w) * freq * 2.7 + phase * 1.7) + 0.15 * Math.sin((x / w) * freq * 6.1));
      g.lineTo(x, y);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
  };
  ridge("#7a4a73", 0.66, 0.1, 5, 0.4);
  ridge("#4c3160", 0.74, 0.09, 7, 2.1);
  ridge("#241c3b", 0.84, 0.07, 9, 4.2);
  const lake = g.createLinearGradient(0, h * 0.86, 0, h);
  lake.addColorStop(0, "#f2a86f");
  lake.addColorStop(1, "#3a2a4f");
  g.fillStyle = lake;
  g.fillRect(0, h * 0.88, w, h * 0.12);
}

function makePhoto(): string {
  const [c, g] = canvas(900, 600);
  drawLandscape(g, 900, 600);
  return c.toDataURL("image/png");
}

function makeTile(): string {
  const [c, g] = canvas(28, 28);
  g.fillStyle = "#eef3ff";
  g.fillRect(0, 0, 28, 28);
  g.fillStyle = "rgba(0,113,227,.28)";
  g.beginPath();
  g.arc(7, 7, 3.2, 0, Math.PI * 2);
  g.arc(21, 21, 3.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(0,113,227,.12)";
  g.fillRect(19, 5, 4, 4);
  g.fillRect(5, 19, 4, 4);
  return c.toDataURL("image/png");
}

function makeAvatar(hue: number, initials: string): string {
  const [c, g] = canvas(176, 176);
  const bg = g.createLinearGradient(0, 0, 176, 176);
  bg.addColorStop(0, `hsl(${hue} 85% 68%)`);
  bg.addColorStop(1, `hsl(${hue + 40} 70% 45%)`);
  g.fillStyle = bg;
  g.fillRect(0, 0, 176, 176);
  g.fillStyle = "rgba(255,255,255,.95)";
  g.font = "600 64px system-ui, -apple-system, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(initials, 88, 92);
  return c.toDataURL("image/png");
}

async function makeClip(): Promise<string | null> {
  if (typeof MediaRecorder === "undefined") return null;
  const [c, g] = canvas(640, 360);
  const stream = c.captureStream(30);
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) return null;
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start();
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      drawLandscape(g, 640, 360, t * 2);
      g.fillStyle = "rgba(255,255,255,.9)";
      g.font = "700 30px system-ui, -apple-system, sans-serif";
      g.fillText("▶ video layer", 28, 52);
      if (t < 1.6) requestAnimationFrame(tick);
      else resolve();
    };
    tick();
  });
  recorder.stop();
  await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
  return chunks.length ? URL.createObjectURL(new Blob(chunks, { type: "video/webm" })) : null;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

function starPath(cx: number, cy: number, outer: number, inner: number, points = 5): string {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / points) * i - Math.PI / 2;
    d += `${i === 0 ? "M" : "L"}${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)} `;
  }
  return `${d}Z`;
}

const circlePath = (cx: number, cy: number, r: number) => `M${cx} ${cy - r} A${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r}`;

const ICONS = {
  home: "M4 12.5 L14 4 L24 12.5 V24 H17.5 V17.5 H10.5 V24 H4 Z",
  search: "M4.5 12 a7.5 7.5 0 1 0 15 0 a7.5 7.5 0 1 0 -15 0 M17.6 17.6 L24 24",
  heart: "M14 23.5 C7 18.6 3.5 14.8 3.5 10.2 C3.5 6.8 6.1 4.3 9.3 4.3 C11.3 4.3 13 5.4 14 7 C15 5.4 16.7 4.3 18.7 4.3 C21.9 4.3 24.5 6.8 24.5 10.2 C24.5 14.8 21 18.6 14 23.5 Z",
  person: "M9 9 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M4.5 24.5 C4.5 19.5 8.7 16.5 14 16.5 C19.3 16.5 23.5 19.5 23.5 24.5",
  arrow: "M4 10 H18 M12 4 L18 10 L12 16",
  check: "M5 13 L10.5 18.5 L21 7.5",
};

// ---------------------------------------------------------------------------
// Specimen board: every layer type
// ---------------------------------------------------------------------------

const PLASMA = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= iResolution.x / iResolution.y;
  float t = iTime * 0.7;
  float v = sin(p.x * 3.1 + t) + sin(p.y * 3.7 - t * 1.3) + sin((p.x + p.y) * 2.3 + t * 0.6) + sin(length(p) * 5.5 - t * 1.8);
  vec3 col = 0.55 + 0.45 * cos(vec3(0.0, 2.2, 4.4) + v * 0.85 + t * 0.5);
  fragColor = vec4(col, 1.0);
}
`;

const BROKEN_SHADER = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  fragColor = vec4(glow, 1.0);
}
`;

/** Samples iChannel0 (an image asset) through a ripple; transparent until the texture loads. */
const RIPPLE = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec2 d = uv - 0.5;
  float r = length(d);
  float wave = sin(r * 38.0 - iTime * 4.0) * 0.012 * smoothstep(0.55, 0.0, r);
  vec2 st = uv + normalize(d + 1e-4) * wave;
  vec4 tex = texture(iChannel0, st);
  fragColor = vec4(tex.rgb * (1.0 + wave * 6.0), tex.a);
}
`;

// ---------------------------------------------------------------------------
// Lottie: a spinner that resolves into a check mark (authored here, clean room)
// ---------------------------------------------------------------------------

const ease = { o: { x: [0.4], y: [0] }, i: { x: [0.2], y: [1] } };
const static_ = (k: unknown) => ({ a: 0, k });
const keys = (frames: [number, number[]][]) => ({ a: 1, k: frames.map(([t, s], i) => (i < frames.length - 1 ? { t, s, ...ease } : { t, s })) });
const transform = { ty: "tr", p: static_([0, 0]), a: static_([0, 0]), s: static_([100, 100]), r: static_(0), o: static_(100), sk: static_(0), sa: static_(0) };

function shapeLayer(ind: number, nm: string, ks: Record<string, unknown>, shapes: unknown[]) {
  return { ddd: 0, ind, ty: 4, nm, sr: 1, ks: { o: static_(100), r: static_(0), p: static_([100, 100, 0]), a: static_([0, 0, 0]), s: static_([100, 100, 100]), ...ks }, ao: 0, shapes, ip: 0, op: 120, st: 0, bm: 0 };
}

function makeLottie(): Record<string, unknown> {
  const blue = [0.04, 0.52, 1, 1];
  const green = [0.19, 0.82, 0.35, 1];
  return {
    v: "5.7.4", nm: "Spinner to check", fr: 60, ip: 0, op: 120, w: 200, h: 200, ddd: 0, assets: [],
    layers: [
      shapeLayer(1, "check", { s: keys([[62, [0, 0, 100]], [80, [112, 112, 100]], [92, [100, 100, 100]]]) }, [
        { ty: "gr", nm: "mark", it: [
          { ty: "sh", d: 1, ks: static_({ i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], v: [[-26, 2], [-8, 20], [28, -18]], c: false }) },
          { ty: "tm", s: static_(0), e: keys([[64, [0]], [88, [100]]]), o: static_(0), m: 1 },
          { ty: "st", c: static_([1, 1, 1, 1]), o: static_(100), w: static_(9), lc: 2, lj: 2, ml: 4 },
          transform,
        ] },
        { ty: "gr", nm: "disc", it: [
          { ty: "el", d: 1, p: static_([0, 0]), s: static_([112, 112]) },
          { ty: "fl", c: static_(green), o: static_(100), r: 1 },
          transform,
        ] },
      ]),
      shapeLayer(2, "ring", { r: keys([[0, [0]], [60, [300]]]), o: keys([[52, [100]], [66, [0]]]) }, [
        { ty: "gr", nm: "arc", it: [
          { ty: "el", d: 1, p: static_([0, 0]), s: static_([112, 112]) },
          { ty: "tm", s: keys([[10, [0]], [60, [100]]]), e: keys([[0, [0]], [44, [100]]]), o: static_(0), m: 1 },
          { ty: "st", c: static_(blue), o: static_(100), w: static_(10), lc: 2, lj: 2, ml: 4 },
          transform,
        ] },
        { ty: "gr", nm: "track", it: [
          { ty: "el", d: 1, p: static_([0, 0]), s: static_([112, 112]) },
          { ty: "st", c: static_([0.04, 0.52, 1, 0.16]), o: static_(100), w: static_(10), lc: 2, lj: 2, ml: 4 },
          transform,
        ] },
      ]),
    ],
  };
}

const LOTTIE = makeLottie();

const CELL_W = 290;
const CELL_H = 220;
const GAP = 16;
const MARGIN = 24;
const HEADER = 72;

function cell(index: number, title: string, subtitle: string, content: SceneNode[]): SceneNode {
  const col = index % 4;
  const row = Math.floor(index / 4);
  const key = `cell${index}`;
  return L(key, "group", { x: MARGIN + col * (CELL_W + GAP), y: HEADER + row * (CELL_H + GAP), w: CELL_W, h: CELL_H }, { color: "#F5F5F7FF", cornerRadius: 20, cornerSmoothing: 0.6 }, [
    L(`${key}_title`, "text", { x: 16, y: 14, w: 258, h: 18 }, { text: title, fontFamily: FONT, fontSize: 13, fontWeight: 600, lineHeight: 18, textColor: "#1D1D1FFF" }),
    L(`${key}_sub`, "text", { x: 16, y: 32, w: 258, h: 16 }, { text: subtitle, fontFamily: FONT, fontSize: 11, lineHeight: 16, textColor: "#86868BFF", maxLines: 1 }),
    ...content,
  ]);
}

function specimenFrame(time: number): SceneFrame {
  const cells: SceneNode[] = [
    cell(0, "Group", "fill · radius · inside stroke · clip · shadow", [
      L("grp", "group", { x: 40, y: 70, w: 210, h: 120, clip: true }, { color: "#FFFFFFFF", cornerRadius: 20, strokeWidth: 1.5, strokeColor: "#0071E3FF", shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: [0, 8], clip: true }, [
        L("grp_orb", "oval", { x: 130, y: -40, w: 130, h: 130 }, { color: { kind: "x" }, gradient: grad("radial", [[0, "#FFD60AFF"], [1, "#FF9F0AFF"]], [0.35, 0.35], [1, 1]) }),
        L("grp_label", "text", { x: 18, y: 18, w: 120, h: 22 }, { text: "Clipped", fontFamily: FONT, fontSize: 17, fontWeight: 600, textColor: "#1D1D1FFF" }),
        L("grp_detail", "text", { x: 18, y: 44, w: 120, h: 60 }, { text: "Children beyond the edge are hidden.", fontFamily: FONT, fontSize: 12, lineHeight: 16, textColor: "#6E6E73FF" }),
      ]),
    ]),
    cell(1, "Rectangle", "circular vs smooth corners · outside stroke", [
      L("rect_round", "rectangle", { x: 34, y: 66, w: 100, h: 100 }, { color: "#5E5CE6FF", cornerRadius: 30 }),
      L("rect_smooth", "rectangle", { x: 156, y: 66, w: 100, h: 100 }, { color: "#5E5CE6FF", cornerRadius: 30, cornerSmoothing: 1, strokeWidth: 4, strokePosition: "outside", strokeColor: "#5E5CE655", shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: [0, 6], shadowColor: "#5E5CE6FF" }),
      L("rect_l1", "text", { x: 34, y: 180, w: 100, h: 16 }, { text: "smoothing 0", fontFamily: FONT, fontSize: 11, textAlignment: "center", textColor: "#86868BFF" }),
      L("rect_l2", "text", { x: 156, y: 180, w: 100, h: 16 }, { text: "smoothing 1", fontFamily: FONT, fontSize: 11, textAlignment: "center", textColor: "#86868BFF" }),
    ]),
    cell(2, "Oval", "fill · centered stroke · box shadow", [
      L("oval", "oval", { x: 95, y: 70, w: 100, h: 100 }, { color: "#30D158FF", strokeWidth: 8, strokePosition: "center", strokeColor: "#30D15866", shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: [0, 8] }),
      L("oval_small", "oval", { x: 36, y: 132, w: 36, h: 36 }, { color: "#FF375FFF" }),
      L("oval_wide", "oval", { x: 210, y: 84, w: 60, h: 30 }, { color: "#0A84FFFF", strokeWidth: 2, strokeColor: "#FFFFFFFF", strokePosition: "inside" }),
    ]),
    cell(3, "Text", "weights · wrapping · max lines · truncation", [
      L("txt_title", "text", { x: 16, y: 58, w: 258, h: 28 }, { text: "The quick brown fox", fontFamily: FONT, fontSize: 22, fontWeight: 700, letterSpacing: -0.3, textColor: "#1D1D1FFF" }),
      L("txt_body", "text", { x: 16, y: 88, w: 258, h: 36 }, { text: "Text wraps to the layer width and clamps to two lines with an ellipsis at the end, like a card preview.", fontFamily: FONT, fontSize: 13, lineHeight: 18, maxLines: 2, textColor: "#3A3A3CFF" }),
      L("txt_caps", "text", { x: 16, y: 132, w: 258, h: 16 }, { text: "tracking · uppercase", fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: 1.4, textTransform: "uppercase", textColor: "#0071E3FF" }),
      L("txt_deco", "text", { x: 16, y: 152, w: 258, h: 20 }, { text: "Italic, underlined, centered", fontFamily: FONT, fontSize: 14, italic: true, textDecoration: "underline", textAlignment: "center", textColor: "#1D1D1FFF" }),
      L("txt_mid", "text", { x: 16, y: 180, w: 190, h: 18 }, { text: "IMG_20260916_sonobe_final_final_v3.png", fontFamily: FONT, fontSize: 13, maxLines: 1, truncation: "middle", textColor: "#6E6E73FF" }),
    ]),
    cell(4, "Image", "fill · fit · tile", [
      L("img_fill", "image", { x: 16, y: 62, w: 80, h: 116 }, { image: { assetId: "photo" }, fillMode: "fill", cornerRadius: 14, cornerSmoothing: 0.6 }),
      L("img_fit", "image", { x: 105, y: 62, w: 80, h: 116 }, { image: { assetId: "photo" }, fillMode: "fit", cornerRadius: 14, strokeWidth: 1, strokeColor: "#D2D2D7FF" }),
      L("img_tile", "image", { x: 194, y: 62, w: 80, h: 116 }, { image: { assetId: "tile" }, fillMode: "tile", cornerRadius: 14 }),
      L("img_l1", "text", { x: 16, y: 186, w: 80, h: 16 }, { text: "fill", fontFamily: FONT, fontSize: 11, textAlignment: "center", textColor: "#86868BFF" }),
      L("img_l2", "text", { x: 105, y: 186, w: 80, h: 16 }, { text: "fit", fontFamily: FONT, fontSize: 11, textAlignment: "center", textColor: "#86868BFF" }),
      L("img_l3", "text", { x: 194, y: 186, w: 80, h: 16 }, { text: "tile", fontFamily: FONT, fontSize: 11, textAlignment: "center", textColor: "#86868BFF" }),
    ]),
    cell(5, "Video", "muted by default · loop · radius", [
      L("vid", "video", { x: 25, y: 62, w: 240, h: 135 }, { video: { assetId: "clip" }, playing: true, loop: true, cornerRadius: 16, cornerSmoothing: 0.6, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: [0, 6] }),
    ]),
    cell(6, "Shape", "SVG path · fill · stroke trim · caps", [
      L("star", "shape", { x: 14, y: 62, w: 120, h: 120 }, { shape: { path: starPath(60, 62, 52, 22) }, color: "#FFD60AFF", strokeWidth: 3, strokeColor: "#FF9F0AFF", lineJoin: "round", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: [0, 4] }),
      L("ring_track", "shape", { x: 150, y: 66, w: 116, h: 116 }, { shape: { path: circlePath(58, 58, 48) }, color: "#00000000", strokeWidth: 12, strokeColor: "#FF375F2E" }),
      L("ring", "shape", { x: 150, y: 66, w: 116, h: 116 }, { shape: { path: circlePath(58, 58, 48) }, color: "#00000000", strokeWidth: 12, strokeColor: "#FF375FFF", strokeEnd: 0.72, lineCap: "round" }),
      L("ring_label", "text", { x: 150, y: 113, w: 116, h: 22 }, { text: "72%", fontFamily: FONT, fontSize: 18, fontWeight: 700, textAlignment: "center", textColor: "#1D1D1FFF" }),
    ]),
    cell(7, "Color Fill", "tint over content · multiply blend", [
      L("tint_card", "group", { x: 25, y: 62, w: 240, h: 135, clip: true }, { cornerRadius: 16, cornerSmoothing: 0.6, clip: true }, [
        L("tint_photo", "image", { x: 0, y: 0, w: 240, h: 135 }, { image: { assetId: "photo" }, fillMode: "fill" }),
        L("tint_fill", "colorFill", { x: 0, y: 0, w: 120, h: 135 }, { color: "#0A84FFFF", blendMode: "multiply" }),
        L("tint_label", "text", { x: 16, y: 104, w: 200, h: 20 }, { text: "multiply | normal", fontFamily: FONT, fontSize: 14, fontWeight: 600, textColor: "#FFFFFFFF", shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: [0, 1] }),
      ]),
    ]),
    cell(8, "Gradient", "linear · radial · angular", [
      L("g_lin", "gradient", { x: 16, y: 66, w: 80, h: 116 }, { ...grad("linear", [[0, "#FF375FFF"], [1, "#5E5CE6FF"]], [0, 0], [1, 1]), cornerRadius: 16, cornerSmoothing: 0.6 }),
      L("g_rad", "gradient", { x: 105, y: 66, w: 80, h: 116 }, { ...grad("radial", [[0, "#FFFFFFFF"], [0.35, "#64D2FFFF"], [1, "#0A2A6BFF"]], [0.5, 0.4], [1, 1]), cornerRadius: 16, cornerSmoothing: 0.6 }),
      L("g_ang", "gradient", { x: 194, y: 66, w: 80, h: 116 }, { ...grad("angular", [[0, "#FF9F0AFF"], [0.33, "#30D158FF"], [0.66, "#0A84FFFF"], [1, "#FF9F0AFF"]], [0.5, 0.5], [0.5, 0]), cornerRadius: 16, cornerSmoothing: 0.6 }),
    ]),
    cell(9, "Hit Area", "invisible target · slop · shown in editor", [
      L("hit_btn", "group", { x: 70, y: 96, w: 150, h: 44 }, { color: "#1D1D1FFF", cornerRadius: 22 }, [
        L("hit_btn_label", "text", { x: 0, y: 12, w: 150, h: 20 }, { text: "Tap me", fontFamily: FONT, fontSize: 15, fontWeight: 600, textAlignment: "center", textColor: "#FFFFFFFF" }),
      ]),
      L("hit", "hitArea", { x: 60, y: 86, w: 170, h: 64 }, { hitSlop: 10, showInEditor: true }),
    ]),
    cell(10, "Text Field", "real input · placeholder · secure", [
      L("tf_box", "group", { x: 16, y: 66, w: 258, h: 44 }, { color: "#FFFFFFFF", cornerRadius: 12, strokeWidth: 1, strokeColor: "#D2D2D7FF" }, [
        L("tf_icon", "shape", { x: 12, y: 13, w: 18, h: 18 }, { shape: { path: "M2.5 7.5 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M11.2 11.2 L15.5 15.5" }, color: "#00000000", strokeWidth: 1.8, strokeColor: "#8E8E93FF", lineCap: "round" }),
        L("tf_search", "textField", { x: 38, y: 0, w: 208, h: 44 }, { placeholder: "Search events", fontFamily: FONT, fontSize: 15, placeholderColor: "#8E8E93FF", textColor: "#1D1D1FFF" }),
      ]),
      L("tf_box2", "group", { x: 16, y: 122, w: 258, h: 44 }, { color: "#FFFFFFFF", cornerRadius: 12, strokeWidth: 1, strokeColor: "#0071E3FF" }, [
        L("tf_password", "textField", { x: 14, y: 0, w: 230, h: 44 }, { text: "hunter2hunter2", secure: true, fontFamily: FONT, fontSize: 15, textColor: "#1D1D1FFF" }),
      ]),
    ]),
    cell(11, "Shader", "GLSL ES 3.0 · iChannel0 image · compile errors", [
      L("fx", "shader", { x: 16, y: 62, w: 82, h: 136 }, { code: PLASMA, cornerRadius: 16, cornerSmoothing: 0.6 }),
      L("fx_texture", "shader", { x: 104, y: 62, w: 82, h: 136 }, { code: RIPPLE, uniforms: { iChannel0: { asset: "photo", wrap: "clamp" } }, cornerRadius: 16, cornerSmoothing: 0.6 }),
      L("fx_broken", "shader", { x: 192, y: 62, w: 82, h: 136 }, { code: BROKEN_SHADER, cornerRadius: 12 }),
    ]),
    cell(12, "Clone", "live copies with their own transform", [
      L("clone_src", "group", { x: 22, y: 70, w: 86, h: 116 }, { color: "#FFFFFFFF", cornerRadius: 16, cornerSmoothing: 0.6, shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: [0, 4] }, [
        L("clone_dot", "oval", { x: 23, y: 20, w: 40, h: 40 }, { gradient: grad("linear", [[0, "#64D2FFFF"], [1, "#0A84FFFF"]], [0, 0], [1, 1]) }),
        L("clone_txt", "text", { x: 0, y: 74, w: 86, h: 18 }, { text: "Source", fontFamily: FONT, fontSize: 13, fontWeight: 600, textAlignment: "center", textColor: "#1D1D1FFF" }),
      ]),
      L("clone_a", "clone", { x: 116, y: 72, w: 86, h: 116, rotation: -8, scale: 0.92, opacity: 0.85 }, { source: { layerId: "clone_src" } }),
      L("clone_b", "clone", { x: 196, y: 74, w: 86, h: 116, rotation: 9, scale: 0.8, opacity: 0.55 }, { source: { layerId: "clone_src" } }),
    ]),
    cell(13, "Lottie", "lottie-web · playing · scrubbed · load failure", [
      L("lottie", "lottie", { x: 16, y: 66, w: 82, h: 100 }, { animation: LOTTIE }),
      L("lottie_scrub", "lottie", { x: 104, y: 66, w: 82, h: 100 }, { animation: { asset: "spinner" }, scrub: true, scrubTime: 1.4 }),
      L("lottie_missing", "lottie", { x: 192, y: 66, w: 82, h: 100 }, { animation: { assetId: "confetti" } }),
      L("lottie_l1", "text", { x: 16, y: 180, w: 82, h: 16 }, { text: "playing", fontFamily: FONT, fontSize: 11, textAlignment: "center", textColor: "#86868BFF" }),
      L("lottie_l2", "text", { x: 104, y: 180, w: 82, h: 16 }, { text: "scrub 1.4s", fontFamily: FONT, fontSize: 11, textAlignment: "center", textColor: "#86868BFF" }),
      L("lottie_l3", "text", { x: 192, y: 180, w: 82, h: 16 }, { text: "missing", fontFamily: FONT, fontSize: 11, textAlignment: "center", textColor: "#86868BFF" }),
    ]),
    cell(14, "Component Instance", "container for a component's layers", [
      L("comp", "componentInstance", { x: 45, y: 96, w: 200, h: 52 }, {}, [
        L("comp_bg", "rectangle", { x: 0, y: 0, w: 200, h: 52 }, { gradient: grad("linear", [[0, "#0A84FFFF"], [1, "#5E5CE6FF"]], [0, 0.5], [1, 0.5]), cornerRadius: 26, cornerSmoothing: 1, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: [0, 8], shadowColor: "#0A84FFFF" }),
        L("comp_label", "text", { x: 0, y: 15, w: 170, h: 22 }, { text: "Continue", fontFamily: FONT, fontSize: 16, fontWeight: 600, textAlignment: "center", textColor: "#FFFFFFFF" }),
        L("comp_arrow", "shape", { x: 150, y: 16, w: 22, h: 20 }, { shape: { path: ICONS.arrow }, color: "#00000000", strokeWidth: 2.2, strokeColor: "#FFFFFFFF", lineCap: "round", lineJoin: "round" }),
      ]),
    ]),
    cell(15, "Effects", "background blur · layer blur · plus lighter", [
      L("fx_photo", "image", { x: 16, y: 62, w: 258, h: 136 }, { image: { assetId: "photo" }, fillMode: "fill", cornerRadius: 16, cornerSmoothing: 0.6 }),
      L("glass", "group", { x: 34, y: 112, w: 150, h: 60 }, { color: "#FFFFFF2E", backgroundBlur: 14, cornerRadius: 16, cornerSmoothing: 0.6, strokeWidth: 1, strokeColor: "#FFFFFF66" }, [
        L("glass_label", "text", { x: 0, y: 19, w: 150, h: 22 }, { text: "Frosted glass", fontFamily: FONT, fontSize: 15, fontWeight: 600, textAlignment: "center", textColor: "#FFFFFFFF" }),
      ]),
      L("glow_a", "oval", { x: 196, y: 76, w: 56, h: 56 }, { color: "#FF375FFF", blendMode: "plusLighter", blur: 6 }),
      L("glow_b", "oval", { x: 218, y: 92, w: 56, h: 56 }, { color: "#0A84FFFF", blendMode: "plusLighter", blur: 6 }),
    ]),
  ];

  const roots = [
    L("board_title", "text", { x: MARGIN, y: 20, w: 800, h: 30 }, { text: "Sonobe renderer · layer specimens", fontFamily: FONT, fontSize: 22, fontWeight: 700, letterSpacing: -0.2, textColor: "#1D1D1FFF" }),
    L("board_sub", "text", { x: MARGIN, y: 48, w: 900, h: 18 }, { text: "Every layer type drawn from a static SceneFrame by @sonobe/renderer (editor mode, hit areas visible).", fontFamily: FONT, fontSize: 12, textColor: "#86868BFF" }),
    ...cells,
  ];
  const width = MARGIN * 2 + CELL_W * 4 + GAP * 3;
  const height = HEADER + CELL_H * 4 + GAP * 3 + MARGIN;
  return { frame: 1, time, size: [width, height], background: { r: 1, g: 1, b: 1, a: 1 }, roots: finalize(roots) };
}

// ---------------------------------------------------------------------------
// Prototype screen inside an iPhone frame
// ---------------------------------------------------------------------------

function chip(key: string, x: number, label: string, selected: boolean): [SceneNode, number] {
  const w = textWidth(label, { fontSize: 14, fontWeight: 600 }) + 28;
  return [
    L(key, "group", { x, y: 452, w, h: 34 }, { color: selected ? "#0071E3FF" : "#FFFFFFFF", cornerRadius: 17, cornerSmoothing: 0.6, strokeWidth: selected ? 0 : 1, strokeColor: "#D1D1D6FF" }, [
      L(`${key}_label`, "text", { x: 14, y: 8, w: w - 28, h: 18 }, { text: label, fontFamily: FONT, fontSize: 14, fontWeight: 600, lineHeight: 18, textColor: selected ? "#FFFFFFFF" : "#1D1D1FFF" }),
    ]),
    w,
  ];
}

function row(key: string, y: number, avatar: string, title: string, detail: string, progress: number): SceneNode {
  return L(key, "group", { x: 16, y, w: 370, h: 64 }, { color: "#FFFFFFFF", cornerRadius: 18, cornerSmoothing: 0.6 }, [
    L(`${key}_avatar`, "image", { x: 12, y: 10, w: 44, h: 44 }, { image: { assetId: avatar }, cornerRadius: 22 }),
    L(`${key}_title`, "text", { x: 68, y: 12, w: 230, h: 20 }, { text: title, fontFamily: FONT, fontSize: 16, fontWeight: 600, lineHeight: 20, textColor: "#1D1D1FFF", maxLines: 1 }),
    L(`${key}_detail`, "text", { x: 68, y: 34, w: 230, h: 18 }, { text: detail, fontFamily: FONT, fontSize: 13, lineHeight: 18, textColor: "#8E8E93FF", maxLines: 1 }),
    L(`${key}_track`, "shape", { x: 318, y: 14, w: 36, h: 36 }, { shape: { path: circlePath(18, 18, 14) }, color: "#00000000", strokeWidth: 4, strokeColor: "#0071E326" }),
    L(`${key}_ring`, "shape", { x: 318, y: 14, w: 36, h: 36 }, { shape: { path: circlePath(18, 18, 14) }, color: "#00000000", strokeWidth: 4, strokeColor: "#0071E3FF", strokeEnd: progress, lineCap: "round" }),
  ]);
}

function prototypeFrame(time: number): SceneFrame {
  const chips: SceneNode[] = [];
  let cx = 16;
  for (const [i, label] of ["Outdoors", "Live music", "Food & drink", "Art"].entries()) {
    const [node, w] = chip(`chip${i}`, cx, label, i === 0);
    chips.push(node);
    cx += w + 8;
  }
  const tabs = (["home", "search", "heart", "person"] as const).map((icon, i) => {
    const x = 16 + i * 92.5;
    const color = i === 0 ? "#0071E3FF" : "#8E8E93FF";
    return L(`tab_${icon}`, "group", { x, y: 8, w: 92.5, h: 50 }, {}, [
      L(`tab_${icon}_icon`, "shape", { x: 32, y: 0, w: 28, h: 28 }, { shape: { path: ICONS[icon] }, color: i === 0 && icon === "home" ? "#0071E3FF" : "#00000000", strokeWidth: 2, strokeColor: color, lineJoin: "round", lineCap: "round" }),
      L(`tab_${icon}_label`, "text", { x: 0, y: 31, w: 92.5, h: 14 }, { text: ["Discover", "Search", "Saved", "Profile"][i], fontFamily: FONT, fontSize: 10, fontWeight: 600, lineHeight: 14, textAlignment: "center", textColor: color }),
    ]);
  });

  const roots: SceneNode[] = [
    L("bg", "colorFill", { x: 0, y: 0, w: 402, h: 874 }, { color: "#F2F2F7FF" }),
    L("status_time", "text", { x: 32, y: 21, w: 60, h: 22 }, { text: "9:41", fontFamily: FONT, fontSize: 17, fontWeight: 600, textAlignment: "center", textColor: "#000000FF" }),
    L("date", "text", { x: 20, y: 70, w: 300, h: 18 }, { text: "Tuesday, September 16", fontFamily: FONT, fontSize: 13, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", textColor: "#8E8E93FF" }),
    L("title", "text", { x: 20, y: 88, w: 300, h: 41 }, { text: "Discover", fontFamily: FONT, fontSize: 34, fontWeight: 700, letterSpacing: -0.4, lineHeight: 41, textColor: "#000000FF" }),
    L("avatar_me", "image", { x: 346, y: 88, w: 38, h: 38 }, { image: { assetId: "avatar_me" }, cornerRadius: 19, strokeWidth: 2, strokeColor: "#FFFFFFFF", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: [0, 2] }),
    L("search", "group", { x: 16, y: 140, w: 370, h: 40 }, { color: "#7676801F", cornerRadius: 12, cornerSmoothing: 0.6 }, [
      L("search_icon", "shape", { x: 10, y: 11, w: 18, h: 18 }, { shape: { path: "M2.5 7.5 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M11.2 11.2 L15.5 15.5" }, color: "#00000000", strokeWidth: 1.8, strokeColor: "#8E8E93FF", lineCap: "round" }),
      L("search_field", "textField", { x: 34, y: 0, w: 320, h: 40 }, { placeholder: "Events, places, friends", fontFamily: FONT, fontSize: 16, placeholderColor: "#8E8E93FF", textColor: "#000000FF" }),
    ]),
    L("hero", "group", { x: 16, y: 196, w: 370, h: 240, clip: true }, { cornerRadius: 28, cornerSmoothing: 0.6, clip: true, shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: [0, 10] }, [
      L("hero_photo", "image", { x: 0, y: 0, w: 370, h: 240 }, { image: { assetId: "photo" }, fillMode: "fill" }),
      L("hero_shade", "gradient", { x: 0, y: 90, w: 370, h: 150 }, grad("linear", [[0, "#00000000"], [1, "#000000B8"]], [0.5, 0], [0.5, 1])),
      L("hero_badge", "group", { x: 16, y: 16, w: 64, h: 26 }, { color: "#FFFFFF33", backgroundBlur: 12, cornerRadius: 13, strokeWidth: 0.5, strokeColor: "#FFFFFF66" }, [
        L("hero_badge_dot", "oval", { x: 10, y: 9, w: 8, h: 8 }, { color: "#FF453AFF", shadowOpacity: 0.8, shadowRadius: 4, shadowColor: "#FF453AFF" }),
        L("hero_badge_label", "text", { x: 23, y: 5, w: 36, h: 16 }, { text: "LIVE", fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, lineHeight: 16, textColor: "#FFFFFFFF" }),
      ]),
      L("hero_title", "text", { x: 20, y: 166, w: 330, h: 30 }, { text: "Golden Hour Hike", fontFamily: FONT, fontSize: 24, fontWeight: 700, letterSpacing: -0.3, lineHeight: 30, textColor: "#FFFFFFFF" }),
      L("hero_detail", "text", { x: 20, y: 198, w: 330, h: 20 }, { text: "Sat · 6:30 PM · Mission Peak Trailhead", fontFamily: FONT, fontSize: 14, lineHeight: 20, textColor: "#FFFFFFCC" }),
    ]),
    ...chips,
    L("upnext", "text", { x: 20, y: 506, w: 200, h: 26 }, { text: "Up next", fontFamily: FONT, fontSize: 22, fontWeight: 700, letterSpacing: -0.2, textColor: "#000000FF" }),
    L("seeall", "text", { x: 286, y: 510, w: 96, h: 20 }, { text: "See all", fontFamily: FONT, fontSize: 15, textAlignment: "right", textColor: "#0071E3FF" }),
    row("row1", 544, "avatar_a", "Jazz on the Pier", "Tonight · Pier 39 · 214 going", 0.35 + 0.1 * Math.sin(time)),
    row("row2", 616, "avatar_b", "Night Market Food Crawl with Friends and Neighbors", "Fri · Chinatown · 1.2k interested", 0.72),
    row("row3", 688, "avatar_c", "Sunrise Yoga", "Sun · Dolores Park · 58 going", 0.9),
    L("tabbar", "group", { x: 0, y: 790, w: 402, h: 84 }, { color: "#F9F9F9D1", backgroundBlur: 20 }, [
      L("tabbar_hairline", "rectangle", { x: 0, y: 0, w: 402, h: 0.5 }, { color: "#0000002E" }),
      ...tabs,
      L("home_indicator", "rectangle", { x: 134, y: 70, w: 134, h: 5 }, { color: "#000000FF", cornerRadius: 2.5 }),
    ]),
    L("hit_hero", "hitArea", { x: 16, y: 196, w: 370, h: 240 }, { showInEditor: true }),
    L("hit_tab_search", "hitArea", { x: 108.5, y: 798, w: 92.5, h: 50 }, { hitSlop: 6 }),
  ];
  return { frame: 1, time, size: [402, 874], background: { r: 0.95, g: 0.95, b: 0.97, a: 1 }, roots: finalize(roots) };
}

/** 100 list rows × 5 layers = 500 nodes; the list scrolls and progress bars pulse. */
function stressFrame(time: number): SceneFrame {
  const rows: SceneNode[] = [];
  const scroll = (Math.sin(time * 0.8) * 0.5 + 0.5) * 3200;
  for (let i = 0; i < 100; i++) {
    const key = `srow${i}`;
    const progress = 0.5 + 0.45 * Math.sin(time * 2 + i * 0.4);
    rows.push(
      L(key, "group", { x: 16, y: 16 + i * 72 - scroll, w: 370, h: 64 }, { color: "#FFFFFFFF", cornerRadius: 16, cornerSmoothing: 0.6 }, [
        L(`${key}_avatar`, "oval", { x: 12, y: 12, w: 40, h: 40 }, { color: ["#FF375FFF", "#FF9F0AFF", "#30D158FF", "#0A84FFFF", "#5E5CE6FF"][i % 5] }),
        L(`${key}_title`, "text", { x: 64, y: 12, w: 220, h: 20 }, { text: `Event #${i + 1}`, fontFamily: FONT, fontSize: 16, fontWeight: 600, lineHeight: 20, textColor: "#1D1D1FFF" }),
        L(`${key}_detail`, "text", { x: 64, y: 34, w: 220, h: 18 }, { text: "Tonight · Pier 39 · 214 going", fontFamily: FONT, fontSize: 13, lineHeight: 18, textColor: "#8E8E93FF", maxLines: 1 }),
        L(`${key}_bar`, "rectangle", { x: 296, y: 28, w: 62 * progress, h: 8 }, { color: "#30D158FF", cornerRadius: 4 }),
      ]),
    );
  }
  return { frame: 1, time, size: [402, 874], background: { r: 0.95, g: 0.95, b: 0.97, a: 1 }, roots: finalize(rows) };
}

function wallpaperFrame(size: [number, number], time: number, label: string): SceneFrame {
  const [w, h] = size;
  const big = Math.min(w, h);
  const iconSize = Math.round(Math.min(60, big * 0.15));
  const icons: SceneNode[] = [];
  const colors = ["#FF375FFF", "#FF9F0AFF", "#30D158FF", "#0A84FFFF", "#5E5CE6FF", "#64D2FFFF", "#FFD60AFF", "#BF5AF2FF"];
  const landscape = w > h;
  const cols = landscape ? 8 : 4;
  const inset = landscape ? 70 : 0;
  const gap = (w - inset * 2 - cols * iconSize) / (cols + 1);
  for (let i = 0; i < 8; i++) {
    icons.push(L(`icon${i}`, "rectangle", { x: inset + gap + (i % cols) * (iconSize + gap), y: h * 0.5 + Math.floor(i / cols) * (iconSize + gap * 0.9), w: iconSize, h: iconSize }, { color: colors[i], cornerRadius: iconSize * 0.225, cornerSmoothing: 0.6, shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: [0, 3] }));
  }
  const roots = [
    L("wall", "gradient", { x: 0, y: 0, w, h }, grad("linear", [[0, "#1B1F4BFF"], [0.55, "#6A3D7AFF"], [1, "#F08A5DFF"]], [0.2, 0], [0.8, 1])),
    L("glow", "shader", { x: 0, y: 0, w, h, opacity: 0.5 }, { code: PLASMA, blendMode: "softLight" }),
    L("time", "text", { x: 0, y: h * 0.14, w, h: big * 0.24 }, { text: "9:41", fontFamily: FONT, fontSize: big * 0.2, fontWeight: 600, letterSpacing: -1, textAlignment: "center", textColor: "#FFFFFFFF" }),
    L("label", "text", { x: 0, y: h * 0.14 + big * 0.24, w, h: 24 }, { text: label, fontFamily: FONT, fontSize: Math.max(12, big * 0.045), fontWeight: 600, textAlignment: "center", textColor: "#FFFFFFD9" }),
    ...(big > 250 ? icons : []),
  ];
  return { frame: 1, time, size, background: { r: 0, g: 0, b: 0, a: 1 }, roots: finalize(roots) };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

interface BenchResult {
  frames: number;
  nodes: number;
  msPerFrame: number;
  /** Median render() time. */
  medianMs: number;
  /** Median render() plus a forced style/layout pass. */
  medianWithLayoutMs: number;
  writesPerFrame: number;
  rerenderWrites: number;
}

declare global {
  interface Window {
    __sonobeReady?: boolean;
    __sonobeLog?: string[];
    __sonobeEvents?: unknown[];
    __sonobeMedia?: Record<string, { currentTime?: number; duration?: number }>;
    __sonobeVerifyText?: () => Promise<{ cases: number; mismatches: string[] }>;
    __sonobeBench?: () => BenchResult;
  }
}

const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "specimens";
const isStatic = params.has("static");
const log = (window.__sonobeLog = [] as string[]);
const capturedEvents = (window.__sonobeEvents = [] as unknown[]);
const media = (window.__sonobeMedia = {} as Record<string, { currentTime?: number; duration?: number }>);

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** Checks that DomTextMeasurer's line breaking matches what the renderer's DOM text actually does. */
async function verifyText(): Promise<{ cases: number; mismatches: string[] }> {
  const rand = lcg(7);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const samples = [
    "The quick brown fox jumps over the lazy dog.",
    "Night Market Food Crawl with Friends and Neighbors",
    "supercalifragilisticexpialidocious and antidisestablishmentarianism",
    "A well-known state-of-the-art design system",
    "日本語のテキストを折り返します。中文排版测试，好。",
    "Emoji 🎉 party 👩‍💻 time 🚀 launch",
    "Line one\nLine two is longer than the first one\n\nLine four",
    "   leading and trailing spaces   ",
    "IMG_20260916_sonobe_final_final_v3.png",
    "Tap the card to expand it, then drag it down to dismiss.",
  ];
  const families = ["Inter", "Georgia", "Menlo", "system-ui", "Helvetica Neue", "Times New Roman", "Arial"];
  const transforms = ["none", "none", "uppercase", "capitalize"] as const;
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-30000px;top:0;width:1200px;height:200px";
  document.body.appendChild(host);
  const renderer = createDomRenderer(host, { resolveAssetUrl: () => undefined, textMeasurer: measurer, captureInput: false });
  const expectations: { key: string; lines: number; lineHeight: number; label: string }[] = [];
  const nodes: SceneNode[] = [];
  let y = 0;
  for (let i = 0; i < 240; i++) {
    const style: TextStyle = {
      fontFamily: pick(families),
      fontSize: Math.round(11 + rand() * 26),
      fontWeight: pick([300, 400, 500, 600, 700, 800]),
      letterSpacing: pick([0, 0, -0.4, 0.5, 1.5]),
      lineHeight: pick([0, 0, 0, 22, 30]),
      italic: rand() < 0.2,
      textTransform: pick(transforms),
    };
    const text = pick(samples);
    const width = rand() < 0.2 ? null : Math.round(30 + rand() * 320);
    const layout = measurer.layout(text, style, width);
    const key = `t${i}`;
    nodes.push(L(key, "text", { x: 0, y, w: width ?? layout.width, h: layout.height }, { text, ...style }));
    expectations.push({ key, lines: layout.lines.length, lineHeight: layout.lineHeight, label: `${JSON.stringify(text.slice(0, 24))} ${style.fontFamily} ${style.fontSize}/${style.fontWeight} ls=${style.letterSpacing} w=${width ?? `auto(${layout.width})`}` });
    y += layout.height + 8;
  }
  renderer.render({ frame: 0, time: 0, size: [1200, y], background: { r: 0, g: 0, b: 0, a: 0 }, roots: finalize(nodes) });
  const mismatches: string[] = [];
  for (const e of expectations) {
    const textEl = renderer.elementForKey(e.key)!.querySelector(".sonobe-text")!;
    const domLines = Math.round(textEl.getBoundingClientRect().height / e.lineHeight);
    if (domLines !== e.lines) mismatches.push(`${e.label}: measurer ${e.lines} lines, DOM ${domLines}`);
  }
  renderer.dispose();
  host.remove();
  return { cases: expectations.length, mismatches };
}

function registerBench(renderer: DomRenderer, make: (t: number) => SceneFrame): void {
  window.__sonobeBench = () => {
    const count = (nodes: readonly SceneNode[]): number => nodes.reduce((n, c) => n + 1 + count(c.children), 0);
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const round = (n: number) => Math.round(n * 100) / 100;
    const frames = 120;
    // Build frames up front so the timing covers rendering, not scene construction.
    for (let i = 0; i < 30; i++) renderer.render(make(1 + i / 60));
    const scenes = Array.from({ length: frames }, (_, i) => make(2 + i / 60));
    const s0 = renderer.getStats();
    const times: number[] = [];
    const t0 = performance.now();
    for (const f of scenes) {
      const a = performance.now();
      renderer.render(f);
      times.push(performance.now() - a);
    }
    const elapsed = performance.now() - t0;
    const s1 = renderer.getStats();
    const layoutTimes: number[] = [];
    for (let i = 0; i < 60; i++) {
      const f = make(5 + i / 60);
      const a = performance.now();
      renderer.render(f);
      void renderer.stage.getBoundingClientRect();
      void renderer.stage.offsetHeight;
      layoutTimes.push(performance.now() - a);
    }
    const f = make(10);
    renderer.render(f);
    const s2 = renderer.getStats();
    renderer.render(f);
    const s3 = renderer.getStats();
    return {
      frames,
      nodes: count(f.roots),
      msPerFrame: round(elapsed / frames),
      medianMs: round(median(times)),
      medianWithLayoutMs: round(median(layoutTimes)),
      writesPerFrame: (s1.styleWrites + s1.attrWrites - s0.styleWrites - s0.attrWrites) / frames,
      rerenderWrites: s3.styleWrites + s3.attrWrites - s2.styleWrites - s2.attrWrites,
    };
  };
}

window.__sonobeVerifyText = verifyText;

async function waitForMedia(root: HTMLElement): Promise<void> {
  await document.fonts?.ready;
  // Lottie layers load the player lazily; wait until each shows an animation or a placeholder.
  const lottieSettled = () => [...root.querySelectorAll('[data-type="lottie"] > .sonobe-body')].every((b) => b.querySelector("svg path") || b.querySelector(".sonobe-placeholder"));
  for (let i = 0; i < 100 && !lottieSettled(); i++) await new Promise((r) => setTimeout(r, 50));
  await Promise.all([...root.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));
  await Promise.all(
    [...root.querySelectorAll("video")].map(
      (video) =>
        new Promise<void>((resolve) => {
          if (video.readyState >= 2) return resolve();
          video.addEventListener("loadeddata", () => resolve(), { once: true });
          setTimeout(resolve, 2500);
        }),
    ),
  );
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

function animate(renderers: [DomRenderer, (t: number) => SceneFrame][]): void {
  if (isStatic) return;
  const start = performance.now();
  const tick = () => {
    const t = (performance.now() - start) / 1000;
    for (const [r, make] of renderers) r.render(make(t));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function main(): Promise<void> {
  const assets: Record<string, string> = {
    photo: makePhoto(),
    tile: makeTile(),
    avatar_me: makeAvatar(210, "TN"),
    avatar_a: makeAvatar(260, "JP"),
    avatar_b: makeAvatar(20, "NM"),
    avatar_c: makeAvatar(140, "SY"),
    spinner: `data:application/json;base64,${btoa(JSON.stringify(LOTTIE))}`,
  };
  const clip = await makeClip();
  if (clip) assets.clip = clip;
  const resolveAssetUrl = (id: string) => assets[id];
  const common = {
    resolveAssetUrl,
    textMeasurer: measurer,
    onShaderError: (info: { layerId: string; error: { message: string; line: number | null } | null }) => log.push(`shader ${info.layerId}: ${info.error ? info.error.message : "ok"}`),
    onEvents: (events: unknown[]) => {
      if (capturedEvents.length < 2000) capturedEvents.push(...events);
    },
    onMediaState: (key: string, _layerId: string, state: { currentTime?: number; duration?: number }) => {
      media[key] = { ...media[key], ...state };
    },
  };
  const app = document.getElementById("app")!;
  document.body.dataset.view = view;
  const fixedTime = 1.3;

  if (view === "specimens") {
    const holder = document.createElement("div");
    holder.className = "board";
    app.appendChild(holder);
    const f = specimenFrame(fixedTime);
    holder.style.width = `${f.size[0]}px`;
    holder.style.height = `${f.size[1]}px`;
    const r = createDomRenderer(holder, { ...common, editorMode: true });
    r.render(f);
    registerBench(r, specimenFrame);
    await waitForMedia(holder);
    animate([[r, specimenFrame]]);
  } else if (view === "prototype" || view === "hit-targets") {
    const stage = document.createElement("div");
    stage.className = "device-stage";
    app.appendChild(stage);
    const device = createDeviceFrame(stage, getDevicePreset("iphone-17-pro"), { showFrame: true });
    const r = createDomRenderer(device.screen, { ...common, showHitTargets: view === "hit-targets" });
    if (view === "hit-targets") r.setShowHitTargets(true, ["chip0", "chip1", "chip2", "chip3", "row1", "row2", "row3", "search"]);
    r.render(prototypeFrame(fixedTime));
    registerBench(r, prototypeFrame);
    await waitForMedia(stage);
    animate([[r, prototypeFrame]]);
  } else if (view === "devices") {
    const gallery = document.createElement("div");
    gallery.className = "gallery";
    app.appendChild(gallery);
    const entries: { preset: string; label: string; orientation?: "portrait" | "landscape"; finish?: "graphite" | "silver"; scale: number; safe?: boolean }[] = [
      { preset: "iphone-17-pro", label: "iPhone 17 Pro · island", scale: 0.5 },
      { preset: "android-large", label: "Android · punch hole", scale: 0.5, finish: "silver" },
      { preset: "iphone-se", label: "iPhone SE · home button", scale: 0.5 },
      { preset: "watch-46", label: "Watch 46mm", scale: 0.8 },
      { preset: "iphone-17-pro-max", label: "Landscape · safe areas", scale: 0.45, orientation: "landscape", finish: "silver", safe: true },
      { preset: "ipad-pro-11", label: "iPad Pro 11″", scale: 0.33 },
    ];
    const renderers: [DomRenderer, (t: number) => SceneFrame][] = [];
    for (const e of entries) {
      const figure = document.createElement("figure");
      const shell = document.createElement("div");
      shell.className = "shell";
      const zoom = document.createElement("div");
      zoom.className = "zoom";
      zoom.style.transform = `scale(${e.scale})`;
      shell.appendChild(zoom);
      const device = createDeviceFrame(zoom, getDevicePreset(e.preset), { orientation: e.orientation, finish: e.finish, showSafeArea: e.safe });
      shell.style.width = `${device.layout.width * e.scale}px`;
      shell.style.height = `${device.layout.height * e.scale}px`;
      const caption = document.createElement("figcaption");
      caption.textContent = e.label;
      figure.append(shell, caption);
      gallery.appendChild(figure);
      const r = createDomRenderer(device.screen, common);
      const size = device.screenSize;
      const make = (t: number) => wallpaperFrame(size, t, e.label.split(" · ")[0]!);
      r.render(make(fixedTime));
      renderers.push([r, make]);
    }
    await waitForMedia(gallery);
    animate(renderers);
  } else if (view === "stress") {
    const stage = document.createElement("div");
    stage.className = "device-stage";
    app.appendChild(stage);
    const device = createDeviceFrame(stage, getDevicePreset("iphone-17-pro"), { showFrame: true });
    const r = createDomRenderer(device.screen, common);
    r.render(stressFrame(fixedTime));
    registerBench(r, stressFrame);
    await waitForMedia(stage);
    animate([[r, stressFrame]]);
  }
  window.__sonobeReady = true;
}

main().catch((err) => {
  console.error(err);
  window.__sonobeLog?.push(`error: ${String(err)}`);
  window.__sonobeReady = true;
});
