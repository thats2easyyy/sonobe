import { describe, expect, it } from "vitest";
import { buildDoc, createTestRuntime, type PatchInput } from "../testing/index.ts";

/** Generous CI threshold; the budget target is < 4 ms per frame on a laptop. */
const THRESHOLD_MS = 12;

describe("runtime: performance", () => {
  it("evaluates 500 simple patches within the frame budget", () => {
    const patches: Record<string, PatchInput> = { p0: { type: "splitter", inputs: { value: 1 } } };
    for (let i = 1; i < 500; i++) patches[`p${i}`] = { type: "add", inputs: { value1: { link: `p${i - 1}.output` }, value2: 1 } };
    const rt = createTestRuntime(buildDoc({ patches }));
    for (let i = 0; i < 60; i++) rt.step();
    const frames = 300;
    const start = performance.now();
    for (let i = 0; i < frames; i++) rt.step();
    const msPerFrame = (performance.now() - start) / frames;
    expect(rt.getValue("p499.output")).toBe(500);
    expect(msPerFrame).toBeLessThan(THRESHOLD_MS);
  });
});
