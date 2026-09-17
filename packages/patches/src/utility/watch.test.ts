import { buildDoc, createMockRegistry, createTestRuntime, runPatch, sequenceDefinition } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { definitions } from "./index.ts";
import { formatWatchNumber, formatWatchValue, watch } from "./watch.ts";

describe("formatWatchNumber", () => {
  it("rounds to 3 decimals and trims trailing zeros", () => {
    expect([0.94, 120, 1234.56789, -0.5, 0.001].map(formatWatchNumber)).toEqual(["0.94", "120", "1234.568", "-0.5", "0.001"]);
  });

  it("uses 3 significant digits in exponent form for tiny and huge values", () => {
    expect([0.000123456, 4e9, -2.5e-5, 1.999e12].map(formatWatchNumber)).toEqual(["1.23e-4", "4e+9", "-2.5e-5", "2e+12"]);
  });

  it("shows non-finite values and -0 as 0", () => {
    expect([Number.NaN, Number.POSITIVE_INFINITY, -0, 0].map(formatWatchNumber)).toEqual(["0", "0", "0", "0"]);
  });
});

describe("formatWatchValue", () => {
  it("formats scalar types", () => {
    expect(formatWatchValue(3, "index")).toBe("3");
    expect(formatWatchValue(true, "boolean")).toBe("true");
    expect(formatWatchValue("column", "enum")).toBe("column");
    expect(formatWatchValue({ r: 1, g: 0, b: 0, a: 0.5 }, "color")).toBe("#FF000080");
    expect(formatWatchValue([10.5, -0], "point")).toBe("[10.5, 0]");
    expect(formatWatchValue([1, 2, 3, 4], "point4d")).toBe("[1, 2, 3, 4]");
  });

  it("quotes text, shows line breaks as ↵, and cuts long text to 60 characters", () => {
    expect(formatWatchValue("Hi\nthere\r\nyou", "text")).toBe('"Hi↵there↵you"');
    const long = formatWatchValue("x".repeat(80), "text");
    expect(long).toBe(`"${"x".repeat(59)}…"`);
  });

  it("stringifies JSON and cuts it to 60 characters", () => {
    expect(formatWatchValue({ a: 1 }, "json")).toBe('{"a":1}');
    expect(formatWatchValue(undefined, "json")).toBe("null");
    expect(formatWatchValue({ text: "y".repeat(100) }, "json")).toHaveLength(60);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => formatWatchValue(circular, "json")).not.toThrow();
  });

  it("describes media, gradients, shapes, effects, and layers", () => {
    expect(formatWatchValue({ assetId: "hero" }, "image")).toBe("image hero");
    expect(formatWatchValue({ url: `https://example.com/${"a".repeat(60)}` }, "video")).toBe(`video https://example.com/${"a".repeat(19)}…`);
    expect(formatWatchValue(null, "sound")).toBe("no sound");
    expect(formatWatchValue({ kind: "radial", stops: [{}, {}], start: [0, 0], end: [1, 1] }, "gradient")).toBe("radial gradient, 2 stops");
    expect(formatWatchValue({ kind: "linear", stops: [{}] }, "gradient")).toBe("linear gradient, 1 stop");
    expect(formatWatchValue({ path: "M0 0 L100 100 L200 0 L300 100 L400 0 Z" }, "shape")).toBe('shape "M0 0 L100 100 L200 0 L300 100…"');
    expect(formatWatchValue({ kind: "blur", params: { radius: 8 } }, "layerEffect")).toBe("blur effect");
    expect(formatWatchValue({ layerId: "card", instance: 2 }, "layer")).toBe("@card#2");
    expect(formatWatchValue({ layerId: "card" }, "layer")).toBe("@card");
    for (const type of ["image", "gradient", "shape", "layer"]) expect(formatWatchValue(null, type)).toBe(`no ${type}`);
    expect(formatWatchValue(null, "layerEffect")).toBe("no effect");
  });
});

