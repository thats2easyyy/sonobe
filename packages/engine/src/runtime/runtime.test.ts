import { applyOps } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { approxEqualMat, compose, multiply } from "../math/matrix.ts";
import {
  buildDoc,
  createMockRegistry,
  createTestRuntime,
  defineMock,
  drag,
  idle,
  port,
  probeDefinition,
  runFrames,
  sequence,
  sequenceDefinition,
  tap,
} from "../testing/index.ts";
import type { InputEvent } from "../types.ts";
import { DETERMINISTIC_EPOCH_MS } from "./runtime.ts";

const down = (x: number, y: number): InputEvent => ({ kind: "pointer", phase: "down", pointerId: 1, x, y });
const up = (x: number, y: number): InputEvent => ({ kind: "pointer", phase: "up", pointerId: 1, x, y });

function tapDoc() {
  return buildDoc({
    layers: [{ id: "card", type: "rectangle", name: "Card", props: { position: [16, 120], size: [358, 220], scale: { link: "grow.output" } } }],
    patches: {
      tap_card: { type: "interaction", inputs: { layer: { layer: "card" } } },
      toggle: { type: "switch", inputs: { flip: { link: "tap_card.tap" } } },
      grow: { type: "transition", typeParam: "number", inputs: { progress: { link: "toggle.on" }, start: 1, end: 1.5 } },
    },
  });
}

describe("runtime: interaction → switch → layer prop", () => {
  it("a tap on the card flips the switch and scales the card about its pivot", () => {
    const rt = createTestRuntime(tapDoc());
    expect(runFrames(rt, 1)[0]!.roots[0]!.props.scale).toBe(1);
    const frames = runFrames(rt, 2, tap(100, 200));
    expect(frames[0]!.roots[0]!.props.scale).toBe(1);
    const card = frames[1]!.roots[0]!;
    expect(card.props.scale).toBe(1.5);
    expect(rt.getValue("tap_card.tap")).toBe(true);
    expect(rt.getValue("@card.scale")).toBe(1.5);
    expect(approxEqualMat(card.transform, compose({ position: [16, 120], size: [358, 220], scale: 1.5 }))).toBe(true);
    rt.step();
    expect(rt.getValue("tap_card.tap")).toBe(false);
    expect(rt.getValue("toggle.on")).toBe(true);
    runFrames(rt, 2, tap(5, 5));
    expect(rt.getValue("toggle.on")).toBe(true);
  });
});

describe("runtime: layout and scene", () => {
  it("lays out containers and emits local and world transforms with pivot math", () => {
    const rt = createTestRuntime(
      buildDoc({
        background: "#102030FF",
        layers: [
          {
            id: "list",
            type: "group",
            name: "List",
            props: { position: [20, 40], size: [300, 400], layout: "column", spacing: 10, padding: [5, 5, 5, 5], clip: true },
            children: [
              { id: "a", type: "rectangle", name: "A", props: { size: [100, 50] } },
              { id: "b", type: "rectangle", name: "B", props: { size: [100, 50], rotation: 90, pivot: [0, 0], opacity: 0.5 } },
              { id: "fill", type: "colorFill", name: "Fill", props: { color: "#FF000080" } },
              { id: "hidden", type: "rectangle", name: "Hidden", props: { enabled: false } },
            ],
          },
          { id: "copy", type: "clone", name: "Copy", props: { source: { layer: "list" }, position: [0, 600] } },
        ],
      }),
    );
    const frame = rt.step();
    expect(frame.size).toEqual([390, 844]);
    expect(frame.background.r).toBeCloseTo(0x10 / 255, 9);
    const list = frame.roots[0]!;
    expect([list.x, list.y, list.width, list.height, list.clip]).toEqual([20, 40, 300, 400, true]);
    expect(list.children.map((c) => c.key)).toEqual(["a", "b", "fill", "hidden"]);
    const [a, b, fill, hidden] = list.children as [typeof list, typeof list, typeof list, typeof list];
    expect([a.x, a.y, b.x, b.y]).toEqual([5, 5, 5, 65]);
    expect(approxEqualMat(b.transform, compose({ position: [5, 65], size: [100, 50], rotationZ: 90, pivot: [0, 0] }))).toBe(true);
    expect(approxEqualMat(b.worldTransform, multiply(list.transform, b.transform))).toBe(true);
    expect(b.opacity).toBe(0.5);
    expect([fill.x, fill.y, fill.width, fill.height]).toEqual([0, 0, 300, 400]);
    expect(hidden.visible).toBe(false);
    expect(frame.roots[1]!.props.source).toEqual({ layerId: "list" });
    expect(rt.hitTest(30, 50).map((h) => h.key)).toEqual(["a", "list"]);
  });

  it("layer info is the previous frame's geometry", () => {
    const widths = sequenceDefinition("widths", "number", [60, 150, 150]);
    const reg = createMockRegistry([widths]);
    const rt = createTestRuntime(
      buildDoc({ layers: [{ id: "box", type: "rectangle", name: "Box", props: { size: { link: "w.value" } } }], patches: { w: { type: "widths" }, info: { type: "layerInfo", inputs: { layer: { layer: "box" } } } } }, reg),
      reg,
    );
    const sizes: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      rt.step();
      sizes.push(rt.getValue("info.size"));
    }
    expect(sizes).toEqual([[100, 100], [60, 60], [150, 150]]);
  });
});

