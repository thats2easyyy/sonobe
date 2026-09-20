import { describe, expect, it } from "vitest";
import { buildSampleDocument, emptyDoc, expectRoundTrip, mockRegistry, mustApply } from "../testing/fixtures.ts";
import type { Op, SonobeDocument, SonobeError } from "../types.ts";
import { applyOps, type ApplyOpsOptions } from "./index.ts";

const apply = (doc: SonobeDocument, ops: Op[], extra: Partial<ApplyOpsOptions> = {}) => applyOps(doc, ops, { registry: mockRegistry, ...extra });
const main = (doc: SonobeDocument) => doc.components.main!;

function firstError(doc: SonobeDocument, ops: Op[]): SonobeError {
  const r = apply(doc, ops);
  expect(r.ok).toBe(false);
  expect(r.doc).toBe(doc);
  return r.errors[0]!;
}

describe("addLayer", () => {
  it("derives ids and default names", () => {
    const r = mustApply(emptyDoc(), [
      { op: "addLayer", layer: { type: "rectangle", name: "Card" } },
      { op: "addLayer", layer: { type: "rectangle", name: "Card" } },
      { op: "addLayer", layer: { type: "rectangle" } },
      { op: "addLayer", layer: { type: "rectangle" } },
    ]);
    expect(main(r.doc).layers.map((l) => [l.id, l.name])).toEqual([["card", "Card"], ["card_2", "Card"], ["rectangle", "Rectangle"], ["rectangle_2", "Rectangle 2"]]);
    expect(r.results.map((x) => x.ids)).toEqual([["card"], ["card_2"], ["rectangle"], ["rectangle_2"]]);
    expect(r.affected).toEqual({ components: ["main"], layers: ["card", "card_2", "rectangle", "rectangle_2"], patches: [] });
    expectRoundTrip(emptyDoc(), r);
  });

  it("validates and normalizes props", () => {
    const r = mustApply(emptyDoc(), [{ op: "addLayer", layer: { type: "rectangle", props: { color: "#fff", position: [10, 20] } } }]);
    expect(main(r.doc).layers[0]!.props).toEqual({ color: "#FFFFFFFF", position: [10, 20] });
    const typo = firstError(emptyDoc(), [{ op: "addLayer", layer: { type: "rectangle", props: { cornerRadus: 4 } } }]);
    expect(typo).toMatchObject({ code: "unknown_prop", opIndex: 0, address: "@rectangle.cornerRadus" });
    expect(typo.message).toContain('Did you mean "cornerRadius"');
    const color = firstError(emptyDoc(), [{ op: "addLayer", layer: { type: "rectangle", props: { color: "blue-ish" } } }]);
    expect(color.code).toBe("invalid_value");
    expect(color.hint).toContain("#FF3B30FF");
    expect(firstError(emptyDoc(), [{ op: "addLayer", layer: { type: "rectangle", props: { size: 100 } } }]).hint).toContain("[100,100]");
    expect(firstError(emptyDoc(), [{ op: "addLayer", layer: { type: "rectangle", props: { layout: "row" } } }]).code).toBe("unknown_prop");
    expect(firstError(emptyDoc(), [{ op: "addLayer", layer: { type: "group", props: { layout: "rows" } } }]).message).toContain('"row"');
  });

  it("suggests layer types", () => {
    const e = firstError(emptyDoc(), [{ op: "addLayer", layer: { type: "rectangel" } }]);
    expect(e.code).toBe("unknown_layer_type");
    expect(e.message).toContain('"rectangle"');
  });

  it("adds nested children that reference each other through refs", () => {
    const r = mustApply(emptyDoc(), [
      {
        op: "addLayer",
        layer: { ref: "stack", type: "group", name: "Stack", children: [{ ref: "a", type: "rectangle", name: "A" }, { type: "rectangle", name: "B", props: { position: { link: "@$a.position" } } }] },
      },
      { op: "addLayer", parent: "$stack", index: 0, layer: { type: "oval", name: "Dot" } },
    ]);
    const stack = main(r.doc).layers[0]!;
    expect(stack.children!.map((l) => l.id)).toEqual(["dot", "a", "b"]);
    expect(stack.children![2]!.props.position).toEqual({ link: "@a.position" });
    expect(r.idMap).toEqual({ stack: "stack", a: "a" });
    expect(r.results[0]!.ids).toEqual(["stack", "a", "b"]);
    expectRoundTrip(emptyDoc(), r);
  });

  it("rejects bad parents and ids", () => {
    const base = mustApply(emptyDoc(), [{ op: "addLayer", layer: { type: "rectangle", name: "Card" } }]).doc;
    expect(firstError(base, [{ op: "addLayer", parent: "card", layer: { type: "oval" } }]).code).toBe("cannot_have_children");
    const taken = firstError(base, [{ op: "addLayer", layer: { id: "card", type: "oval" } }]);
    expect(taken.code).toBe("id_taken");
    expect(taken.hint).toContain("card_2");
    expect(firstError(base, [{ op: "addLayer", layer: { id: "2x", type: "oval" } }]).code).toBe("invalid_id");
    expect(firstError(base, [{ op: "addLayer", parent: "nope", layer: { type: "oval" } }]).code).toBe("not_found");
    expect(firstError(base, [{ op: "addLayer", layer: { type: "oval", name: "  " } }]).code).toBe("invalid_value");
  });
});

