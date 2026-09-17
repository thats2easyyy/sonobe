import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, sequenceDefinition, type PatchInput } from "../testing/index.ts";
import type { PatchDefinition } from "../types.ts";

function run(defs: PatchDefinition[], patches: Record<string, PatchInput>, frames: number, addresses: string[]): unknown[][] {
  const reg = createMockRegistry(defs);
  const rt = createTestRuntime(buildDoc({ patches }, reg), reg);
  const out: unknown[][] = [];
  for (let i = 0; i < frames; i++) {
    rt.step();
    out.push(addresses.map((a) => rt.getValue(a)));
  }
  return out;
}

const column = (rows: unknown[][], i = 0) => rows.map((r) => r[i]);

describe("pulses", () => {
  it("a boolean state wired into a pulse port fires on each rising edge", () => {
    const state = sequenceDefinition("state", "boolean", [false, true, true, false, true, true]);
    const rows = run([state], { src: { type: "state" }, count: { type: "counter", inputs: { increase: { link: "src.value" } } } }, 6, ["count.count"]);
    expect(column(rows)).toEqual([0, 1, 1, 1, 2, 2]);
  });

  it("upstream pulses on consecutive frames each count", () => {
    const pulses = sequenceDefinition("pulses", "pulse", [true, true, true, false, true]);
    const rows = run([pulses], { src: { type: "pulses" }, count: { type: "counter", inputs: { increase: { link: "src.value" } } } }, 5, ["count.count"]);
    expect(column(rows)).toEqual([1, 2, 3, 3, 4]);
  });

  it("pulse outputs are true for exactly one frame", () => {
    const pulses = sequenceDefinition("pulses", "pulse", [false, true, false, false, true, false]);
    const rows = run([pulses], { src: { type: "pulses" }, toggle: { type: "switch", inputs: { flip: { link: "src.value" } } } }, 6, ["src.value", "toggle.on"]);
    expect(column(rows, 0)).toEqual([false, true, false, false, true, false]);
    expect(column(rows, 1)).toEqual([false, true, true, true, false, false]);
  });

  it("same-frame precedence is the patch's own rule (switch: turnOff > turnOn > flip)", () => {
    const pulses = sequenceDefinition("pulses", "pulse", [true, true]);
    const rows = run([pulses], { src: { type: "pulses" }, toggle: { type: "switch", inputs: { flip: { link: "src.value" }, turnOff: { link: "src.value" } } } }, 2, ["toggle.on"]);
    expect(column(rows)).toEqual([false, false]);
  });

  it("a state that is already on at launch fires once on frame 0", () => {
    const state = sequenceDefinition("state", "boolean", [true, true, true]);
    const rows = run([state], { src: { type: "state" }, count: { type: "counter", inputs: { increase: { link: "src.value" } } } }, 3, ["count.count"]);
    expect(column(rows)).toEqual([1, 1, 1]);
  });
});

describe("frame 0 seeding (gap-fill R1)", () => {
  it("previous-frame patches see the authored value on frame 0: no spikes, no false pulses", () => {
    const value = sequenceDefinition("value", "number", [100, 100, 110, 110]);
    const rows = run(
      [value],
      {
        src: { type: "value" },
        speed: { type: "velocity", inputs: { value: { link: "src.value" } } },
        change: { type: "pulseOnChange", inputs: { value: { link: "src.value" } } },
        start: { type: "whenPrototypeStarts" },
      },
      4,
      ["speed.velocity", "change.changed", "start.started"],
    );
    expect(column(rows, 0)[0]).toBe(0);
    expect(column(rows, 0)[1]).toBe(0);
    expect(column(rows, 0)[2]).toBeCloseTo(600, 6);
    expect(column(rows, 0)[3]).toBe(0);
    expect(column(rows, 1)).toEqual([false, false, true, false]);
    expect(column(rows, 2)).toEqual([true, false, false, false]);
  });

  it("literal inputs are authored values on frame 0", () => {
    const rows = run([], { m: { type: "multiply", inputs: { a: 6, b: 7 } } }, 1, ["m.output"]);
    expect(rows).toEqual([[42]]);
  });
});
