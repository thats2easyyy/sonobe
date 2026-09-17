/** Ops over node-dependent ports: dynamic variants, inputCountRange, 0-based and output-side variadics, gradient literals. */

import { describe, expect, it } from "vitest";
import { parseComponentFile } from "../schema.ts";
import { serializeComponent } from "../serialize.ts";
import { emptyDoc, expectRoundTrip, extendedRegistry, mustApply } from "../testing/fixtures.ts";
import type { Op, SonobeDocument } from "../types.ts";
import { applyOps } from "./index.ts";

const opts = { registry: extendedRegistry };
const apply = (doc: SonobeDocument, ops: Op[]) => applyOps(doc, ops, opts);
const main = (doc: SonobeDocument) => doc.components.main!;

describe("typeParam from dynamic variants", () => {
  it("accepts the variants a node's dynamicPorts declare", () => {
    const doc = emptyDoc();
    const r = mustApply(doc, [{ op: "addPatch", patch: { id: "js", type: "script", typeParam: "color", settings: { variants: ["number", "color"] } } }], opts);
    expect(main(r.doc).patches.js!.typeParam).toBe("color");
    expectRoundTrip(doc, r, opts);
    const defaulted = mustApply(doc, [{ op: "addPatch", patch: { id: "js", type: "script", settings: { variants: ["text"] } } }], opts);
    expect(main(defaulted.doc).patches.js!.typeParam).toBe("text");
    expect(apply(doc, [{ op: "addPatch", patch: { type: "script", typeParam: "color" } }]).errors[0]).toMatchObject({ code: "invalid_value", message: expect.stringContaining("no type options") });
  });

  it("checks updatePatch typeParam against settings from the same op", () => {
    const plain = mustApply(emptyDoc(), [{ op: "addPatch", patch: { id: "js", type: "script" } }], opts).doc;
    expect(main(plain).patches.js!.typeParam).toBeUndefined();
    const switched = mustApply(plain, [{ op: "updatePatch", id: "js", settings: { variants: ["number", "point"] }, typeParam: "point" }], opts);
    expect(main(switched.doc).patches.js).toMatchObject({ typeParam: "point", settings: { variants: ["number", "point"] } });
    expectRoundTrip(plain, switched, opts);
    expect(apply(switched.doc, [{ op: "updatePatch", id: "js", typeParam: "sound" }]).errors[0]).toMatchObject({ code: "invalid_value", hint: "Its types: number, point." });
  });
});

describe("inputCount with inputCountRange", () => {
  it("defaults and validates the count", () => {
    const added = mustApply(emptyDoc(), [{ op: "addPatch", patch: { id: "grad", type: "stops" } }], opts).doc;
    expect(main(added).patches.grad!.inputCount).toBe(2);
    expect(apply(added, [{ op: "updatePatch", id: "grad", inputCount: 5 }]).errors[0]).toMatchObject({ code: "invalid_value", message: expect.stringContaining("between 1 and 4") });
    expect(apply(added, [{ op: "addPatch", patch: { type: "or", inputCount: 1 } }]).errors[0]!.message).toContain("between 2 and 8 value inputs");
    expect(apply(added, [{ op: "addPatch", patch: { type: "switch", inputCount: 2 } }]).errors[0]!.message).toContain("fixed set of inputs");
  });

  it("drops inputs and links of groups that go away, and undo brings them back", () => {
    const doc = mustApply(
      emptyDoc(),
      [
        { op: "addPatch", patch: { id: "grad", type: "stops", inputCount: 3, inputs: { stop1: 0.25, stop3: 0.75 } } },
        { op: "addPatch", patch: { id: "log", type: "logger", inputs: { value: { link: "grad.at3" } } } },
      ],
      opts,
    ).doc;
    const r = mustApply(doc, [{ op: "updatePatch", id: "grad", inputCount: 2 }], opts);
    expect(main(r.doc).patches.grad!.inputs).toEqual({ stop1: 0.25 });
    expect(main(r.doc).patches.log!.inputs).toEqual({});
    expectRoundTrip(doc, r, opts);
  });
});

describe("variadic startIndex and direction", () => {
  it("addresses 0-based variadic inputs and prunes the last one", () => {
    const doc = mustApply(emptyDoc(), [{ op: "addPatch", patch: { id: "pick", type: "picker", inputCount: 3, inputs: { option0: 4, option2: 6 } } }], opts).doc;
    expect(apply(doc, [{ op: "setInput", target: "pick.option3", value: 1 }]).errors[0]!.code).toBe("unknown_port");
    const r = mustApply(doc, [{ op: "updatePatch", id: "pick", inputCount: 2 }], opts);
    expect(main(r.doc).patches.pick!.inputs).toEqual({ option0: 4 });
    expectRoundTrip(doc, r, opts);
  });

  it("drops links from removed variadic outputs and restores them on undo", () => {
    const doc = mustApply(
      emptyDoc(),
      [
        { op: "addPatch", patch: { id: "send", type: "sender", inputCount: 3 } },
        { op: "addPatch", patch: { id: "log", type: "logger", inputs: { value: { link: "send.option2" } } } },
      ],
      opts,
    ).doc;
    expect(apply(doc, [{ op: "setInput", target: "send.option0", value: 1 }]).errors[0]!.code).toBe("unknown_port");
    const r = mustApply(doc, [{ op: "updatePatch", id: "send", inputCount: 2 }], opts);
    expect(main(r.doc).patches.log!.inputs).toEqual({});
    expectRoundTrip(doc, r, opts);
  });
});

describe("gradient literals", () => {
  it("stores a radial gradient's ratio, serializes it after end, and rejects a bad one", () => {
    const doc = mustApply(emptyDoc(), [{ op: "addLayer", layer: { id: "glow", type: "gradient" } }], opts).doc;
    const gradient = { kind: "radial", stops: [[0, "#FFFFFF"], [1, "#000000FF"]], start: [0.5, 0.5], end: [1, 0.5], ratio: 2 };
    const r = mustApply(doc, [{ op: "setInput", target: "@glow.gradient", value: { gradient } as never }], opts);
    expect(main(r.doc).layers[0]!.props.gradient).toEqual({ gradient: { ...gradient, stops: [[0, "#FFFFFFFF"], [1, "#000000FF"]] } });
    expectRoundTrip(doc, r, opts);
    expect(apply(doc, [{ op: "setInput", target: "@glow.gradient", value: { gradient: { ...gradient, ratio: 0 } } as never }]).errors[0]).toMatchObject({ code: "invalid_value", message: expect.stringContaining("ratio") });

    const text = serializeComponent(main(r.doc));
    expect(text.indexOf('"ratio": 2')).toBeGreaterThan(text.indexOf('"end"'));
    const parsed = parseComponentFile(text);
    expect(parsed.ok && parsed.value).toStrictEqual(main(r.doc));
    const bad = JSON.parse(text);
    bad.layers[0].props.gradient.gradient.ratio = -1;
    const rejected = parseComponentFile(bad);
    expect(rejected.ok).toBe(false);
    expect(!rejected.ok && rejected.message).toContain("gradient ratio must be a number above 0");
  });
});
