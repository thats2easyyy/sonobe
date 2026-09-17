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

describe("TextInputTracker", () => {
  it("tracks typed text, focus and one-frame submits by key", () => {
    const text = new TextInputTracker();
    text.update([
      { kind: "focus", layerId: "field", focused: true },
      { kind: "text", layerId: "field", key: "field#2", value: "hello" },
      { kind: "submit", layerId: "field" },
    ]);
    expect(text.snapshot("field")).toEqual({ value: undefined, focused: true, submitted: true });
    expect(text.snapshot("field#2")).toEqual({ value: "hello", focused: undefined, submitted: false });
    text.endFrame();
    expect(text.snapshot("field").submitted).toBe(false);
    text.setValue("field#2", "reset");
    expect(text.snapshot("field#2").value).toBe("reset");
    text.reset();
    expect(text.snapshot("field")).toEqual({ value: undefined, focused: undefined, submitted: false });
  });
});
