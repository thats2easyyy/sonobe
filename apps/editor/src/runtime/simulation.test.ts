import { buildDoc, createMockRegistry, mockRandom } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createSimulation } from "./simulation.ts";

const registry = createMockRegistry();

const springDoc = () =>
  buildDoc(
    {
      patches: {
        toggle: { type: "switch" },
        pop: { type: "popAnimation", inputs: { number: { link: "toggle.on" } } },
        dice: { type: mockRandom.type },
        logger: { type: "logger", inputs: { value: { link: "toggle.on" } } },
      },
    },
    registry,
  );

describe("simulation", () => {
  it("steps by frames or duration and reads values", () => {
    const sim = createSimulation({ registry, document: springDoc() });
    expect(sim.step({ frames: 3 })).toMatchObject({ simId: sim.id, frame: 2, fps: 60, seed: 1 });
    expect(sim.step({ durationMs: 500 }).frame).toBe(32);
    expect(sim.values(["pop.output", "missing.port"]).values).toEqual({ "pop.output": 0, "missing.port": null });
    expect(sim.logs()).toEqual([{ frame: 0, level: "log", message: "logger false" }]);
    sim.dispose();
  });

  it("is deterministic per seed and resets", () => {
    const run = (seed: number) => {
      const sim = createSimulation({ registry, document: springDoc(), seed });
      sim.step({ frames: 5 });
      const v = sim.values(["dice.value"]).values["dice.value"];
      sim.dispose();
      return v;
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));

    const sim = createSimulation({ registry, document: springDoc(), seed: 7 });
    sim.step({ frames: 10 });
    expect(sim.reset({ seed: 9, fps: 120 })).toMatchObject({ frame: -1, seed: 9, fps: 120 });
    sim.dispose();
  });

  it("traces on a clone without advancing", () => {
    const doc = buildDoc({ patches: { pop: { type: "popAnimation", inputs: { number: 1 } } } }, registry);
    const sim = createSimulation({ registry, document: doc });
    const trace = sim.trace(["pop.output"], 1000);
    expect(trace.times.length).toBe(61);
    expect(trace.summaries["pop.output"]).toMatchObject({ start: 1, end: 1 });
    expect(sim.snapshot().frame).toBe(-1);
    sim.dispose();
  });
});
