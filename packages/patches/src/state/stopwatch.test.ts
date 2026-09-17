import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { stopwatchPatch } from "./stopwatch.ts";

const DT = 0.25;

describe("stopwatch", () => {
  it("starts stopped at 0 and accrues from the frame after Start", () => {
    const h = createPatchHarness(stopwatchPatch);
    expect(h.step({ dt: 0 }).outputs).toEqual({ time: 0, running: false });
    const start = h.step({ dt: DT, pulses: ["start"] });
    expect(start.outputs).toEqual({ time: 0, running: true });
    expect(start.requestedNextFrame).toBe(true);
    expect(h.step({ dt: DT }).outputs.time).toBe(0.25);
    expect(h.step({ dt: DT }).outputs.time).toBe(0.5);
  });

  it("counts the Stop frame, holds while stopped, and resumes on Start", () => {
    const h = createPatchHarness(stopwatchPatch);
    h.step({ dt: 0, pulses: ["start"] });
    h.step({ dt: DT });
    const stop = h.step({ dt: DT, pulses: ["stop"] });
    expect(stop.outputs).toEqual({ time: 0.5, running: false });
    expect(stop.requestedNextFrame).toBe(false);
    expect(h.run(4, { dt: DT }).outputs.time).toBe(0.5);
    h.step({ dt: DT, pulses: ["start"] });
    expect(h.step({ dt: DT }).outputs.time).toBe(0.75);
  });

  it("lets Stop beat Start, and Reset zero the time without starting or stopping", () => {
    const h = createPatchHarness(stopwatchPatch);
    expect(h.step({ dt: 0, pulses: ["start", "stop"] }).outputs.running).toBe(false);
    h.step({ dt: DT, pulses: ["start"] });
    h.run(3, { dt: DT });
    expect(h.step({ dt: DT, pulses: ["reset"] }).outputs).toEqual({ time: 0, running: true });
    expect(h.step({ dt: DT }).outputs.time).toBe(0.25);
    expect(h.step({ dt: DT, pulses: ["reset", "stop"] }).outputs).toEqual({ time: 0, running: false });
    expect(h.step({ dt: DT, pulses: ["reset"] }).outputs).toEqual({ time: 0, running: false });
  });

  it("begins again from 0 on Reset plus Start after a pause", () => {
    const h = createPatchHarness(stopwatchPatch);
    h.step({ dt: 0, pulses: ["start"] });
    h.step({ dt: DT, pulses: ["stop"] });
    expect(h.step({ dt: DT, pulses: ["reset", "start"] }).outputs).toEqual({ time: 0, running: true });
    expect(h.step({ dt: DT }).outputs.time).toBe(0.25);
  });

  it("keeps a stopwatch per loop index", () => {
    const h = createPatchHarness(stopwatchPatch, { inputs: { start: loopOf([true, false]) } });
    h.step({ dt: 0 });
    expect(h.step({ dt: DT }).outputs.time).toEqual(loopOf([0.25, 0]));
    expect(h.output("running")).toEqual(loopOf([true, false]));
  });

  it("returns to stopped at 0 on restart", () => {
    const h = createPatchHarness(stopwatchPatch);
    h.step({ dt: 0, pulses: ["start"] });
    h.step({ dt: DT });
    h.restart();
    expect(h.step({ dt: DT }).outputs).toEqual({ time: 0, running: false });
  });
});
