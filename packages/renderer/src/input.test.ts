// @vitest-environment happy-dom
import type { InputEvent, SceneFrame, SceneNode } from "@sonobe/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientToPrototype, effectiveScale } from "./input.ts";
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

  const pointer = (type: string, init: PointerEventInit) => container.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "mouse", ...init }));

  it("converts pointer down/move/up/cancel into prototype coordinates", () => {
    pointer("pointerdown", { clientX: 120, clientY: 110, pointerId: 7, button: 0, buttons: 1 });
    pointer("pointermove", { clientX: 130, clientY: 120, pointerId: 7, buttons: 1 });
    pointer("pointerup", { clientX: 130, clientY: 120, pointerId: 7, button: 0 });
    pointer("pointercancel", { clientX: 20, clientY: 10, pointerId: 8 });
    expect(events).toEqual([
      { kind: "pointer", phase: "down", pointerId: 7, x: 200, y: 200, button: 0 },
      { kind: "pointer", phase: "move", pointerId: 7, x: 220, y: 220 },
      { kind: "pointer", phase: "up", pointerId: 7, x: 220, y: 220, button: 0 },
      { kind: "pointer", phase: "cancel", pointerId: 8, x: 0, y: 0 },
    ]);
  });

  it("reports hover moves and a position outside the prototype when the mouse leaves", () => {
    pointer("pointermove", { clientX: 24, clientY: 110, pointerId: 1 });
    pointer("pointerleave", { clientX: 24, clientY: 110, pointerId: 1 });
    expect(events[0]).toEqual({ kind: "pointer", phase: "move", pointerId: 1, x: 8, y: 200 });
    expect(events[1]).toEqual({ kind: "pointer", phase: "move", pointerId: 1, x: -1, y: 200 });
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
});
