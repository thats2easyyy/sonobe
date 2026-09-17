import { describe, expect, it } from "vitest";
import { drag, idle, pointerEvent, sequence, tap } from "@sonobe/engine/testing";
import type { HarnessFrame } from "../infra/index.ts";
import { scroll, scrollAxisGeometry, scrollPageIndex } from "./scroll.ts";
import { createInteractionRig, type InteractionRig, type RigLayer } from "./testing.ts";

const feed: RigLayer[] = [
  { id: "window", rect: [0, 0, 390, 600] },
  { id: "content", rect: [0, 0, 390, 2000], parent: "window" },
];

const carousel: RigLayer[] = [
  { id: "window", rect: [0, 0, 390, 600] },
  { id: "content", rect: [0, 0, 1170, 600], parent: "window" },
];

function rig(inputs: Record<string, unknown> = {}, layers: RigLayer[] = feed) {
  return createInteractionRig(scroll, { inputs: { layer: { layerId: "content" }, ...inputs }, layers, screen: [390, 844] });
}

function settle(r: InteractionRig<unknown>, max = 900): HarnessFrame {
  let f = r.step();
  for (let i = 0; i < max && f.outputs.moving === true; i++) f = r.step();
  return f;
}

const num = (f: HarnessFrame, key: string) => f.outputs[key] as number;

describe("scroll geometry", () => {
  const base = { start: [0, 0] as [number, number], contentSize: [0, 0] as [number, number], pageSize: [0, 0] as [number, number], pagePadding: [0, 0] as [number, number], viewport: [390, 600] as [number, number] };
  const info = {
    type: "group",
    enabled: true,
    position: [0, 0] as [number, number],
    size: [1170, 2000] as [number, number],
    scale: [1, 1] as [number, number],
    anchor: [0, 0] as [number, number],
    parent: { layerId: "window" },
    worldTransform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    contentSize: [0, 0] as [number, number],
  };

  it("bounds a Free axis from the top-left down to the content's end", () => {
    expect(scrollAxisGeometry(1, { ...base, mode: "free", info })).toMatchObject({ mode: "free", lo: -1400, hi: 0 });
    expect(scrollAxisGeometry(1, { ...base, mode: "free", info, contentSize: [0, 300] })).toMatchObject({ lo: 0, hi: 0 });
    expect(scrollAxisGeometry(1, { ...base, mode: "free", info, start: [0, 50] })).toMatchObject({ lo: -1450, hi: 0 });
    expect(scrollAxisGeometry(1, { ...base, mode: "off", info })).toMatchObject({ mode: "off", lo: 0, hi: 0 });
  });

  it("centers pages and counts them", () => {
    const g = scrollAxisGeometry(0, { ...base, mode: "paging", info, pageSize: [300, 0], pagePadding: [10, 0] });
    expect(g).toMatchObject({ mode: "paging", step: 310, count: 4, hi: 45, lo: 45 - 3 * 310 });
    expect(scrollPageIndex(g, 45)).toBe(0);
    expect(scrollPageIndex(g, 45 - 310)).toBe(1);
    expect(scrollPageIndex(g, 400)).toBe(0);
    expect(scrollPageIndex(g, -5000)).toBe(3);
  });

  it("falls back to Free when a page has no size", () => {
    let warned = 0;
    const g = scrollAxisGeometry(0, { ...base, viewport: [0, 0], mode: "paging", info }, () => warned++);
    expect(g.mode).toBe("free");
    expect(warned).toBe(1);
  });

  it("counts whole screens on Free axes", () => {
    const g = scrollAxisGeometry(1, { ...base, mode: "free", info });
    expect(scrollPageIndex(g, 0)).toBe(0);
    expect(scrollPageIndex(g, -900)).toBe(2);
    expect(scrollPageIndex(g, 100)).toBe(0);
  });
});

