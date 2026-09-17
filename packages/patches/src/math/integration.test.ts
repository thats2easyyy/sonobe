/** Math patches wired into real runtime documents with mock time and loop patches. */

import { DECELERATION_NORMAL, decayFinalPosition, mulberry32 } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, runFrames, sequenceDefinition } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { loopOf } from "../infra/index.ts";
import { definitions } from "./index.ts";

const registry = createMockRegistry(definitions);

describe("math patches in a runtime", () => {
  it("time → multiply → sine → remap and a formula drive layer props", () => {
    const doc = buildDoc(
      {
        layers: [{ id: "card", type: "rectangle", name: "Card", props: { size: [100, 100], position: { link: "place.output" }, cornerRadius: { link: "corner.output" }, opacity: { link: "fade.output" } } }],
        patches: {
          clock: { type: "time" },
          degrees: { type: "multiply", inputs: { value1: { link: "clock.time" }, value2: 360 } },
          wave: { type: "sine", inputs: { angle: { link: "degrees.output" } } },
          place: { type: "remap", typeParam: "point", inputs: { value: { link: "wave.output" }, fromStart: -1, fromEnd: 1, toStart: [0, 100], toEnd: [200, 300] } },
          corner: { type: "mathExpression", settings: { expression: "r = abs(s) * 8; r + 4" }, inputs: { s: { link: "wave.output" } } },
          fade: { type: "clamp", inputs: { value: { link: "wave.output" }, min: 1, max: 0.2 } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 1);
    expect(rt.getValue("@card.position")).toEqual([100, 200]);
    expect(rt.getValue("@card.cornerRadius")).toBe(4);
    expect(rt.getValue("@card.opacity")).toBe(0.2);

    runFrames(rt, 15);
    expect(rt.getValue("wave.output")).toBe(1);
    expect(rt.getValue("@card.position")).toEqual([200, 300]);
    expect(rt.getValue("corner.r")).toBe(8);
    expect(rt.getValue("@card.cornerRadius")).toBe(12);
    expect(rt.getValue("@card.opacity")).toBe(1);

    runFrames(rt, 15);
    expect(rt.getValue("wave.output")).toBe(0);
    expect(rt.getValue("@card.position")).toEqual([100, 200]);
    expect(rt.issues()).toEqual([]);
  });

  it("random, snap, and a formula evaluate per loop index, reproducibly after restart", () => {
    const doc = buildDoc(
      {
        patches: {
          items: { type: "loop", inputs: { count: 4 } },
          jitter: { type: "random", inputs: { start: { link: "items.index" }, end: 100, wholeNumbers: true } },
          snapped: { type: "snap", inputs: { value: { link: "jitter.value" }, step: 25 } },
          odd: { type: "mathExpression", settings: { expression: "i * 2 + 1" }, inputs: { i: { link: "items.index" } } },
        },
      },
      registry,
    );
    const rng = mulberry32(1);
    const expected = [0, 1, 2, 3].map((i) => i + Math.floor(rng() * (100 - i + 1)));
    const nearest25 = expected.map((v) => Math.sign(v) * Math.floor(Math.abs(v) / 25 + 0.5) * 25);

    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 3);
    expect(rt.getRawValue("jitter.value")).toEqual(loopOf(expected));
    expect(rt.getRawValue("snapped.output")).toEqual(loopOf(nearest25));
    expect(rt.getRawValue("odd.output")).toEqual(loopOf([1, 3, 5, 7]));

    rt.restart();
    runFrames(rt, 1);
    expect(rt.getRawValue("jitter.value")).toEqual(loopOf(expected));
    expect(rt.issues()).toEqual([]);
  });

  it("snap projects a fling with the engine decay, and zero divisors surface as runtime issues", () => {
    const fling = sequenceDefinition("fling", "number", [0, 800]);
    const flingRegistry = createMockRegistry([...definitions, fling]);
    const doc = buildDoc(
      {
        patches: {
          speed: { type: "fling" },
          settle: { type: "snap", inputs: { value: 120, velocity: { link: "speed.value" }, step: 100 } },
          ratio: { type: "divide", inputs: { value1: 10, value2: { link: "settle.index" } } },
        },
      },
      flingRegistry,
    );
    const rt = createTestRuntime(doc, flingRegistry);
    runFrames(rt, 1);
    expect(rt.getValue("settle.output")).toBe(100);
    expect(rt.getValue("ratio.output")).toBe(10);
    runFrames(rt, 1);
    expect(rt.getValue("settle.projected")).toBe(decayFinalPosition(120, 800, DECELERATION_NORMAL));
    expect(rt.getValue("settle.output")).toBe(500);

    const broken = buildDoc(
      {
        patches: {
          source: { type: "multiply", inputs: { value1: 2, value2: 3 } },
          formula: { type: "mathExpression", settings: { expression: "total = price ^ 2; total + 1" }, inputs: { price: { link: "source.output" } } },
          doubled: { type: "multiply", inputs: { value1: { link: "formula.total" }, value2: 2 } },
        },
      },
      registry,
    );
    const brt = createTestRuntime(broken, registry);
    runFrames(brt, 3);
    expect(brt.getValue("formula.total")).toBe(0);
    expect(brt.getValue("formula.output")).toBe(0);
    expect(brt.getValue("doubled.output")).toBe(0);
    expect(brt.issues()).toEqual([expect.objectContaining({ severity: "error", patchId: "formula", message: expect.stringContaining("Use `**` for powers") })]);

    const zero = buildDoc({ patches: { ratio: { type: "divide", inputs: { value1: 10, value2: 0 } } } }, registry);
    const zrt = createTestRuntime(zero, registry);
    runFrames(zrt, 2);
    expect(zrt.getValue("ratio.output")).toBe(0);
    expect(zrt.issues()).toEqual([expect.objectContaining({ severity: "warning", patchId: "ratio", message: expect.stringContaining("Value 2 is 0") })]);
  });
});
