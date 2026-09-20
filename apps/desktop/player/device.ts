/**
 * What the web player tells the runtime about the device it runs on: RuntimeOptions.device at start,
 * then runtime.setDevice whenever it changes, so Device Info and the other device patches read real
 * values.
 *
 * - On a phone or tablet ("mobile": a native host like Sonobe Viewer, or a touch screen as the main
 *   pointer): the system appearance, the safe-area insets that reach over the drawn prototype, the
 *   screen's rotation and its pixel density.
 * - In a desktop browser or the pop-out viewer window ("web"): the system appearance only. Like the
 *   editor's viewer, the simulated device keeps the project's safe area, orientation and scale.
 *
 * The screen size stays the project's: the player scales the prototype to fit the screen.
 */

import type { DeviceInfo } from "@sonobe/engine";

/** [top, right, bottom, left]. */
export type Insets = [number, number, number, number];

/** The parts of `window` the device read-out uses. */
export interface DeviceWindow {
  matchMedia?(query: string): { matches: boolean };
  screen?: { orientation?: { type?: string; angle?: number } };
  /** window.orientation: iOS before 16.4 has no screen.orientation. */
  orientation?: number;
  devicePixelRatio?: number;
}

/** Where the prototype is drawn: its size in points and the scale that fits it to the viewport, both centered. */
export interface PlayerStage {
  viewport: [number, number];
  size: [number, number];
  scale: number;
}

const matches = (win: DeviceWindow, query: string) => {
  try {
    return win.matchMedia?.(query).matches === true;
  } catch {
    return false;
  }
};

/** A phone or tablet: a native host, or a touch screen as the main pointer (a touchscreen laptop's main pointer is its trackpad). */
export function isMobileDevice(win: DeviceWindow, native: boolean): boolean {
  return native || matches(win, "(pointer: coarse)");
}

const ANGLE_OF_TYPE: Readonly<Record<string, number>> = { "portrait-primary": 0, "landscape-primary": 90, "portrait-secondary": 180, "landscape-secondary": 270 };

/**
 * The screen's rotation in degrees counterclockwise from upright portrait: 0, 90, 180 or 270
 * (DeviceInfo.orientationAngle), or undefined when the browser doesn't say. Read from the orientation
 * type, so a tablet that is naturally landscape still reads 90 held that way.
 */
export function screenAngle(win: DeviceWindow): number | undefined {
  const orientation = win.screen?.orientation;
  const byType = orientation?.type !== undefined ? ANGLE_OF_TYPE[orientation.type] : undefined;
  if (byType !== undefined) return byType;
  const angle = typeof win.orientation === "number" ? win.orientation : orientation?.angle;
  return typeof angle === "number" && Number.isFinite(angle) ? (((Math.round(angle / 90) * 90) % 360) + 360) % 360 : undefined;
}

/**
 * The safe area over the drawn prototype, in prototype points: how far each system inset (CSS pixels
 * from the viewport's edges) reaches past the letterbox around the stage, over the fit scale.
 */
export function stageSafeArea(insets: Insets, stage: PlayerStage): Insets {
  if (!(stage.scale > 0)) return [0, 0, 0, 0];
  const side = (stage.viewport[0] - stage.size[0] * stage.scale) / 2;
  const cap = (stage.viewport[1] - stage.size[1] * stage.scale) / 2;
  const points = (css: number, gap: number) => Math.max(0, Math.round((css - Math.max(0, gap)) / stage.scale));
  return [points(insets[0], cap), points(insets[1], side), points(insets[2], cap), points(insets[3], side)];
}

/** The device overrides for the runtime (see the module comment). */
export function playerDevice(win: DeviceWindow, options: { mobile: boolean; insets: Insets; stage: PlayerStage | null }): Partial<DeviceInfo> {
  const device: Partial<DeviceInfo> = { platform: options.mobile ? "mobile" : "web", darkMode: matches(win, "(prefers-color-scheme: dark)") };
  if (!options.mobile) return device;
  const angle = screenAngle(win);
  if (angle !== undefined) device.orientationAngle = angle;
  const dpr = win.devicePixelRatio;
  if (typeof dpr === "number" && Number.isFinite(dpr) && dpr > 0) device.screenScale = dpr;
  if (options.stage) device.safeArea = stageSafeArea(options.insets, options.stage);
  return device;
}