describe("scroll", () => {
  it("starts at Start Position", () => {
    expect(rig({ startPosition: [16, 80] }).step().outputs).toEqual({ position: [16, 80], x: 16, y: 80, pageX: 0, pageY: 0, dragging: false, moving: false });
  });

  it("follows a drag once it passes the slop, without jumping", () => {
    const r = rig();
    r.step();
    const frames = r.script(drag([200, 500], [200, 300], { frames: 10, release: false }));
    expect(frames[0]!.outputs.dragging).toBe(false);
    expect(frames[1]!.outputs).toMatchObject({ y: 0, dragging: true, moving: true });
    expect(num(frames[2]!, "y")).toBe(-20);
    expect(frames.at(-1)!.outputs.position).toEqual([0, -180]);
  });

  it("glides after a flick and settles inside the bounds", () => {
    const r = rig();
    r.step();
    r.script(drag([200, 500], [200, 300], { frames: 10, release: false }));
    const up = r.step({ events: [pointerEvent("up", 200, 300)] });
    expect(up.outputs.dragging).toBe(false);
    expect(up.outputs.moving).toBe(true);
    expect(num(up, "y")).toBeLessThan(-180);
    const rest = settle(r);
    expect(rest.outputs.moving).toBe(false);
    expect(rest.requestedNextFrame).toBe(false);
    expect(num(rest, "y")).toBeLessThan(-300);
    expect(num(rest, "y")).toBeGreaterThanOrEqual(-1400);
  });

  it("leaves content resting on a tap, and a tap catches a glide", () => {
    const r = rig();
    r.step();
    const frames = r.script(tap(200, 300));
    expect(frames.every((f) => f.outputs.dragging === false && f.outputs.y === 0)).toBe(true);
    r.script(drag([200, 500], [200, 300], { frames: 5 }));
    r.run(3);
    const caught = r.script(tap(200, 300));
    const y = num(caught[0]!, "y");
    expect(caught[0]!.outputs.moving).toBe(false);
    expect(num(r.run(10), "y")).toBe(y);
  });

  it("rubber-bands past the edge and springs back after release", () => {
    const r = rig();
    r.step();
    const pulled = r.script(drag([200, 100], [200, 400], { frames: 10, release: false })).at(-1)!;
    expect(num(pulled, "y")).toBeGreaterThan(50);
    expect(num(pulled, "y")).toBeLessThan(270);
    r.step({ events: [pointerEvent("up", 200, 400)] });
    const rest = settle(r);
    expect(num(rest, "y")).toBe(0);
  });

  it("stops hard at the edges with Rubber Band off", () => {
    const r = rig({ rubberBand: false });
    r.step();
    expect(num(r.script(drag([200, 100], [200, 400], { frames: 10, release: false })).at(-1)!, "y")).toBe(0);
  });

  it("ignores drags in a direction that doesn't scroll when Direction Locking is on", () => {
    const r = rig();
    r.step();
    const frames = r.script(drag([300, 300], [100, 320], { frames: 5 }));
    expect(frames.every((f) => f.outputs.dragging === false && f.outputs.y === 0)).toBe(true);
    const unlocked = rig({ directionLocking: false });
    unlocked.step();
    // The first move (40 pt left, 8 pt up) accepts the touch; the next four move y by −32.
    expect(num(unlocked.script(drag([300, 300], [100, 260], { frames: 5, release: false })).at(-1)!, "y")).toBe(-32);
  });

  it("locks a two-axis scroll to the direction the touch started", () => {
    const r = rig({ scrollX: "free" });
    r.step();
    const last = r.script(drag([300, 300], [100, 360], { frames: 5, release: false })).at(-1)!;
    expect(num(last, "y")).toBe(0);
    expect(num(last, "x")).toBeLessThan(0);
  });

  it("pages one page per flick", () => {
    const r = rig({ scrollX: "paging", scrollY: "off" }, carousel);
    r.step();
    r.script(drag([300, 300], [150, 300], { frames: 3 }));
    let rest = settle(r);
    expect(num(rest, "x")).toBeCloseTo(-390, 6);
    expect(rest.outputs.pageX).toBe(1);
    r.script(drag([380, 300], [0, 300], { frames: 2 }));
    rest = settle(r);
    expect(num(rest, "x")).toBeCloseTo(-780, 6);
    expect(rest.outputs.pageX).toBe(2);
    r.script(drag([380, 300], [0, 300], { frames: 2 }));
    expect(settle(r).outputs.pageX).toBe(2);
    r.script(drag([0, 300], [380, 300], { frames: 2 }));
    expect(settle(r).outputs.pageX).toBe(1);
  });

  it("snaps back to the current page after a short, slow drag", () => {
    const r = rig({ scrollX: "paging", scrollY: "off" }, carousel);
    r.step();
    r.script(sequence(drag([300, 300], [250, 300], { frames: 10, release: false }), idle(15), [[pointerEvent("up", 250, 300)]]));
    const rest = settle(r);
    expect(num(rest, "x")).toBeCloseTo(0, 6);
    expect(rest.outputs.pageX).toBe(0);
  });

  it("jumps instantly or with a spring, clamped to the bounds, even while disabled", () => {
    const r = rig({ startPosition: [0, 50], enabled: false });
    r.step();
    const instant = r.step({ inputs: { jumpPositionY: -450, jumpStyleY: "instant" }, pulses: ["jumpToY"] });
    expect(instant.outputs).toMatchObject({ y: -450, moving: false });
    // Content starting 50 pt down can scroll until its bottom meets the window's: offset −1450.
    expect(num(r.step({ inputs: { jumpPositionY: -5000 }, pulses: ["jumpToY"] }), "y")).toBe(-1400);
    const animated = r.step({ inputs: { jumpPositionY: -250, jumpStyleY: "animated" }, pulses: ["jumpToY"] });
    expect(animated.outputs.moving).toBe(true);
    expect(num(settle(r), "y")).toBeCloseTo(-250, 6);
  });

  it("cancels an active drag on a jump", () => {
    const r = rig();
    r.step();
    r.script(drag([200, 500], [200, 400], { frames: 5, release: false }));
    const jumped = r.step({ inputs: { jumpPositionY: -600, jumpStyleY: "instant" }, pulses: ["jumpToY"], events: [pointerEvent("move", 200, 380)] });
    expect(jumped.outputs).toMatchObject({ y: -600, dragging: false });
    expect(num(r.step({ events: [pointerEvent("move", 200, 200)] }), "y")).toBe(-600);
  });

  it("scrolls with the wheel while the pointer is over the window", () => {
    const r = rig();
    r.step();
    expect(num(r.step({ events: [{ kind: "wheel", x: 200, y: 300, dx: 0, dy: 50 }] }), "y")).toBe(0);
    r.step({ events: [pointerEvent("move", 200, 300)] });
    expect(num(r.step({ events: [{ kind: "wheel", x: 200, y: 300, dx: 0, dy: 50 }] }), "y")).toBe(-50);
    expect(num(r.step({ events: [{ kind: "wheel", x: 200, y: 300, dx: 0, dy: -200 }] }), "y")).toBe(0);
  });

  it("snaps a Paging axis to the nearest page once the wheel rests", () => {
    const r = rig({ scrollX: "paging", scrollY: "off" }, carousel);
    r.step();
    r.step({ events: [pointerEvent("move", 200, 300)] });
    const wheeled = r.step({ events: [{ kind: "wheel", x: 200, y: 300, dx: 250, dy: 0 }] });
    expect(wheeled.requestedNextFrame).toBe(true);
    expect(num(r.run(5), "x")).toBe(-250);
    r.run(5);
    const rest = settle(r);
    expect(num(rest, "x")).toBeCloseTo(-390, 6);
    expect(rest.outputs.pageX).toBe(1);
  });

  it("ignores touches and the wheel while disabled", () => {
    const r = rig({ enabled: false });
    r.step();
    r.step({ events: [pointerEvent("move", 200, 300)] });
    const frames = r.script(sequence(drag([200, 500], [200, 300], { frames: 5 }), [[{ kind: "wheel", x: 200, y: 300, dx: 0, dy: 80 }]]));
    expect(frames.every((f) => f.outputs.y === 0 && f.outputs.dragging === false)).toBe(true);
  });

  it("releases an active drag with no velocity when disabled mid-drag", () => {
    const r = rig();
    r.step();
    r.script(drag([200, 100], [200, 400], { frames: 10, release: false }));
    const disabled = r.step({ inputs: { enabled: false } });
    expect(disabled.outputs.dragging).toBe(false);
    expect(num(settle(r), "y")).toBe(0);
  });

  it("converts drags through ancestor scale", () => {
    const layers: RigLayer[] = [{ id: "window", rect: [0, 0, 390, 600], scale: [1, 2] }, { id: "content", rect: [0, 0, 390, 2000], parent: "window" }];
    const r = rig({}, layers);
    r.step();
    expect(num(r.script(drag([200, 500], [200, 300], { frames: 10, release: false })).at(-1)!, "y")).toBe(-90);
  });
});
