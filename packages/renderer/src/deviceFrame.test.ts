// @vitest-environment happy-dom
import { getDevicePreset } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createDeviceFrame, getDeviceFrameLayout, orientSafeArea } from "./deviceFrame.ts";

describe("getDeviceFrameLayout", () => {
  const iphone = getDevicePreset("iphone-17-pro");

  it("lays out a portrait phone with a centered island and side buttons", () => {
    const l = getDeviceFrameLayout(iphone);
    expect(l.screenSize).toEqual([402, 874]);
    expect(l.body!.width).toBe(402 + 26);
    expect(l.body!.radius).toBe(62 + 13);
    expect(l.screen).toMatchObject({ width: 402, height: 874, radius: 62 });
    expect(l.screen.x - l.body!.x).toBe(13);
    expect(l.width).toBe(l.body!.width + 8);
    expect(l.cutout!.kind).toBe("island");
    expect(l.cutout!.x + l.cutout!.width / 2).toBe(201);
    expect(new Set(l.buttons.map((b) => b.side))).toEqual(new Set(["left", "right"]));
    for (const b of l.buttons) {
      if (b.side === "left") expect(b.x + b.width).toBeCloseTo(l.body!.x + 0.5);
      if (b.side === "right") expect(b.x).toBeCloseTo(l.body!.x + l.body!.width - 0.5);
    }
    expect(l.safeArea).toEqual([62, 0, 34, 0]);
  });

  it("rotates everything for landscape", () => {
    const l = getDeviceFrameLayout(iphone, { orientation: "landscape" });
    expect(l.screenSize).toEqual([874, 402]);
    expect(l.body!.width).toBe(874 + 26);
    expect(l.screen).toMatchObject({ width: 874, height: 402 });
    expect(l.cutout!.width).toBe(36.5);
    expect(l.cutout!.x).toBe(11);
    expect(l.cutout!.y + l.cutout!.height / 2).toBe(201);
    expect(new Set(l.buttons.map((b) => b.side))).toEqual(new Set(["top", "bottom"]));
    expect(l.safeArea).toEqual([0, 62, 21, 62]);
  });

  it("returns a bare screen without a frame", () => {
    const l = getDeviceFrameLayout(iphone, { showFrame: false });
    expect(l).toMatchObject({ width: 402, height: 874, body: null, cutout: null, buttons: [] });
    expect(l.screen.radius).toBe(0);
  });

  it("draws a classic phone with earpiece and home button", () => {
    const l = getDeviceFrameLayout(getDevicePreset("iphone-se"));
    expect(l.details.map((d) => d.kind).sort()).toEqual(["camera", "homeButton", "speaker"]);
    expect(l.screen.y - l.body!.y).toBe(96);
    expect(l.cutout).toBeNull();
  });

  it("frames tablets, watches, and desktops", () => {
    expect(getDeviceFrameLayout(getDevicePreset("ipad-pro-11")).bezel).toBe(22);
    expect(getDeviceFrameLayout(getDevicePreset("watch-46")).buttons.some((b) => b.kind === "crown")).toBe(true);
    const desktop = getDeviceFrameLayout(getDevicePreset("desktop"));
    expect(desktop.bezel).toBe(0);
    expect(desktop.screen).toMatchObject({ x: 0, y: 0, width: 1440, height: 900, radius: 10 });
  });

  it("keeps tablet safe areas in landscape and moves android cutout insets to the side", () => {
    expect(orientSafeArea(getDevicePreset("ipad-pro-13"), "landscape")).toEqual([24, 0, 20, 0]);
    expect(orientSafeArea(getDevicePreset("android-large"), "landscape")).toEqual([24, 0, 24, 40]);
    expect(orientSafeArea(getDevicePreset("iphone-se"), "landscape")).toEqual([0, 0, 0, 0]);
  });
});

describe("createDeviceFrame", () => {
  it("builds the frame DOM and returns a screen element", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const frame = createDeviceFrame(container, getDevicePreset("iphone-17-pro"), { showSafeArea: true });
    expect(frame.element.parentElement).toBe(container);
    expect(frame.element.style.width).toBe("436px");
    expect(frame.screen.classList.contains("sonobe-device-content")).toBe(true);
    expect(frame.element.querySelector('.sonobe-device-cutout[data-kind="island"]')).not.toBeNull();
    expect(frame.element.querySelectorAll(".sonobe-device-button").length).toBe(5);
    expect(frame.element.querySelectorAll(".sonobe-device-safe").length).toBe(2);
    expect(frame.safeArea).toEqual([62, 0, 34, 0]);
    expect(document.head.querySelector('style[data-sonobe="device-frame"]')).not.toBeNull();

    frame.update(getDevicePreset("android-large"), { orientation: "landscape", finish: "silver" });
    expect(frame.element.dataset.orientation).toBe("landscape");
    expect(frame.element.dataset.finish).toBe("silver");
    expect(frame.element.querySelector('.sonobe-device-cutout[data-kind="punchHole"]')).not.toBeNull();
    expect(frame.screenSize).toEqual([915, 412]);
    expect(frame.element.contains(frame.screen)).toBe(true);

    frame.dispose();
    expect(container.children.length).toBe(0);
    container.remove();
  });
});
