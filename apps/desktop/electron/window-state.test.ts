import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadWindowState, resolveWindowState, saveWindowStateSync } from "./window-state.ts";

const defaults = { width: 1440, height: 900, minWidth: 1024, minHeight: 680 };
const laptop = { x: 0, y: 25, width: 1512, height: 944 };
const external = { x: 1512, y: -200, width: 2560, height: 1415 };

describe("resolveWindowState", () => {
  it("uses defaults when nothing is saved", () => {
    expect(resolveWindowState(undefined, [laptop], defaults)).toEqual({ bounds: { width: 1440, height: 900 }, maximized: false, fullScreen: false, zoomFactor: 1 });
  });

  it("shrinks defaults to fit a small display, but never below the minimum size", () => {
    const small = { x: 0, y: 0, width: 1280, height: 720 };
    expect(resolveWindowState(undefined, [small], defaults).bounds).toEqual({ width: 1280, height: 720 });
    const tiny = { x: 0, y: 0, width: 800, height: 600 };
    expect(resolveWindowState(undefined, [tiny], defaults).bounds).toEqual({ width: 1024, height: 680 });
  });

  it("restores a visible position and flags", () => {
    const saved = { bounds: { x: 1800, y: 100, width: 1600, height: 1000 }, maximized: true, fullScreen: false, zoomFactor: 1.25 };
    expect(resolveWindowState(saved, [laptop, external], defaults)).toEqual({ bounds: { x: 1800, y: 100, width: 1600, height: 1000 }, maximized: true, fullScreen: false, zoomFactor: 1.25 });
  });

  it("drops a position that's off every display (unplugged monitor)", () => {
    const saved = { bounds: { x: 1800, y: 100, width: 1440, height: 900 } };
    const state = resolveWindowState(saved, [laptop], defaults);
    expect(state.bounds).toEqual({ width: 1440, height: 900 });
  });

  it("drops a position whose title bar is above the work area", () => {
    const saved = { bounds: { x: 100, y: -300, width: 1440, height: 900 } };
    expect(resolveWindowState(saved, [laptop], defaults).bounds.x).toBeUndefined();
  });

  it("sanitizes garbage", () => {
    const state = resolveWindowState({ bounds: { x: "nope", y: null, width: Number.NaN, height: 99999 }, maximized: "yes", zoomFactor: 40 }, [laptop], defaults);
    expect(state).toEqual({ bounds: { width: 1440, height: 944 }, maximized: false, fullScreen: false, zoomFactor: 2 });
  });
});

describe("persistence", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sonobe-ws-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips through disk and tolerates corrupt files", async () => {
    const file = path.join(dir, "nested", "window-state.json");
    saveWindowStateSync(file, { bounds: { x: 40, y: 60, width: 1200, height: 800 }, maximized: false, fullScreen: true, zoomFactor: 1.1 });
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ version: 1, fullScreen: true });
    expect(await loadWindowState(file, [laptop], defaults)).toEqual({ bounds: { x: 40, y: 60, width: 1200, height: 800 }, maximized: false, fullScreen: true, zoomFactor: 1.1 });

    await writeFile(file, "{not json");
    expect((await loadWindowState(file, [laptop], defaults)).bounds).toEqual({ width: 1440, height: 900 });
  });
});
