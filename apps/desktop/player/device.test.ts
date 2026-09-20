import { describe, expect, it } from "vitest";
import { isMobileDevice, playerDevice, screenAngle, stageSafeArea, type DeviceWindow } from "./device.ts";

/** A window whose media queries answer from `media`. */
const win = (media: Record<string, boolean>, extra: Omit<DeviceWindow, "matchMedia"> = {}): DeviceWindow => ({ matchMedia: (query) => ({ matches: media[query] === true }), ...extra });

describe("the player's device", () => {
  it("is mobile under a native host or with a touch screen as the main pointer", () => {
    expect(isMobileDevice(win({ "(pointer: coarse)": true }), false)).toBe(true);
    expect(isMobileDevice(win({}), true)).toBe(true);
    // A laptop, a desktop browser, the pop-out viewer window.
    expect(isMobileDevice(win({ "(pointer: fine)": true }), false)).toBe(false);
    expect(isMobileDevice({}, false)).toBe(false);
  });

  it("reads the screen's rotation counterclockwise from portrait", () => {
    expect(screenAngle({ screen: { orientation: { type: "portrait-primary", angle: 0 } } })).toBe(0);
    expect(screenAngle({ screen: { orientation: { type: "landscape-primary", angle: 90 } } })).toBe(90);
    expect(screenAngle({ screen: { orientation: { type: "landscape-secondary", angle: 270 } } })).toBe(270);
    // A tablet that is naturally landscape says angle 0 held that way.
    expect(screenAngle({ screen: { orientation: { type: "landscape-primary", angle: 0 } } })).toBe(90);
    // iOS before 16.4: window.orientation, where turning clockwise is -90.
    expect(screenAngle({ orientation: -90 })).toBe(270);
    expect(screenAngle({ orientation: 180 })).toBe(180);
    expect(screenAngle({})).toBeUndefined();
  });

  it("measures the safe area over the drawn prototype, in its points", () => {
    // A 402×874 prototype on a 393×852 phone: scaled to 0.975 and letterboxed by 0.9 px left and right.
    const stage = { viewport: [393, 852] as [number, number], size: [402, 874] as [number, number], scale: 852 / 874 };
    expect(stageSafeArea([59, 0, 34, 0], stage)).toEqual([61, 0, 35, 0]);
    // Turned, with the interface kept portrait: the prototype sits between the side insets, which the letterbox covers.
    const turned = { viewport: [852, 393] as [number, number], size: [402, 874] as [number, number], scale: 393 / 874 };
    expect(stageSafeArea([0, 59, 21, 59], turned)).toEqual([0, 0, 47, 0]);
    expect(stageSafeArea([10, 10, 10, 10], { ...stage, scale: 0 })).toEqual([0, 0, 0, 0]);
  });

  it("tells a phone's runtime its appearance, insets, rotation and density, and a desktop browser's only its appearance", () => {
    const stage = { viewport: [402, 874] as [number, number], size: [402, 874] as [number, number], scale: 1 };
    const phone = win({ "(prefers-color-scheme: dark)": true }, { screen: { orientation: { type: "portrait-primary", angle: 0 } }, devicePixelRatio: 3 });
    expect(playerDevice(phone, { mobile: true, insets: [62, 0, 34, 0], stage })).toEqual({ platform: "mobile", darkMode: true, orientationAngle: 0, screenScale: 3, safeArea: [62, 0, 34, 0] });
    // Before the prototype's size is known, the project's safe area stays.
    expect(playerDevice(phone, { mobile: true, insets: [62, 0, 34, 0], stage: null })).not.toHaveProperty("safeArea");
    expect(playerDevice(win({}, { devicePixelRatio: 2, screen: { orientation: { type: "landscape-primary", angle: 0 } } }), { mobile: false, insets: [0, 0, 0, 0], stage })).toEqual({ platform: "web", darkMode: false });
  });
});
