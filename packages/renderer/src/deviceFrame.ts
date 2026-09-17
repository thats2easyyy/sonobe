/**
 * Pure-CSS device frames: a rounded body with a metal band, concentric screen corners,
 * island / notch / punch-hole cutouts, and subtle side buttons. No bitmaps, no device imagery.
 */

import type { DevicePreset } from "@sonobe/core";
import { ensureStylesheet } from "./stylesheet.ts";
import { px } from "./values.ts";

export type Orientation = "portrait" | "landscape";
export type SafeArea = [top: number, right: number, bottom: number, left: number];

export interface DeviceFrameOptions {
  /** Draw the bezel (default true). When off, only the screen rectangle is shown. */
  showFrame?: boolean;
  orientation?: Orientation;
  /** Band and button finish. Default "graphite". */
  finish?: "graphite" | "silver";
  /** Tint the unsafe regions (handy while laying out). Default false. */
  showSafeArea?: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoundedRect extends Rect {
  radius: number;
}

export interface DeviceButton extends Rect {
  side: "left" | "right" | "top" | "bottom";
  kind: "button" | "crown";
}

export interface DeviceCutout extends RoundedRect {
  kind: "island" | "notch" | "punchHole";
}

export interface DeviceFrameLayout {
  orientation: Orientation;
  showFrame: boolean;
  /** Size of the frame element (body plus room for buttons). */
  width: number;
  height: number;
  /** Device body, in frame coordinates (null without a frame). */
  body: RoundedRect | null;
  /** Screen, in frame coordinates. */
  screen: RoundedRect;
  bezel: number;
  /** Cutout in screen coordinates. */
  cutout: DeviceCutout | null;
  /** Buttons in frame coordinates. */
  buttons: DeviceButton[];
  /** Front details in frame coordinates (earpiece, home button, camera dot). */
  details: (RoundedRect & { kind: "speaker" | "homeButton" | "camera" })[];
  safeArea: SafeArea;
  screenSize: [number, number];
}

export interface DeviceFrame {
  /** Outer frame element appended to the container. */
  readonly element: HTMLElement;
  /** Element to render the prototype into (screen-sized, clipped to the screen corners). */
  readonly screen: HTMLElement;
  readonly layout: DeviceFrameLayout;
  readonly safeArea: SafeArea;
  readonly screenSize: [number, number];
  update(preset: DevicePreset, opts?: DeviceFrameOptions): void;
  dispose(): void;
}

/** Safe-area insets for an orientation. Landscape phones with cutouts get symmetric side insets. */
export function orientSafeArea(preset: DevicePreset, orientation: Orientation): SafeArea {
  const [t, r, b, l] = preset.safeArea;
  if (orientation === "portrait" || preset.kind !== "phone") return [t, r, b, l];
  const cutout = preset.cutout ?? "none";
  if (cutout === "island" || cutout === "notch") {
    const side = Math.max(t, r, l);
    return [0, side, b > 0 ? Math.round(b * 0.62) : 0, side];
  }
  if (cutout === "punchHole") return [Math.min(t, 24), 0, b, t];
  return [0, 0, b, 0];
}

const BUTTON_DEPTH = 3;

interface FrameSpec {
  side: number;
  top: number;
  bottom: number;
  bodyRadius: number;
  pad: number;
  buttons: { side: "left" | "right" | "top"; at: number; length: number; kind?: "crown"; depth?: number }[];
  details: (RoundedRect & { kind: "speaker" | "homeButton" | "camera" })[];
}

function frameSpec(preset: DevicePreset): FrameSpec {
  const [w] = preset.size;
  const cutout = preset.cutout ?? "none";
  const r = preset.cornerRadius;
  switch (preset.kind) {
    case "phone": {
      if (cutout === "none" && r === 0) {
        const side = 16, top = 96, bottom = 96;
        const bw = w + side * 2;
        return {
          side, top, bottom, bodyRadius: 54, pad: BUTTON_DEPTH + 1,
          buttons: [
            { side: "left", at: 0.13, length: 0.04 },
            { side: "left", at: 0.2, length: 0.07 },
            { side: "left", at: 0.29, length: 0.07 },
            { side: "right", at: 0.2, length: 0.08 },
          ],
          details: [
            { kind: "speaker", x: bw / 2 - 26, y: top / 2 - 2.5, width: 52, height: 5, radius: 2.5 },
            { kind: "camera", x: bw / 2 - 52, y: top / 2 - 4.5, width: 9, height: 9, radius: 4.5 },
            { kind: "homeButton", x: bw / 2 - 30, y: top + preset.size[1] + bottom / 2 - 30, width: 60, height: 60, radius: 30 },
          ],
        };
      }
      const bezel = cutout === "notch" ? 15 : cutout === "punchHole" ? 11 : 13;
      const buttons: FrameSpec["buttons"] =
        preset.platform === "android"
          ? [
              { side: "right", at: 0.17, length: 0.12 },
              { side: "right", at: 0.33, length: 0.065 },
            ]
          : [
              { side: "left", at: 0.155, length: 0.04 },
              { side: "left", at: 0.225, length: 0.07 },
              { side: "left", at: 0.31, length: 0.07 },
              { side: "right", at: 0.26, length: 0.11 },
              ...(cutout === "island" ? [{ side: "right" as const, at: 0.6, length: 0.075 }] : []),
            ];
      return { side: bezel, top: bezel, bottom: bezel, bodyRadius: r + bezel, pad: BUTTON_DEPTH + 1, buttons, details: [] };
    }
    case "tablet": {
      const bezel = 22;
      return {
        side: bezel, top: bezel, bottom: bezel, bodyRadius: r + bezel, pad: BUTTON_DEPTH + 1,
        buttons: [
          { side: "top", at: 0.8, length: 0.07 },
          { side: "right", at: 0.07, length: 0.045 },
          { side: "right", at: 0.125, length: 0.045 },
        ],
        details: [{ kind: "camera", x: bezel + w / 2 - 3.5, y: bezel / 2 - 3.5, width: 7, height: 7, radius: 3.5 }],
      };
    }
    case "watch": {
      const bezel = 12;
      return {
        side: bezel, top: bezel, bottom: bezel, bodyRadius: r + bezel, pad: 8,
        buttons: [
          { side: "right", at: 0.2, length: 0.24, kind: "crown", depth: 6 },
          { side: "right", at: 0.56, length: 0.2 },
        ],
        details: [],
      };
    }
    default:
      return { side: 0, top: 0, bottom: 0, bodyRadius: r, pad: 0, buttons: [], details: [] };
  }
}

function cutoutRect(preset: DevicePreset): DeviceCutout | null {
  const [w] = preset.size;
  switch (preset.cutout) {
    case "island":
      return { kind: "island", x: w / 2 - 62.5, y: 11, width: 125, height: 36.5, radius: 18.25 };
    case "notch":
      return { kind: "notch", x: w / 2 - 81, y: 0, width: 162, height: 32, radius: 20 };
    case "punchHole":
      return { kind: "punchHole", x: w / 2 - 6.5, y: 13, width: 13, height: 13, radius: 6.5 };
    default:
      return null;
  }
}

/** Rotates a rect from a portrait box of width `boxWidth` into landscape (device top turns left). */
function rotateRect<T extends Rect>(r: T, boxWidth: number): T {
  return { ...r, x: r.y, y: boxWidth - r.x - r.width, width: r.height, height: r.width };
}

const ROTATED_SIDE = { left: "bottom", right: "top", top: "left", bottom: "right" } as const;

/** Geometry for a device frame (pure; used by createDeviceFrame and tests). */
export function getDeviceFrameLayout(preset: DevicePreset, opts: DeviceFrameOptions = {}): DeviceFrameLayout {
  const orientation = opts.orientation ?? "portrait";
  const showFrame = opts.showFrame ?? true;
  const landscape = orientation === "landscape";
  const [pw, ph] = preset.size;
  const screenSize: [number, number] = landscape ? [ph, pw] : [pw, ph];
  const safeArea = orientSafeArea(preset, orientation);

  if (!showFrame) {
    return {
      orientation, showFrame, width: screenSize[0], height: screenSize[1], body: null,
      screen: { x: 0, y: 0, width: screenSize[0], height: screenSize[1], radius: 0 },
      bezel: 0, cutout: null, buttons: [], details: [], safeArea, screenSize,
    };
  }

  const spec = frameSpec(preset);
  const bw = pw + spec.side * 2;
  const bh = ph + spec.top + spec.bottom;
  const pad = spec.pad;
  const screenP: RoundedRect = { x: spec.side, y: spec.top, width: pw, height: ph, radius: preset.cornerRadius };
  const buttonsP: DeviceButton[] = spec.buttons.map((b) => {
    const depth = b.depth ?? BUTTON_DEPTH;
    if (b.side === "top") return { side: "top", kind: "button", x: bw * b.at, y: -depth, width: bw * b.length, height: depth + 0.5 };
    const x = b.side === "left" ? -depth : bw - 0.5;
    return { side: b.side, kind: b.kind ?? "button", x, y: bh * b.at, width: depth + 0.5, height: bh * b.length };
  });
  const cutoutP = cutoutRect(preset);

  const body: RoundedRect = landscape ? { x: 0, y: 0, width: bh, height: bw, radius: spec.bodyRadius } : { x: 0, y: 0, width: bw, height: bh, radius: spec.bodyRadius };
  const screen = landscape ? rotateRect(screenP, bw) : screenP;
  const buttons = landscape ? buttonsP.map((b) => ({ ...rotateRect(b, bw), side: ROTATED_SIDE[b.side] })) : buttonsP;
  const details = landscape ? spec.details.map((d) => rotateRect(d, bw)) : spec.details;
  const cutout = cutoutP && (landscape ? rotateRect(cutoutP, pw) : cutoutP);

  const shift = <T extends Rect>(r: T): T => ({ ...r, x: r.x + pad, y: r.y + pad });
  return {
    orientation, showFrame,
    width: body.width + pad * 2,
    height: body.height + pad * 2,
    body: shift(body),
    screen: shift(screen),
    bezel: spec.side,
    cutout,
    buttons: buttons.map(shift),
    details: details.map(shift),
    safeArea,
    screenSize,
  };
}

const DEVICE_CSS = `
.sonobe-device{position:relative;flex:none;box-sizing:border-box;
  --sd-body:#0b0b0c;--sd-band:#3a3a3e;--sd-band-edge:#5f5f65;--sd-btn-dark:#27272a;--sd-btn-light:#55555b}
.sonobe-device[data-finish="silver"]{--sd-body:#0e0e10;--sd-band:#c7c7cc;--sd-band-edge:#ececf0;--sd-btn-dark:#a9a9ae;--sd-btn-light:#e4e4e8}
.sonobe-device *{box-sizing:border-box}
.sonobe-device-body{position:absolute;background:var(--sd-body);
  box-shadow:0 0 0 2px var(--sd-band),0 0 0 2.75px var(--sd-band-edge),inset 0 0 0 1px rgba(255,255,255,.05),
    0 2px 3px rgba(0,0,0,.18),0 28px 56px -14px rgba(0,0,0,.34),0 12px 28px -12px rgba(0,0,0,.28)}
.sonobe-device[data-kind="computer"] .sonobe-device-body,.sonobe-device[data-kind="custom"] .sonobe-device-body{background:transparent;
  box-shadow:0 0 0 1px rgba(0,0,0,.14),0 18px 44px -14px rgba(0,0,0,.28),0 4px 10px -4px rgba(0,0,0,.12)}
.sonobe-device-button{position:absolute;border-radius:1.5px}
.sonobe-device-button[data-side="left"],.sonobe-device-button[data-side="right"]{background:linear-gradient(to right,var(--sd-btn-dark),var(--sd-btn-light) 55%,var(--sd-btn-dark))}
.sonobe-device-button[data-side="top"],.sonobe-device-button[data-side="bottom"]{background:linear-gradient(to bottom,var(--sd-btn-dark),var(--sd-btn-light) 55%,var(--sd-btn-dark))}
.sonobe-device-button[data-kind="crown"][data-side="right"],.sonobe-device-button[data-kind="crown"][data-side="left"]{border-radius:2px 3px 3px 2px;background:repeating-linear-gradient(to bottom,var(--sd-btn-light) 0 1.5px,var(--sd-btn-dark) 1.5px 3px)}
.sonobe-device-button[data-kind="crown"][data-side="top"],.sonobe-device-button[data-kind="crown"][data-side="bottom"]{border-radius:3px 3px 2px 2px;background:repeating-linear-gradient(to right,var(--sd-btn-light) 0 1.5px,var(--sd-btn-dark) 1.5px 3px)}
.sonobe-device-detail{position:absolute}
.sonobe-device-detail[data-kind="speaker"]{background:#1d1d20;box-shadow:inset 0 1px 1px rgba(0,0,0,.6)}
.sonobe-device-detail[data-kind="camera"]{background:radial-gradient(circle at 35% 35%,#2d3346 0 22%,#0d0f16 60%)}
.sonobe-device-detail[data-kind="homeButton"]{box-shadow:inset 0 0 0 2px #2b2b2f,inset 0 0 0 3px rgba(255,255,255,.04)}
.sonobe-device-screen{position:absolute;overflow:hidden;background:#000;isolation:isolate}
.sonobe-device-content{position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden}
.sonobe-device-overlay{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:1}
.sonobe-device-cutout{position:absolute;background:#000}
.sonobe-device-cutout[data-kind="island"]{box-shadow:inset 0 0 0 .5px rgba(255,255,255,.03)}
.sonobe-device-cutout[data-kind="island"]::after{content:"";position:absolute;width:11px;height:11px;border-radius:50%;
  background:radial-gradient(circle at 40% 40%,#27304a 0 18%,#0b0d14 55%,#000 70%)}
.sonobe-device[data-orientation="portrait"] .sonobe-device-cutout[data-kind="island"]::after{right:13px;top:calc(50% - 5.5px)}
.sonobe-device[data-orientation="landscape"] .sonobe-device-cutout[data-kind="island"]::after{top:13px;left:calc(50% - 5.5px)}
.sonobe-device-cutout[data-kind="punchHole"]{box-shadow:0 0 0 1.5px rgba(20,20,24,.9);background:radial-gradient(circle at 40% 40%,#232a3e 0 20%,#050608 60%)}
.sonobe-device-cutout[data-kind="notch"]::before,.sonobe-device-cutout[data-kind="notch"]::after{content:"";position:absolute;width:6px;height:6px}
.sonobe-device[data-orientation="portrait"] .sonobe-device-cutout[data-kind="notch"]::before{top:0;left:-6px;background:radial-gradient(circle at 0 100%,transparent 5.5px,#000 6px)}
.sonobe-device[data-orientation="portrait"] .sonobe-device-cutout[data-kind="notch"]::after{top:0;right:-6px;background:radial-gradient(circle at 100% 100%,transparent 5.5px,#000 6px)}
.sonobe-device[data-orientation="landscape"] .sonobe-device-cutout[data-kind="notch"]::before{left:0;bottom:-6px;background:radial-gradient(circle at 100% 100%,transparent 5.5px,#000 6px)}
.sonobe-device[data-orientation="landscape"] .sonobe-device-cutout[data-kind="notch"]::after{left:0;top:-6px;background:radial-gradient(circle at 100% 0,transparent 5.5px,#000 6px)}
.sonobe-device-safe{position:absolute;background:repeating-linear-gradient(135deg,rgba(255,55,95,.16) 0 5px,rgba(255,55,95,.07) 5px 10px)}
`;

function rectStyle(el: HTMLElement, r: Rect, radius?: number): void {
  el.style.left = px(r.x);
  el.style.top = px(r.y);
  el.style.width = px(r.width);
  el.style.height = px(r.height);
  if (radius !== undefined) el.style.borderRadius = px(radius);
}

/** Builds a CSS device frame inside `container` and returns the screen element to render into. */
export function createDeviceFrame(container: HTMLElement, preset: DevicePreset, opts: DeviceFrameOptions = {}): DeviceFrame {
  const doc = container.ownerDocument;
  ensureStylesheet(container, "device-frame", DEVICE_CSS);
  const element = doc.createElement("div");
  element.className = "sonobe-device";
  const screenEl = doc.createElement("div");
  screenEl.className = "sonobe-device-screen";
  const content = doc.createElement("div");
  content.className = "sonobe-device-content";
  const overlay = doc.createElement("div");
  overlay.className = "sonobe-device-overlay";
  screenEl.append(content, overlay);
  container.appendChild(element);

  let layout = getDeviceFrameLayout(preset, opts);

  const build = (p: DevicePreset, o: DeviceFrameOptions) => {
    layout = getDeviceFrameLayout(p, o);
    element.dataset.kind = p.kind;
    element.dataset.platform = p.platform;
    element.dataset.orientation = layout.orientation;
    element.dataset.finish = o.finish ?? "graphite";
    element.dataset.frame = layout.showFrame ? "on" : "off";
    element.style.width = px(layout.width);
    element.style.height = px(layout.height);
    element.replaceChildren();
    overlay.replaceChildren();

    for (const b of layout.buttons) {
      const btn = doc.createElement("div");
      btn.className = "sonobe-device-button";
      btn.dataset.side = b.side;
      btn.dataset.kind = b.kind;
      rectStyle(btn, b);
      element.appendChild(btn);
    }
    if (layout.body) {
      const body = doc.createElement("div");
      body.className = "sonobe-device-body";
      rectStyle(body, layout.body, layout.body.radius);
      element.appendChild(body);
    }
    for (const d of layout.details) {
      const detail = doc.createElement("div");
      detail.className = "sonobe-device-detail";
      detail.dataset.kind = d.kind;
      rectStyle(detail, d, d.radius);
      element.appendChild(detail);
    }
    rectStyle(screenEl, layout.screen, layout.screen.radius);
    element.appendChild(screenEl);

    if (layout.cutout) {
      const c = layout.cutout;
      const cut = doc.createElement("div");
      cut.className = "sonobe-device-cutout";
      cut.dataset.kind = c.kind;
      rectStyle(cut, c);
      if (c.kind === "notch") {
        cut.style.borderRadius = layout.orientation === "portrait" ? `0 0 ${px(c.radius)} ${px(c.radius)}` : `0 ${px(c.radius)} ${px(c.radius)} 0`;
      } else {
        cut.style.borderRadius = px(c.radius);
      }
      overlay.appendChild(cut);
    }
    if (o.showSafeArea) {
      const [t, r, b, l] = layout.safeArea;
      const [sw, sh] = layout.screenSize;
      const bands: Rect[] = [
        { x: 0, y: 0, width: sw, height: t },
        { x: sw - r, y: t, width: r, height: sh - t - b },
        { x: 0, y: sh - b, width: sw, height: b },
        { x: 0, y: t, width: l, height: sh - t - b },
      ];
      for (const band of bands) {
        if (band.width <= 0 || band.height <= 0) continue;
        const el = doc.createElement("div");
        el.className = "sonobe-device-safe";
        rectStyle(el, band);
        overlay.appendChild(el);
      }
    }
  };

  build(preset, opts);

  return {
    element,
    screen: content,
    get layout() {
      return layout;
    },
    get safeArea() {
      return layout.safeArea;
    },
    get screenSize() {
      return layout.screenSize;
    },
    update(p, o = {}) {
      build(p, o);
    },
    dispose() {
      element.remove();
    },
  };
}
