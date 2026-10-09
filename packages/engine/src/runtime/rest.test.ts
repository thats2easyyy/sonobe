/**
 * Rest (ARCHITECTURE.md §5.2): `resting` turns true after two steps that changed nothing, every way
 * of reaching the runtime ends it and calls `onWake`, and a runtime that sits out the frames it
 * rests through shows what one stepped on every frame shows.
 */

import { applyOps, type InputValue, type LayerRef, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import {
  buildDoc,
  createMockRegistry,
  createTestRuntime,
  defineMock,
  drag,
  idle,
  pointerEvent,
  port,
  runFrames,
  runRested,
  sequence,
  tap,
  type DocInput,
} from "../testing/index.ts";
import type { InputEvent, PatchDefinition, Runtime } from "../types.ts";
import { REST_AFTER_STILL_STEPS } from "./runtime.ts";

/** Asks for frames while it counts up to `frames`, then holds. */
const countTo = defineMock<{ n: number }>({
  type: "countTo",
  name: "Count To",
  inputs: [port("frames", "number", { default: 5 })],
  outputs: [port("count", "number")],
  state: () => ({ n: 0 }),
  evaluate(ctx) {
    if (ctx.state.n < ctx.input<number>("frames")) {
      ctx.state.n++;
      ctx.requestNextFrame();
    }
    ctx.output("count", ctx.state.n);
  },
});

/** Records the dt and time of every evaluation. */
const clockLog: { dt: number; time: number }[] = [];
const clock = defineMock({
  type: "clockProbe",
  name: "Clock Probe",
  inputs: [],
  outputs: [],
  evaluate(ctx) {
    clockLog.push({ dt: ctx.dt, time: ctx.time });
  },
});

/** Restarts the prototype when its input pulses. */
const restarter = defineMock({
  type: "restarter",
  name: "Restarter",
  inputs: [port("go", "pulse")],
  outputs: [],
  evaluate(ctx) {
    if (ctx.pulsed("go")) ctx.services.restart();
  },
});

/** A gesture's velocity, read straight from the pointer (no frame request). */
const gesture = defineMock({
  type: "gestureProbe",
  name: "Gesture Probe",
  inputs: [port("layer", "layer", { default: null })],
  outputs: [port("velocity", "point"), port("down", "boolean")],
  evaluate(ctx) {
    const snap = ctx.services.pointer(ctx.input<LayerRef | null>("layer") ?? null);
    ctx.output("velocity", snap.velocity);
    ctx.output("down", snap.down);
  },
});

const registry = createMockRegistry([countTo, clock, restarter, gesture]);

const apply = (doc: SonobeDocument, ops: Op[]) => {
  const r = applyOps(doc, ops, { registry });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return r.doc;
};

const CARD = { id: "card", type: "rectangle", name: "Card", props: { position: [20, 20], size: [100, 100] } };

/** A card that pops bigger and back on each tap. */
function tapDoc(): SonobeDocument {
  return buildDoc(
    {
      layers: [{ ...CARD, props: { ...CARD.props, scale: { link: "grow.output" } } }],
      patches: {
        touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
        toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
        pop: { type: "popAnimation", inputs: { number: { link: "toggle.on" } } },
        grow: { type: "transition", typeParam: "number", inputs: { progress: { link: "pop.output" }, start: 1, end: 1.5 } },
      },
    },
    registry,
  );
}

/** A live runtime at rest, counting the times it called onWake. */
function rested(doc: SonobeDocument, definitions: readonly PatchDefinition[] = []) {
  let wakes = 0;
  const reg = definitions.length ? createMockRegistry([countTo, clock, restarter, gesture, ...definitions]) : registry;
  const rt = createTestRuntime(doc, reg, { deterministic: false, platform: {}, onWake: () => wakes++ });
  for (let i = 0; i < 400 && !rt.resting; i++) rt.step(1 / 60);
  expect(rt.resting).toBe(true);
  wakes = 0;
  return { rt, wakes: () => wakes };
}

/** `resting` after each of `frames` steps. */
const restingAfter = (rt: Runtime & { resting: boolean }, frames: number) => {
  const out: boolean[] = [];
  for (let i = 0; i < frames; i++) {
    rt.step();
    out.push(rt.resting);
  }
  return out;
};

const restingOver = (doc: SonobeDocument, frames: number) => restingAfter(createTestRuntime(doc, registry), frames);

describe("rest: a prototype where nothing moves", () => {
  it("is at rest after two steps that changed nothing, and stays there", () => {
    const rt = createTestRuntime(tapDoc(), registry);
    expect(rt.resting).toBe(false);
    const seen: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      rt.step();
      seen.push(rt.resting);
      expect(rt.needsNextFrame).toBe(false);
    }
    expect(seen).toEqual([false, false, true, true, true, true]);
    expect(REST_AFTER_STILL_STEPS).toBe(2);
  });

  it("isn't at rest after a restart until it has settled again", () => {
    const rt = createTestRuntime(tapDoc(), registry);
    runFrames(rt, 5);
    rt.restart();
    expect(rt.resting).toBe(false);
    expect(restingAfter(rt, 3)).toEqual([false, false, true]);
  });

  it("never rests while a patch asks for frames, and rests two steps after its last moving one", () => {
    const doc = buildDoc({ layers: [CARD], patches: { n: { type: "countTo", inputs: { frames: 5 } } } }, registry);
    // Steps 0-4 count and ask for the next frame; step 5 writes the same count but wasn't watched.
    expect(restingOver(doc, 9)).toEqual([false, false, false, false, false, false, false, true, true]);
  });

  it("never rests while an output keeps changing, even when nothing asks for frames", () => {
    const doc = buildDoc({ layers: [CARD], patches: { t: { type: "time" } } }, registry);
    expect(restingOver(doc, 30)).not.toContain(true);
  });

  it("stays at rest without comparing again while it is stepped anyway", () => {
    const doc = tapDoc();
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 4);
    const nodes = rt.scene().roots;
    for (let i = 0; i < 20; i++) rt.step();
    expect(rt.resting).toBe(true);
    expect(rt.scene().roots).not.toBe(nodes);
  });
});