describe("runtime: muting", () => {
  it("muted patches skip evaluation and pass variant inputs to variant outputs, or zero values when declared", () => {
    const doc = buildDoc({
      patches: {
        t: { type: "transition", muted: true, inputs: { progress: 0.25, start: 10, end: 20 } },
        start: { type: "whenPrototypeStarts", muted: true },
        toggle: { type: "switch", muted: true, inputs: { turnOn: { link: "start.started" } } },
      },
    });
    const rt = createTestRuntime(doc);
    runFrames(rt, 2);
    expect(rt.getValue("t.output")).toBe(10);
    expect(rt.getValue("start.started")).toBe(false);
    expect(rt.getValue("toggle.on")).toBe(false);
    const unmuted = applyOps(doc, [{ op: "updatePatch", id: "start", muted: false }], { registry: createMockRegistry() }).doc;
    rt.updateDocument(unmuted);
    rt.step();
    expect(rt.getValue("start.started")).toBe(true);
    rt.step();
    expect(rt.getValue("start.started")).toBe(false);
  });
});

describe("runtime: updateDocument", () => {
  it("keeps state for patches whose id, type and component path are unchanged (springs keep velocity)", () => {
    const target = sequenceDefinition("target", "number", [0, 100]);
    const reg = createMockRegistry([target]);
    const doc = buildDoc({ patches: { t: { type: "target" }, pop: { type: "popAnimation", inputs: { number: { link: "t.value" } } } } }, reg);
    const live = createTestRuntime(doc, reg);
    const reference = createTestRuntime(doc, reg);
    runFrames(live, 10);
    runFrames(reference, 10);
    const edited = applyOps(doc, [{ op: "addPatch", patch: { id: "extra", type: "splitter", inputs: { value: 3 } } }], { registry: reg }).doc;
    live.updateDocument(edited);
    const a: unknown[] = [];
    const b: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      live.step();
      reference.step();
      a.push(live.getValue("pop.output"));
      b.push(reference.getValue("pop.output"));
    }
    expect(a).toEqual(b);
    expect(a[0]).toBeGreaterThan(1);
    expect(live.getValue("extra.output")).toBe(3);
  });

  it("a patch whose type changed starts fresh and the old state is disposed", () => {
    const log: string[] = [];
    const reg = createMockRegistry([probeDefinition(log, "probe"), probeDefinition(log, "probe2")]);
    const doc = buildDoc({ patches: { p: { type: "probe" } } }, reg);
    const rt = createTestRuntime(doc, reg);
    runFrames(rt, 3);
    expect(rt.getValue("p.count")).toBe(3);
    const retyped = structuredClone(doc);
    retyped.components.main!.patches.p!.type = "probe2";
    rt.updateDocument(retyped);
    expect(log).toEqual(["dispose main#0"]);
    rt.step();
    expect(rt.getValue("p.count")).toBe(1);
  });
});