describe("layer nesting depth", () => {
  const chain = (depth: number): Extract<Op, { op: "addLayer" }>["layer"] => {
    let layer: Extract<Op, { op: "addLayer" }>["layer"] = { id: `g${depth}`, type: "group", name: "G" };
    for (let i = depth - 1; i >= 1; i--) layer = { id: `g${i}`, type: "group", name: "G", children: [layer] };
    return layer;
  };

  it("refuses to nest layers deeper than a file can hold", () => {
    expect(mustApply(emptyDoc(), [{ op: "addLayer", layer: chain(256) }]).ok).toBe(true);
    expect(firstError(emptyDoc(), [{ op: "addLayer", layer: chain(2000) }]).code).toBe("too_deep");
    const deep = mustApply(emptyDoc(), [{ op: "addLayer", layer: chain(255) }, { op: "addLayer", layer: { id: "box", type: "group", name: "Box", children: [{ id: "inner", type: "rectangle", name: "Inner" }] } }]).doc;
    expect(mustApply(deep, [{ op: "addLayer", parent: "g255", layer: { type: "rectangle" } }]).ok).toBe(true);
    expect(firstError(deep, [{ op: "addLayer", parent: "g255", layer: { type: "group", children: [{ type: "rectangle" }] } }]).code).toBe("too_deep");
    expect(firstError(deep, [{ op: "moveLayer", id: "box", parent: "g255" }]).code).toBe("too_deep");
    expect(mustApply(deep, [{ op: "moveLayer", id: "inner", parent: "g255" }]).ok).toBe(true);
  });
});

describe("updateLayer", () => {
  it("sets and resets props, name and flags with an exact inverse", () => {
    const base = mustApply(emptyDoc(), [{ op: "addLayer", layer: { type: "rectangle", name: "Card", props: { opacity: 0.5 } } }]).doc;
    const r = mustApply(base, [{ op: "updateLayer", id: "card", props: { opacity: null, cornerRadius: 12 }, name: "Big Card", locked: true }]);
    expect(main(r.doc).layers[0]).toStrictEqual({ id: "card", type: "rectangle", name: "Big Card", props: { cornerRadius: 12 }, locked: true });
    expectRoundTrip(base, r);
    const unlocked = mustApply(r.doc, [{ op: "updateLayer", id: "card", locked: false }]);
    expect("locked" in main(unlocked.doc).layers[0]!).toBe(false);
    expectRoundTrip(r.doc, unlocked);
    expect(firstError(base, [{ op: "updateLayer", id: "card", name: "" }]).code).toBe("invalid_value");
  });

  it("can remove props the registry doesn't know", () => {
    const base = emptyDoc();
    base.components.main!.layers = [{ id: "old", type: "rectangle", name: "Old", props: { legacyProp: 1 } }];
    const r = mustApply(base, [{ op: "updateLayer", id: "old", props: { legacyProp: null } }]);
    expect(main(r.doc).layers[0]!.props).toEqual({});
    expectRoundTrip(base, r, { lenient: true });
  });
});

