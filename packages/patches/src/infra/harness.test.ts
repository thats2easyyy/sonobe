import type { PatchDefinition } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { HARNESS_EPOCH_MS, createPatchHarness } from "./harness.ts";
import { loopOf } from "./loops.ts";

const doubler: PatchDefinition = {
  type: "doubler",
  name: "Doubler",
  category: "math",
  summary: "Doubles a number.",
  inputs: [{ key: "value", name: "Value", type: "number", default: 2, description: "In." }],
  outputs: [{ key: "output", name: "Output", type: "number", description: "Out." }],
  evaluate(ctx) {
    ctx.output("output", ctx.input<number>("value") * 2);
  },
};

const toggle: PatchDefinition<{ on: boolean }> = {
  type: "toggle",
  name: "Toggle",
  category: "state",
  summary: "Flips on pulses.",
  inputs: [{ key: "flip", name: "Flip", type: "pulse", description: "Pulse to flip." }],
  outputs: [
    { key: "on", name: "On", type: "boolean", description: "On." },
    { key: "turnedOn", name: "Turned On", type: "pulse", description: "Pulses when it turns on." },
  ],
  state: () => ({ on: false }),
  evaluate(ctx) {
    if (ctx.pulsed("flip")) {
      ctx.state.on = !ctx.state.on;
      if (ctx.state.on) ctx.pulse("turnedOn");
    }
    ctx.output("on", ctx.state.on);
  },
};

