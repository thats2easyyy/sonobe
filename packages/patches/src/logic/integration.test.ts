/** Logic patches wired into real runtime documents with mock interaction, switch, and spring patches. */

import { createSpringState, fromBouncinessSpeed, stepSpring } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, pointerEvent, runFrames, tap } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { loopOf } from "../infra/index.ts";
import { definitions } from "./index.ts";

const registry = createMockRegistry(definitions);

function tapToGrowDoc() {
  return buildDoc(
    {
      layers: [{ id: "card", type: "rectangle", name: "Card", props: { size: [200, 120], scale: { link: "pop.output" }, opacity: { link: "fade.output" } } }],
      patches: {
        touch: { type: "interaction", inputs: { layer: { layer: "card" } } },
        toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
        target: { type: "ifElse", typeParam: "number", inputs: { condition: { link: "toggle.on" }, ifTrue: 1.2, ifFalse: 1 } },
        pop: { type: "popAnimation", inputs: { number: { link: "target.output" } } },
        grown: { type: "greaterThan", inputs: { value1: { link: "pop.output" }, value2: 1.1 } },
        released: { type: "not", inputs: { value: { link: "touch.down" } } },
        bright: { type: "and", inputs: { value1: { link: "grown.output" }, value2: { link: "released.output" } } },
        fade: { type: "ifElse", typeParam: "number", inputs: { condition: { link: "bright.output" }, ifTrue: 1, ifFalse: 0.5 } },
      },
    },
    registry,
  );
}

describe("logic patches in a runtime", () => {
  it("tap → switch → if / else → pop animation settles on the chosen scale", () => {
    const rt = createTestRuntime(tapToGrowDoc(), registry);
    runFrames(rt, 1);
    expect(rt.getValue("@card.scale")).toBe(1);
    expect(rt.getValue("@card.opacity")).toBe(0.5);

    runFrames(rt, 2, tap(100, 60));
    expect(rt.getValue("toggle.on")).toBe(true);
    expect(rt.getValue("target.output")).toBe(1.2);
    runFrames(rt, 90);

    // Reference: the engine spring stepped with the same targets and frame times.
    const spring = createSpringState(1);
    const config = fromBouncinessSpeed(5, 10);
    const dts = [0, 1 / 60, ...new Array<number>(91).fill(1 / 60)];
    dts.forEach((dt, frame) => {
      spring.target = frame >= 2 ? 1.2 : 1;
      stepSpring(spring, config, dt);
    });
    expect(rt.getValue("@card.scale")).toBeCloseTo(spring.value, 9);
    expect(rt.getValue("@card.scale")).toBeCloseTo(1.2, 3);
    expect(rt.getValue("grown.output")).toBe(true);
    expect(rt.getValue("@card.opacity")).toBe(1);
  });

  it("Not turns a press into a dimmed card while the finger is down", () => {
    const rt = createTestRuntime(tapToGrowDoc(), registry);
    runFrames(rt, 1);
    runFrames(rt, 2, tap(100, 60));
    runFrames(rt, 90);
    expect(rt.getValue("@card.opacity")).toBe(1);

    runFrames(rt, 1, [[pointerEvent("down", 100, 60)]]);
    expect(rt.getValue("released.output")).toBe(false);
    expect(rt.getValue("@card.opacity")).toBe(0.5);
    runFrames(rt, 1, [[pointerEvent("up", 100, 60)]]);
    expect(rt.getValue("toggle.on")).toBe(false);
    expect(rt.getValue("@card.opacity")).toBe(1);
    runFrames(rt, 90);
    expect(rt.getValue("@card.scale")).toBeCloseTo(1, 3);
    expect(rt.getValue("@card.opacity")).toBe(0.5);
  });

  it("loop literals evaluate per index and ranges classify each item", () => {
    const doc = buildDoc(
      {
        patches: {
          match: { type: "equalsExactly", inputs: { value1: { loop: [0, 1, 2] }, value2: 1 } },
          band: { type: "inRange", inputs: { value: { loop: [-5, 5, 50] }, min: 0, max: 10 } },
          label: { type: "ifElse", typeParam: "text", inputs: { condition: { link: "band.inRange" }, ifTrue: "fits", ifFalse: "no" } },
          chain: { type: "lessThanOrEqual", inputCount: 3, inputs: { value1: 0, value2: { link: "match.output" }, value3: 1 } },
        },
      },
      registry,
    );
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 1);
    expect(rt.getRawValue("match.output")).toEqual(loopOf([false, true, false]));
    expect(rt.getRawValue("band.below")).toEqual(loopOf([true, false, false]));
    expect(rt.getRawValue("label.output")).toEqual(loopOf(["no", "fits", "no"]));
    expect(rt.getRawValue("chain.output")).toEqual(loopOf([true, true, true]));
    expect(rt.issues()).toEqual([]);
  });
});