describe("runtime: determinism and restart", () => {
  const doc = () =>
    buildDoc({
      layers: [{ id: "card", type: "rectangle", name: "Card", props: { position: { link: "move.position" }, size: [120, 120], scale: { link: "pop.output" } } }],
      patches: {
        move: { type: "interaction", inputs: { layer: { layer: "card" } } },
        dice: { type: "random", inputs: { randomize: { link: "move.tap" } } },
        pop: { type: "popAnimation", inputs: { number: { link: "dice.value" }, bounciness: 12 } },
      },
    });

  it("identical documents and events produce identical frames", () => {
    const script = sequence(idle(2), drag([50, 50], [200, 300], { frames: 8 }), tap(200, 300), idle(5));
    const run = () => JSON.stringify(runFrames(createTestRuntime(doc(), undefined, { seed: 7 }), script.length, script));
    expect(run()).toBe(run());
  });

  it("services.restart() takes effect before the next step and replays launch", () => {
    const pulses = sequenceDefinition("pulses", "pulse", [false, false, true, false]);
    const reg = createMockRegistry([pulses]);
    const rt = createTestRuntime(
      buildDoc({ patches: { src: { type: "pulses" }, again: { type: "restartPrototype", inputs: { restart: { link: "src.value" } } }, start: { type: "whenPrototypeStarts" }, dice: { type: "random" } } }, reg),
      reg,
    );
    const seen: [number, unknown, unknown][] = [];
    for (let i = 0; i < 5; i++) {
      rt.step();
      seen.push([rt.frame, rt.getValue("start.started"), rt.getValue("dice.value")]);
    }
    expect(seen.map((s) => s[0])).toEqual([0, 1, 2, 0, 1]);
    expect(seen.map((s) => s[1])).toEqual([true, false, false, true, false]);
    expect(seen[3]![2]).toBe(seen[0]![2]);
  });

  it("restart() resets frame, time, state and issues", () => {
    const rt = createTestRuntime(tapDoc());
    runFrames(rt, 3, sequence(idle(1), tap(100, 200)));
    expect(rt.getValue("toggle.on")).toBe(true);
    rt.restart();
    expect([rt.frame, rt.time]).toEqual([-1, 0]);
    rt.step();
    expect(rt.getValue("toggle.on")).toBe(false);
  });
});

describe("runtime: trace", () => {
  it("traces a spring on a clone with summaries and never touches the live runtime", () => {
    const target = sequenceDefinition("target", "number", [0, 1]);
    const reg = createMockRegistry([target]);
    const rt = createTestRuntime(buildDoc({ patches: { t: { type: "target" }, pop: { type: "popAnimation", inputs: { number: { link: "t.value" }, bounciness: 10 } } } }, reg), reg);
    const result = rt.trace(["pop.output", "t.value", "nothing.here"], 2000);
    expect(rt.frame).toBe(-1);
    expect(rt.getValue("pop.output")).toBeUndefined();
    expect(result.times).toHaveLength(121);
    expect(result.times[0]).toBe(0);
    expect(result.times[120]).toBeCloseTo(2, 9);
    const s = result.summaries["pop.output"]!;
    expect(s.start).toBe(0);
    expect(s.end).toBeCloseTo(1, 3);
    expect(s.max).toBeGreaterThan(1.01);
    expect(s.overshoot).toBeCloseTo(s.max - s.end, 9);
    expect(s.settleTime).not.toBeNull();
    expect(s.settleTime!).toBeGreaterThan(0.1);
    expect(s.settleTime!).toBeLessThan(2);
    expect(result.summaries["nothing.here"]).toBeNull();
  });

  it("continues from the live state and dispatches scheduled events", () => {
    const rt = createTestRuntime(tapDoc());
    runFrames(rt, 3, sequence(idle(1), tap(100, 200)));
    expect(rt.getValue("toggle.on")).toBe(true);
    const plain = rt.trace(["toggle.on", "@card.scale"], 100);
    expect(plain.values["toggle.on"]![0]).toBe(true);
    expect(plain.values["@card.scale"]![0]).toBe(1.5);
    expect(plain.times[0]).toBeCloseTo(1 / 60, 9);
    const scheduled = rt.trace(["toggle.on"], 200, [
      { atMs: 50, events: [down(100, 200)] },
      { atMs: 100, events: [up(100, 200)] },
    ]);
    const on = scheduled.values["toggle.on"]!;
    expect(on[0]).toBe(true);
    expect(on[on.length - 1]).toBe(false);
    expect(scheduled.summaries["toggle.on"]).toMatchObject({ start: 1, end: 0 });
    expect(rt.frame).toBe(2);
    expect(rt.getValue("toggle.on")).toBe(true);
  });
});

