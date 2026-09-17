import { fromBouncinessSpeed } from "@sonobe/engine";
import type { Loop } from "@sonobe/engine";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { bouncyConverter } from "./bouncyConverter.ts";

const convert = (inputs: Record<string, unknown>) => createPatchHarness(bouncyConverter, { inputs }).step().outputs;

describe("bouncyConverter", () => {
  it.each([
    [5, 10, 299.6188, 27.0487],
    [0, 10, 299.6188, 34.4496],
    [10, 10, 299.6188, 20.5729],
    [0, 0, 87.21, 5.777],
    [4, 12, 342.1006, 30.487],
  ])("converts bounciness %d, speed %d", (bounciness, speed, tension, friction) => {
    const out = convert({ bounciness, speed });
    expect(out.tension as number).toBeCloseTo(tension, 3);
    expect(out.friction as number).toBeCloseTo(friction, 3);
  });

  it("gives the same spring Pop Animation uses", () => {
    const out = convert({ bounciness: 7.5, speed: 13 });
    const config = fromBouncinessSpeed(7.5, 13);
    expect(out.tension).toBe(config.stiffness);
    expect(out.friction).toBe(config.damping);
  });

  it("treats a negative Speed as 0", () => {
    expect(convert({ bounciness: 5, speed: -3 })).toEqual(convert({ bounciness: 5, speed: 0 }));
  });

  it("stops adding bounce above 42.5, so 85 behaves like 0", () => {
    expect(convert({ bounciness: 85, speed: 10 }).friction as number).toBeCloseTo(convert({ bounciness: 0, speed: 10 }).friction as number, 9);
  });

  it("adds damping for negative Bounciness and always outputs finite values", () => {
    expect(convert({ bounciness: -10, speed: 10 }).friction as number).toBeGreaterThan(convert({ bounciness: 0, speed: 10 }).friction as number);
    const out = convert({ bounciness: Number.NaN, speed: Number.POSITIVE_INFINITY });
    expect(Number.isFinite(out.tension)).toBe(true);
    expect(Number.isFinite(out.friction)).toBe(true);
  });

  it("evaluates loops per index", () => {
    const out = convert({ bounciness: loopOf([0, 5, 10]), speed: 10 });
    expect((out.tension as Loop<number>).items).toHaveLength(3);
  });
});
