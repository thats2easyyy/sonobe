/**
 * Rest with the real patches (ARCHITECTURE.md §5.2): for prototypes of every common shape, a host
 * that rests while nothing moves draws what a host that steps on every frame draws, on every frame,
 * and does rest. A patch that waits on something without asking for frames fails here.
 */

import type { InputEvent } from "@sonobe/engine";
import { buildDoc, drag, idle, pointerEvent, runRested, sequence, tap, type DocInput, type FrameEvents } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchRegistry } from "./index.ts";

const registry = createPatchRegistry();

interface Case {
  doc: DocInput;
  events: FrameEvents;
  watch: string[];
  /** The resting host steps at most this share of the frames. */
  awake: number;
  /** Where the watched values end up, so a case that never reacted can't pass. */
  end: Record<string, unknown>;
}

const CARD = { id: "card", type: "rectangle", name: "Card", props: { position: [40, 40], size: [120, 120] } };
const text = (layerId: string, value: string): InputEvent => ({ kind: "text", layerId, value });

const CASES: Record<string, Case> = {
  "a tap pops a card": {
    doc: {
      layers: [{ ...CARD, props: { ...CARD.props, scale: { link: "grow.output" } } }],
      patches: {
        touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
        toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
        pop: { type: "popAnimation", typeParam: "number", inputs: { number: { link: "toggle.on" } } },
        grow: { type: "transition", typeParam: "number", inputs: { progress: { link: "pop.output" }, start: 1, end: 1.4 } },
      },
    },
    events: sequence(idle(20), tap(100, 100), idle(240), tap(100, 100, { holdFrames: 4 }), idle(240)),
    watch: ["pop.output", "toggle.on", "@card.scale"],
    awake: 0.6,
    end: { "toggle.on": false, "@card.scale": 1 },
  },
  "a drag coasts on its momentum": {
    doc: {
      layers: [{ ...CARD, props: { ...CARD.props, position: { link: "mover.position" } } }],
      patches: { mover: { type: "drag", inputs: { layer: { layer: "card" }, startPosition: [40, 40], momentum: true } } },
    },
    events: sequence(idle(10), drag([100, 100], [220, 180], { frames: 8 }), idle(400)),
    watch: ["mover.position", "mover.dragging", "mover.velocity"],
    awake: 0.8,
    end: { "mover.dragging": false, "mover.velocity": [0, 0] },
  },
  "a list scrolls and settles": {
    doc: {
      layers: [
        {
          id: "list",
          type: "group",
          name: "List",
          props: { size: [300, 400], clip: true },
          children: [{ id: "content", type: "rectangle", name: "Content", props: { size: [300, 1600], position: { link: "scroller.position" } } }],
        },
      ],
      patches: { scroller: { type: "scroll", inputs: { layer: { layer: "list" }, contentSize: [300, 1600] } } },
    },
    events: sequence(idle(10), drag([150, 300], [150, 120], { frames: 6 }), idle(500), [[{ kind: "wheel", x: 150, y: 200, dx: 0, dy: 60 }]], idle(200)),
    watch: ["scroller.position", "scroller.moving", "scroller.dragging"],
    awake: 0.8,
    end: { "scroller.moving": false, "scroller.dragging": false },
  },
  "a tap starts a wait, then a delay": {
    doc: {
      layers: [{ ...CARD, props: { ...CARD.props, opacity: { link: "fade.output" } } }],
      patches: {
        touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
        timer: { type: "wait", inputs: { start: { link: "touch.tap" }, duration: 0.5 } },
        later: { type: "delay", typeParam: "boolean", inputs: { value: { link: "timer.done" }, duration: 0.4 } },
        fade: { type: "transition", typeParam: "number", inputs: { progress: { link: "later.output" }, start: 1, end: 0.3 } },
      },
    },
    events: sequence(idle(30), tap(100, 100), idle(300)),
    watch: ["timer.done", "timer.progress", "later.output", "@card.opacity"],
    awake: 0.5,
    end: { "timer.done": true, "later.output": true, "@card.opacity": 0.3 },
  },
  "layers follow each other through Layer Info": {
    doc: {
      layers: [
        { ...CARD, props: { ...CARD.props, position: { link: "mover.position" } } },
        ...[1, 2, 3, 4].map((i) => ({ id: `tail${i}`, type: "oval", name: `Tail ${i}`, props: { size: [20, 20], position: { link: `info${i}.position` } } })),
      ],
      patches: {
        mover: { type: "drag", inputs: { layer: { layer: "card" }, startPosition: [40, 40] } },
        ...Object.fromEntries([1, 2, 3, 4].map((i) => [`info${i}`, { type: "layerInfo", inputs: { layer: { layer: i === 1 ? "card" : `tail${i - 1}` } } }])),
      },
    },
    events: sequence(idle(20), drag([100, 100], [180, 140], { frames: 5 }), idle(120)),
    watch: ["info4.position", "@tail4.position"],
    awake: 0.4,
    end: { "@tail4.position": [120, 80] },
  },
  "typing in a text field": {
    doc: {
      layers: [
        { id: "field", type: "textField", name: "Field", props: { position: [20, 20], size: [200, 40] } },
        { id: "echo", type: "text", name: "Echo", props: { position: [20, 80], text: { link: "@field.value" } } },
        { id: "box", type: "rectangle", name: "Box", props: { position: [20, 120], size: { link: "@echo.textSize" } } },
      ],
    },
    events: sequence(idle(10), [[{ kind: "focus", layerId: "field", focused: true }]], idle(60), [[text("field", "h")]], idle(3), [[text("field", "hello")]], idle(90), [[{ kind: "submit", layerId: "field" }]], idle(60)),
    watch: ["@field.value", "@field.isFocused", "@echo.text", "@box.size"],
    awake: 0.4,
    end: { "@field.value": "hello", "@field.isFocused": true, "@echo.text": "hello" },
  },
  "a loop whose count grows with each tap": {
    doc: {
      layers: [
        { ...CARD, props: { ...CARD.props } },
        { id: "dot", type: "oval", name: "Dot", props: { size: [10, 10], position: { link: "place.output" }, repeat: { link: "rows.index" } } },
      ],
      patches: {
        touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
        taps: { type: "counter", inputs: { increase: { link: "touch.tap" } } },
        rows: { type: "loop", inputs: { count: { link: "taps.count" } } },
        place: { type: "transition", typeParam: "point", inputs: { progress: { link: "rows.index" }, start: [200, 20], end: [200, 60] } },
      },
    },
    events: sequence(idle(10), tap(100, 100), idle(60), tap(100, 100), idle(60), tap(100, 100), idle(60)),
    watch: ["taps.count", "rows.index"],
    awake: 0.4,
    end: { "taps.count": 3 },
  },
  "two instances of a component that pops": {
    doc: {
      components: [
        {
          id: "chip",
          kind: "layerComponent",
          size: [80, 80],
          layers: [{ id: "face", type: "rectangle", name: "Face", props: { size: [80, 80], scale: { link: "grow.output" } } }],
          patches: {
            touch: { type: "interaction", inputs: { layer: { layer: "face" } } },
            toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
            pop: { type: "popAnimation", typeParam: "number", inputs: { number: { link: "toggle.on" } } },
            grow: { type: "transition", typeParam: "number", inputs: { progress: { link: "pop.output" }, start: 1, end: 1.3 } },
          },
        },
      ],
      layers: [
        { id: "a", type: "componentInstance", name: "A", component: "chip", props: { position: [20, 20] } },
        { id: "b", type: "componentInstance", name: "B", component: "chip", props: { position: [140, 20] } },
      ],
    },
    events: sequence(idle(10), tap(60, 60), idle(200), tap(180, 60), idle(200)),
    watch: ["a/pop.output", "b/pop.output", "@a/face.scale"],
    awake: 0.7,
    end: { "a/pop.output": 1, "b/pop.output": 1, "@a/face.scale": 1.3 },
  },
  "a drag that stops, holds a second, and lets go isn't a swipe": {
    doc: {
      layers: [CARD],
      patches: {
        feel: { type: "gesture", inputs: { layer: { layer: "card" } } },
        flick: { type: "swipe", inputs: { layer: { layer: "card" } } },
        count: { type: "counter", inputs: { increase: { link: "flick.swiped" } } },
      },
    },
    events: sequence(idle(10), drag([60, 100], [150, 100], { frames: 6, release: false }), idle(60), [[pointerEvent("up", 150, 100)]], idle(60), drag([60, 100], [150, 100], { frames: 4 }), idle(60)),
    watch: ["feel.velocity", "feel.translation", "count.count"],
    awake: 0.7,
    end: { "count.count": 1 },
  },
  "a double tap and a long press keep their timing across a rest": {
    doc: {
      layers: [CARD],
      patches: {
        touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
        twice: { type: "doubleTap", inputs: { layer: { layer: "card" } } },
        doubles: { type: "counter", inputs: { increase: { link: "twice.doubleTap" } } },
        singles: { type: "counter", inputs: { increase: { link: "twice.singleTap" } } },
        hold: { type: "longPress", inputs: { layer: { layer: "card" }, duration: 0.5 } },
      },
    },
    // Two taps far apart (two singles), two close together (a double), then a press held past the
    // long-press time, whose release is a third single tap.
    events: sequence(idle(10), tap(100, 100), idle(120), tap(100, 100), idle(120), tap(100, 100), idle(6), tap(100, 100), idle(120), tap(100, 100, { holdFrames: 50 }), idle(60)),
    watch: ["doubles.count", "singles.count", "hold.longPress", "hold.progress"],
    awake: 0.6,
    end: { "doubles.count": 1, "singles.count": 3, "hold.longPress": false },
  },
};

describe("rest: a host that rests draws what a host that steps every frame draws", () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(name, () => {
      const run = runRested(buildDoc(c.doc, registry), registry, c.events.length, c.events, { watch: c.watch });
      expect(run.mismatch).toBeNull();
      expect(run.steps / c.events.length).toBeLessThan(c.awake);
      expect(run.steps).toBeGreaterThan(10);
      for (const [address, value] of Object.entries(c.end)) {
        if (typeof value === "number") expect(run.values[address], address).toBeCloseTo(value, 3);
        else if (Array.isArray(value)) (run.values[address] as number[]).forEach((n, i) => expect(n, address).toBeCloseTo(value[i] as number, 1));
        else expect(run.values[address], address).toBe(value);
      }
    });
  }
});
