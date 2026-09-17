import { describe, expect, it } from "vitest";
import { translation } from "../math/matrix.ts";
import type { InputEvent } from "../types.ts";
import {
  InputTracker,
  KeyboardTracker,
  normalizeKey,
  PointerTracker,
  WheelTracker,
  type HitTestFunction,
} from "./index.ts";

const layers = [
  { key: "button", layerId: "button", rect: [10, 10, 40, 40] },
  { key: "card", layerId: "card", rect: [0, 0, 100, 100] },
];

const hit: HitTestFunction = (x, y) =>
  layers
    .filter(({ rect }) => x >= rect[0]! && x <= rect[2]! && y >= rect[1]! && y <= rect[3]!)
    .map(({ key, layerId }) => ({ key, layerId }));

const down = (x: number, y: number, pointerId = 1): InputEvent => ({
  kind: "pointer",
  phase: "down",
  pointerId,
  x,
  y,
});
const move = (x: number, y: number, pointerId = 1): InputEvent => ({
  kind: "pointer",
  phase: "move",
  pointerId,
  x,
  y,
});
const up = (x: number, y: number, pointerId = 1): InputEvent => ({
  kind: "pointer",
  phase: "up",
  pointerId,
  x,
  y,
});
const cancel = (x: number, y: number, pointerId = 1): InputEvent => ({
  kind: "pointer",
  phase: "cancel",
  pointerId,
  x,
  y,
});

/** Run one frame: update, read, endFrame. */
function frame<T>(tracker: PointerTracker, events: InputEvent[], read: () => T, dt = 1 / 60): T {
  tracker.update(events, hit, dt);
  const result = read();
  tracker.endFrame();
  return result;
}

describe("PointerTracker: taps", () => {
  it("down then release in place is a tap; position holds on the release frame", () => {
    const t = new PointerTracker();
    const f1 = frame(t, [down(20, 20)], () => t.snapshot("button"));
    expect(f1).toMatchObject({
      down: true,
      began: true,
      ended: false,
      tapped: false,
      pointerCount: 1,
      position: [20, 20],
    });
    const f2 = frame(t, [up(22, 21)], () => t.snapshot("button"));
    expect(f2).toMatchObject({
      down: false,
      began: false,
      ended: true,
      tapped: true,
      position: [22, 21],
      translation: [2, 1],
      startPosition: [20, 20],
    });
    const f3 = frame(t, [], () => t.snapshot("button"));
    expect(f3).toMatchObject({ down: false, ended: false, tapped: false });
  });

  it("taps bubble to ancestors; null target means the whole screen", () => {
    const t = new PointerTracker();
    frame(t, [down(20, 20)], () => undefined);
    const release = frame(t, [up(20, 20)], () => [
      t.snapshot("card").tapped,
      t.snapshot(null).tapped,
      t.snapshot("elsewhere").tapped,
    ]);
    expect(release).toEqual([true, true, false]);
  });

  it("moving beyond 10 pt cancels the tap even if released at the start point", () => {
    const t = new PointerTracker();
    frame(t, [down(20, 20)], () => undefined);
    frame(t, [move(40, 20)], () => undefined);
    const f = frame(t, [up(20, 20)], () => t.snapshot("button"));
    expect(f.ended).toBe(true);
    expect(f.tapped).toBe(false);
  });

  it("releasing outside the layer ends without a tap (but still taps the container)", () => {
    const t = new PointerTracker();
    frame(t, [down(38, 20)], () => undefined);
    const f = frame(t, [up(43, 20)], () => [t.snapshot("button"), t.snapshot("card")] as const);
    expect(f[0]).toMatchObject({ ended: true, tapped: false });
    expect(f[1]).toMatchObject({ ended: true, tapped: true });
  });

  it("cancel ends without a tap", () => {
    const t = new PointerTracker();
    frame(t, [down(20, 20)], () => undefined);
    expect(frame(t, [cancel(20, 20)], () => t.snapshot("button"))).toMatchObject({
      ended: true,
      tapped: false,
      down: false,
    });
  });

  it("down and up in the same frame still begin, end, and tap", () => {
    const t = new PointerTracker();
    expect(frame(t, [down(20, 20), up(20, 20)], () => t.snapshot("button"))).toMatchObject({
      began: true,
      ended: true,
      tapped: true,
      down: false,
    });
  });

  it("a press that starts elsewhere never reports down on the layer", () => {
    const t = new PointerTracker();
    frame(t, [down(90, 90)], () => undefined);
    expect(frame(t, [move(20, 20)], () => t.snapshot("button"))).toMatchObject({
      down: false,
      pointerCount: 0,
    });
    expect(t.snapshot("card").down).toBe(true);
  });
});

