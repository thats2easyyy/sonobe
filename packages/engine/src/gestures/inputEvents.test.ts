import { describe, expect, it } from "vitest";
import type { InputEvent } from "../types.ts";
import { PointerTracker, TextInputTracker, type HitTestFunction } from "./index.ts";

const hit: HitTestFunction = (x, y) => (x >= 0 && x <= 100 && y >= 0 && y <= 100 ? [{ key: "card/button", layerId: "button" }] : []);

function pointer(phase: "down" | "move" | "up" | "cancel" | "leave", x: number, y: number, extra: Partial<Extract<InputEvent, { kind: "pointer" }>> = {}): InputEvent {
  return { kind: "pointer", phase, pointerId: 1, x, y, ...extra };
}

function frame<T>(t: PointerTracker, events: InputEvent[], read: () => T, dt = 1 / 60): T {
  t.update(events, hit, dt);
  const result = read();
  t.endFrame();
  return result;
}

describe("PointerTracker: contract input fields", () => {
  it("leave ends hover but not a press", () => {
    const t = new PointerTracker();
    expect(frame(t, [pointer("move", 10, 10)], () => t.snapshot("button").hovering)).toBe(true);
    expect(frame(t, [pointer("leave", 10, 10)], () => t.snapshot("button").hovering)).toBe(false);
    frame(t, [pointer("down", 10, 10)], () => undefined);
    expect(frame(t, [pointer("leave", 150, 10)], () => t.snapshot("button").down)).toBe(true);
  });

  it("touches never hover, before or after a press", () => {
    const t = new PointerTracker();
    expect(frame(t, [pointer("move", 10, 10, { pointerType: "touch" })], () => t.snapshot("button").hovering)).toBe(false);
    frame(t, [pointer("down", 10, 10, { pointerType: "touch" })], () => undefined);
    const release = frame(t, [pointer("up", 10, 10, { pointerType: "touch" })], () => t.snapshot("button"));
    expect(release.tapped).toBe(true);
    expect(frame(t, [], () => t.snapshot("button").hovering)).toBe(false);
  });

  it("uses event timeStamps for velocity when they are present", () => {
    const t = new PointerTracker();
    frame(t, [pointer("down", 0, 50, { timeStamp: 0 })], () => undefined);
    let v = 0;
    for (let i = 1; i <= 40; i++) v = frame(t, [pointer("move", i * 10, 50, { timeStamp: i * 8 })], () => t.snapshot(null).velocity[0]);
    expect(v).toBeCloseTo(1250, 0);
  });

  it("exact snapshots match scene keys only", () => {
    const t = new PointerTracker();
    frame(t, [pointer("down", 10, 10)], () => undefined);
    expect(t.snapshot("button").down).toBe(true);
    expect(t.snapshot("button", null, true).down).toBe(false);
    expect(t.snapshot("card/button", null, true).down).toBe(true);
  });
});

