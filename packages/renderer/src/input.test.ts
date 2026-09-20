// @vitest-environment happy-dom
import type { InputEvent, SceneFrame, SceneNode } from "@sonobe/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buttonsOf, clientToPrototype, effectiveScale, eventTime, pointerTypeOf } from "./input.ts";
import { createDomRenderer } from "./renderer.ts";
import type { DomRenderer } from "./renderer.ts";
import { cursorAt, findNodesAt } from "./sceneQuery.ts";

const mat = (x = 0, y = 0) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];

describe("clientToPrototype", () => {
  it("uses the stage's on-screen size to find the effective scale", () => {
    const rect = { left: 100, top: 50, width: 195, height: 422 };
    expect(effectiveScale(rect, [390, 844], 1)).toEqual([0.5, 0.5]);
    expect(clientToPrototype(150, 100, rect, [390, 844], 1)).toEqual([100, 100]);
    expect(clientToPrototype(100, 50, rect, [390, 844], 1)).toEqual([0, 0]);
  });

  it("falls back to the renderer scale before the stage has a size", () => {
    expect(clientToPrototype(40, 20, { left: 0, top: 0, width: 0, height: 0 }, null, 2)).toEqual([20, 10]);
    expect(clientToPrototype(40, 20, { left: 10, top: 0, width: 0, height: 0 }, [390, 844], 0)).toEqual([30, 20]);
  });
});

describe("event normalization", () => {
  it("maps pointer types and timestamps", () => {
    expect(pointerTypeOf({ pointerType: "touch" })).toBe("touch");
    expect(pointerTypeOf({ pointerType: "pen" })).toBe("pen");
    expect(pointerTypeOf({ pointerType: "" })).toBe("mouse");
    expect(pointerTypeOf({})).toBe("mouse");
    expect(eventTime({ timeStamp: 1234.5 })).toBe(1234.5);
    expect(eventTime({ timeStamp: 0 })).toBeGreaterThan(0);
  });

  it("reads the buttons bitmask, counting the pressed button when a press reports none", () => {
    expect(buttonsOf({ buttons: 5 })).toBe(5);
    expect(buttonsOf({ buttons: 0, button: 0 }, "up")).toBe(0);
    expect(buttonsOf({}, "move")).toBe(0);
    expect(buttonsOf({ buttons: 1.5 })).toBe(0);
    expect(buttonsOf({ buttons: 0, button: 0 }, "down")).toBe(1);
    expect(buttonsOf({ button: 1 }, "down")).toBe(4);
    expect(buttonsOf({ button: 2 }, "down")).toBe(2);
    expect(buttonsOf({ buttons: 2, button: 0 }, "down")).toBe(2);
  });
});