describe("rest: everything that reaches the runtime ends it", () => {
  const INPUTS: Record<string, InputEvent> = {
    "a pointer press": pointerEvent("down", 50, 50),
    "a pointer move": pointerEvent("move", 300, 300),
    "a key": { kind: "key", phase: "down", key: "a" },
    "the wheel": { kind: "wheel", x: 10, y: 10, dx: 0, dy: 12 },
    "typed text": { kind: "text", layerId: "card", value: "hi" },
    "a layer pulse": { kind: "layerPulse", layerId: "card", prop: "beginEditing" },
    "the phone turning": { kind: "orientation", orientation: "landscape" },
    "device motion": { kind: "deviceMotion", acceleration: [0, 0, -1], rotationRate: [0, 0, 0] },
  };
  for (const [name, event] of Object.entries(INPUTS)) {
    it(`dispatch: ${name}`, () => {
      const { rt, wakes } = rested(tapDoc());
      rt.dispatch([event]);
      expect(rt.resting).toBe(false);
      expect(wakes()).toBe(1);
      rt.step(1 / 60);
      expect(rt.resting).toBe(false);
    });
  }

  it("dispatch with nothing in it doesn't", () => {
    const { rt, wakes } = rested(tapDoc());
    rt.dispatch([]);
    expect(rt.resting).toBe(true);
    expect(wakes()).toBe(0);
  });

  it("updateDocument: a literal edit, a structural edit, and a knob value", () => {
    const base = apply(tapDoc(), [
      { op: "addKnob", knob: { id: "end", name: "End", type: "number", value: 1.5 } },
      { op: "setInput", target: "grow.end", value: { link: "$knob.end" } },
    ]);
    const edits: Op[][] = [
      [{ op: "setInput", target: "@card.opacity", value: 0.5 }],
      [{ op: "addLayer", layer: { id: "chip", type: "oval", name: "Chip", props: {} } }],
      [{ op: "setKnobValue", id: "end", value: 2 }],
    ];
    for (const ops of edits) {
      const { rt, wakes } = rested(base);
      rt.updateDocument(apply(base, ops));
      expect(rt.resting).toBe(false);
      expect(wakes()).toBe(1);
      rt.updateDocument(rt.document);
      expect(wakes()).toBe(1);
    }
  });

  it("setDevice with a new value, and not with the same one", () => {
    const { rt, wakes } = rested(tapDoc());
    rt.setDevice({ darkMode: true });
    expect(rt.resting).toBe(false);
    expect(wakes()).toBe(1);
    runFrames(rt, 4);
    expect(rt.resting).toBe(true);
    rt.setDevice({ darkMode: true });
    expect(rt.resting).toBe(true);
    expect(wakes()).toBe(1);
  });

  it("setLayerOutputs with a new value, and not with the same one", () => {
    const { rt, wakes } = rested(tapDoc());
    rt.setLayerOutputs("card", { naturalSize: [40, 30], loading: false });
    expect(rt.resting).toBe(false);
    expect(wakes()).toBe(1);
    runFrames(rt, 4);
    expect(rt.resting).toBe(true);
    rt.setLayerOutputs("card", { naturalSize: [40, 30] });
    expect(rt.resting).toBe(true);
    rt.setLayerOutputs("card", { naturalSize: [40, 31] });
    expect(rt.resting).toBe(false);
    expect(wakes()).toBe(2);
  });

  it("restart and refreshScene", () => {
    const first = rested(tapDoc());
    first.rt.restart();
    expect(first.rt.resting).toBe(false);
    expect(first.wakes()).toBe(1);
    const second = rested(tapDoc());
    second.rt.refreshScene();
    expect(second.rt.resting).toBe(false);
    expect(second.wakes()).toBe(1);
  });

  it("a patch that restarts the prototype during a step", () => {
    const doc = buildDoc(
      {
        layers: [CARD],
        patches: { touch: { type: "interaction", inputs: { layer: { layer: "card" } } }, again: { type: "restarter", inputs: { go: { link: "touch.tap" } } } },
      },
      registry,
    );
    const { rt } = rested(doc);
    const frames = sequence(tap(50, 50), idle(6));
    const seen: [number, boolean][] = [];
    for (const batch of frames) {
      if (batch.length) rt.dispatch(batch);
      rt.step(1 / 60);
      seen.push([rt.frame, rt.resting]);
    }
    // The release is on the second step; the step after it is frame 0 of the restarted prototype.
    expect(seen.slice(1, 6)).toEqual([[seen[1]![0], false], [0, false], [1, false], [2, true], [3, true]]);
  });

  it("a held pointer keeps it awake, and it rests two steps after the release", () => {
    const rt = createTestRuntime(tapDoc(), registry);
    runFrames(rt, 4);
    rt.dispatch([pointerEvent("down", 300, 300)]);
    for (let i = 0; i < 30; i++) {
      rt.step();
      expect(rt.resting).toBe(false);
    }
    rt.dispatch([pointerEvent("up", 300, 300)]);
    // The release step has input, then two still steps (the press missed the card, so nothing fired).
    expect(restingAfter(rt, 4)).toEqual([false, false, true, true]);
  });
});