describe("moveLayer", () => {
  const base = () =>
    mustApply(emptyDoc(), [
      { op: "addLayer", layer: { type: "group", name: "G", children: [{ type: "rectangle", name: "Inner" }] } },
      { op: "addLayer", layer: { type: "rectangle", name: "A" } },
      { op: "addLayer", layer: { type: "rectangle", name: "B" } },
    ]).doc;

  it("reorders and reparents with exact inverses", () => {
    const doc = base();
    const r1 = mustApply(doc, [{ op: "moveLayer", id: "b", index: 0 }]);
    expect(main(r1.doc).layers.map((l) => l.id)).toEqual(["b", "g", "a"]);
    expectRoundTrip(doc, r1);
    const r2 = mustApply(doc, [{ op: "moveLayer", id: "a", parent: "g", index: 0 }]);
    expect(main(r2.doc).layers[0]!.children!.map((l) => l.id)).toEqual(["a", "inner"]);
    expectRoundTrip(doc, r2);
    const r3 = mustApply(doc, [{ op: "moveLayer", id: "inner", parent: null }]);
    expect(main(r3.doc).layers.map((l) => l.id)).toEqual(["g", "a", "b", "inner"]);
    expect("children" in main(r3.doc).layers[0]!).toBe(false);
    expectRoundTrip(doc, r3);
    const r4 = mustApply(doc, [{ op: "moveLayer", id: "a", index: -1 }]);
    expect(main(r4.doc).layers.map((l) => l.id)).toEqual(["g", "b", "a"]);
  });

  it("refuses impossible moves", () => {
    expect(firstError(base(), [{ op: "moveLayer", id: "g", parent: "inner" }]).code).toBe("cycle");
    expect(firstError(base(), [{ op: "moveLayer", id: "g", parent: "g" }]).code).toBe("cycle");
    expect(firstError(base(), [{ op: "moveLayer", id: "a", parent: "b" }]).code).toBe("cannot_have_children");
    expect(firstError(base(), [{ op: "moveLayer", id: "a", index: 1.5 }]).code).toBe("invalid_op");
  });
});

describe("removeLayer", () => {
  it("removes the subtree, cascades references and restores exactly", () => {
    const doc = buildSampleDocument();
    const r = mustApply(doc, [{ op: "removeLayer", id: "card" }]);
    expect(main(r.doc).layers).toEqual([]);
    expect(main(r.doc).patches.tap_card!.inputs).toEqual({});
    expect(r.results[0]!.ids).toEqual(["card", "title"]);
    expect(r.affected.patches).toEqual(["tap_card"]);
    expectRoundTrip(doc, r);
  });

  it("restores locked subtrees and links between removed siblings", () => {
    const doc = mustApply(buildSampleDocument(), [
      { op: "setInput", target: "@title.opacity", value: { link: "@card.opacity" } },
      { op: "updateLayer", id: "title", locked: true, collapsed: true },
    ]).doc;
    expectRoundTrip(doc, mustApply(doc, [{ op: "removeLayer", id: "card" }]));
  });
});

