/** Interaction patches wired into real runtime documents with engine mocks for the rest of the graph. */

import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, defineMock, drag, keyPress, pointerEvent, port, runFrames, tap } from "@sonobe/engine/testing";
import type { DocInput } from "@sonobe/engine/testing";
import { definitions as animation } from "../animation/index.ts";
import { definitions } from "./index.ts";

const rowPositions = defineMock({
  type: "rowPositions",
  name: "Row Positions",
  category: "loops",
  inputs: [],
  outputs: [port("positions", "point", { wholeLoop: true })],
  evaluate(ctx) {
    ctx.output("positions", [[0, 0], [0, 100], [0, 200]]);
  },
});

function runtime(input: DocInput) {
  const registry = createMockRegistry([...definitions, rowPositions]);
  return createTestRuntime(buildDoc(input, registry), registry);
}

describe("interaction patches in a runtime", () => {
  it("hands Drag's release velocity to Spring Animation on Dragging's falling edge", () => {
    const registry = createMockRegistry([...definitions, ...animation]);
    const doc = buildDoc(
      {
        layers: [{ id: "knob", type: "rectangle", name: "Knob", props: { position: [100, 100], size: [60, 60] } }],
        patches: {
          mover: { type: "drag", inputs: { layer: { layer: "knob" }, startPosition: [0, 0] } },
          settle: { type: "springAnimation", typeParam: "point", inputs: { number: { link: "mover.position" }, gestureActive: { link: "mover.dragging" }, gestureVelocity: { link: "mover.velocity" } } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 2);
    runFrames(rt, 7, drag([130, 130], [250, 130], { frames: 6, release: false }));
    const flung = rt.getValue("mover.velocity") as number[];
    expect(flung[0]).toBeGreaterThan(500);
    runFrames(rt, 1, [[pointerEvent("up", 250, 130)]]);
    expect(rt.getValue("mover.dragging")).toBe(false);
    expect(rt.getValue("mover.velocity")).toEqual(flung);
    const rest = rt.getValue("mover.position") as number[];
    runFrames(rt, 3);
    expect(rt.getValue("mover.velocity")).toEqual([0, 0]);
    expect((rt.getValue("settle.output") as number[])[0]).toBeGreaterThan(rest[0]! + 1);
  });

  it("reports every finger to Touches and pinches Pop Switch through the runtime's pointer list", () => {
    const rt = runtime({
      layers: [{ id: "pad", type: "rectangle", name: "Pad", props: { position: [0, 0], size: [390, 400] } }],
      patches: {
        fingers: { type: "touches", inputs: { layer: { layer: "pad" } } },
        zoom: { type: "popSwitch", inputs: { layer: { layer: "pad" }, gesture: "pinchScale", start: 1, end: 3 } },
      },
    });
    const finger = (phase: "down" | "move" | "up", x: number, y: number, pointerId: number) => ({ kind: "pointer" as const, phase, pointerId, pointerType: "touch" as const, x, y, pressure: 0.6 });
    runFrames(rt, 2);
    runFrames(rt, 1, [[finger("down", 100, 200, 1)]]);
    runFrames(rt, 1, [[finger("down", 200, 200, 2)]]);
    expect(rt.getValue("fingers.count")).toBe(2);
    expect(rt.getRawValue("fingers.ids")).toEqual({ __loop: true, items: [1, 2] });
    expect(rt.getValue("zoom.dragging")).toBe(true);
    runFrames(rt, 1, [[finger("move", 300, 200, 2)]]);
    expect(rt.getValue("zoom.output")).toBeCloseTo(2, 9);
    runFrames(rt, 1, [[finger("up", 300, 200, 2)]]);
    expect(rt.getValue("zoom.dragging")).toBe(false);
    expect(rt.getValue("fingers.count")).toBe(1);
  });

  it("taps a card through Switch, Pop Animation, and Transition until its scale settles", () => {
    const rt = runtime({
      layers: [{ id: "card", type: "rectangle", name: "Card", props: { position: [95, 322], size: [200, 200], scale: { link: "grow.output" } } }],
      patches: {
        touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
        toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
        pop: { type: "popAnimation", inputs: { number: { link: "toggle.on" } } },
        grow: { type: "transition", typeParam: "number", inputs: { progress: { link: "pop.output" }, start: 1, end: 1.2 } },
      },
    });
    runFrames(rt, 2);
    runFrames(rt, 1, [[pointerEvent("down", 195, 422)]]);
    expect(rt.getValue("touch.down")).toBe(true);
    runFrames(rt, 1, [[pointerEvent("up", 195, 422)]]);
    expect(rt.getValue("touch.tap")).toBe(true);
    expect(rt.getValue("touch.position")).toEqual([195, 422]);
    expect(rt.getValue("toggle.on")).toBe(true);
    runFrames(rt, 1);
    expect(rt.getValue("touch.tap")).toBe(false);
    expect(rt.needsNextFrame).toBe(true);
    runFrames(rt, 240);
    expect(rt.getValue("@card.scale")).toBeCloseTo(1.2, 6);
    expect(rt.needsNextFrame).toBe(false); // the spring is at rest and nothing is pressed

    runFrames(rt, 2, tap(10, 10));
    expect(rt.getValue("toggle.on")).toBe(true);
  });

  it("throws a card on a quick, short flick once Swipe looks ahead", () => {
    const deck = (lookahead: number) =>
      runtime({
        layers: [{ id: "card", type: "rectangle", name: "Card", props: { position: [37, 250], size: [328, 420] } }],
        patches: {
          throw: { type: "swipe", inputs: { layer: { layer: "card" }, axis: "horizontal", minDistance: 95, minVelocity: 800, lookahead } },
          gone: { type: "switch", inputs: { turnOn: { link: "throw.swiped" } } },
        },
      });
    for (const [lookahead, thrown] of [[0, false], [0.2, true]] as const) {
      const rt = deck(lookahead);
      runFrames(rt, 2);
      runFrames(rt, 6, drag([200, 460], [260, 460], { frames: 5, release: false }));
      const heading = (rt.getValue("throw.projected") as number[])[0]!;
      expect(lookahead ? heading > 100 : heading === 60).toBe(true);
      runFrames(rt, 1, [[pointerEvent("up", 260, 460)]]);
      expect(rt.getValue("gone.on")).toBe(thrown);
    }
  });

  it("keeps a toggle per copy of a loop-replicated row", () => {
    const rt = runtime({
      layers: [{ id: "row", type: "rectangle", name: "Row", props: { size: [300, 80], position: { link: "rows.positions" } } }],
      patches: {
        rows: { type: "rowPositions" },
        check: { type: "tapToggle", inputs: { layer: { layer: "row" } } },
      },
    });
    runFrames(rt, 2);
    runFrames(rt, 2, tap(150, 140));
    expect([0, 1, 2].map((i) => rt.getValue(`check.on#${i}`))).toEqual([false, true, false]);
    runFrames(rt, 2, tap(150, 230));
    expect([0, 1, 2].map((i) => rt.getValue(`check.on#${i}`))).toEqual([false, true, true]);
  });

  it("scrolls a clipped feed with a drag and a fling, then settles inside the bounds", () => {
    const rt = runtime({
      layers: [
        {
          id: "window",
          type: "group",
          name: "Window",
          props: { position: [0, 100], size: [390, 600], clip: true },
          children: [{ id: "content", type: "rectangle", name: "Content", props: { size: [390, 2000], position: { link: "feed.position" } } }],
        },
      ],
      patches: { feed: { type: "scroll", inputs: { layer: { layer: "content" } } } },
    });
    runFrames(rt, 2);
    runFrames(rt, 11, drag([195, 600], [195, 400], { frames: 10, release: false }));
    expect(rt.getValue("feed.dragging")).toBe(true);
    expect(rt.getValue("feed.y")).toBe(-180);
    expect(rt.getValue("@content.position")).toEqual([0, -180]);
    runFrames(rt, 1, [[pointerEvent("up", 195, 400)]]);
    expect(rt.getValue("feed.moving")).toBe(true);
    runFrames(rt, 600);
    expect(rt.getValue("feed.moving")).toBe(false);
    const y = rt.getValue("feed.y") as number;
    expect(y).toBeLessThan(-300);
    expect(y).toBeGreaterThanOrEqual(-1400);
    expect(rt.issues()).toEqual([]);
  });

  it("nests a paging carousel inside a vertical feed, each taking its own direction", () => {
    const rt = runtime({
      layers: [
        {
          id: "window",
          type: "group",
          name: "Window",
          props: { size: [390, 600], clip: true },
          children: [
            {
              id: "content",
              type: "group",
              name: "Content",
              props: { size: [390, 2000], position: { link: "feed.position" } },
              children: [
                {
                  id: "strip",
                  type: "group",
                  name: "Strip",
                  props: { size: [390, 200], clip: true },
                  children: [{ id: "cards", type: "rectangle", name: "Cards", props: { size: [1170, 200], position: { link: "carousel.position" } } }],
                },
              ],
            },
          ],
        },
      ],
      patches: {
        feed: { type: "scroll", inputs: { layer: { layer: "content" } } },
        carousel: { type: "scroll", inputs: { layer: { layer: "cards" }, scrollX: "paging", scrollY: "off" } },
      },
    });
    runFrames(rt, 2);
    runFrames(rt, 5, drag([300, 100], [150, 105], { frames: 3 }));
    runFrames(rt, 240);
    expect(rt.getValue("carousel.pageX")).toBe(1);
    expect(rt.getValue("carousel.x") as number).toBeCloseTo(-390, 6);
    expect(rt.getValue("feed.y")).toBe(0);

    runFrames(rt, 11, drag([200, 150], [200, 30], { frames: 10, release: false }));
    expect(rt.getValue("feed.dragging")).toBe(true);
    expect(rt.getValue("feed.y")).toBe(-108);
    expect(rt.getValue("carousel.dragging")).toBe(false);
    expect(rt.getValue("carousel.x") as number).toBeCloseTo(-390, 6);
  });

  it("drags a knob and leaves it where it's dropped", () => {
    const rt = runtime({
      layers: [{ id: "knob", type: "oval", name: "Knob", props: { size: [60, 60], position: { link: "mover.position" } } }],
      patches: { mover: { type: "drag", inputs: { layer: { layer: "knob" }, startPosition: [100, 100] } } },
    });
    runFrames(rt, 2);
    expect(rt.getValue("@knob.position")).toEqual([100, 100]);
    runFrames(rt, 7, drag([130, 130], [230, 180], { frames: 5 }));
    runFrames(rt, 1);
    expect(rt.getValue("@knob.position")).toEqual([200, 150]);
    expect(rt.getValue("mover.dragging")).toBe(false);
  });

  it("toggles a switch from the keyboard, once per press", () => {
    const rt = runtime({
      patches: {
        key: { type: "keyboard", inputs: { key: "k" } },
        toggle: { type: "switch", inputs: { flip: { link: "key.down" } } },
      },
    });
    runFrames(rt, 1);
    runFrames(rt, 1, [[{ kind: "key", phase: "down", key: "k" }]]);
    expect(rt.getValue("toggle.on")).toBe(true);
    runFrames(rt, 10);
    expect(rt.getValue("toggle.on")).toBe(true);
    runFrames(rt, 3, [...keyPress("k"), [{ kind: "key", phase: "down", key: "K" }]]);
    expect(rt.getValue("toggle.on")).toBe(false);
  });

  it("opens a menu with a long press that stays open after release", () => {
    const rt = runtime({
      layers: [{ id: "card", type: "rectangle", name: "Card", props: { size: [200, 200] } }],
      patches: {
        hold: { type: "longPress", inputs: { layer: { layer: "card" }, duration: 0.4 } },
        menu: { type: "switch", inputs: { turnOn: { link: "hold.longPress" } } },
      },
    });
    runFrames(rt, 2);
    runFrames(rt, 1, [[pointerEvent("down", 100, 100)]]);
    runFrames(rt, 20);
    expect(rt.getValue("hold.progress") as number).toBeCloseTo(20 / 24, 6);
    expect(rt.getValue("menu.on")).toBe(false);
    runFrames(rt, 5);
    expect(rt.getValue("menu.on")).toBe(true);
    runFrames(rt, 1, [[pointerEvent("up", 100, 100)]]);
    expect(rt.getValue("hold.longPress")).toBe(false);
    expect(rt.getValue("menu.on")).toBe(true);
  });

  it("uses each patch's muted behavior", () => {
    const rt = runtime({
      layers: [{ id: "card", type: "rectangle", name: "Card", props: { size: [200, 200] } }],
      patches: {
        touch: { type: "interaction", muted: true, inputs: { layer: { layer: "card" } } },
        toggle: { type: "tapToggle", muted: true, inputs: { layer: { layer: "card" }, startOn: true } },
        mover: { type: "drag", muted: true, inputs: { layer: { layer: "card" }, startPosition: [40, 50] } },
        feed: { type: "scroll", muted: true, inputs: { layer: { layer: "card" }, startPosition: [0, 64] } },
        flip: { type: "popSwitch", muted: true, inputs: { start: 20, end: 80 } },
        fling: { type: "momentumScrolling", muted: true, inputs: { value: 33, tracking: true } },
        fingers: { type: "touches", muted: true },
        hold: { type: "longPress", muted: true, inputs: { layer: { layer: "card" }, duration: 0 } },
        key: { type: "keyboard", muted: true },
      },
    });
    runFrames(rt, 2);
    runFrames(rt, 1, [[pointerEvent("down", 100, 100), { kind: "key", phase: "down", key: " " }]]);
    expect(rt.getValue("touch.down")).toBe(false);
    expect(rt.getValue("touch.position")).toEqual([0, 0]);
    expect(rt.getValue("toggle.on")).toBe(true);
    expect(rt.getValue("toggle.down")).toBe(false);
    expect(rt.getValue("mover.position")).toEqual([40, 50]);
    expect(rt.getValue("mover.dragging")).toBe(false);
    expect(rt.getValue("mover.velocity")).toEqual([0, 0]);
    expect([rt.getValue("feed.position"), rt.getValue("feed.x"), rt.getValue("feed.y"), rt.getValue("feed.pageY")]).toEqual([[0, 64], 0, 64, 0]);
    expect([rt.getValue("flip.output"), rt.getValue("flip.progress"), rt.getValue("flip.on")]).toEqual([20, 0, false]);
    expect([rt.getValue("fling.output"), rt.getValue("fling.velocity"), rt.getValue("fling.moving")]).toEqual([33, 0, false]);
    expect(rt.getValue("fingers.count")).toBe(0);
    expect(rt.getValue("fingers.json")).toEqual([]);
    expect(rt.getValue("hold.longPress")).toBe(false);
    expect(rt.getValue("key.down")).toBe(false);
  });
});
