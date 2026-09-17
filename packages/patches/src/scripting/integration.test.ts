import { applyOps } from "@sonobe/core";
import type { Op, SonobeDocument } from "@sonobe/core";
import { createSpringState, fromBouncinessSpeed, isLoop, makeLoop, stepSpring } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, runFrames, sequenceDefinition, tap } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { component } from "../components/component.ts";
import { javascript } from "./javascript.ts";

const items = (value: unknown) => (isLoop(value) ? value.items : value);

function build(ops: Op[], definitions = [javascript, component], base?: Parameters<typeof buildDoc>[0]): SonobeDocument {
  const registry = createMockRegistry(definitions);
  const doc = buildDoc(base ?? {}, registry);
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  return result.doc;
}

const toggleScript = `export const inputs = [{ key: "tap", type: "pulse" }];
export const outputs = [{ key: "target", type: "number", default: 1 }, { key: "on", type: "boolean" }];
let on = false;
export function evaluate(patch) {
  if (patch.pulsed("tap")) on = !on;
  patch.output("on", on);
  patch.output("target", on ? 1.5 : 1);
}`;

describe("scripting in a prototype", () => {
  it("interaction → javascript → pop animation drives @card.scale to settle like the engine spring", () => {
    const doc = build(
      [
        { op: "setScript", file: "toggle.js", source: toggleScript },
        { op: "addPatch", patch: { id: "toggle", type: "javascript", settings: { script: "toggle.js" } } },
        { op: "connect", from: "touch.tap", to: "toggle.tap" },
        { op: "connect", from: "toggle.target", to: "pop.number" },
      ],
      [javascript, component],
      {
        layers: [{ id: "card", type: "rectangle", name: "Card", props: { position: [0, 0], size: [200, 200], scale: { link: "pop.output" } } }],
        patches: { touch: { type: "interaction", inputs: { layer: { layer: "card" } } }, pop: { type: "popAnimation", inputs: { number: 1 } } },
      },
    );
    const rt = createTestRuntime(doc, [javascript, component]);
    const events = [[], ...tap(100, 100)];
    const scales: number[] = [];
    for (let frame = 0; frame < 153; frame++) {
      runFrames(rt, 1, [events[frame]]);
      scales.push(rt.getValue("@card.scale") as number);
    }
    expect(rt.getValue("toggle.on")).toBe(true);

    const config = fromBouncinessSpeed(5, 10);
    const spring = createSpringState(1);
    const expected = scales.map((_, frame) => {
      spring.target = frame >= 2 ? 1.5 : 1;
      stepSpring(spring, config, frame === 0 ? 0 : 1 / 60);
      return spring.value;
    });
    for (let f = 0; f < scales.length; f++) expect(scales[f]).toBeCloseTo(expected[f]!, 9);
    expect(Math.max(...scales)).toBeGreaterThan(1.5);
    expect(scales.at(-1)).toBeCloseTo(1.5, 3);
    expect(rt.issues()).toEqual([]);
  });

  it("gives every component instance, and every looped copy, its own script state", () => {
    const tallyScript = `export const inputs = [{ key: "tick", type: "pulse" }];
export const outputs = [{ key: "count", type: "number" }];
let count = 0;
export function evaluate(patch) { if (patch.pulsed("tick")) count++; patch.output("count", count); }`;
    const ticksA = sequenceDefinition("ticksA", "pulse", [true, true, false]);
    const ticksB = sequenceDefinition("ticksB", "pulse", [false, true, false]);
    const ticksLoop = sequenceDefinition("ticksLoop", "pulse", [makeLoop([true, false, true]), makeLoop([true, false, false]), makeLoop([false, false, false])]);
    const definitions = [javascript, component, ticksA, ticksB, ticksLoop];
    const doc = build(
      [
        { op: "addComponent", component: { id: "tally", name: "Tally", kind: "patchComponent" } },
        { op: "updateInterface", component: "tally", inputs: { tick: { key: "tick", name: "Tick", type: "pulse" } } },
        { op: "setScript", file: "tally.js", source: tallyScript },
        { op: "addPatch", component: "tally", patch: { id: "js", type: "javascript", settings: { script: "tally.js" } } },
        { op: "connect", component: "tally", from: "$in.tick", to: "js.tick" },
        { op: "updateInterface", component: "tally", outputs: { count: { key: "count", name: "Count", type: "number", link: "js.count" } } },
        { op: "addPatch", patch: { id: "srcA", type: "ticksA" } },
        { op: "addPatch", patch: { id: "srcB", type: "ticksB" } },
        { op: "addPatch", patch: { id: "srcLoop", type: "ticksLoop" } },
        { op: "addPatch", patch: { id: "a", type: "component", component: "tally" } },
        { op: "addPatch", patch: { id: "b", type: "component", component: "tally" } },
        { op: "addPatch", patch: { id: "rows", type: "component", component: "tally" } },
        { op: "connect", from: "srcA.value", to: "a.tick" },
        { op: "connect", from: "srcB.value", to: "b.tick" },
        { op: "connect", from: "srcLoop.value", to: "rows.tick" },
      ],
      definitions,
    );
    const rt = createTestRuntime(doc, definitions);
    runFrames(rt, 3);
    expect(rt.getValue("a.count")).toBe(2);
    expect(rt.getValue("b.count")).toBe(1);
    expect(items(rt.getRawValue("rows.count"))).toEqual([2, 0, 1]);
    expect(rt.issues()).toEqual([]);
  });

  it("runs timers inside the runtime and keeps frames coming while they're pending", () => {
    const source = `export const outputs = [{ key: "done", type: "boolean" }, { key: "finished", type: "pulse" }];
export function evaluate(patch) { setTimeout(() => { patch.output("done", true); patch.pulse("finished"); }, 500); }`;
    const doc = build([
      { op: "setScript", file: "wait.js", source },
      { op: "addPatch", patch: { id: "wait", type: "javascript", settings: { script: "wait.js" } } },
      { op: "addPatch", patch: { id: "count", type: "counter" } },
      { op: "connect", from: "wait.finished", to: "count.increase" },
    ]);
    const rt = createTestRuntime(doc, [javascript, component]);
    runFrames(rt, 30);
    expect(rt.getValue("wait.done")).toBe(false);
    expect(rt.needsNextFrame).toBe(true);
    runFrames(rt, 1);
    expect(rt.getValue("wait.done")).toBe(true);
    expect(rt.getValue("count.count")).toBe(1);
    runFrames(rt, 5);
    expect(rt.getValue("count.count")).toBe(1);
    expect(rt.needsNextFrame).toBe(false);
  });

  it("stalls a runaway script without stopping the rest of the prototype", () => {
    const doc = build([
      { op: "setScript", file: "spin.js", source: "export const outputs = [];\nexport function evaluate() { for (;;) {} }" },
      { op: "addPatch", patch: { id: "spin", type: "javascript", settings: { script: "spin.js" } } },
      { op: "addPatch", patch: { id: "clock", type: "time" } },
    ]);
    const rt = createTestRuntime(doc, [javascript, component]);
    runFrames(rt, 3);
    expect(rt.getValue("clock.frame")).toBe(2);
    expect(rt.issues()).toEqual([{ code: "script_error", severity: "error", message: "scripts/spin.js:2:30 The script took too long. Check for a loop that never ends.", patchId: "spin" }]);
  });
});