describe("addPatch", () => {
  it("fills default typeParam and inputCount and places patches left to right", () => {
    const r = mustApply(emptyDoc(), [
      { op: "addPatch", patch: { type: "transition" } },
      { op: "addPatch", patch: { type: "add", name: "Sum" } },
      { op: "addPatch", patch: { type: "switch", ui: { x: 10, y: 300 } } },
    ]);
    expect(main(r.doc).patches).toStrictEqual({
      transition: { type: "transition", typeParam: "number", inputs: {}, ui: { x: 40, y: 40 } },
      sum: { type: "add", name: "Sum", typeParam: "number", inputCount: 2, inputs: {}, ui: { x: 276, y: 40 } },
      switch: { type: "switch", inputs: {}, ui: { x: 10, y: 300 } },
    });
    expectRoundTrip(emptyDoc(), r);
  });

  it("suggests patch types by name and alias", () => {
    const e = firstError(emptyDoc(), [{ op: "addPatch", patch: { type: "spring" } }]);
    expect(e.code).toBe("unknown_patch_type");
    expect(e.message).toContain('"popAnimation"');
    expect(firstError(emptyDoc(), [{ op: "addPatch", patch: { type: "Pop Animaton" } }]).message).toContain("popAnimation");
  });

  it("validates typeParam and inputCount", () => {
    expect(firstError(emptyDoc(), [{ op: "addPatch", patch: { type: "transition", typeParam: "sound" } }]).hint).toContain("number, point, color");
    expect(firstError(emptyDoc(), [{ op: "addPatch", patch: { type: "switch", typeParam: "number" } }]).code).toBe("invalid_value");
    expect(firstError(emptyDoc(), [{ op: "addPatch", patch: { type: "add", inputCount: 9 } }]).message).toContain("between 2 and 6");
    expect(firstError(emptyDoc(), [{ op: "addPatch", patch: { type: "switch", inputCount: 3 } }]).code).toBe("invalid_value");
  });

  it("validates inputs against the resolved ports", () => {
    const r = mustApply(emptyDoc(), [{ op: "addPatch", patch: { id: "grow", type: "transition", typeParam: "color", inputs: { start: "red", end: "#00FF00" } } }]);
    expect(main(r.doc).patches.grow!.inputs).toEqual({ start: "#FF3B30FF", end: "#00FF00FF" });
    expect(firstError(emptyDoc(), [{ op: "addPatch", patch: { type: "popAnimation", inputs: { numbr: 1 } } }]).message).toContain('Did you mean "number"');
    expect(firstError(emptyDoc(), [{ op: "addPatch", patch: { type: "popAnimation", inputs: { output: 1 } } }]).hint).toContain("is an output");
    expect(firstError(emptyDoc(), [{ op: "addPatch", patch: { type: "switch", inputs: { flip: true } } }]).message).toContain("pulse input");
    expect(firstError(emptyDoc(), [{ op: "addPatch", patch: { type: "popAnimation", inputs: { number: "5" } } }]).hint).toContain("without quotes");
  });

  it("uses dynamic ports", () => {
    const r = mustApply(emptyDoc(), [{ op: "addPatch", patch: { id: "js", type: "javascript", settings: { ports: { inputs: [["count", "number"]], outputs: [] } }, inputs: { count: 3 } } }]);
    expect(main(r.doc).patches.js!.inputs).toEqual({ count: 3 });
    expect(firstError(emptyDoc(), [{ op: "addPatch", patch: { type: "javascript", inputs: { count: 3 } } }]).code).toBe("unknown_port");
  });
});

