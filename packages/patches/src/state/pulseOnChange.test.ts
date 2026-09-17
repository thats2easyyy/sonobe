import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { pulseOnChangePatch } from "./pulseOnChange.ts";

const fired = (frame: { pulses: ReadonlySet<string> }) => frame.pulses.has("changed");

describe("pulseOnChange", () => {
  it("seeds on the first frame and fires on every frame the value differs", () => {
    const h = createPatchHarness(pulseOnChangePatch, { inputs: { value: 3 } });
    expect(fired(h.step())).toBe(false);
    expect(fired(h.step({ inputs: { value: 3 } }))).toBe(false);
    expect(fired(h.step({ inputs: { value: 4 } }))).toBe(true);
    expect(fired(h.step({ inputs: { value: 5 } }))).toBe(true);
    expect(fired(h.step())).toBe(false);
  });

  it("never fires for an unconnected value", () => {
    const h = createPatchHarness(pulseOnChangePatch);
    expect([h.step(), h.step(), h.step()].some(fired)).toBe(false);
  });

  it("compares numbers exactly, with 0 equal to −0 and a steady NaN not changing", () => {
    const h = createPatchHarness(pulseOnChangePatch, { inputs: { value: 0 } });
    h.step();
    expect(fired(h.step({ inputs: { value: -0 } }))).toBe(false);
    expect(fired(h.step({ inputs: { value: 0.1 + 0.2 } }))).toBe(true);
    expect(fired(h.step({ inputs: { value: 0.3 } }))).toBe(true);
    expect(fired(h.step({ inputs: { value: Number.NaN } }))).toBe(true);
    expect(fired(h.step({ inputs: { value: Number.NaN } }))).toBe(false);
  });

  it("compares text case-sensitively", () => {
    const h = createPatchHarness(pulseOnChangePatch, { typeParam: "text", inputs: { value: "Rain" } });
    h.step();
    expect(fired(h.step({ inputs: { value: "Rain" } }))).toBe(false);
    expect(fired(h.step({ inputs: { value: "rain" } }))).toBe(true);
    expect(fired(h.step({ inputs: { value: "rain " } }))).toBe(true);
  });

  it("compares colors at 8-bit precision", () => {
    const h = createPatchHarness(pulseOnChangePatch, { typeParam: "color", inputs: { value: { r: 0.5, g: 0, b: 0, a: 1 } } });
    h.step();
    expect(fired(h.step({ inputs: { value: { r: 0.5001, g: 0, b: 0, a: 1 } } }))).toBe(false);
    expect(fired(h.step({ inputs: { value: { r: 0.52, g: 0, b: 0, a: 1 } } }))).toBe(true);
    expect(fired(h.step({ inputs: { value: "#FF0000FF" } }))).toBe(true);
  });

  it("compares vectors component by component and JSON deeply in any key order", () => {
    const point = createPatchHarness(pulseOnChangePatch, { typeParam: "point", inputs: { value: [1, 2] } });
    point.step();
    expect(fired(point.step({ inputs: { value: [1, 2] } }))).toBe(false);
    expect(fired(point.step({ inputs: { value: [2, 1] } }))).toBe(true);

    const json = createPatchHarness(pulseOnChangePatch, { typeParam: "json", inputs: { value: { a: 1, b: [1, 2] } } });
    json.step();
    expect(fired(json.step({ inputs: { value: { b: [1, 2], a: 1 } } }))).toBe(false);
    expect(fired(json.step({ inputs: { value: { b: [2, 1], a: 1 } } }))).toBe(true);
    expect(fired(json.step({ inputs: { value: { b: [2, 1], a: 1, c: null } } }))).toBe(true);
  });

  it("fires only at the loop indices that changed and seeds new indices", () => {
    const h = createPatchHarness(pulseOnChangePatch, { inputs: { value: loopOf([1, 2, 3]) } });
    expect(fired(h.step())).toBe(false);
    expect(h.step({ inputs: { value: loopOf([1, 5, 3]) } }).pulseItems.changed).toEqual([false, true, false]);
    const grown = h.step({ inputs: { value: loopOf([1, 5, 3, 9]) } });
    expect(fired(grown)).toBe(false);
  });

  it("seeds again after a restart", () => {
    const h = createPatchHarness(pulseOnChangePatch, { inputs: { value: 1 } });
    h.step();
    h.restart();
    expect(fired(h.step({ inputs: { value: 2 } }))).toBe(false);
  });
});