describe("PointerTracker: pointer detail", () => {
  it("reports pressure, buttons, pointer type and cancelled presses", () => {
    const t = new PointerTracker();
    const mouse = frame(t, [pointer("down", 10, 10, { pointerType: "mouse" })], () => t.snapshot("button"));
    expect([mouse.pressure, mouse.buttons, mouse.pointerType, mouse.cancelled]).toEqual([0, 1, "mouse", false]);
    const chord = frame(t, [pointer("move", 12, 10, { buttons: 3, pressure: 0.25 })], () => t.snapshot("button"));
    expect([chord.pressure, chord.buttons]).toEqual([0.25, 3]);
    const cancelled = frame(t, [pointer("cancel", 12, 10)], () => t.snapshot("button"));
    expect([cancelled.ended, cancelled.cancelled, cancelled.tapped, cancelled.buttons, cancelled.pressure]).toEqual([true, true, false, 0, 0]);
    expect(frame(t, [], () => t.snapshot("button").cancelled)).toBe(false);

    const u = new PointerTracker();
    const touch = frame(u, [pointer("down", 10, 10, { pointerType: "touch", pointerId: 2 })], () => u.snapshot("button"));
    expect([touch.pressure, touch.buttons, touch.pointerType]).toEqual([0.5, 1, "touch"]);
    const right = frame(u, [pointer("down", 20, 20, { pointerId: 3, button: 2, pressure: 2 })], () => u.snapshot("button"));
    expect([right.pressure, right.buttons, right.pointerCount]).toEqual([0.5, 3, 2]);
    const released = frame(u, [pointer("up", 10, 10, { pointerType: "touch", pointerId: 2 })], () => u.snapshot("button"));
    expect([released.cancelled, released.tapped, released.pressure, released.buttons]).toEqual([false, true, 1, 2]);
  });

  it("mice and pens keep hovering while held and re-hit-test as they move; touches never hover", () => {
    const t = new PointerTracker();
    frame(t, [pointer("down", 10, 10, { pointerType: "pen" })], () => undefined);
    expect(frame(t, [], () => t.snapshot("button").hovering)).toBe(true);
    expect(frame(t, [pointer("move", 150, 10, { pointerType: "pen" })], () => [t.snapshot("button").hovering, t.snapshot("button").down])).toEqual([false, true]);
    expect(frame(t, [pointer("move", 50, 50, { pointerType: "pen" })], () => t.snapshot("button").hovering)).toBe(true);
    expect(frame(t, [pointer("up", 50, 50, { pointerType: "pen" })], () => t.snapshot("button").hovering)).toBe(true);

    const u = new PointerTracker();
    expect(frame(u, [pointer("down", 10, 10, { pointerType: "touch" })], () => u.snapshot("button").hovering)).toBe(false);
    expect(frame(u, [pointer("move", 20, 20, { pointerType: "touch" })], () => u.snapshot("button").hovering)).toBe(false);
  });

  it("lists pressed pointers per target by press time, then id", () => {
    const t = new PointerTracker();
    frame(t, [pointer("down", 10, 10, { pointerId: 7, pointerType: "touch", pressure: 0.8 })], () => undefined);
    frame(t, [pointer("down", 150, 10, { pointerId: 5, pointerType: "touch" }), pointer("down", 20, 20, { pointerId: 3, buttons: 4 })], () => undefined);
    expect(t.pointers(null).map((p) => p.id)).toEqual([7, 3, 5]);
    expect(t.pointers("button")).toEqual([
      { id: 7, position: [10, 10], pressure: 0.8, startTime: 1 / 60, buttons: 1 },
      { id: 3, position: [20, 20], pressure: 0, startTime: 2 / 60, buttons: 4 },
    ]);
    expect(t.pointers("card/button", true).map((p) => p.id)).toEqual([7, 3]);
    expect(t.pointers("button", true)).toEqual([]);
    frame(t, [pointer("up", 10, 10, { pointerId: 7, pointerType: "touch" })], () => undefined);
    expect(t.pointers(null).map((p) => p.id)).toEqual([3, 5]);
  });
});

describe("TextInputTracker", () => {
  it("tracks typed text, focus and one-frame submits by key", () => {
    const text = new TextInputTracker();
    text.update([
      { kind: "focus", layerId: "field", focused: true },
      { kind: "text", layerId: "field", key: "field#2", value: "hello" },
      { kind: "submit", layerId: "field" },
    ]);
    const untouched = { textRevision: 0, editRevision: 0, editing: false };
    expect(text.snapshot("field")).toEqual({ value: undefined, focused: true, submitted: true, ...untouched });
    expect(text.snapshot("field#2")).toEqual({ value: "hello", focused: undefined, submitted: false, ...untouched });
    text.endFrame();
    expect(text.snapshot("field").submitted).toBe(false);
    text.setValue("field#2", "reset");
    expect(text.snapshot("field#2")).toMatchObject({ value: "reset", textRevision: 0 });
    text.reset();
    expect(text.snapshot("field")).toEqual({ value: undefined, focused: undefined, submitted: false, ...untouched });
    expect(text.has("field")).toBe(false);
  });

  it("counts Set Text and Begin/End Editing as revisions that keep rising across restarts", () => {
    const text = new TextInputTracker();
    text.update([{ kind: "text", layerId: "field", value: "hi" }]);
    text.setText("field", "");
    expect(text.snapshot("field")).toMatchObject({ value: "", textRevision: 1, editRevision: 0 });
    // Setting the same text again is still a new revision: that's what clears a field twice.
    text.setText("field", "");
    expect(text.snapshot("field").textRevision).toBe(2);
    text.setEditing("field", true);
    expect(text.snapshot("field")).toMatchObject({ focused: true, editing: true, editRevision: 3 });
    // The renderer's blur wins until the next command.
    text.update([{ kind: "focus", layerId: "field", focused: false }]);
    expect(text.snapshot("field")).toMatchObject({ focused: false, editing: true, editRevision: 3 });
    text.setEditing("field", false);
    expect(text.snapshot("field")).toMatchObject({ focused: false, editing: false, editRevision: 4 });
    text.reset();
    expect(text.has("field")).toBe(false);
    text.setText("field", "again");
    expect(text.snapshot("field").textRevision).toBe(5);
  });
});