describe("updatePatch", () => {
  it("prunes values that no longer fit after a type change and undo restores them", () => {
    const doc = mustApply(emptyDoc(), [
      { op: "addLayer", layer: { type: "rectangle", name: "Card" } },
      { op: "addPatch", patch: { id: "pop", type: "popAnimation" } },
      { op: "addPatch", patch: { id: "grow", type: "transition", typeParam: "color", inputs: { progress: { link: "pop.output" }, start: "#FF0000FF", end: "#0000FFFF" } } },
      { op: "connect", from: "grow.output", to: "@card.color" },
    ]).doc;
    const r = mustApply(doc, [{ op: "updatePatch", id: "grow", typeParam: "number" }]);
    const c = main(r.doc);
    expect(c.patches.grow).toStrictEqual({ type: "transition", typeParam: "number", inputs: { progress: { link: "pop.output" } }, ui: { x: 276, y: 40 } });
    expect(c.layers[0]!.props).toEqual({});
    expect(r.affected.layers).toEqual(["card"]);
    expectRoundTrip(doc, r);
    expect(firstError(doc, [{ op: "updatePatch", id: "grow", typeParam: "audio" }]).code).toBe("invalid_value");
  });

  it("drops variadic inputs when the count shrinks", () => {
    const doc = mustApply(emptyDoc(), [{ op: "addPatch", patch: { id: "sum", type: "add", inputCount: 3, inputs: { value1: 1, value2: 2, value3: 3 } } }]).doc;
    const r = mustApply(doc, [{ op: "updatePatch", id: "sum", inputCount: 2 }]);
    expect(main(r.doc).patches.sum!.inputs).toEqual({ value1: 1, value2: 2 });
    expectRoundTrip(doc, r);
  });

  it("updates name, muted, settings and ui", () => {
    const doc = mustApply(emptyDoc(), [{ op: "addPatch", patch: { id: "js", type: "javascript", settings: { a: 1, b: 2 } } }]).doc;
    const r = mustApply(doc, [{ op: "updatePatch", id: "js", name: "Script", muted: true, settings: { a: null, c: [1] }, ui: { x: 5, collapsed: true, color: "blue" } }]);
    expect(main(r.doc).patches.js).toStrictEqual({ type: "javascript", name: "Script", muted: true, inputs: {}, settings: { b: 2, c: [1] }, ui: { x: 5, y: 40, collapsed: true, color: "blue" } });
    expectRoundTrip(doc, r);
    const cleared = mustApply(r.doc, [{ op: "updatePatch", id: "js", name: "", muted: false, settings: { b: null, c: null }, ui: { collapsed: false, color: "" } }]);
    expect(main(cleared.doc).patches.js).toStrictEqual({ type: "javascript", inputs: {}, ui: { x: 5, y: 40 } });
    expectRoundTrip(r.doc, cleared);
  });
});

describe("removePatch", () => {
  it("cascades links from its outputs and restores exactly", () => {
    const doc = buildSampleDocument();
    const r = mustApply(doc, [{ op: "removePatch", id: "pop" }]);
    expect(main(r.doc).patches.grow!.inputs).toEqual({ start: 1, end: 1.08 });
    expect(main(r.doc).patches.pop).toBeUndefined();
    expect(r.affected.patches).toEqual(["grow", "pop"]);
    expectRoundTrip(doc, r);
  });

  it("restores flags and handles chains removed in one batch", () => {
    const doc = mustApply(buildSampleDocument(), [{ op: "updatePatch", id: "toggle", muted: true, ui: { collapsed: true, color: "red" } }]).doc;
    expectRoundTrip(doc, mustApply(doc, [{ op: "removePatch", id: "toggle" }, { op: "removePatch", id: "tap_card" }]));
    expectRoundTrip(doc, mustApply(doc, [{ op: "removePatch", id: "tap_card" }, { op: "removePatch", id: "toggle" }]));
  });
});