describe("input capture", () => {
  let container: HTMLElement;
  let renderer: DomRenderer;
  let events: InputEvent[];
  const frame: SceneFrame = { frame: 0, time: 0, size: [400, 800], background: { r: 1, g: 1, b: 1, a: 1 }, roots: [] };

  beforeEach(() => {
    events = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    renderer = createDomRenderer(container, { resolveAssetUrl: () => undefined, onEvents: (e) => events.push(...e), scale: 0.5 });
    renderer.render(frame);
    vi.spyOn(renderer.stage, "getBoundingClientRect").mockReturnValue({ left: 20, top: 10, width: 200, height: 400, right: 220, bottom: 410, x: 20, y: 10, toJSON: () => ({}) } as DOMRect);
  });

  afterEach(() => {
    renderer.dispose();
    container.remove();
    vi.restoreAllMocks();
  });

  const pointerEvent = (type: string, init: PointerEventInit) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "mouse", ...init });
  const pointer = (type: string, init: PointerEventInit) => container.dispatchEvent(pointerEvent(type, init));
  const at = expect.any(Number);

  it("converts pointer down/move/up/cancel into prototype coordinates with type and time", () => {
    pointer("pointerdown", { clientX: 120, clientY: 110, pointerId: 7, button: 0, buttons: 1 });
    pointer("pointermove", { clientX: 130, clientY: 120, pointerId: 7, buttons: 1 });
    pointer("pointerup", { clientX: 130, clientY: 120, pointerId: 7, button: 0 });
    pointer("pointercancel", { clientX: 20, clientY: 10, pointerId: 8 });
    expect(events).toEqual([
      { kind: "pointer", phase: "down", pointerId: 7, pointerType: "mouse", timeStamp: at, x: 200, y: 200, buttons: 1, button: 0 },
      { kind: "pointer", phase: "move", pointerId: 7, pointerType: "mouse", timeStamp: at, x: 220, y: 220, buttons: 1 },
      { kind: "pointer", phase: "up", pointerId: 7, pointerType: "mouse", timeStamp: at, x: 220, y: 220, buttons: 0, button: 0 },
      { kind: "pointer", phase: "cancel", pointerId: 8, pointerType: "mouse", timeStamp: at, x: 0, y: 0, buttons: 0 },
    ]);
    const times = events.map((e) => (e.kind === "pointer" ? e.timeStamp! : 0));
    expect(times.every((t, i) => i === 0 || t >= times[i - 1]!)).toBe(true);
  });

  it("reports the buttons bitmask, including chorded presses", () => {
    pointer("pointerdown", { clientX: 120, clientY: 110, pointerId: 1, button: 2, buttons: 2 });
    pointer("pointermove", { clientX: 120, clientY: 110, pointerId: 1, button: 0, buttons: 3 });
    pointer("pointerup", { clientX: 120, clientY: 110, pointerId: 1, button: 2, buttons: 1 });
    pointer("pointerup", { clientX: 120, clientY: 110, pointerId: 1, button: 0, buttons: 0 });
    expect(events.map((e) => (e.kind === "pointer" ? [e.phase, (e as { buttons?: number }).buttons] : e.kind))).toEqual([
      ["down", 2],
      ["move", 3],
      ["up", 1],
      ["up", 0],
    ]);
  });

  it("reports touch and pen pressure", () => {
    pointer("pointerdown", { clientX: 120, clientY: 110, pointerId: 3, pointerType: "touch", pressure: 0.6, buttons: 1 });
    expect(events[0]).toMatchObject({ phase: "down", pointerType: "touch", pressure: 0.6 });
  });

  it("reports hover moves and a leave phase when the pointer exits", () => {
    pointer("pointermove", { clientX: 24, clientY: 110, pointerId: 1 });
    pointer("pointerleave", { clientX: 18, clientY: 110, pointerId: 1 });
    expect(events).toEqual([
      { kind: "pointer", phase: "move", pointerId: 1, pointerType: "mouse", timeStamp: at, x: 8, y: 200, buttons: 0 },
      { kind: "pointer", phase: "leave", pointerId: 1, pointerType: "mouse", timeStamp: at, x: -4, y: 200, buttons: 0 },
    ]);
  });

  it("doesn't end hover while a captured drag is still pressed", () => {
    pointer("pointerleave", { clientX: 5, clientY: 5, pointerId: 1, buttons: 1 });
    expect(events).toEqual([]);
  });

  it("emits a lifted touch leaving as a leave phase", () => {
    pointer("pointerup", { clientX: 120, clientY: 110, pointerId: 9, pointerType: "touch", button: 0 });
    pointer("pointerleave", { clientX: 120, clientY: 110, pointerId: 9, pointerType: "touch" });
    expect(events.map((e) => (e.kind === "pointer" ? `${e.phase}:${e.pointerType}` : e.kind))).toEqual(["up:touch", "leave:touch"]);
  });

  it("expands coalesced samples while dragging", () => {
    const move = pointerEvent("pointermove", { clientX: 140, clientY: 130, pointerId: 2, buttons: 1 });
    const samples = [
      { clientX: 120, clientY: 110, pointerId: 2, pointerType: "mouse", timeStamp: 100, buttons: 1 },
      { clientX: 140, clientY: 130, pointerId: 2, pointerType: "mouse", timeStamp: 108, buttons: 1 },
    ];
    Object.defineProperty(move, "getCoalescedEvents", { value: () => samples });
    container.dispatchEvent(move);
    expect(events).toEqual([
      { kind: "pointer", phase: "move", pointerId: 2, pointerType: "mouse", timeStamp: 100, x: 200, y: 200, buttons: 1 },
      { kind: "pointer", phase: "move", pointerId: 2, pointerType: "mouse", timeStamp: 108, x: 240, y: 240, buttons: 1 },
    ]);
  });

  it("captures the pointer for drags", () => {
    const capture = vi.spyOn(container, "setPointerCapture");
    pointer("pointerdown", { clientX: 30, clientY: 30, pointerId: 4, button: 0 });
    expect(capture).toHaveBeenCalledWith(4);
  });

  it("converts wheel deltas to points", () => {
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 5, deltaY: -20, deltaMode: 0 });
    // happy-dom's WheelEvent lacks MouseEvent coordinates; browsers always provide them.
    Object.defineProperty(wheel, "clientX", { value: 120 });
    Object.defineProperty(wheel, "clientY", { value: 210 });
    container.dispatchEvent(wheel);
    expect(events).toEqual([{ kind: "wheel", x: 200, y: 400, dx: 10, dy: -40 }]);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it("emits key events once per press and releases held keys on blur", () => {
    const key = (type: string, init: KeyboardEventInit) => container.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }));
    key("keydown", { key: "a", code: "KeyA", shiftKey: true });
    key("keydown", { key: "a", code: "KeyA", shiftKey: true, repeat: true });
    key("keyup", { key: "a", code: "KeyA" });
    key("keydown", { key: " ", code: "Space" });
    container.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    expect(events).toEqual([
      { kind: "key", phase: "down", key: "a", code: "KeyA", shift: true, alt: false, meta: false, ctrl: false },
      { kind: "key", phase: "up", key: "a", code: "KeyA", shift: false, alt: false, meta: false, ctrl: false },
      { kind: "key", phase: "down", key: " ", code: "Space", shift: false, alt: false, meta: false, ctrl: false },
      { kind: "key", phase: "up", key: " ", code: "Space", shift: false, alt: false, meta: false, ctrl: false },
    ]);
  });

  it("only forwards Enter and Escape from text fields", () => {
    const input = document.createElement("input");
    renderer.stage.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "b", code: "KeyB" }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
    expect(events.map((e) => (e.kind === "key" ? e.key : e.kind))).toEqual(["Enter"]);
  });

  it("stops emitting after dispose", () => {
    renderer.dispose();
    pointer("pointerdown", { clientX: 30, clientY: 30, pointerId: 1 });
    expect(events).toEqual([]);
  });
});

