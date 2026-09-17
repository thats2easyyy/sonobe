/**
 * Soft Keyboard: the on-screen keyboard's height and slide progress. The host reports visibility
 * and measured heights; hidden keyboards use a per-device estimate, and the slide eases over
 * 0.35 s with a cubic ease out. The slide is shared by the instance, because there's one keyboard.
 */

import { EASINGS } from "@sonobe/engine";
import type { DeviceInfo, SoftKeyboardSnapshot } from "@sonobe/engine";
import { definePatch, toText } from "../infra/index.ts";
import { dropInstanceStore, findPreset, instanceKey, instanceStore } from "./shared.ts";

/** Slide duration in seconds. */
export const KEYBOARD_SLIDE_DURATION = 0.35;

const KEYBOARD_TYPES = new Set(["default", "number", "email", "url", "phone"]);

/** Estimated keyboard height in points for a device, orientation, and keyboard type. */
export function estimateKeyboardHeight(device: DeviceInfo, type: string): number {
  const preset = findPreset(device.preset);
  let kind: string = preset?.kind ?? "custom";
  if (kind === "custom") {
    const [w, h] = Array.isArray(device.screenSize) ? device.screenSize : [0, 0];
    kind = Math.min(Number(w) || 0, Number(h) || 0) < 600 ? "phone" : "tablet";
  }
  const landscape = device.orientation === "landscape";
  const pad = type === "number" || type === "phone";
  if (kind === "phone") return landscape ? (pad ? 171 : 209) : pad ? 250 : 336;
  if (kind === "tablet") return landscape ? 398 : 313;
  return 0;
}

interface Slide {
  from: number;
  to: number;
  elapsed: number;
  progress: number;
  /** Frame the slide last advanced on. */
  frame: number;
  measured: Record<string, number>;
}

interface KeyboardState {
  key: string;
  index: number;
}

export const softKeyboardPatch = definePatch<KeyboardState>("softKeyboard", {
  state: () => ({ key: "", index: -1 }),
  evaluate(ctx) {
    ctx.state.key = instanceKey(ctx);
    ctx.state.index = ctx.loopIndex;
    const slide = instanceStore<Slide>(ctx, () => ({ from: 0, to: 0, elapsed: KEYBOARD_SLIDE_DURATION, progress: 0, frame: -1, measured: {} }));
    let kb: SoftKeyboardSnapshot | undefined;
    try {
      kb = ctx.services.platform.softKeyboard?.();
    } catch {
      kb = undefined;
    }
    const d = ctx.services.device();
    const choice = toText(ctx.input("keyboardType"));
    const reported = typeof kb?.keyboardType === "string" && KEYBOARD_TYPES.has(kb.keyboardType) ? kb.keyboardType : "default";
    const type = choice === "auto" ? reported : KEYBOARD_TYPES.has(choice) ? choice : "default";
    const visible = kb?.visible === true;
    if (visible && typeof kb!.height === "number" && Number.isFinite(kb!.height) && kb!.height > 0) slide.measured[type] = kb!.height;
    const height = slide.measured[type] ?? estimateKeyboardHeight(d, type);
    if (slide.frame !== ctx.frame) {
      slide.frame = ctx.frame;
      const target = visible ? 1 : 0;
      if (target !== slide.to) {
        slide.from = slide.progress;
        slide.to = target;
        slide.elapsed = 0;
      }
      slide.elapsed = Math.min(slide.elapsed + (ctx.dt > 0 ? ctx.dt : 0), KEYBOARD_SLIDE_DURATION);
      const t = slide.elapsed / KEYBOARD_SLIDE_DURATION;
      slide.progress = slide.from + (slide.to - slide.from) * EASINGS.cubicOut(t);
    }
    if (slide.elapsed < KEYBOARD_SLIDE_DURATION) ctx.requestNextFrame();
    ctx.output("visibleHeight", height * slide.progress);
    ctx.output("height", height);
    ctx.output("progress", slide.progress);
    ctx.output("visible", slide.to === 1);
  },
  dispose(state, services) {
    if (state?.index === 0) dropInstanceStore(services, state.key);
  },
});