describe("watch", () => {
  it("shows the value with its label and counts changes after frame 0", () => {
    const h = createPatchHarness(watch, { inputs: { value: 0.94, label: "  Scale " } });
    expect(h.step().outputs).toEqual({ display: "Scale: 0.94", changeCount: 0 });
    h.step();
    expect(h.output("changeCount")).toBe(0);
    h.step({ inputs: { value: 1 } });
    h.step({ inputs: { value: 0.5 } });
    expect(h.step().outputs).toEqual({ display: "Scale: 0.5", changeCount: 2 });
  });

  it("counts each time an on/off value turns on and shows the tally", () => {
    const h = createPatchHarness(watch, { typeParam: "boolean", inputs: { label: "Card taps" } });
    expect(h.step().outputs.display).toBe("Card taps: false");
    h.step({ inputs: { value: true } });
    expect(h.output("display")).toBe("Card taps: true · on 1×");
    h.step({ inputs: { value: false } });
    h.step({ inputs: { value: true } });
    expect(h.step({ inputs: { value: false } }).outputs).toEqual({ display: "Card taps: false · on 2×", changeCount: 2 });
  });

  it("doesn't count an on/off value that's already on at launch, but counts a launch pulse", () => {
    const held = createPatchHarness(watch, { typeParam: "boolean", inputs: { value: true } });
    expect(held.step().outputs).toEqual({ display: "true", changeCount: 0 });
    held.step({ inputs: { value: false } });
    expect(held.step({ inputs: { value: true } }).outputs.changeCount).toBe(1);
    const pulsed = createPatchHarness(watch, { typeParam: "boolean" });
    expect(pulsed.step({ pulses: ["value"] }).outputs.changeCount).toBe(1);
  });

  it("lets Reset beat a change on the same frame", () => {
    const h = createPatchHarness(watch, { inputs: { value: 1 } });
    h.step();
    h.step({ inputs: { value: 2 } });
    expect(h.output("changeCount")).toBe(1);
    expect(h.step({ inputs: { value: 3 }, pulses: ["reset"] }).outputs.changeCount).toBe(0);
    expect(h.step({ inputs: { value: 4 } }).outputs.changeCount).toBe(1);
  });

  it("logs the first value on frame 0, named by label, then patch name, then id", () => {
    const labeled = createPatchHarness(watch, { inputs: { value: 3, label: "Count" } });
    labeled.step();
    expect(labeled.logs.map((l) => [l.level, l.message])).toEqual([["log", "Count: 3"]]);

    const named = createPatchHarness(watch, { id: "scale_watch", inputs: { value: 3 } });
    named.node.name = "Press Scale";
    named.step();
    expect(named.logs.map((l) => l.message)).toEqual(["Press Scale: 3"]);

    const plain = createPatchHarness(watch, { id: "scale_watch", inputs: { value: 3 } });
    plain.step();
    expect(plain.logs.map((l) => l.message)).toEqual(["scale_watch: 3"]);
  });

  it("logs nothing when Log Changes is off", () => {
    const h = createPatchHarness(watch, { inputs: { value: 1, logChanges: false } });
    h.step();
    h.step({ inputs: { value: 2 } });
    expect(h.logs).toEqual([]);
    expect(h.output("changeCount")).toBe(1);
  });

  it("logs at most 4 lines a second and always ends on the settled value, at 60 and 120 fps", () => {
    for (const fps of [60, 120]) {
      const h = createPatchHarness(watch, { id: "w", fps });
      const requested: boolean[] = [];
      for (let i = 0; i < fps; i++) requested.push(h.step({ inputs: { value: i } }).requestedNextFrame);
      expect(requested[1], `${fps} fps`).toBe(true);
      const quarter = fps / 4;
      expect(h.logs.map((l) => l.message), `${fps} fps`).toEqual([0, 1, 2, 3].map((q) => `w: ${q * quarter}`));
      let settled = h.step();
      for (let i = 0; i < fps && settled.requestedNextFrame; i++) settled = h.step();
      expect(settled.requestedNextFrame).toBe(false);
      expect(h.logs.at(-1)?.message, `${fps} fps`).toBe(`w: ${fps - 1}`);
      expect(h.logs).toHaveLength(5);
    }
  });

  it("stops requesting frames once the newest text is logged", () => {
    const h = createPatchHarness(watch, { inputs: { value: 1 } });
    expect(h.step().requestedNextFrame).toBe(false);
    expect(h.step({ inputs: { value: 2 } }).requestedNextFrame).toBe(true);
    h.step({ inputs: { value: 1 } });
    expect(h.step().requestedNextFrame).toBe(false);
    expect(h.logs.map((l) => l.message)).toEqual(["patch_1: 1"]);
  });

  it("keeps per-index state for loops and marks console lines with the index", () => {
    const h = createPatchHarness(watch, { inputs: { value: loopOf([1, 2]), label: "Dot" } });
    expect(h.step().outputs).toEqual({ display: loopOf(["Dot: 1", "Dot: 2"]), changeCount: loopOf([0, 0]) });
    h.step({ inputs: { value: loopOf([1, 5]) } });
    expect(h.output("changeCount")).toEqual(loopOf([0, 1]));
    expect(h.logs.map((l) => l.message)).toEqual(["Dot #0: 1", "Dot #1: 2"]);
  });

  it("formats the patch's type", () => {
    const h = createPatchHarness(watch, { typeParam: "point", inputs: { value: [16, 120.25] } });
    expect(h.step().outputs.display).toBe("[16, 120.25]");
    const layer = createPatchHarness(watch, { typeParam: "layer", inputs: { value: { layerId: "card" } } });
    expect(layer.step().outputs.display).toBe("@card");
  });

  it("resets the count and logs again after a restart", () => {
    const h = createPatchHarness(watch, { inputs: { value: 1 } });
    h.step();
    h.run(20, { inputs: { value: 2 } });
    expect(h.output("changeCount")).toBe(1);
    h.restart();
    expect(h.step().outputs.changeCount).toBe(0);
    expect(h.logs.map((l) => l.message)).toEqual(["patch_1: 1", "patch_1: 2", "patch_1: 2"]);
  });

  it("outputs empty text and 0 and logs nothing while muted", () => {
    const result = runPatch(watch, [{ value: 3, label: "Scale" }, { value: 4 }], { muted: true });
    expect(result.frames.map((f) => f.outputs)).toEqual([
      { display: "", changeCount: 0 },
      { display: "", changeCount: 0 },
    ]);
    expect(result.logs).toEqual([]);
  });

  it("counts upstream pulses on back-to-back frames when set to boolean", () => {
    const pulses = sequenceDefinition("pulses", "pulse", [false, true, true, false, true, false]);
    const registry = createMockRegistry([pulses, ...definitions]);
    const rt = createTestRuntime(
      buildDoc({ patches: { src: { type: "pulses" }, taps: { type: "watch", typeParam: "boolean", inputs: { value: { link: "src.value" }, logChanges: false } } } }, registry),
      registry,
    );
    const counts: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      rt.step();
      counts.push(rt.getValue("taps.changeCount"));
    }
    expect(counts).toEqual([0, 1, 2, 2, 3, 3]);
    expect(rt.getValue("taps.display")).toBe("false · on 3×");
  });
});
