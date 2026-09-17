import { mulberry32 } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { random, randomValue } from "./random.ts";

describe("random", () => {
  it("draws once on the first frame and again on each Randomize pulse", () => {
    const rng = mulberry32(1);
    const draws = [rng(), rng(), rng()];
    const run = runPatch(random, [{ randomize: true }, {}, { randomize: true }, { randomize: true }, {}]);
    expect(run.frames.map((f) => f.outputs.value)).toEqual([draws[0], draws[0], draws[1], draws[2], draws[2]]);
  });

  it("rescales the held draw when the range changes", () => {
    const h = createPatchHarness(random, { inputs: { start: 10, end: 20 } });
    const u = (h.step().outputs.value as number - 10) / 10;
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
    expect(h.step({ inputs: { end: 30 } }).outputs.value).toBeCloseTo(10 + u * 20, 12);
    expect(h.step({ inputs: { start: 30 } }).outputs.value).toBe(30);
  });

  it("covers reversed ranges and inclusive whole numbers", () => {
    expect(randomValue(0.5, 20, 10, false)).toBe(15);
    expect(randomValue(0, 1, 6, true)).toBe(1);
    expect(randomValue(0.999, 1, 6, true)).toBe(6);
    expect(randomValue(0.5, 6, 1, true)).toBe(4);
    expect(randomValue(0.7, 0.2, 0.4, true)).toBe(0);
  });

  it("keeps a draw per loop index and redraws every index on a broadcast pulse", () => {
    const rng = mulberry32(1);
    const draws = Array.from({ length: 6 }, () => rng());
    const run = runPatch(random, [{ start: loopOf([0, 10, 20]), end: loopOf([1, 11, 21]) }, {}, { randomize: true }]);
    expect(run.frames[0]!.outputs.value).toEqual(loopOf([draws[0], 10 + draws[1]!, 20 + draws[2]!]));
    expect(run.frames[1]!.outputs.value).toEqual(run.frames[0]!.outputs.value);
    expect(run.frames[2]!.outputs.value).toEqual(loopOf([draws[3], 10 + draws[4]!, 20 + draws[5]!]));
  });

  it("outputs 0 for a non-finite range, warns once, and draws again after a restart", () => {
    const h = createPatchHarness(random, { inputs: { start: -1.7e308, end: 1.7e308 } });
    expect(h.run(2).outputs.value).toBe(0);
    expect(h.logs).toHaveLength(1);
    h.restart();
    expect(h.state()).toBeUndefined();
    h.step();
    expect(h.state()?.u).not.toBeNull();
    expect(h.logs).toHaveLength(2);
  });
});