describe("runtime: services and issues", () => {
  it("log messages reach onLog; warnings become deduplicated issues", () => {
    const noisy = defineMock({
      type: "noisy",
      name: "Noisy",
      inputs: [],
      outputs: [],
      evaluate(ctx) {
        ctx.services.log("log", "hello", ctx.frame);
        ctx.services.log("warn", "careful", { a: 1 });
      },
    });
    const logs: unknown[][] = [];
    const reg = createMockRegistry([noisy]);
    const rt = createTestRuntime(buildDoc({ patches: { n: { type: "noisy" } } }, reg), reg, { onLog: (level, args) => logs.push([level, ...args]) });
    runFrames(rt, 2);
    expect(logs).toEqual([["log", "hello", 0], ["warn", "careful", { a: 1 }], ["log", "hello", 1], ["warn", "careful", { a: 1 }]]);
    expect(rt.issues()).toEqual([{ code: "patch_warning", severity: "warning", message: 'careful {"a":1}', patchId: "n" }]);
  });

  it("device info follows the project device and orientation events; now() and random are deterministic", () => {
    const probe = defineMock({
      type: "deviceProbe",
      name: "Device Probe",
      inputs: [],
      outputs: [port("screen", "size"), port("safeTop", "number"), port("now", "number"), port("dice", "number")],
      evaluate(ctx) {
        const device = ctx.services.device();
        ctx.output("screen", device.screenSize);
        ctx.output("safeTop", device.safeArea[0]);
        ctx.output("now", ctx.services.now());
        ctx.output("dice", ctx.services.random());
      },
    });
    const reg = createMockRegistry([probe]);
    const doc = buildDoc({ device: "iphone-17-pro", patches: { d: { type: "deviceProbe" } } }, reg);
    const rt = createTestRuntime(doc, reg, { seed: 3 });
    rt.step();
    expect(rt.getValue("d.screen")).toEqual([402, 874]);
    expect(rt.getValue("d.safeTop")).toBe(62);
    expect(rt.getValue("d.now")).toBe(DETERMINISTIC_EPOCH_MS);
    rt.dispatch([{ kind: "orientation", orientation: "landscape" }]);
    const frame = rt.step();
    expect(rt.getValue("d.screen")).toEqual([874, 402]);
    expect(frame.size).toEqual([874, 402]);
    expect(rt.getValue("d.safeTop")).toBe(0);
    expect(rt.getValue("d.now")).toBeCloseTo(DETERMINISTIC_EPOCH_MS + 1000 / 60, 6);
    const again = createTestRuntime(doc, reg, { seed: 3 });
    again.step();
    const other = createTestRuntime(doc, reg, { seed: 4 });
    other.step();
    rt.restart();
    rt.step();
    expect(again.getValue("d.dice")).toBe(rt.getValue("d.dice"));
    expect(other.getValue("d.dice")).not.toBe(rt.getValue("d.dice"));
  });

  it("host-reported layer outputs, text field events and text sizes are readable as @layer.key", () => {
    const rt = createTestRuntime(
      buildDoc({
        layers: [
          { id: "img", type: "image", name: "Image", props: {} },
          { id: "field", type: "textField", name: "Field", props: { text: "start" } },
          { id: "label", type: "text", name: "Label", props: { text: "Hello" } },
        ],
        patches: {
          natural: { type: "splitter", typeParam: "size", inputs: { value: { link: "@img.naturalSize" } } },
          typed: { type: "splitter", typeParam: "text", inputs: { value: { link: "@field.value" } } },
          submits: { type: "counter", inputs: { increase: { link: "@field.submitted" } } },
          measured: { type: "splitter", typeParam: "size", inputs: { value: { link: "@label.textSize" } } },
        },
      }),
    );
    rt.step();
    expect(rt.getValue("typed.output")).toBe("start");
    expect((rt.getValue("measured.output") as number[])[0]).toBeGreaterThan(0);
    rt.setLayerOutputs("img", { naturalSize: [640, 480] });
    rt.dispatch([
      { kind: "text", layerId: "field", value: "hi" },
      { kind: "submit", layerId: "field" },
    ]);
    rt.step();
    expect(rt.getValue("natural.output")).toEqual([640, 480]);
    expect(rt.getValue("typed.output")).toBe("hi");
    expect(rt.getValue("submits.count")).toBe(1);
    rt.step();
    expect(rt.getValue("submits.count")).toBe(1);
  });

  it("keyboard input reaches patches", () => {
    const keys = defineMock({
      type: "keys",
      name: "Keys",
      inputs: [],
      outputs: [port("a", "boolean"), port("typed", "text")],
      evaluate(ctx) {
        ctx.output("a", ctx.services.keyboard().pressed.has("a"));
        ctx.output("typed", ctx.services.keyboard().text);
      },
    });
    const reg = createMockRegistry([keys]);
    const rt = createTestRuntime(buildDoc({ patches: { k: { type: "keys" } } }, reg), reg);
    rt.dispatch([{ kind: "key", phase: "down", key: "A" }]);
    rt.step();
    expect([rt.getValue("k.a"), rt.getValue("k.typed")]).toEqual([true, "A"]);
    rt.step();
    expect([rt.getValue("k.a"), rt.getValue("k.typed")]).toEqual([true, ""]);
  });

  it("dispose releases every patch state", () => {
    const log: string[] = [];
    const reg = createMockRegistry([probeDefinition(log)]);
    const rt = createTestRuntime(buildDoc({ patches: { p: { type: "probe" } } }, reg), reg);
    rt.step();
    rt.dispose();
    expect(log).toEqual(["dispose main#0"]);
    expect(rt.step().frame).toBe(0);
  });
});
