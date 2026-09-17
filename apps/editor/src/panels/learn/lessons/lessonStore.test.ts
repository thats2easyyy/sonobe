import { describe, expect, it } from "vitest";
import { createLessonStore, sanitizeProgress } from "./lessonStore.ts";

describe("lessonStore", () => {
  it("starts, advances, and finishes a lesson", () => {
    const store = createLessonStore({ storageKey: null, now: () => 42 });
    store.getState().start("first-prototype");
    expect(store.getState().active).toEqual({ id: "first-prototype", step: 0 });
    store.getState().advance(2);
    expect(store.getState().active?.step).toBe(1);
    expect(store.getState().isCompleted("first-prototype")).toBe(false);
    store.getState().advance(2);
    expect(store.getState().active?.step).toBe(2);
    expect(store.getState().completed).toEqual({ "first-prototype": 42 });
    store.getState().advance(2);
    expect(store.getState().active?.step).toBe(2);
    store.getState().goTo(-3);
    expect(store.getState().active?.step).toBe(0);
    store.getState().exit();
    expect(store.getState().active).toBeNull();
    expect(store.getState().isCompleted("first-prototype")).toBe(true);
    store.getState().resetAll();
    expect(store.getState().completed).toEqual({});
  });

  it("ignores step changes without an active lesson", () => {
    const store = createLessonStore({ storageKey: null });
    store.getState().advance(3);
    store.getState().goTo(2);
    expect(store.getState().active).toBeNull();
  });

  it("sanitizes stored progress", () => {
    expect(sanitizeProgress(null)).toEqual({ active: null, completed: {} });
    expect(sanitizeProgress({ active: { id: "x", step: 1.5 }, completed: { a: 1, b: "no" } })).toEqual({ active: null, completed: { a: 1 } });
    expect(sanitizeProgress({ active: { id: "x", step: 2 } })).toEqual({ active: { id: "x", step: 2 }, completed: {} });
  });
});
