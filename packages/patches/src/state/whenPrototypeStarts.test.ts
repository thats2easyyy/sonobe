import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness } from "../infra/index.ts";
import { whenPrototypeStartsPatch } from "./whenPrototypeStarts.ts";

describe("whenPrototypeStarts", () => {
  it("pulses once on the first frame and again after each restart", () => {
    const h = createPatchHarness(whenPrototypeStartsPatch);
    expect(h.step().pulses.has("started")).toBe(true);
    expect([h.step(), h.step(), h.step()].some((f) => f.pulses.size > 0)).toBe(false);
    h.restart();
    expect(h.step().pulses.has("started")).toBe(true);
    expect(h.step().pulses.has("started")).toBe(false);
  });

  it("never fires while muted", () => {
    const result = runPatch(whenPrototypeStartsPatch, [{}, {}, {}], { muted: true });
    expect(result.frames.flatMap((f) => f.pulses)).toEqual([]);
  });
});
