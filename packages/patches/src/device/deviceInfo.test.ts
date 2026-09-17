import type { DeviceInfo } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness } from "../infra/index.ts";
import { deviceInfoPatch, orientationAngle } from "./deviceInfo.ts";

const device = (overrides: Partial<DeviceInfo> = {}): DeviceInfo => ({
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

describe("deviceInfo", () => {
  it("reports the starting device on frame 0", () => {
    const h = createPatchHarness(deviceInfoPatch);
    expect(h.step().outputs).toEqual({
      screenSize: [402, 874],
      safeArea: [62, 0, 34, 0],
      screenScale: 3,
      orientation: 0,
      landscape: false,
      usesMouse: false,
      darkMode: false,
      deviceName: "iPhone 17 Pro",
    });
  });

  it("follows the snapshot every frame: landscape, computers, dark mode", () => {
    let d = device();
    const h = createPatchHarness(deviceInfoPatch, { services: { device: () => d } });
    h.step();
    d = device({ preset: "desktop", screenSize: [1440, 900], screenScale: 2, safeArea: [0, 0, 0, 0], orientation: "landscape", darkMode: true });
    const f = h.step();
    expect(f.outputs).toMatchObject({ screenSize: [1440, 900], landscape: true, usesMouse: true, darkMode: true, orientation: 90, deviceName: "Desktop 1440×900", screenScale: 2 });
  });

  it("reads the proposed orientation angle when the host provides it", () => {
    expect(orientationAngle(device({ orientationAngle: 180 }))).toBe(180);
    expect(orientationAngle(device({ orientationAngle: -90 }))).toBe(270);
    expect(orientationAngle(device({ orientation: "landscape" }))).toBe(90);
    expect(orientationAngle(device())).toBe(0);
  });

  it("handles unknown presets, bad scales, square screens, and non-finite values with one warning", () => {
    const d = device({ preset: "my-phone", screenScale: 0, screenSize: [Number.NaN, 800], safeArea: [Number.POSITIVE_INFINITY, 0, 0, 0] });
    const h = createPatchHarness(deviceInfoPatch, { services: { device: () => d } });
    const f = h.run(3);
    expect(f.outputs).toMatchObject({ deviceName: "my-phone", usesMouse: false, screenScale: 1, screenSize: [0, 800], safeArea: [0, 0, 0, 0], landscape: false });
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    const square = createPatchHarness(deviceInfoPatch, { services: { device: () => device({ screenSize: [500, 500] }) } });
    expect(square.step().outputs.landscape).toBe(false);
  });

  it("reads the runtime's device settings through runPatch", () => {
    const result = runPatch(deviceInfoPatch, [{}]);
    expect(result.frames[0]!.outputs).toMatchObject({ screenSize: [390, 844], deviceName: "Custom", usesMouse: false });
  });
});
