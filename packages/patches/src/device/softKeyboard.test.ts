import { EASINGS } from "@sonobe/engine";
import type { DeviceInfo, SoftKeyboardSnapshot } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { KEYBOARD_SLIDE_DURATION, estimateKeyboardHeight, softKeyboardPatch } from "./softKeyboard.ts";

const info = (overrides: Partial<DeviceInfo> = {}): DeviceInfo => ({
  preset: "iphone-17-pro",
  screenSize: [402, 874],
  screenScale: 3,
  safeArea: [62, 0, 34, 0],
  orientation: "portrait",
  darkMode: false,
  platform: "web",
  timeZone: "UTC",
  ...overrides,
});

function harness(inputs: Record<string, unknown> = {}) {
  let kb: SoftKeyboardSnapshot | undefined;
  const h = createPatchHarness(softKeyboardPatch, { inputs, services: { platform: { softKeyboard: () => kb } as never } });
  return { h, setKeyboard: (next: SoftKeyboardSnapshot | undefined) => (kb = next) };
}

describe("estimateKeyboardHeight", () => {
  it("uses the table by device kind, orientation, and keyboard type", () => {
    expect(estimateKeyboardHeight(info(), "default")).toBe(336);
    expect(estimateKeyboardHeight(info(), "phone")).toBe(250);
    expect(estimateKeyboardHeight(info({ orientation: "landscape" }), "email")).toBe(209);
    expect(estimateKeyboardHeight(info({ orientation: "landscape" }), "number")).toBe(171);
    expect(estimateKeyboardHeight(info({ preset: "ipad-pro-11" }), "number")).toBe(313);
    expect(estimateKeyboardHeight(info({ preset: "ipad-pro-11", orientation: "landscape" }), "default")).toBe(398);
    expect(estimateKeyboardHeight(info({ preset: "desktop" }), "default")).toBe(0);
    expect(estimateKeyboardHeight(info({ preset: "watch-46" }), "default")).toBe(0);
    expect(estimateKeyboardHeight(info({ preset: "custom", screenSize: [390, 844] }), "default")).toBe(336);
    expect(estimateKeyboardHeight(info({ preset: "custom", screenSize: [800, 1200] }), "default")).toBe(313);
  });
});

describe("softKeyboard", () => {
  it("starts hidden with the estimated height (no keyboard service in simulation)", () => {
    const h = createPatchHarness(softKeyboardPatch);
    expect(h.step().outputs).toEqual({ visibleHeight: 0, height: 336, progress: 0, visible: false });
  });

  it("slides up over 0.35 s with a cubic ease out and uses the measured height", () => {
    const { h, setKeyboard } = harness();
    h.step();
    setKeyboard({ visible: true, height: 300, keyboardType: "default" });
    const dt = 0.05;
    let f = h.step({ dt });
    expect(f.outputs.visible).toBe(true);
    expect(f.outputs.height).toBe(300);
    expect(f.outputs.progress).toBeCloseTo(EASINGS.cubicOut(dt / KEYBOARD_SLIDE_DURATION), 10);
    expect(f.outputs.visibleHeight).toBeCloseTo(300 * (f.outputs.progress as number), 10);
    expect(f.requestedNextFrame).toBe(true);
    f = h.run(10, { dt });
    expect(f.outputs.progress).toBe(1);
    expect(f.outputs.visibleHeight).toBe(300);
    expect(f.requestedNextFrame).toBe(false);
  });

  it("eases back to 0 from the current progress over the full duration when hidden mid-slide", () => {
    const { h, setKeyboard } = harness();
    h.step();
    setKeyboard({ visible: true, height: 300 });
    h.step({ dt: 0.1 });
    const mid = h.output("progress") as number;
    setKeyboard({ visible: false, height: 0 });
    const f = h.step({ dt: 0.1 });
    expect(f.outputs.visible).toBe(false);
    expect(f.outputs.progress).toBeCloseTo(mid + (0 - mid) * EASINGS.cubicOut(0.1 / KEYBOARD_SLIDE_DURATION), 10);
    expect(f.outputs.height).toBe(300);
    expect(h.run(5, { dt: 0.1 }).outputs.progress).toBe(0);
  });

  it("Auto follows the field's keyboard; bad host heights fall back to the last measurement, then the estimate", () => {
    const { h, setKeyboard } = harness();
    setKeyboard({ visible: true, height: 260, keyboardType: "number" });
    expect(h.step().outputs.height).toBe(260);
    setKeyboard({ visible: true, height: Number.NaN, keyboardType: "number" });
    expect(h.step().outputs.height).toBe(260);
    setKeyboard({ visible: true, height: -4, keyboardType: "phone" });
    expect(h.step().outputs.height).toBe(250);
  });

  it("shares one slide across loop indices while heights follow each index's keyboard type", () => {
    const { h, setKeyboard } = harness({ keyboardType: loopOf(["default", "number"]) });
    h.step();
    setKeyboard({ visible: true, height: 0 });
    const f = h.step({ dt: 0.1 });
    const progress = f.outputs.progress as { items: number[] };
    expect(progress.items[0]).toBe(progress.items[1]);
    expect(progress.items[0]).toBeCloseTo(EASINGS.cubicOut(0.1 / KEYBOARD_SLIDE_DURATION), 10);
    expect(f.outputs.height).toEqual(loopOf([336, 250]));
  });

  it("restart forgets measured heights and the slide", () => {
    const { h, setKeyboard } = harness();
    setKeyboard({ visible: true, height: 280 });
    h.run(20);
    setKeyboard(undefined);
    h.restart();
    expect(h.step().outputs).toEqual({ visibleHeight: 0, height: 336, progress: 0, visible: false });
  });
});