describe("PointerTracker: drag and velocity", () => {
  it("smoothed velocity approaches the true speed and holds on the release frame", () => {
    const t = new PointerTracker();
    frame(t, [down(0, 50)], () => undefined);
    expect(t.snapshot(null).velocity).toEqual([0, 0]);
    let v: [number, number] = [0, 0];
    for (let i = 1; i <= 20; i++) v = frame(t, [move(i * 10, 50)], () => t.snapshot(null).velocity);
    expect(v[0]).toBeCloseTo(600, 0);
    expect(v[1]).toBe(0);
    const release = frame(t, [up(200, 50)], () => t.snapshot(null));
    expect(release.ended).toBe(true);
    expect(release.velocity[0]).toBeCloseTo(600, 0);
    expect(release.translation).toEqual([200, 0]);
    expect(frame(t, [], () => t.snapshot(null).velocity)).toEqual([0, 0]);
  });

  it("does not report a jump on the press frame or for movement within it", () => {
    const t = new PointerTracker();
    const f = frame(t, [move(300, 300), down(0, 0), move(5, 0)], () => t.snapshot(null));
    expect(f.velocity).toEqual([0, 0]);
    const next = frame(t, [move(10, 0)], () => t.snapshot(null));
    expect(next.velocity[0]).toBeGreaterThan(0);
    expect(next.velocity[0]).toBeLessThanOrEqual(600 + 1e-9);
  });

  it("stays steady when input arrives slower than frames (120 Hz frames, 60 Hz input)", () => {
    const t = new PointerTracker();
    frame(t, [down(0, 0)], () => undefined, 1 / 120);
    const readings: number[] = [];
    for (let i = 1; i <= 60; i++) {
      const events = i % 2 === 0 ? [move((i / 2) * 10, 0)] : [];
      readings.push(frame(t, events, () => t.snapshot(null).velocity[0], 1 / 120));
    }
    for (const r of readings.slice(20)) expect(r).toBeGreaterThan(570);
  });

  it("decays once the finger stops", () => {
    const t = new PointerTracker();
    frame(t, [down(0, 0)], () => undefined);
    for (let i = 1; i <= 10; i++) frame(t, [move(i * 10, 0)], () => undefined);
    for (let i = 0; i < 18; i++) frame(t, [], () => undefined);
    expect(Math.abs(t.snapshot(null).velocity[0])).toBeLessThan(5);
    const release = frame(t, [up(100, 0)], () => t.snapshot(null));
    expect(Math.abs(release.velocity[0])).toBeLessThan(5);
  });

  it("localPosition uses the layer's inverse world transform", () => {
    const t = new PointerTracker();
    const f = frame(t, [down(22, 21)], () => t.snapshot("button", translation(-10, -10)));
    expect(f.localPosition).toEqual([12, 11]);
    expect(f.position).toEqual([22, 21]);
  });

  it("keeps the last press position and translation after release", () => {
    const t = new PointerTracker({ hoverOnRelease: false });
    frame(t, [down(20, 20)], () => undefined);
    frame(t, [move(60, 30)], () => undefined);
    frame(t, [up(60, 30)], () => undefined);
    const after = frame(t, [], () => t.snapshot("card"));
    expect(after).toMatchObject({
      down: false,
      position: [60, 30],
      startPosition: [20, 20],
      translation: [40, 10],
      velocity: [0, 0],
    });
    expect(t.snapshot("nothing").position).toEqual([0, 0]);
  });
});

