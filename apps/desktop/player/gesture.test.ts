import { describe, expect, it } from "vitest";
import { createMenuGesture, type GesturePointer } from "./gesture.ts";

let clock = 0;
const touch = (type: string, pointerId: number, x = 100, y = 200, at?: number): GesturePointer => {
  if (at !== undefined) clock = at;
  return { type, pointerId, pointerType: "touch", clientX: x, clientY: y, timeStamp: clock };
};

describe("the three-finger menu gesture", () => {
  it("passes one- and two-finger touches to the prototype", () => {
    const gesture = createMenuGesture();
    expect(gesture.handle(touch("pointerdown", 1, 100, 200, 0))).toEqual({ swallow: false });
    expect(gesture.handle(touch("pointermove", 1, 140, 200, 16))).toEqual({ swallow: false });
    expect(gesture.handle(touch("pointerdown", 2, 200, 200, 20))).toEqual({ swallow: false });
    expect(gesture.handle(touch("pointerup", 2, 200, 200, 80))).toEqual({ swallow: false });
    expect(gesture.handle(touch("pointerup", 1, 140, 200, 90))).toEqual({ swallow: false });
    expect(gesture.handle(touch("pointerleave", 1))).toEqual({ swallow: false });
    expect(gesture.claimed).toBe(false);
  });

  it("takes a touch from the prototype when a third finger lands, and taps", () => {
    const gesture = createMenuGesture();
    gesture.handle(touch("pointerdown", 1, 100, 300, 0));
    gesture.handle(touch("pointermove", 1, 102, 301, 10));
    gesture.handle(touch("pointerdown", 2, 160, 300, 25));
    // The prototype got fingers 1 and 2, so they're cancelled where they are now.
    expect(gesture.handle(touch("pointerdown", 3, 220, 300, 40))).toEqual({
      swallow: true,
      cancel: [
        { pointerId: 1, clientX: 102, clientY: 301 },
        { pointerId: 2, clientX: 160, clientY: 300 },
      ],
    });
    expect(gesture.claimed).toBe(true);
    expect(gesture.handle(touch("pointermove", 2, 164, 302, 60))).toEqual({ swallow: true });
    expect(gesture.handle(touch("pointerup", 1, 102, 301, 150))).toEqual({ swallow: true });
    expect(gesture.handle(touch("pointerup", 3, 220, 300, 160))).toEqual({ swallow: true });
    expect(gesture.handle(touch("pointerup", 2, 164, 302, 170))).toEqual({ swallow: true, tap: true });
    expect(gesture.claimed).toBe(false);
    // Their pointerleave (after pointerup) stays away from the prototype too, once.
    expect(gesture.handle(touch("pointerleave", 2))).toEqual({ swallow: true });
    expect(gesture.handle(touch("pointerleave", 2))).toEqual({ swallow: false });
  });

  it("keeps fingers that land during the gesture, and counts a browser cancel as a lift", () => {
    const gesture = createMenuGesture();
    gesture.handle(touch("pointerdown", 1, 100, 300, 0));
    gesture.handle(touch("pointerdown", 2, 150, 300, 5));
    gesture.handle(touch("pointerdown", 3, 200, 300, 10));
    expect(gesture.handle(touch("pointerdown", 4, 250, 300, 20))).toEqual({ swallow: true });
    for (const id of [1, 2, 3]) gesture.handle(touch("pointercancel", id, 100, 300, 100));
    expect(gesture.handle(touch("pointerup", 4, 250, 300, 120))).toEqual({ swallow: true, tap: true });
  });

  it("isn't a tap when a finger slides or the fingers stay down too long", () => {
    const slide = createMenuGesture();
    for (const [id, x] of [[1, 100], [2, 150], [3, 200]] as const) slide.handle(touch("pointerdown", id, x, 300, 0));
    slide.handle(touch("pointermove", 3, 200, 360, 50));
    for (const id of [1, 2]) slide.handle(touch("pointerup", id, 100, 300, 100));
    expect(slide.handle(touch("pointerup", 3, 200, 360, 110))).toEqual({ swallow: true });

    const long = createMenuGesture();
    long.handle(touch("pointerdown", 1, 100, 300, 0));
    long.handle(touch("pointerdown", 2, 150, 300, 700));
    long.handle(touch("pointerdown", 3, 200, 300, 720));
    for (const id of [1, 2]) long.handle(touch("pointerup", id, 100, 300, 800));
    expect(long.handle(touch("pointerup", 3, 200, 300, 810))).toEqual({ swallow: true });

    // A finger that already dragged before the others landed doesn't make a tap either.
    const dragged = createMenuGesture();
    dragged.handle(touch("pointerdown", 1, 100, 300, 0));
    dragged.handle(touch("pointermove", 1, 100, 400, 50));
    dragged.handle(touch("pointerdown", 2, 150, 300, 60));
    dragged.handle(touch("pointerdown", 3, 200, 300, 70));
    for (const id of [1, 2]) dragged.handle(touch("pointerup", id, 100, 400, 150));
    expect(dragged.handle(touch("pointerup", 3, 200, 300, 160))).toEqual({ swallow: true });
  });

  it("leaves the mouse and pens alone", () => {
    const gesture = createMenuGesture();
    for (const id of [1, 2, 3]) gesture.handle(touch("pointerdown", id, 100, 100, 0));
    expect(gesture.handle({ type: "pointermove", pointerId: 9, pointerType: "mouse", clientX: 5, clientY: 5, timeStamp: 1 })).toEqual({ swallow: false });
    expect(gesture.handle({ type: "pointerdown", pointerId: 10, pointerType: "pen", clientX: 5, clientY: 5, timeStamp: 1 })).toEqual({ swallow: false });
    gesture.reset();
    expect(gesture.claimed).toBe(false);
    expect(gesture.handle(touch("pointerup", 1))).toEqual({ swallow: false });
  });
});