describe("createPatchHarness", () => {
  it("uses declared defaults and coerces held inputs", () => {
    const h = createPatchHarness(doubler);
    expect(h.step().outputs.output).toBe(4);
    h.set({ value: "3" });
    expect(h.step().outputs.output).toBe(6);
    expect(h.step({ inputs: { value: true } }).outputs.output).toBe(2);
    h.disconnect("value");
    h.step();
    expect(h.output("output")).toBe(4);
  });

  it("fires pulse inputs on pulses and on rising booleans", () => {
    const h = createPatchHarness(toggle);
    expect(h.step({ pulses: ["flip"] }).outputs.on).toBe(true);
    expect(h.pulsed("turnedOn")).toBe(true);
    expect(h.step().outputs.on).toBe(true);
    expect(h.pulsed("turnedOn")).toBe(false);
    h.step({ pulses: ["flip"] });
    expect(h.step({ pulses: ["flip"] }).outputs.on).toBe(true);

    const held = createPatchHarness(toggle);
    held.set({ flip: true });
    expect(held.step().outputs.on).toBe(true);
    expect(held.step().outputs.on).toBe(true);
    held.set({ flip: false });
    held.step();
    held.set({ flip: 1 });
    expect(held.step().outputs.on).toBe(false);
  });

  it("evaluates loops per index with per-index state", () => {
    const disposed: number[] = [];
    const counter: PatchDefinition<{ n: number }> = {
      ...doubler,
      state: () => ({ n: 0 }),
      evaluate(ctx) {
        ctx.state.n += ctx.input<number>("value");
        ctx.output("output", ctx.state.n);
        if (ctx.loopIndex === 1) ctx.pulse("tick");
      },
      dispose: (state) => disposed.push(state.n),
    };
    const h = createPatchHarness(counter, { inputs: { value: loopOf([1, 2, 3]) } });
    const first = h.step();
    expect(first.loopCount).toBe(3);
    expect(first.outputs.output).toEqual(loopOf([1, 2, 3]));
    expect(first.pulseItems.tick).toEqual([false, true, false]);
    expect(h.step().outputs.output).toEqual(loopOf([2, 4, 6]));
    expect(h.step({ inputs: { value: loopOf([1, 1]) } }).outputs.output).toEqual(loopOf([3, 5]));
    expect(disposed).toEqual([6]);
    expect(h.state(2)).toBeUndefined();
    expect(h.step({ inputs: { value: loopOf([]) } }).outputs.output).toEqual(loopOf([]));

    const broadcast = createPatchHarness(doubler, { inputs: { value: loopOf([1, 2]) } });
    expect(broadcast.step().outputs.output).toEqual(loopOf([2, 4]));
  });

  it("evaluates once with whole loops", () => {
    const reverse: PatchDefinition = {
      type: "reverse",
      name: "Reverse",
      category: "loops",
      summary: "Reverses a loop.",
      inputs: [
        { key: "loop", name: "Loop", type: "number", default: { loop: [] }, wholeLoop: true, description: "Items." },
        { key: "offset", name: "Offset", type: "number", default: 0, description: "Added to each item." },
      ],
      outputs: [{ key: "loop", name: "Loop", type: "number", wholeLoop: true, description: "Reversed." }],
      evaluate(ctx) {
        const offset = ctx.input<number>("offset");
        ctx.output("loop", [...ctx.inputItems<number>("loop")].reverse().map((n) => n + offset));
      },
    };
    const h = createPatchHarness(reverse);
    expect(h.step().outputs.loop).toEqual(loopOf([]));
    const frame = h.step({ inputs: { loop: loopOf([1, "2", 3]), offset: loopOf([10, 20]) } });
    expect(frame.loopCount).toBeUndefined();
    expect(frame.outputs.loop).toEqual(loopOf([13, 12, 11]));
    expect(h.step({ inputs: { loop: 5, offset: 0 } }).outputs.loop).toEqual(loopOf([5]));
  });

  it("reports changes, time, services, and restarts", () => {
    const seen: { changed: boolean; time: number; frame: number; random: number }[] = [];
    const probe: PatchDefinition<{ runs: number }> = {
      ...doubler,
      state: () => ({ runs: 0 }),
      evaluate(ctx) {
        ctx.state.runs++;
        seen.push({ changed: ctx.changed("value"), time: ctx.time, frame: ctx.frame, random: ctx.services.random() });
        if (ctx.frame === 2) ctx.services.log("warn", "frame", 2);
        if (ctx.frame === 3) ctx.services.restart();
        ctx.requestNextFrame();
      },
    };
    const h = createPatchHarness(probe, { fps: 120, seed: 42 });
    h.step();
    h.step();
    h.step({ inputs: { value: 5 } });
    const last = h.step({ dt: 0.5 });
    expect(seen.map((s) => s.changed)).toEqual([false, false, true, false]);
    expect(seen.map((s) => s.frame)).toEqual([0, 1, 2, 3]);
    expect(seen[1]!.time).toBeCloseTo(1 / 120, 12);
    expect(last.time).toBeCloseTo(2 / 120 + 0.5, 12);
    expect(last.requestedNextFrame).toBe(true);
    expect(last.restartRequested).toBe(true);
    expect(h.logs).toEqual([{ level: "warn", message: "frame 2", args: ["frame", 2] }]);
    expect(h.services.now()).toBe(HARNESS_EPOCH_MS + last.time * 1000);
    expect(h.state()!.runs).toBe(4);

    const again = createPatchHarness(probe, { seed: 42 });
    again.step();
    expect(seen[4]!.random).toBe(seen[0]!.random);

    h.restart();
    expect(h.frame).toBe(0);
    expect(h.state()).toBeUndefined();
    h.step();
    expect(h.state()!.runs).toBe(1);
    expect(seen.at(-1)!.changed).toBe(false);
  });

  it("resolves variant ports and connections", () => {
    const variant: PatchDefinition = {
      type: "hold",
      name: "Hold",
      category: "utility",
      summary: "Passes a value through.",
      variants: ["number", "point", "color"],
      variantDefaults: { color: { value: "#FFFFFFFF" } },
      inputs: [{ key: "value", name: "Value", type: "variant", default: 1, description: "In." }],
      outputs: [{ key: "output", name: "Output", type: "variant", description: "Out." }],
      evaluate(ctx) {
        ctx.output("output", ctx.input("value"));
        ctx.output("connected", ctx.isConnected("value"));
      },
    };
    expect(createPatchHarness(variant).step().outputs.output).toBe(1);
    expect(createPatchHarness(variant, { typeParam: "color" }).step().outputs.output).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    const point = createPatchHarness(variant, { typeParam: "point", inputs: { value: 3 } });
    expect(point.step().outputs).toEqual({ output: [3, 3], connected: true });
    expect(createPatchHarness(variant, { inputs: { value: 3 }, connected: [] }).step().outputs.connected).toBe(false);
  });

  it("applies the definition's muted behavior", () => {
    const passthrough: PatchDefinition = {
      type: "tint",
      name: "Tint",
      category: "color",
      summary: "Tints a value.",
      variants: ["number", "color"],
      inputs: [
        { key: "amount", name: "Amount", type: "number", default: 0.5, description: "How much." },
        { key: "value", name: "Value", type: "variant", default: 2, description: "In." },
      ],
      outputs: [
        { key: "output", name: "Output", type: "variant", description: "Out." },
        { key: "strength", name: "Strength", type: "number", description: "Amount used." },
        { key: "changed", name: "Changed", type: "pulse", description: "Pulses." },
      ],
      evaluate(ctx) {
        ctx.output("output", ctx.muted ? "muted" : 99);
        ctx.output("strength", 7);
        ctx.pulse("changed");
      },
    };
    expect(createPatchHarness(passthrough, { muted: true, inputs: { value: 4 } }).step()).toMatchObject({ outputs: { output: 4, strength: 0.5 }, pulses: new Set() });
    expect(createPatchHarness({ ...passthrough, mutedBehavior: "zero" }, { muted: true, typeParam: "color" }).step().outputs).toEqual({ output: { r: 0, g: 0, b: 0, a: 0 }, strength: 0 });
    const evaluated = createPatchHarness({ ...passthrough, mutedBehavior: "evaluate" }, { muted: true }).step();
    expect(evaluated.outputs.output).toBe("muted");
    expect(evaluated.pulses.has("changed")).toBe(true);
  });

  it("reports pulse sources, feedback reads, issues, once-warnings, and restarts", () => {
    const seen: { source: boolean; feedback: boolean; pulsed: boolean; restarts: number }[] = [];
    const probe: PatchDefinition = {
      ...doubler,
      evaluate(ctx) {
        seen.push({ source: ctx.isPulseSource("value"), feedback: ctx.isFeedback("value"), pulsed: ctx.pulsed("value"), restarts: ctx.services.restartCount });
        ctx.warnOnce("k", "once per restart");
        ctx.services.issue("probe_issue", "warning", "raised");
        ctx.services.issue("probe_issue", "warning", "raised");
        ctx.output("output", ctx.input("value"));
      },
    };
    const h = createPatchHarness(probe, { feedback: ["value"] });
    expect(h.step({ pulses: ["value"] }).outputs.output).toBe(1);
    expect(h.step().outputs.output).toBe(2);
    expect(seen.slice(0, 2)).toEqual([
      { source: true, feedback: true, pulsed: true, restarts: 0 },
      { source: true, feedback: true, pulsed: false, restarts: 0 },
    ]);
    expect(h.logs.map((l) => l.message)).toEqual(["once per restart"]);
    expect(h.issues).toEqual([{ code: "probe_issue", severity: "warning", message: "raised" }]);
    h.restart();
    h.step();
    expect(seen.at(-1)!.restarts).toBe(1);
    expect(h.logs).toHaveLength(2);
    expect(h.issues).toHaveLength(1);

    const held = createPatchHarness(probe, { inputs: { value: 1 }, pulseSources: ["value"] });
    held.run(2);
    expect(seen.slice(-2).map((s) => s.pulsed)).toEqual([true, true]);
    expect(createPatchHarness(doubler).services).toMatchObject({ deterministic: true, restartCount: 0 });
    expect(createPatchHarness(doubler).services.device().timeZone).toBe("UTC");
  });

  it("resolves dynamic ports, variadic start indexes, and inputCountRange counts like the runtime", () => {
    const counts: number[] = [];
    const stops: PatchDefinition = {
      type: "stops",
      name: "Stops",
      category: "animation",
      summary: "Repeats stop groups.",
      inputCountRange: { min: 1, max: 4, defaultCount: 2 },
      inputs: [],
      outputs: [{ key: "sum", name: "Sum", type: "number", description: "Sum of the stops." }],
      dynamicPorts: (node) => ({
        inputs: Array.from({ length: Math.min(4, Math.max(1, node.inputCount ?? 2)) }, (_, i) => ({ key: `stop${i + 1}`, name: `Stop ${i + 1}`, type: "number" as const, default: i + 1, description: "A stop." })),
        outputs: [],
      }),
      evaluate(ctx) {
        counts.push(ctx.inputCount);
        let sum = 0;
        for (let i = 1; i <= ctx.inputCount; i++) sum += ctx.input<number>(`stop${i}`);
        ctx.output("sum", sum);
      },
    };
    expect(createPatchHarness(stops).step().outputs.sum).toBe(3);
    const h = createPatchHarness(stops, { inputCount: 9 });
    expect(h.ports.inputs.map((p) => p.key)).toEqual(["stop1", "stop2", "stop3", "stop4"]);
    expect(h.step({ inputs: { stop4: 10 } }).outputs.sum).toBe(16);
    expect(counts).toEqual([2, 4]);

    const options: PatchDefinition = {
      type: "picker",
      name: "Picker",
      category: "state",
      summary: "Picks.",
      inputs: [{ key: "option", name: "Option", type: "index", default: 0, description: "Which." }],
      outputs: [],
      variadic: { key: "choice", name: "Choice", type: "number", default: 5, min: 2, max: 8, defaultCount: 3, startIndex: 0, direction: "outputs", description: "One choice." },
      evaluate() {},
    };
    const picker = createPatchHarness(options);
    expect(picker.ports.inputs.map((p) => p.key)).toEqual(["option"]);
    expect(picker.ports.outputs.map((p) => p.key)).toEqual(["choice0", "choice1", "choice2"]);
  });
});