describe("PointerTracker: hover, multi-touch, long press", () => {
  it("hovering means over the layer without a press", () => {
    const t = new PointerTracker();
    expect(
      frame(t, [move(20, 20)], () => [
        t.snapshot("button").hovering,
        t.snapshot("card").hovering,
        t.snapshot("button").down,
      ]),
    ).toEqual([true, true, false]);
    expect(
      frame(t, [move(80, 80)], () => [t.snapshot("button").hovering, t.snapshot("card").hovering]),
    ).toEqual([false, true]);
    expect(frame(t, [down(80, 80)], () => t.snapshot("card").hovering)).toBe(false);
    frame(t, [up(80, 80)], () => undefined);
    expect(frame(t, [], () => t.snapshot("card").hovering)).toBe(true);
    expect(frame(t, [cancel(80, 80)], () => t.snapshot("card").hovering)).toBe(false);
  });

  it("hover position is reported while not pressed", () => {
    const t = new PointerTracker();
    expect(frame(t, [move(33, 44)], () => t.snapshot("card").position)).toEqual([33, 44]);
  });

  it("counts pointers per layer and matches loop instances by layer id", () => {
    const t = new PointerTracker();
    frame(t, [down(20, 20, 1), down(80, 80, 2)], () => undefined);
    expect(t.snapshot("card").pointerCount).toBe(2);
    expect(t.snapshot("button").pointerCount).toBe(1);
    expect(t.pressedCount).toBe(2);

    const instances: HitTestFunction = () => [{ key: "cell#2", layerId: "cell" }];
    const u = new PointerTracker();
    u.update([down(1, 1)], instances, 1 / 60);
    expect(u.snapshot("cell").down).toBe(true);
    expect(u.snapshot("cell#2").down).toBe(true);
    expect(u.snapshot("cell#1").down).toBe(false);
  });

  it("long press = held and stationary for the duration", () => {
    const t = new PointerTracker();
    frame(t, [down(20, 20)], () => undefined);
    const results: boolean[] = [];
    for (let i = 1; i <= 30; i++)
      results.push(frame(t, i === 10 ? [move(26, 24)] : [], () => t.longPress("button", 0.5)));
    expect(results.slice(0, 29).every((r) => !r)).toBe(true);
    expect(results[29]).toBe(true);
    frame(t, [up(26, 24)], () => undefined);
    expect(t.longPress("button", 0.5)).toBe(false);

    const moved = new PointerTracker();
    frame(moved, [down(20, 20)], () => undefined);
    frame(moved, [move(35, 20)], () => undefined);
    for (let i = 0; i < 40; i++) frame(moved, [], () => undefined);
    expect(moved.longPress("button", 0.5)).toBe(false);
  });

  it("re-pressing an id without release cancels the previous press", () => {
    const t = new PointerTracker();
    frame(t, [down(20, 20)], () => undefined);
    const f = frame(t, [down(80, 80)], () => [t.snapshot("button"), t.snapshot("card")] as const);
    expect(f[0]).toMatchObject({ ended: true, tapped: false, down: false });
    expect(f[1]).toMatchObject({ began: true, down: true, pointerCount: 1 });
  });

  it("reset forgets everything", () => {
    const t = new PointerTracker();
    frame(t, [down(20, 20)], () => undefined);
    t.reset();
    expect(t.snapshot("button").down).toBe(false);
    expect(t.time).toBe(0);
  });
});