describe("scene queries", () => {
  const node = (key: string, x: number, y: number, props: Record<string, unknown> = {}, children: SceneNode[] = []): SceneNode => ({
    key, layerId: key, type: "rectangle", parentKey: null, x, y, width: 100, height: 100, transform: mat(x, y), worldTransform: mat(x, y), opacity: 1, visible: true, clip: false, props, children,
  });

  it("finds the front-most node and its ancestors", () => {
    const child = { ...node("child", 10, 10, { cursor: "pointer" }), worldTransform: mat(60, 60) };
    const f: SceneFrame = { frame: 0, time: 0, size: [400, 400], background: { r: 0, g: 0, b: 0, a: 1 }, roots: [node("back", 0, 0), node("group", 50, 50, {}, [child])] };
    expect(findNodesAt(f, 70, 70).map((h) => h.node.key)).toEqual(["child", "group"]);
    expect(findNodesAt(f, 20, 20).map((h) => h.node.key)).toEqual(["back"]);
    expect(cursorAt(f, 70, 70)).toBe("pointer");
    expect(cursorAt(f, 20, 20)).toBe("");
    expect(findNodesAt(f, 390, 390)).toEqual([]);
  });

  it("follows paint order, so the lifted layer's cursor wins", () => {
    const f: SceneFrame = { frame: 0, time: 0, size: [400, 400], background: { r: 0, g: 0, b: 0, a: 1 }, roots: [node("lifted", 0, 0, { cursor: "pointer", zPosition: 10 }), node("later", 50, 50, { cursor: "text" })] };
    expect(findNodesAt(f, 75, 75).map((h) => h.node.key)).toEqual(["lifted"]);
    expect(cursorAt(f, 75, 75)).toBe("pointer");
    expect(cursorAt(f, 125, 125)).toBe("text");
  });
});