describe("setInput / connect / disconnect", () => {
  it("sets literals, links and resets", () => {
    const doc = buildSampleDocument();
    const r = mustApply(doc, [
      { op: "setInput", target: "pop.speed", value: 20 },
      { op: "setInput", target: "@card.opacity", value: { link: "pop.output" } },
      { op: "setInput", target: "grow.start", value: null },
    ]);
    const c = main(r.doc);
    expect(c.patches.pop!.inputs.speed).toBe(20);
    expect(c.layers[0]!.props.opacity).toEqual({ link: "pop.output" });
    expect("start" in c.patches.grow!.inputs).toBe(false);
    expectRoundTrip(doc, r);
  });

  it("explains wrong addresses", () => {
    const doc = buildSampleDocument();
    expect(firstError(doc, [{ op: "setInput", target: "pop.output", value: 1 }]).hint).toContain('"output" is an output');
    expect(firstError(doc, [{ op: "setInput", target: "card.opacity", value: 1 }]).hint).toContain('"@card.opacity"');
    expect(firstError(doc, [{ op: "setInput", target: "@tap_card.layer", value: 1 }]).hint).toContain("is a patch");
    expect(firstError(doc, [{ op: "setInput", target: "$in.label", value: 1 }]).code).toBe("invalid_address");
    expect(firstError(doc, [{ op: "setInput", target: "nonsense", value: 1 }]).code).toBe("invalid_address");
    expect(firstError(doc, [{ op: "setInput", target: "pop.number#2", value: 1 }]).code).toBe("invalid_address");
    expect(firstError(doc, [{ op: "setInput", target: "@card.scale", value: { layer: "title" } }]).code).toBe("invalid_value");
    expect(firstError(doc, [{ op: "setInput", target: "tap_card.layer", value: { layer: "ghost" } }]).code).toBe("not_found");
  });

  it("connect replaces the existing driver and undo restores it", () => {
    const doc = buildSampleDocument();
    const r = mustApply(doc, [{ op: "connect", from: "tap_card.down", to: "pop.number" }]);
    expect(main(r.doc).patches.pop!.inputs.number).toEqual({ link: "tap_card.down" });
    expect(r.inverse).toEqual([{ op: "setInput", component: "main", target: "pop.number", value: { link: "toggle.on" } }]);
    expectRoundTrip(doc, r);
  });

  it("rejects type mismatches with converter suggestions that apply cleanly", () => {
    const doc = buildSampleDocument();
    const e = firstError(doc, [{ op: "connect", from: "toggle.on", to: "@card.color" }]);
    expect(e.code).toBe("type_mismatch");
    expect(e.message).toContain("toggle.on (on/off (boolean))");
    const s = e.suggestions![0]!;
    expect(s.ops![0]).toMatchObject({ op: "addPatch", patch: { type: "transition", typeParam: "color" } });
    const fixed = mustApply(doc, s.ops!);
    expect(main(fixed.doc).layers[0]!.props.color).toEqual({ link: `${fixed.idMap.transition}.output` });
    expect(main(fixed.doc).patches.transition!.inputs.progress).toEqual({ link: "toggle.on" });
  });

  it("points out swapped directions", () => {
    const e = firstError(buildSampleDocument(), [{ op: "connect", from: "pop.number", to: "toggle.on" }]);
    expect(e.code).toBe("wrong_direction");
    expect(e.suggestions![0]!.ops).toEqual([{ op: "connect", component: "main", from: "toggle.on", to: "pop.number" }]);
  });

  it("rejects direct self edges and suggests a Delay 1", () => {
    const e = firstError(buildSampleDocument(), [{ op: "connect", from: "pop.output", to: "pop.number" }]);
    expect(e.code).toBe("self_edge");
    expect(e.suggestions![0]!.ops![0]).toMatchObject({ op: "addPatch", patch: { type: "delay1" } });
    expect(apply(buildSampleDocument(), e.suggestions![0]!.ops!).ok).toBe(true);
    expect(firstError(buildSampleDocument(), [{ op: "connect", from: "@card.opacity", to: "@card.opacity" }]).code).toBe("self_edge");
  });

  it("allows pulses into numbers and layer outputs as sources", () => {
    expect(apply(buildSampleDocument(), [{ op: "connect", from: "tap_card.tap", to: "pop.number" }]).ok).toBe(true);
    expect(apply(buildSampleDocument(), [{ op: "connect", from: "@title.textSize", to: "grow.start" }]).ok).toBe(true);
    expect(firstError(buildSampleDocument(), [{ op: "connect", from: "@card.nope", to: "grow.start" }]).code).toBe("unknown_port");
  });

  it("disconnects links only", () => {
    const doc = buildSampleDocument();
    const r = mustApply(doc, [{ op: "disconnect", to: "@card.scale" }]);
    expect("scale" in main(r.doc).layers[0]!.props).toBe(false);
    expectRoundTrip(doc, r);
    expect(firstError(doc, [{ op: "disconnect", to: "pop.speed" }])).toMatchObject({ code: "not_connected", hint: expect.stringContaining("setInput") });
    expect(firstError(doc, [{ op: "disconnect", to: "tap_card.enabled" }]).message).toContain("isn't connected");
  });
});

