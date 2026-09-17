/** Animation patches wired together in real runtime documents, with mock interaction and switch patches. */

import { applyOps } from "@sonobe/core";
import { createVectorSpringState, fromBouncinessSpeed, setVectorSpringTarget, stepVectorSpring } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, runFrames, tap } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { definitions } from "./index.ts";

const registry = () => createMockRegistry(definitions);

describe("animation patches in a real runtime", () => {
  it("interaction → switch → pop animation → transition grows a card with the Rebound spring and settles", () => {
    const reg = registry();
    const doc = buildDoc(
      {
        layers: [{ id: "card", type: "rectangle", name: "Card", props: { position: [95, 362], size: [200, 120], scale: { link: "grow.output" } } }],
        patches: {
          touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
          toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
          pop: { type: "popAnimation", inputs: { number: { link: "toggle.on" } } },
          grow: { type: "transition", typeParam: "number", inputs: { progress: { link: "pop.output" }, start: 1, end: 1.2 } },
        },
      },
      reg,
    );
    const rt = createTestRuntime(doc, reg);
    runFrames(rt, 1);
    expect(rt.getValue("@card.scale")).toBe(1);
    expect(rt.needsNextFrame).toBe(false);

    runFrames(rt, 2, tap(195, 422));
    expect(rt.getValue("toggle.on")).toBe(true);
    const config = fromBouncinessSpeed(5, 10);
    const reference = createVectorSpringState([0]);
    setVectorSpringTarget(reference, [1]);
    stepVectorSpring(reference, config, 1 / 60);
    expect(rt.getValue("pop.output")).toBe(reference.value[0]);
    expect(rt.needsNextFrame).toBe(true);

    let peak = 0;
    for (let i = 0; i < 90; i++) {
      runFrames(rt, 1);
      stepVectorSpring(reference, config, 1 / 60);
      expect(rt.getValue("pop.output")).toBe(reference.value[0]);
      peak = Math.max(peak, rt.getValue("@card.scale") as number);
    }
    expect(peak).toBeGreaterThan(1.2);
    expect(rt.getValue("@card.scale") as number).toBeCloseTo(1.2, 12);
    expect(rt.needsNextFrame).toBe(false);
    rt.dispose();
  });

  it("repeating animation → keyframes → opacity, with velocity reading the fade speed", () => {
    const reg = registry();
    const doc = buildDoc(
      {
        layers: [{ id: "dot", type: "oval", name: "Dot", props: { size: [20, 20], opacity: { link: "fade.output" } } }],
        patches: {
          cycle: { type: "repeatingAnimation", inputs: { duration: 1, curve: "linear" } },
          fade: { type: "keyframes", inputs: { progress: { link: "cycle.progress" }, value1: 0.2, value2: 1, value3: 0.2 } },
          speed: { type: "velocity", inputs: { value: { link: "fade.output" } } },
        },
      },
      reg,
    );
    const rt = createTestRuntime(doc, reg);
    runFrames(rt, 1);
    expect(rt.getValue("@dot.opacity")).toBe(0.2);
    expect(rt.getValue("speed.velocity")).toBe(0);
    runFrames(rt, 15);
    expect(rt.getValue("@dot.opacity") as number).toBeCloseTo(0.6, 9);
    expect(rt.getValue("speed.velocity") as number).toBeCloseTo(1.6, 6);
    runFrames(rt, 30);
    expect(rt.getValue("@dot.opacity") as number).toBeCloseTo(0.6, 9);
    expect(rt.getValue("speed.velocity") as number).toBeCloseTo(-1.6, 6);
    expect(rt.needsNextFrame).toBe(true);
    rt.dispose();
  });

  it("spring preset → spring animation slides a sheet into place with a snappy feel", () => {
    const reg = registry();
    const doc = buildDoc(
      {
        layers: [
          { id: "button", type: "rectangle", name: "Button", props: { position: [0, 0], size: [100, 100] } },
          { id: "sheet", type: "rectangle", name: "Sheet", props: { size: [390, 400], position: { link: "slide.output" } } },
        ],
        patches: {
          touch: { type: "interaction", inputs: { layer: { layer: "button" } } },
          toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
          feel: { type: "springPreset", inputs: { preset: "snappy" } },
          offset: { type: "transition", typeParam: "point", inputs: { progress: { link: "toggle.on" }, start: [0, 844], end: [0, 444] } },
          slide: {
            type: "springAnimation",
            typeParam: "point",
            inputs: { number: { link: "offset.output" }, mass: { link: "feel.mass" }, tension: { link: "feel.tension" }, friction: { link: "feel.friction" } },
          },
        },
      },
      reg,
    );
    const rt = createTestRuntime(doc, reg);
    runFrames(rt, 1);
    expect(rt.getValue("@sheet.position")).toEqual([0, 844]);
    runFrames(rt, 2, tap(50, 50));
    let lowest = 844;
    for (let i = 0; i < 120; i++) {
      runFrames(rt, 1);
      lowest = Math.min(lowest, (rt.getValue("@sheet.position") as number[])[1]!);
    }
    expect(lowest).toBeLessThan(444);
    expect(lowest).toBeGreaterThan(440);
    expect(rt.getValue("@sheet.position")).toEqual([0, 444]);
    rt.dispose();
  });

  it("keeps per-index springs across a document update", () => {
    const reg = registry();
    const doc = buildDoc({ patches: { pop: { type: "popAnimation", inputs: { number: { loop: [0, 1, 2] } } } } }, reg);
    const rt = createTestRuntime(doc, reg);
    runFrames(rt, 3);
    expect(rt.getValue("pop.output#2")).toBe(2);
    const next = applyOps(rt.document, [{ op: "setInput", target: "pop.number", value: { loop: [2, 1, 0] } }], { registry: reg });
    expect(next.ok).toBe(true);
    rt.updateDocument(next.doc);
    runFrames(rt, 6);
    const first = rt.getValue("pop.output#0") as number;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(2);
    expect(rt.getValue("pop.output#1")).toBe(1);
    expect(rt.getValue("pop.output#2") as number).toBeLessThan(2);
    rt.dispose();
  });

  it("passes Start through a muted Transition in the runtime", () => {
    const reg = registry();
    const doc = buildDoc({ patches: { grow: { type: "transition", muted: true, inputs: { progress: 0.5, start: 3, end: 9 } } } }, reg);
    const rt = createTestRuntime(doc, reg);
    runFrames(rt, 1);
    expect(rt.getValue("grow.output")).toBe(3);
    rt.dispose();
  });
});
