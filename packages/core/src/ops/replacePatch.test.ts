import { describe, expect, it } from "vitest";
import { buildSampleDocument, expectRoundTrip, mockRegistry, mustApply } from "../testing/fixtures.ts";
import type { Op, SonobeDocument } from "../types.ts";
import { applyOps } from "./index.ts";

const apply = (doc: SonobeDocument, ops: Op[]) => applyOps(doc, ops, { registry: mockRegistry });
const firstError = (doc: SonobeDocument, ops: Op[]) => apply(doc, ops).errors[0]!;
const main = (doc: SonobeDocument) => doc.components.main!;

describe("replacePatch", () => {
  it("changes the type in place, keeping the id, position and every cable that still fits", () => {
    const doc = buildSampleDocument();
    const r = mustApply(doc, [{ op: "replacePatch", id: "pop", patch: { type: "transition" }, inputMap: { number: "progress" } }]);
    expect(main(r.doc).patches.pop).toStrictEqual({ type: "transition", typeParam: "number", inputs: { progress: { link: "toggle.on" } }, ui: main(doc).patches.pop!.ui });
    // The Transition reading pop.output still reads it: a Transition has an Output too.
    expect(main(r.doc).patches.grow!.inputs.progress).toEqual({ link: "pop.output" });
    expect(r.results[0]).toMatchObject({
      ok: true,
      ids: ["pop"],
      dropped: [
        { to: "pop.bounciness", value: 8 },
        { to: "pop.speed", value: 10 },
      ],
    });
    expect(r.applied).toEqual([
      { op: "setInput", component: "main", target: "pop.bounciness", value: null },
      { op: "setInput", component: "main", target: "pop.speed", value: null },
      { op: "replacePatch", component: "main", id: "pop", patch: { type: "transition", name: "", settings: {}, typeParam: "number" }, inputMap: { number: "progress" } },
    ]);
    expect(r.affected.patches).toEqual(["grow", "pop"]);
    expectRoundTrip(doc, r);
    // Undo and redo replay leniently and land on the same documents.
    expect(applyOps(doc, r.applied, { registry: mockRegistry, lenient: true }).doc).toStrictEqual(r.doc);
    expect(applyOps(r.doc, r.inverse, { registry: mockRegistry, lenient: true }).doc).toStrictEqual(doc);
  });

  it("drops the cables and values the new type has no fitting port for", () => {
    const doc = buildSampleDocument();
    // Without an inputMap, Pop Animation's Number has nowhere to go.
    const unmapped = mustApply(doc, [{ op: "replacePatch", id: "pop", patch: { type: "transition" } }]);
    expect(main(unmapped.doc).patches.pop!.inputs).toEqual({});
    expect(unmapped.results[0]!.dropped!.map((d) => d.to)).toEqual(["pop.number", "pop.bounciness", "pop.speed"]);
    // A Hex Color has an output named Color, and a color can't drive the card's scale.
    const colored = mustApply(doc, [{ op: "replacePatch", id: "grow", patch: { type: "hexColor" }, outputMap: { output: "color" } }]);
    expect(main(colored.doc).layers[0]!.props.scale).toBeUndefined();
    expect(colored.results[0]!.dropped).toContainEqual({ to: "@card.scale", value: { link: "grow.output" } });
    expectRoundTrip(doc, colored);
  });

  it("keeps a custom name and bypass, and drops a name that only repeated the old type", () => {
    const named = mustApply(buildSampleDocument(), [
      { op: "updatePatch", id: "pop", name: "Card Spring", muted: true, ui: { collapsed: true, color: "blue" } },
      { op: "updatePatch", id: "grow", name: "Transition" },
    ]).doc;
    const r = mustApply(named, [
      { op: "replacePatch", id: "pop", patch: { type: "delay1" } },
      { op: "replacePatch", id: "grow", patch: { type: "popAnimation" } },
      { op: "replacePatch", id: "toggle", patch: { type: "counter", name: "Taps" } },
    ]);
    expect(main(r.doc).patches.pop).toMatchObject({ type: "delay1", name: "Card Spring", muted: true, ui: { collapsed: true, color: "blue" } });
    expect(main(r.doc).patches.grow!.name).toBeUndefined();
    expect(main(r.doc).patches.toggle!.name).toBe("Taps");
    expectRoundTrip(named, r);
  });

  it("resolves refs made earlier in the batch", () => {
    const doc = buildSampleDocument();
    const r = mustApply(doc, [
      { op: "addPatch", patch: { ref: "echo", type: "delay1", inputs: { value: { link: "pop.output" } } } },
      { op: "replacePatch", id: "$echo", patch: { type: "logger" } },
    ]);
    expect(main(r.doc).patches.delay1).toMatchObject({ type: "logger", inputs: { value: { link: "pop.output" } } });
    expect(r.results[1]!.dropped).toBeUndefined();
    expectRoundTrip(doc, r);
  });

  it("teaches the right shape", () => {
    const doc = buildSampleDocument();
    expect(firstError(doc, [{ op: "replacePatch", id: "pop", patch: { type: "popAnimaton" } }])).toMatchObject({ code: "unknown_patch_type", message: expect.stringContaining('"popAnimation"') });
    expect(firstError(doc, [{ op: "replacePatch", id: "pop", type: "switch" } as unknown as Op])).toMatchObject({ code: "unknown_field", hint: expect.stringContaining('inside "patch"') });
    expect(firstError(doc, [{ op: "replacePatch", id: "pop" } as unknown as Op]).code).toBe("invalid_op");
    expect(firstError(doc, [{ op: "replacePatch", id: "pop", patch: { type: "switch", inputs: {} } as never }])).toMatchObject({ code: "unknown_field", hint: expect.stringContaining("carry over by themselves") });
    expect(firstError(doc, [{ op: "replacePatch", id: "pop", patch: { type: "popAnimation" } }])).toMatchObject({ code: "invalid_op", message: expect.stringContaining("already a Pop Animation") });
    expect(firstError(doc, [{ op: "replacePatch", id: "pop", patch: { type: "transition" }, inputMap: { numbr: "progress" } }])).toMatchObject({ code: "unknown_port", message: expect.stringContaining('"number"') });
    expect(firstError(doc, [{ op: "replacePatch", id: "pop", patch: { type: "transition" }, inputMap: { number: "progres" } }])).toMatchObject({ code: "unknown_port", message: expect.stringContaining('"progress"') });
    expect(firstError(doc, [{ op: "replacePatch", id: "nope", patch: { type: "switch" } }]).code).toBe("not_found");
    expect(firstError(doc, [{ op: "replacePatch", id: "grow", patch: { type: "transition", typeParam: "size" } }]).code).toBe("invalid_value");
  });

  it("changes a type option in place like updatePatch, and runs components", () => {
    const doc = mustApply(buildSampleDocument(), [
      { op: "addComponent", component: { id: "logic", name: "Logic", kind: "patchComponent" } },
      { op: "updateInterface", component: "logic", inputs: { on: { name: "On", type: "boolean" } }, outputs: { output: { name: "Output", type: "number" } } },
    ]).doc;
    const retyped = mustApply(doc, [{ op: "replacePatch", id: "grow", patch: { type: "transition", typeParam: "point" } }]);
    expect(main(retyped.doc).patches.grow).toMatchObject({ type: "transition", typeParam: "point", inputs: { progress: { link: "pop.output" } } });
    expectRoundTrip(doc, retyped);
    expect(firstError(doc, [{ op: "replacePatch", id: "pop", patch: { type: "component" } }]).message).toContain('needs "component"');
    const run = mustApply(doc, [{ op: "replacePatch", id: "pop", patch: { type: "component", component: "logic" }, inputMap: { number: "on" } }]);
    expect(main(run.doc).patches.pop).toMatchObject({ type: "component", component: "logic", inputs: { on: { link: "toggle.on" } } });
    expect(main(run.doc).patches.grow!.inputs.progress).toEqual({ link: "pop.output" });
    expectRoundTrip(doc, run);
  });
});