describe("KeyboardTracker", () => {
  it("tracks pressed keys, transitions, and typed text", () => {
    const k = new KeyboardTracker();
    k.update([
      { kind: "key", phase: "down", key: "a" },
      { kind: "key", phase: "down", key: "B", shift: true },
    ]);
    const s = k.snapshot();
    expect([...s.pressed].sort()).toEqual(["a", "b"]);
    expect([...s.downThisFrame].sort()).toEqual(["a", "b"]);
    expect(s.text).toBe("aB");
    expect(k.isDown("A")).toBe(true);
    k.endFrame();
    expect(k.snapshot().downThisFrame.size).toBe(0);
    expect(k.snapshot().text).toBe("");
    k.update([{ kind: "key", phase: "down", key: "a" }]);
    expect(k.wentDown("a")).toBe(false);
    expect(k.snapshot().text).toBe("a");
    k.endFrame();
    k.update([{ kind: "key", phase: "up", key: "A" }]);
    expect(k.wentUp("a")).toBe(true);
    expect(k.isDown("a")).toBe(false);
  });

  it("modifier shortcuts don't type; Enter and Tab do", () => {
    const k = new KeyboardTracker();
    k.update([
      { kind: "key", phase: "down", key: "Meta" },
      { kind: "key", phase: "down", key: "c", meta: true },
      { kind: "key", phase: "down", key: "Enter" },
      { kind: "key", phase: "down", key: "Tab" },
      { kind: "key", phase: "down", key: " " },
    ]);
    expect(k.snapshot().text).toBe("\n\t ");
    expect(k.isDown("cmd")).toBe(true);
    expect(k.isDown("space")).toBe(true);
    k.endFrame();
    k.update([{ kind: "key", phase: "up", key: "Meta" }]);
    expect(k.isDown("c")).toBe(false);
    expect(k.wentUp("c")).toBe(true);
  });

  it("releaseAll clears stuck keys", () => {
    const k = new KeyboardTracker();
    k.update([{ kind: "key", phase: "down", key: "ArrowUp" }]);
    k.endFrame();
    k.releaseAll();
    expect(k.isDown("up")).toBe(false);
    expect(k.wentUp("ArrowUp")).toBe(true);
  });

  it("normalizeKey accepts friendly spellings", () => {
    expect(normalizeKey("A")).toBe("a");
    expect(normalizeKey(" ")).toBe("Space");
    expect(normalizeKey("Spacebar")).toBe("Space");
    expect(normalizeKey("up")).toBe("ArrowUp");
    expect(normalizeKey("option")).toBe("Alt");
    expect(normalizeKey("Command")).toBe("Meta");
    expect(normalizeKey("return")).toBe("Enter");
    expect(normalizeKey("delete")).toBe("Backspace");
    expect(normalizeKey("f5")).toBe("F5");
    expect(normalizeKey("MediaPlayPause")).toBe("MediaPlayPause");
  });
});

describe("WheelTracker and InputTracker", () => {
  it("accumulates wheel deltas per frame", () => {
    const w = new WheelTracker();
    w.update(
      [
        { kind: "wheel", x: 10, y: 20, dx: 0, dy: 5 },
        { kind: "wheel", x: 12, y: 22, dx: 1, dy: 7 },
      ],
      1 / 60,
    );
    const s = w.snapshot();
    expect(s.delta).toEqual([1, 12]);
    expect(s.position).toEqual([12, 22]);
    expect(s.velocity[1]).toBeCloseTo(720, 9);
    w.endFrame();
    expect(w.snapshot().delta).toEqual([0, 0]);
    expect(w.snapshot().position).toEqual([12, 22]);
  });

  it("InputTracker drives all trackers together", () => {
    const input = new InputTracker();
    input.update(
      [
        down(20, 20),
        { kind: "key", phase: "down", key: "x" },
        { kind: "wheel", x: 0, y: 0, dx: 0, dy: 3 },
      ],
      hit,
      1 / 60,
    );
    expect(input.pointer.snapshot("button").began).toBe(true);
    expect(input.keyboard.snapshot().text).toBe("x");
    expect(input.wheel.snapshot().delta).toEqual([0, 3]);
    input.endFrame();
    expect(input.pointer.snapshot("button").began).toBe(false);
    input.reset();
    expect(input.keyboard.isDown("x")).toBe(false);
  });
});