describe("rename", () => {
  it("renames layers, patches and components", () => {
    const doc = buildSampleDocument();
    const r = mustApply(doc, [
      { op: "rename", id: "card", name: "Event Card" },
      { op: "rename", id: "pop", name: "Press Spring" },
      { op: "rename", id: "main", name: "Home" },
    ]);
    expect(main(r.doc).layers[0]!.name).toBe("Event Card");
    expect(main(r.doc).patches.pop!.name).toBe("Press Spring");
    expect(main(r.doc).name).toBe("Home");
    expectRoundTrip(doc, r);
    expect(firstError(doc, [{ op: "rename", id: "crad", name: "x" }]).message).toContain('"card"');
  });

  it("guides comment renames to updateComment", () => {
    const e = firstError(buildSampleDocument(), [{ op: "rename", id: "note_1", name: "x" }]);
    expect(e.suggestions![0]!.ops![0]).toMatchObject({ op: "updateComment", id: "note_1", text: "x" });
  });
});

describe("comments", () => {
  it("adds, updates and removes comments kept in id order", () => {
    const doc = buildSampleDocument();
    const r = mustApply(doc, [
      { op: "addComment", comment: { text: "Second", rect: [0, 0, 10, 10] } },
      { op: "addComment", comment: { id: "a_first", text: "First", rect: [0, 0, 10, 10] } },
      { op: "updateComment", id: "note_1", text: "Updated", color: "" },
    ]);
    expect(main(r.doc).comments.map((c) => c.id)).toEqual(["a_first", "comment", "note_1"]);
    expect(main(r.doc).comments[2]).toStrictEqual({ id: "note_1", text: "Updated", rect: [30, 20, 600, 120] });
    expectRoundTrip(doc, r);
    expectRoundTrip(r.doc, mustApply(r.doc, [{ op: "removeComment", id: "comment" }]));
    expect(firstError(doc, [{ op: "addComment", comment: { text: "x", rect: [1, 2] as unknown as [number, number, number, number] } }]).code).toBe("invalid_value");
    expect(firstError(doc, [{ op: "removeComment", id: "nope" }]).code).toBe("not_found");
  });
});

