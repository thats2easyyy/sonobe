import { describe, expect, it } from "vitest";
import { loopShapes } from "./loopShapes.ts";
import { applyOps } from "./ops/index.ts";
import { emptyDoc, loopRegistry } from "./testing/fixtures.ts";
import type { Op, SonobeDocument } from "./types.ts";

function build(ops: Op[]): SonobeDocument {
  const r = applyOps(emptyDoc(), ops, { registry: loopRegistry });
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 2));
  return r.doc;
}

/** A card with a title inside, four names, a Loop of 6, and a drag on the card. */
const deck: Op[] = [
  { op: "addLayer", layer: { id: "card", type: "group", name: "Card" } },
  { op: "addLayer", parent: "card", layer: { id: "title", type: "text", name: "Title" } },
  { op: "addPatch", patch: { id: "names", type: "loopBuilder", typeParam: "text", inputCount: 4, inputs: { item0: "A", item1: "B", item2: "C", item3: "D" } } },
  { op: "addPatch", patch: { id: "six", type: "loop", inputs: { count: 6 } } },
  { op: "addPatch", patch: { id: "drag", type: "drag", inputs: { layer: { layer: "card" } } } },
  { op: "connect", from: "names.loop", to: "@title.text" },
  { op: "connect", from: "drag.position", to: "@card.position" },
];

describe("loopShapes", () => {
  it("knows the lengths the document fixes, and which values loop without a known length", () => {
    const doc = build([
      ...deck,
      { op: "addPatch", patch: { id: "sum", type: "add", inputs: { value1: { link: "six.index" }, value2: { link: "names.index" } } } },
      { op: "addPatch", patch: { id: "one", type: "add", inputs: { value1: { loop: [5] }, value2: 1 } } },
      { op: "addPatch", patch: { id: "kept", type: "loopFilter", inputs: { loop: { link: "six.index" } } } },
      { op: "addPatch", patch: { id: "plain", type: "add", inputs: { value1: 1, value2: 2 } } },
    ]);
    const shapes = loopShapes(doc, "main", loopRegistry);
    expect(shapes.ofLink("names.loop")).toEqual({ length: 4, origin: "names" });
    expect(shapes.ofLink("six.index")).toEqual({ length: 6, origin: "six" });
    // Per item, the longest loop decides; a one-item loop comes out a plain value.
    expect(shapes.ofLink("sum.output")).toEqual({ length: 6, origin: "six" });
    expect(shapes.ofLink("one.output")).toBeNull();
    // A filter's length is only known while the prototype runs.
    expect(shapes.ofLink("kept.output")).toEqual({ length: null, origin: "kept" });
    expect(shapes.ofLink("plain.output")).toBeNull();
    // Published inputs come from outside the component; constants like "$knob.<id>" never loop.
    expect(shapes.ofLink("$in.items")).toBeNull();
    expect(shapes.ofLink("$knob.speed")).toBeNull();
    expect(shapes.ofValue({ loop: [1, 2, 3] }, "title")).toEqual({ length: 3, origin: "title" });
  });

  it("works out copies: Auto from the layer's own loops, Repeat alone when set, and children of copies", () => {
    const auto = loopShapes(build(deck), "main", loopRegistry);
    // The card's only loop would be its own drag, which runs once per copy: a cycle, so one copy.
    expect(auto.copies("card")).toEqual({ kind: "single" });
    expect(auto.copies("title")).toEqual({ kind: "auto", count: 4 });
    expect(auto.ofLink("drag.position")).toBeNull();

    const linked = loopShapes(build([...deck, { op: "setInput", target: "@card.repeat", value: { link: "names.loop" } }]), "main", loopRegistry);
    expect(linked.copies("card")).toEqual({ kind: "repeat", count: 4 });
    expect(linked.copies("title")).toEqual({ kind: "inherited", ancestor: "card" });
    expect(linked.count("title")).toBe(4);
    // The drag now runs once per copy of the card.
    expect(linked.ofLink("drag.position")).toEqual({ length: 4, origin: "card" });
    // Read as a source, Repeat is the copy count, one number, not the loop it counts.
    expect(linked.ofLink("@card.repeat")).toBeNull();

    const typed = loopShapes(build([...deck, { op: "setInput", target: "@card.repeat", value: 3 }]), "main", loopRegistry);
    expect(typed.copies("card")).toEqual({ kind: "repeat", count: 3 });
    const filtered = loopShapes(
      build([...deck, { op: "addPatch", patch: { id: "kept", type: "loopFilter", inputs: { loop: { link: "six.index" } } } }, { op: "setInput", target: "@card.repeat", value: { link: "kept.output" } }]),
      "main",
      loopRegistry,
    );
    expect(filtered.copies("card")).toEqual({ kind: "repeat", count: null });
  });
});
