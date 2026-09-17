import type { DeviceInfo } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness } from "../infra/index.ts";
import { deviceOrientation, deviceSupports, interfaceOrientationPatch } from "./interfaceOrientation.ts";

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
  let d = info();
  const h = createPatchHarness(interfaceOrientationPatch, { inputs, services: { device: () => d } });
  return { h, setDevice: (next: DeviceInfo) => (d = next) };
}

describe("deviceOrientation and deviceSupports", () => {
  it("maps the contract orientation and the proposed angle", () => {
    expect(deviceOrientation(info())).toBe("portrait");
    expect(deviceOrientation(info({ orientation: "landscape" }))).toBe("landscapeLeft");
    expect(deviceOrientation(info({ orientationAngle: 90 }))).toBe("landscapeLeft");
    expect(deviceOrientation(info({ orientationAngle: 180 }))).toBe("upsideDown");
    expect(deviceOrientation(info({ orientationAngle: 268 }))).toBe("landscapeRight");
    expect(deviceOrientation(info({ orientationAngle: 359 }))).toBe("portrait");
  });

  it("never allows upside down on phones with an island or notch", () => {
    expect(deviceSupports(info(), "upsideDown")).toBe(false);
    expect(deviceSupports(info({ preset: "iphone-se" }), "upsideDown")).toBe(true);
    expect(deviceSupports(info({ preset: "custom" }), "upsideDown")).toBe(true);
    expect(deviceSupports(info(), "landscapeRight")).toBe(true);
  });
});

describe("interfaceOrientation", () => {
  it("applies Start In on frame 0 and again after a restart", () => {
    const { h } = harness({ startIn: "landscapeRight" });
    expect(h.step().outputs).toEqual({ orientation: "landscapeRight", landscape: true });
    expect(h.step().outputs.orientation).toBe("landscapeRight");
    h.set({ startIn: "portrait" });
    h.restart();
    expect(h.step().outputs.orientation).toBe("portrait");
  });

  it("starts in portrait when the device can't show Start In, or it isn't an orientation", () => {
    expect(harness({ startIn: "upsideDown" }).h.step().outputs.orientation).toBe("portrait");
    const bad = harness({ startIn: "sideways" }).h;
    expect(bad.step().outputs.orientation).toBe("portrait");
    expect(bad.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("turns when the device rotates to an allowed direction", () => {
    const { h, setDevice } = harness();
    h.step();
    setDevice(info({ orientation: "landscape" }));
    expect(h.step().outputs).toEqual({ orientation: "landscapeLeft", landscape: true });
    setDevice(info());
    expect(h.step().outputs).toEqual({ orientation: "portrait", landscape: false });
  });

  it("doesn't turn toward a disallowed direction until its input turns on", () => {
    const { h, setDevice } = harness({ landscapeLeft: false });
    h.step();
    setDevice(info({ orientation: "landscape" }));
    expect(h.run(3).outputs.orientation).toBe("portrait");
    expect(h.step({ inputs: { landscapeLeft: true } }).outputs.orientation).toBe("landscapeLeft");
  });

  it("turning a direction off never turns the interface away from it", () => {
    const { h, setDevice } = harness();
    h.step();
    setDevice(info({ orientation: "landscape" }));
    h.step();
    expect(h.step({ inputs: { landscapeLeft: false, landscapeRight: false } }).outputs.orientation).toBe("landscapeLeft");
    setDevice(info());
    expect(h.step().outputs.orientation).toBe("portrait");
  });

  it("outputs portrait and Landscape false while muted", () => {
    const result = runPatch(interfaceOrientationPatch, [{ startIn: "landscapeLeft" }], { muted: true });
    expect(result.frames[0]!.outputs).toEqual({ orientation: "portrait", landscape: false });
  });

  it("warns once inside a component, where it doesn't drive the viewer", () => {
    const h = createPatchHarness(interfaceOrientationPatch, { componentPath: "main/card" });
    h.run(3);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });
});