describe("scripts, assets and project", () => {
  it("sets and removes scripts", () => {
    const doc = emptyDoc();
    const r = mustApply(doc, [{ op: "setScript", file: "js_1.js", source: "log(1)" }]);
    expect(r.doc.scripts).toEqual({ "js_1.js": "log(1)" });
    expectRoundTrip(doc, r);
    expect(firstError(doc, [{ op: "setScript", file: "../evil.js", source: "" }]).code).toBe("invalid_value");
  });

  it("adds assets and cascades removal", () => {
    const doc = mustApply(emptyDoc(), [
      { op: "addAsset", asset: { id: "photo", kind: "image", name: "Photo", file: "ab12.png" } },
      { op: "addLayer", layer: { type: "image", name: "Hero", props: { image: { asset: "photo" } } } },
    ]).doc;
    const r = mustApply(doc, [{ op: "removeAsset", id: "photo" }]);
    expect(r.doc.assets).toEqual({});
    expect(main(r.doc).layers[0]!.props).toEqual({});
    expectRoundTrip(doc, r);
    expect(firstError(doc, [{ op: "addAsset", asset: { id: "photo", kind: "image", name: "P", file: "x.png" } }]).code).toBe("id_taken");
    expect(firstError(doc, [{ op: "addAsset", asset: { id: "p2", kind: "gif" as "image", name: "P", file: "../x.png" } }]).message).toContain("file");
    expect(firstError(doc, [{ op: "setInput", target: "@hero.image", value: { asset: "nope" } }]).hint).toContain("addAsset");
  });

  it("validates project settings with exact inverses", () => {
    const doc = emptyDoc();
    const r = mustApply(doc, [{ op: "setProject", changes: { name: "Checkout", background: "white", fps: 120, generator: null as unknown as string } }]);
    expect(r.doc.project).toStrictEqual({ formatVersion: 1, name: "Checkout", root: "main", device: { preset: "custom" }, background: "#FFFFFFFF", fps: 120 });
    expectRoundTrip(doc, r);
    expect(firstError(doc, [{ op: "setProject", changes: { device: { preset: "iphone-17-por" } } }]).message).toContain("iphone-17-pro");
    expect(firstError(doc, [{ op: "setProject", changes: { fps: 30 as 60 } }]).code).toBe("invalid_value");
    expect(firstError(doc, [{ op: "setProject", changes: { root: "nope" } }]).code).toBe("not_found");
    expect(firstError(doc, [{ op: "setProject", changes: { nmae: "x" } as never }]).message).toContain('"name"');
    expect(firstError(doc, [{ op: "setProject", changes: { name: null as unknown as string } }]).message).toContain("can't be removed");
    expect(firstError(doc, [{ op: "setProject", changes: { formatVersion: 2 } as never }]).code).toBe("invalid_op");
  });
});

describe("Repeat (a copy count)", () => {
  it("takes a whole number from 0 to 10,000, null for Auto, or a link", () => {
    const doc = buildSampleDocument();
    const r = mustApply(doc, [
      { op: "setInput", target: "@card.repeat", value: 4 },
      { op: "setInput", target: "@title.repeat", value: 0 },
    ]);
    expect(main(r.doc).layers[0]!.props.repeat).toBe(4);
    expect(mustApply(r.doc, [{ op: "setInput", target: "@card.repeat", value: null }]).doc.components.main!.layers[0]!.props.repeat).toBeUndefined();
    expect(mustApply(doc, [{ op: "setInput", target: "@card.repeat", value: { link: "pop.output" } }]).ok).toBe(true);
  });

  it("refuses anything else with a teaching error", () => {
    const doc = buildSampleDocument();
    const refuse = (value: unknown) => firstError(doc, [{ op: "setInput", target: "@card.repeat", value: value as never }]);
    expect(refuse("four")).toMatchObject({
      code: "invalid_value",
      message: '@card.repeat (Repeat) needs a whole number of copies from 0 to 10,000, but got text "four".',
      hint: 'Type a whole number like 4, or link a loop to make one copy per item: { "link": "names.loop" }. null goes back to Auto.',
    });
    expect(refuse(-1).message).toBe("@card.repeat (Repeat) needs a whole number of copies from 0 to 10,000, but got the number -1.");
    expect(refuse(2.5).hint).toBe("Copies come in whole numbers: use 2 or 3.");
    expect(refuse("4").hint).toBe("Write the number without quotes: 4.");
    expect(refuse(20_000).hint).toBe("Layers make at most 10,000 copies.");
    expect(refuse({ loop: ["a", "b"] })).toMatchObject({
      message: "@card.repeat (Repeat) counts copies, so it takes a number, not a loop of 2 items.",
      hint: 'To make one copy per item, link the loop instead of typing it, like { "link": "names.loop" }, or type 2.',
    });
  });
});
