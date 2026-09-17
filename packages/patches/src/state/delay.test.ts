import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import type { HarnessFrame, PatchHarness } from "../infra/index.ts";
import { DELAY_QUEUE_LIMIT, delayPatch } from "./delay.ts";

/** Step once per entry (inputs held until changed) and collect Output. */
function outputs(h: PatchHarness, script: readonly (Record<string, unknown> | undefined)[]): unknown[] {
  return script.map((inputs) => h.step(inputs ? { inputs } : {}).outputs.output);
}

const repeat = <T>(n: number, value: T): T[] => Array.from({ length: n }, () => value);

describe("delay", () => {
  it("starts at the first input value with nothing queued", () => {
    const h = createPatchHarness(delayPatch, { inputs: { value: 5 } });
    const frame = h.step();
    expect(frame.outputs.output).toBe(5);
    expect(frame.requestedNextFrame).toBe(false);
  });

  it("releases a change exactly Duration later (30 frames at 60 fps for 0.5 s)", () => {
    const h = createPatchHarness(delayPatch, { inputs: { value: 5 } });
    h.step();
    const changed = h.step({ inputs: { value: 10 } });
    expect(changed.outputs.output).toBe(5);
    expect(changed.requestedNextFrame).toBe(true);
    const frames: HarnessFrame[] = [];
    for (let i = 0; i < 30; i++) frames.push(h.step());
    expect(frames[28]!.outputs.output).toBe(5);
    expect(frames[29]!.outputs.output).toBe(10);
    expect(frames[29]!.frame).toBe(31);
    expect(h.step().requestedNextFrame).toBe(false);
  });

  it("gives the same timing at 120 fps", () => {
    const h = createPatchHarness(delayPatch, { fps: 120, inputs: { value: 0 } });
    h.step();
    h.step({ inputs: { value: 1 } });
    const out = outputs(h, repeat(60, undefined));
    expect(out.indexOf(1)).toBe(59);
  });

  it("replays quick changes in order", () => {
    const h = createPatchHarness(delayPatch, { typeParam: "boolean", inputs: { value: false, duration: 0.1 } });
    h.step();
    const out = outputs(h, [{ value: true }, { value: false }, { value: true }, ...repeat(8, undefined)]);
    // Changes on frames 1, 2, 3 replay on frames 7, 8, 9.
    expect(out).toEqual([false, false, false, false, false, false, true, false, true, true, true]);
  });

  it("When Increasing delays rises, and a fall passes through and cancels a waiting rise", () => {
    const h = createPatchHarness(delayPatch, { typeParam: "boolean", inputs: { value: false, duration: 0.1, style: "whenIncreasing" } });
    h.step();
    const quick = outputs(h, [{ value: true }, undefined, { value: false }, ...repeat(10, undefined)]);
    expect(quick.every((v) => v === false)).toBe(true);
    const held = outputs(h, [{ value: true }, ...repeat(6, undefined), { value: false }]);
    expect(held).toEqual([false, false, false, false, false, false, true, false]);
  });

  it("When Decreasing passes rises through and stretches a one-frame blip into Duration", () => {
    const h = createPatchHarness(delayPatch, { typeParam: "boolean", inputs: { value: false, duration: 0.1, style: "whenDecreasing" } });
    h.step();
    const out = outputs(h, [{ value: true }, { value: false }, ...repeat(3, undefined), { value: true }, { value: false }, ...repeat(7, undefined)]);
    // The second pulse (frame 6) cancels the waiting fall; its own fall (frame 7) lands 6 frames later.
    expect(out).toEqual([true, true, true, true, true, true, true, true, true, true, true, true, false, false]);
  });

  it("orders numbers for the directional styles", () => {
    const h = createPatchHarness(delayPatch, { inputs: { value: 1, duration: 0.05, style: "whenDecreasing" } });
    h.step();
    expect(h.step({ inputs: { value: 3 } }).outputs.output).toBe(3);
    expect(outputs(h, [{ value: 2 }, undefined, undefined, undefined])).toEqual([3, 3, 3, 2]);
  });

  it("treats every style as Always for types without an order", () => {
    const h = createPatchHarness(delayPatch, { typeParam: "text", inputs: { value: "a", duration: 0.05, style: "whenIncreasing" } });
    h.step();
    expect(outputs(h, [{ value: "b" }, undefined, undefined, undefined])).toEqual(["a", "a", "a", "b"]);
    const color = createPatchHarness(delayPatch, { typeParam: "color", inputs: { value: "#000000FF", duration: 0.05, style: "whenDecreasing" } });
    color.step();
    color.step({ inputs: { value: "#FFFFFFFF" } });
    expect(color.step().outputs.output).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("passes changes straight through with Duration 0 or less and clears the queue", () => {
    const h = createPatchHarness(delayPatch, { inputs: { value: 0, duration: 1 } });
    h.step();
    h.step({ inputs: { value: 1 } });
    expect(h.step({ inputs: { value: 2, duration: 0 } }).outputs.output).toBe(2);
    expect(h.run(90).outputs.output).toBe(2);
    expect(h.step({ inputs: { value: 3, duration: -2 } }).outputs.output).toBe(3);
    expect(h.logs).toEqual([]);
  });

  it("counts a non-finite Duration as 0 and warns once per restart", () => {
    const h = createPatchHarness(delayPatch, { inputs: { value: 0, duration: Number.NaN } });
    h.step();
    expect(h.step({ inputs: { value: 4 } }).outputs.output).toBe(4);
    h.step({ inputs: { duration: Number.POSITIVE_INFINITY } });
    expect(h.logs.map((l) => l.level)).toEqual(["warn"]);
    h.restart();
    h.step();
    expect(h.logs).toHaveLength(2);
  });

  it("counts a non-finite number as 0 with a warning", () => {
    const h = createPatchHarness(delayPatch, { inputs: { value: Number.NaN, duration: 0 } });
    expect(h.step().outputs.output).toBe(0);
    expect(h.logs).toHaveLength(1);
  });

  it("keeps each queued change's due time when Duration changes", () => {
    const h = createPatchHarness(delayPatch, { inputs: { value: 0, duration: 0.1 } });
    h.step();
    h.step({ inputs: { value: 1 } });
    h.step({ inputs: { value: 2, duration: 0.02 } });
    // The newer entry is due first (frame 4) but never overtakes the older one; both release on frame 7.
    const out = outputs(h, repeat(6, undefined));
    expect(out).toEqual([0, 0, 0, 0, 2, 2]);
  });

  it("staggers loop items with a loop of durations", () => {
    const h = createPatchHarness(delayPatch, { typeParam: "boolean", inputs: { value: false, duration: loopOf([0, 0.05, 0.1]) } });
    h.step();
    const frames = [h.step({ inputs: { value: true } }), ...Array.from({ length: 6 }, () => h.step())];
    const out = frames.map((f) => (f.outputs.output as { items: boolean[] }).items);
    expect(out[0]).toEqual([true, false, false]);
    expect(out[2]).toEqual([true, false, false]);
    expect(out[3]).toEqual([true, true, false]);
    expect(out[6]).toEqual([true, true, true]);
  });

  it("releases the oldest change early past the queue limit, with one warning", () => {
    const h = createPatchHarness(delayPatch, { inputs: { value: 0, duration: 1000 } });
    h.step();
    for (let i = 1; i <= DELAY_QUEUE_LIMIT; i++) h.step({ inputs: { value: i } });
    expect(h.output("output")).toBe(0);
    expect(h.step({ inputs: { value: -1 } }).outputs.output).toBe(1);
    expect(h.step({ inputs: { value: -2 } }).outputs.output).toBe(2);
    expect(h.logs).toHaveLength(1);
    expect(h.state()!.queue.length - h.state()!.head).toBe(DELAY_QUEUE_LIMIT);
  });

  it("seeds again after a restart", () => {
    const h = createPatchHarness(delayPatch, { inputs: { value: 1 } });
    h.step();
    h.step({ inputs: { value: 2 } });
    h.restart();
    expect(h.step().outputs.output).toBe(2);
  });
});
