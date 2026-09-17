import { describe, expect, it } from "vitest";
import { isLoop, makeLoop } from "../runtime/loop.ts";
import {
  buildDoc,
  createTestRuntime,
  drag,
  idle,
  keyPress,
  mockAdd,
  mockCounter,
  mockLogger,
  mockPopAnimation,
  mockRestartPrototype,
  mockSwitch,
  mockTransition,
  mockWhenPrototypeStarts,
  probeDefinition,
  runFrames,
  runPatch,
  sequence,
  tap,
} from "./index.ts";

describe("runPatch", () => {
  it("runs a definition with held inputs and one-frame pulses", () => {
    const r = runPatch(mockSwitch, [{}, { flip: true }, {}, { turnOn: true, flip: true }, { turnOff: true, turnOn: true }]);
    expect(r.frames.map((f) => f.outputs.on)).toEqual([false, true, true, true, false]);
  });

  it("edge inputs hold like states and fire on rising edges", () => {
    const r = runPatch(mockCounter, [{ increase: true }, {}, { increase: false }, { increase: true }], { edgeInputs: ["increase"] });
    expect(r.frames.map((f) => f.outputs.count)).toEqual([1, 1, 1, 2]);
  });

  it("expands loops per index and reports pulses", () => {
    const sum = runPatch(mockAdd, [{ value1: makeLoop([1, 2, 3]), value2: 10 }, { value1: { loop: [4] } }]);
    const first = sum.frames[0]!.outputs.output;
    expect(isLoop(first) && first.items).toEqual([11, 12, 13]);
    expect(sum.frames[1]!.outputs.output).toBe(14);
    const start = runPatch(mockWhenPrototypeStarts, [{}, {}]);
    expect(start.frames.map((f) => f.pulses)).toEqual([["started"], []]);
  });

  it("applies mute behavior", () => {
    expect(runPatch(mockTransition, [{ progress: 0.5, start: 0, end: 10 }], { muted: true }).frames[0]!.outputs.output).toBe(0.5);
    expect(runPatch(mockSwitch, [{ flip: true }], { muted: true }).frames[0]!.outputs.on).toBe(false);
  });

  it("decodes document literals and variant defaults", () => {
    const r = runPatch(mockTransition, [{ progress: 0.5 }, { end: "#FF0000FF" }], { typeParam: "color" });
    expect(r.frames[0]!.outputs.output).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
    expect(r.frames[1]!.outputs.output).toEqual({ r: 1, g: 0.5, b: 0.5, a: 1 });
  });

  it("collects logs, restart requests and requestNextFrame", () => {
    const pop = runPatch(mockPopAnimation, [{ number: 0 }, { number: 1 }, {}]);
    expect(pop.frames.map((f) => f.requestedNextFrame)).toEqual([false, true, true]);
    expect(runPatch(mockRestartPrototype, [{}, { restart: true }]).restarts).toBe(1);
    const logger = runPatch(mockLogger, [{ value: 1 }, { value: 1 }, { value: 2 }], { id: "log_1" });
    expect(logger.logs).toEqual([
      { level: "log", args: ["log_1", 1] },
      { level: "log", args: ["log_1", 2] },
    ]);
  });

  it("dispose releases states", () => {
    const log: string[] = [];
    const r = runPatch(probeDefinition(log), [{ value: makeLoop([1, 2]) }]);
    expect(r.states).toHaveLength(2);
    r.dispose();
    expect(log).toEqual(["dispose main#0", "dispose main#1"]);
  });
});

describe("buildDoc", () => {
  it("builds components, interfaces, links and connections through applyOps", () => {
    const doc = buildDoc({
      components: [
        {
          id: "c",
          kind: "patchComponent",
          inputs: { x: { type: "number", loopBehavior: "pass" } },
          outputs: { y: { type: "number", link: "m.output" } },
          patches: { m: { type: "multiply", inputs: { a: { link: "$in.x" } } } },
        },
      ],
      layers: [{ id: "card", type: "rectangle", name: "Card", props: { opacity: { link: "a.output" } } }],
      patches: { a: { type: "splitter", inputs: { value: 2 } }, i: { type: "component", component: "c" } },
      connections: [["a.output", "i.x"]],
    });
    expect(doc.components.c!.interface.outputs.y!.link).toBe("m.output");
    expect(doc.components.c!.interface.inputs.x!.loopBehavior).toBe("pass");
    expect(doc.components.main!.patches.i!.inputs.x).toEqual({ link: "a.output" });
    expect(doc.components.main!.layers[0]!.props.opacity).toEqual({ link: "a.output" });
  });

  it("throws with core's errors for invalid wiring", () => {
    expect(() => buildDoc({ patches: { a: { type: "multiply", inputs: { nope: 1 } } } })).toThrow(/unknown_port/);
  });
});

describe("event generators and runFrames", () => {
  it("generates per-frame scripts", () => {
    expect(tap(1, 2).map((f) => f.map((e) => (e.kind === "pointer" ? e.phase : e.kind)))).toEqual([["down"], ["up"]]);
    expect(tap(1, 2, { holdFrames: 3 })).toHaveLength(4);
    expect(drag([0, 0], [10, 0], { frames: 2 }).map((f) => f.map((e) => (e.kind === "pointer" ? [e.phase, e.x] : [])))).toEqual([[["down", 0]], [["move", 5]], [["move", 10]], [["up", 10]]]);
    expect(sequence(idle(2), keyPress("a"))).toHaveLength(4);
  });

  it("runFrames dispatches each frame's events before stepping", () => {
    const rt = createTestRuntime(buildDoc({ patches: { touch: { type: "interaction" } } }));
    const frames = runFrames(rt, 3, { 1: tap(5, 5)[0]! });
    expect(frames.map((f) => f.frame)).toEqual([0, 1, 2]);
    expect(rt.getValue("touch.down")).toBe(true);
  });
});