describe("rest: what reads the frame before settles first", () => {
  it("a chain of Layer Info readers ends where stepping every frame ends", () => {
    const layers: DocInput["layers"] = [{ id: "l0", type: "rectangle", name: "L0", props: { position: [40, 10], size: [10, 10] } }];
    const patches: NonNullable<DocInput["patches"]> = {};
    for (let i = 1; i <= 5; i++) {
      patches[`info${i}`] = { type: "layerInfo", inputs: { layer: { layer: `l${i - 1}` } } };
      layers.push({ id: `l${i}`, type: "rectangle", name: `L${i}`, props: { position: { link: `info${i}.position` }, size: [10, 10] } });
    }
    const doc = buildDoc({ layers, patches }, registry);
    const every = createTestRuntime(doc, registry);
    runFrames(every, 30);
    const rt = createTestRuntime(doc, registry);
    let steps = 0;
    while (!rt.resting && steps < 30) {
      rt.step();
      steps++;
    }
    expect(steps).toBeLessThan(12);
    expect(steps).toBeGreaterThan(6);
    for (let i = 1; i <= 5; i++) expect(rt.getValue(`@l${i}.position`)).toEqual(every.getValue(`@l${i}.position`));
    expect(rt.getValue("@l5.position")).toEqual([40, 10]);
  });

  it("a pulse reads false, and a velocity reads 0, before it rests", () => {
    const doc = buildDoc(
      {
        layers: [CARD],
        patches: {
          touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
          toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
          level: { type: "transition", typeParam: "number", inputs: { progress: { link: "toggle.on" }, start: 0, end: 5 } },
          edge: { type: "pulseOnChange", inputs: { value: { link: "level.output" } } },
          speed: { type: "velocity", inputs: { value: { link: "level.output" } } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 4);
    expect(rt.resting).toBe(true);
    const rows: unknown[][] = [];
    for (const batch of sequence(tap(50, 50), idle(4))) {
      if (batch.length) rt.dispatch(batch);
      rt.step();
      rows.push([rt.getValue("touch.tap"), rt.getValue("edge.changed"), rt.getValue("speed.velocity"), rt.resting]);
    }
    // The tap lands on the release step: the level jumps, and the pulses and the velocity show it.
    // The step after lets them go, and only then do two still steps count.
    expect(rows).toEqual([
      [false, false, 0, false],
      [true, true, 300, false],
      [false, false, 0, false],
      [false, false, 0, false],
      [false, false, 0, true],
      [false, false, 0, true],
    ]);
  });

  it("a Text layer's size linked into another layer's size", () => {
    const doc = buildDoc(
      {
        layers: [
          { id: "label", type: "text", name: "Label", props: { text: "Hello there", fontSize: 20 } },
          { id: "box", type: "rectangle", name: "Box", props: { size: { link: "@label.textSize" } } },
        ],
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    const seen = restingAfter(rt, 5);
    const box = rt.scene().roots[1]!;
    expect(box.width).toBeGreaterThan(20);
    expect([box.width, box.height]).toEqual(rt.getValue("@label.textSize"));
    // The first step reads the layout made before it, so the size is there from frame 0.
    expect(seen).toEqual([false, false, true, true, true]);
  });
});

describe("rest: layers that move without the engine", () => {
  const SHADER = { id: "fx", type: "shader", name: "Shader", props: { size: [100, 100] } };
  const restsWith = (layers: DocInput["layers"]) => restingOver(buildDoc({ layers }, registry), 6).includes(true);
  /** A document with one media layer showing an asset. */
  const restsWithMedia = (type: "lottie" | "video", prop: string, props: Record<string, InputValue>) => {
    const doc = buildDoc({ layers: [{ id: "media", type, name: "Media", props }] }, registry);
    doc.assets.file = { id: "file", kind: type === "video" ? "video" : "lottie", name: "File", file: "file" };
    if (!(prop in props)) doc.components.main!.layers[0]!.props[prop] = { asset: "file" };
    return restingOver(doc, 6).includes(true);
  };

  it("a drawn shader never rests; a disabled or transparent one does", () => {
    expect(restsWith([SHADER])).toBe(false);
    expect(restsWith([{ ...SHADER, props: { ...SHADER.props, enabled: false } }])).toBe(true);
    expect(restsWith([{ ...SHADER, props: { ...SHADER.props, opacity: 0 } }])).toBe(true);
    expect(restsWith([{ id: "g", type: "group", name: "Group", props: { enabled: false }, children: [SHADER] }])).toBe(true);
    expect(restsWith([{ id: "g", type: "group", name: "Group", props: {}, children: [SHADER] }])).toBe(false);
  });

  it("a hidden shader never rests while a Clone could draw it", () => {
    const hidden = { ...SHADER, props: { ...SHADER.props, enabled: false } };
    expect(restsWith([hidden, { id: "copy", type: "clone", name: "Clone", props: { source: { layer: "fx" } } }])).toBe(false);
  });

  it("a Lottie with Play on never rests, even hidden; with Play off, Scrub on, or no animation it does", () => {
    const lottie = (props: Record<string, InputValue>) => restsWithMedia("lottie", "animation", props);
    expect(lottie({})).toBe(false);
    expect(lottie({ enabled: false })).toBe(false);
    expect(lottie({ playing: false })).toBe(true);
    expect(lottie({ scrub: true })).toBe(true);
    expect(lottie({ animation: null })).toBe(true);
  });

  it("a video with Play on never rests while shown; hidden, with Play off, Scrub on, or no video it does", () => {
    const video = (props: Record<string, InputValue>) => restsWithMedia("video", "video", props);
    expect(video({})).toBe(false);
    expect(video({ enabled: false })).toBe(true);
    expect(video({ playing: false })).toBe(true);
    expect(video({ scrub: true })).toBe(true);
    expect(video({ video: null })).toBe(true);
  });
});

describe("rest: time", () => {
  const doc = () => buildDoc({ layers: [CARD], patches: { c: { type: "clockProbe" } } }, registry);

  it("keeps running while a live prototype rests, and the step after sees one frame of dt", () => {
    const { rt } = rested(doc());
    const before = rt.time;
    clockLog.length = 0;
    rt.dispatch([pointerEvent("move", 5, 5)]);
    rt.step(5);
    expect(rt.time).toBeCloseTo(before + 5, 9);
    expect(clockLog).toEqual([{ dt: 1 / 60, time: rt.time }]);
    // The next frame is an ordinary one again.
    rt.step(5);
    expect(rt.time).toBeCloseTo(before + 5.064, 9);
  });

  it("caps a slow frame at 64 ms when the prototype wasn't at rest", () => {
    const rt = createTestRuntime(doc(), registry, { deterministic: false, platform: {} });
    rt.step(1 / 60);
    rt.step(5);
    expect(rt.time).toBeCloseTo(0.064, 9);
  });

  it("is fixed-step in a deterministic runtime, rested or not", () => {
    const rt = createTestRuntime(doc(), registry);
    runFrames(rt, 4);
    expect(rt.resting).toBe(true);
    rt.step(5);
    expect(rt.time).toBeCloseTo(4 / 60, 9);
  });

  it("a trace of a live runtime that rested replays the gap", () => {
    const { rt } = rested(tapDoc());
    for (const batch of tap(50, 50)) {
      rt.dispatch(batch);
      rt.step(2);
    }
    for (let i = 0; i < 5; i++) rt.step(1 / 60);
    const traced = rt.trace(["pop.output", "toggle.on"], 100);
    const live: unknown[] = [];
    for (let i = 0; i < traced.times.length; i++) {
      rt.step(1 / 60);
      live.push(rt.getValue("pop.output"));
    }
    expect(traced.values["toggle.on"]![0]).toBe(true);
    expect(traced.values["pop.output"]).toEqual(live);
  });
});

describe("rest: a host that rests draws what a host that steps every frame draws", () => {
  it("taps that pop a card, with long waits between them", () => {
    const events = sequence(idle(10), tap(50, 50), idle(200), tap(50, 50, { holdFrames: 3 }), idle(200));
    const run = runRested(tapDoc(), registry, events.length, events, { watch: ["pop.output", "toggle.on", "@card.scale"] });
    expect(run.mismatch).toBeNull();
    expect(run.steps).toBeLessThan(events.length / 2);
    expect(run.steps).toBeGreaterThan(40);
  });

  it("a drag that stops, holds a second and lets go reports no velocity", () => {
    const doc = buildDoc({ layers: [CARD], patches: { g: { type: "gestureProbe", inputs: { layer: { layer: "card" } } } } }, registry);
    const events = sequence(idle(5), drag([30, 30], [90, 30], { frames: 6, release: false }), idle(60), [[pointerEvent("up", 90, 30)]], idle(30));
    const run = runRested(doc, registry, events.length, events, { watch: ["g.velocity", "g.down"] });
    expect(run.mismatch).toBeNull();
    // At rest before the press and after the release, awake for every frame of the hold.
    expect(run.steps).toBeGreaterThan(60);
    expect(run.steps).toBeLessThan(events.length - 20);
  });

  it("an animation that asks for frames", () => {
    const doc = buildDoc({ layers: [{ ...CARD, props: { ...CARD.props, opacity: { link: "n.count" } } }], patches: { n: { type: "countTo", inputs: { frames: 40 } } } }, registry);
    const run = runRested(doc, registry, 120, undefined, { watch: ["n.count"] });
    expect(run.mismatch).toBeNull();
    expect(run.steps).toBe(43);
  });
});
