import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { loopOptionSwitchPatch } from "./loopOptionSwitch.ts";

const items = (...on: boolean[]) => ({ select: loopOf(on) });

describe("loopOptionSwitch", () => {
  it("starts at 0 and remembers the item that pulsed most recently", () => {
    const h = createPatchHarness(loopOptionSwitchPatch);
    expect(h.step().outputs.option).toBe(0);
    expect(h.step({ inputs: items(false, false, true) }).outputs.option).toBe(2);
    expect(h.step({ inputs: items(false, false, false) }).outputs.option).toBe(2);
    expect(h.step({ inputs: items(false, true, false) }).outputs.option).toBe(1);
    expect(h.step({ inputs: items(false, false, false) }).outputs.option).toBe(1);
  });

  it("lets the highest index win when several items pulse in one frame", () => {
    const h = createPatchHarness(loopOptionSwitchPatch, { inputs: items(false, false, false, false) });
    h.step();
    expect(h.step({ inputs: items(true, false, true, true) }).outputs.option).toBe(3);
  });

  it("selects on frame 0 when an item is already on", () => {
    const h = createPatchHarness(loopOptionSwitchPatch, { inputs: items(false, true) });
    expect(h.step().outputs.option).toBe(1);
  });

  it("selects once per rising edge of a held state", () => {
    const h = createPatchHarness(loopOptionSwitchPatch);
    expect(h.step({ inputs: items(false, true) }).outputs.option).toBe(1);
    expect(h.step({ inputs: items(true, true) }).outputs.option).toBe(0);
    expect(h.step({ inputs: items(true, true) }).outputs.option).toBe(0);
    expect(h.step({ inputs: items(true, false) }).outputs.option).toBe(0);
    expect(h.step({ inputs: items(true, true) }).outputs.option).toBe(1);
  });

  it("caps Option at the last item when the loop shrinks and restores it when it grows back", () => {
    const h = createPatchHarness(loopOptionSwitchPatch);
    expect(h.step({ inputs: items(false, false, false, true) }).outputs.option).toBe(3);
    expect(h.step({ inputs: items(false, false) }).outputs.option).toBe(1);
    expect(h.state()!.option).toBe(3);
    expect(h.step({ inputs: items(false, false, false, false) }).outputs.option).toBe(3);
  });

  it("outputs 0 for an empty loop and for a plain pulse", () => {
    const h = createPatchHarness(loopOptionSwitchPatch, { inputs: { select: loopOf([]) } });
    expect(h.step().outputs.option).toBe(0);
    const plain = createPatchHarness(loopOptionSwitchPatch);
    expect(plain.step({ inputs: { select: true } }).outputs.option).toBe(0);
  });

  it("resets on restart", () => {
    const h = createPatchHarness(loopOptionSwitchPatch);
    h.step({ inputs: items(false, false, true) });
    h.step({ inputs: items(false, false, false) });
    h.restart();
    expect(h.step().outputs.option).toBe(0);
  });
});
