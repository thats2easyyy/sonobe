import { applyOps, createEmptyDocument, findLayer, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { applyPastePlan, createClipboardFragment, parseClipboardFragment, planPaste, serializeClipboardFragment } from "./clipboard.ts";
import { getRegistry } from "./registry.ts";

const registry = getRegistry();

function build(ops: Op[], doc: SonobeDocument = createEmptyDocument()): SonobeDocument {
  const result = applyOps(doc, ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

/** Card that grows on tap. */
const tapToGrow = () =>
  build([
    { op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card", props: { position: [16, 120], size: [358, 220] } } },
    { op: "addPatch", patch: { id: "tap", type: "interaction", inputs: { layer: { layer: "card" } }, ui: { x: 40, y: 60 } } },
    { op: "addPatch", patch: { id: "toggle", type: "switch", ui: { x: 220, y: 60 } } },
    { op: "addPatch", patch: { id: "pop", type: "popAnimation", inputs: { bounciness: 8 }, ui: { x: 400, y: 60 } } },
    { op: "addPatch", patch: { id: "grow", type: "transition", typeParam: "number", inputs: { start: 1, end: 1.08 }, ui: { x: 580, y: 60 } } },
    { op: "connect", from: "tap.tap", to: "toggle.flip" },
    { op: "connect", from: "toggle.on", to: "pop.number" },
    { op: "connect", from: "pop.output", to: "grow.progress" },
    { op: "connect", from: "grow.output", to: "@card.scale" },
    { op: "updatePatch", id: "pop", muted: true },
  ]);

const pasteInto = (doc: SonobeDocument, text: string, offset: [number, number] = [24, 24]) => {
  const fragment = parseClipboardFragment(text);
  expect(fragment).not.toBeNull();
  const plan = planPaste(doc, "main", fragment!, { patchOffset: offset });
  return applyPastePlan(plan, (ops) => applyOps(doc, ops, { registry }));
};

describe("clipboard", () => {
  it("round-trips a fragment and remaps ids and links to the copies", () => {
    const doc = tapToGrow();
    const fragment = createClipboardFragment(doc, "main", { layers: ["card"], patches: ["tap", "toggle", "pop", "grow"] })!;
    expect(fragment).toMatchObject({ type: "sonobe/clipboard", formatVersion: 1, source: { component: "main" } });
    const text = serializeClipboardFragment(fragment);
    expect(parseClipboardFragment(text)).toEqual(fragment);

    const outcome = pasteInto(doc, text);
    expect(outcome.result.ok).toBe(true);
    expect(outcome.droppedLinks).toBe(0);
    expect(outcome.layers).toEqual(["card_2"]);
    const [tap, toggle, pop, grow] = ["tap", "toggle", "pop", "grow"].map((id) => outcome.result.idMap[`p_${id}`]!);
    expect([tap, toggle, pop, grow]).toEqual(["tap_2", "toggle_2", "pop_2", "grow_2"]);

    const main = outcome.result.doc.components.main!;
    expect(main.patches[tap!]!.inputs.layer).toEqual({ layer: "card_2" });
    expect(main.patches[toggle!]!.inputs.flip).toEqual({ link: "tap_2.tap" });
    expect(main.patches[pop!]!.inputs).toEqual({ number: { link: "toggle_2.on" }, bounciness: 8 });
    expect(main.patches[pop!]!.muted).toBe(true);
    expect(main.patches[grow!]!.inputs.progress).toEqual({ link: "pop_2.output" });
    expect(main.patches[grow!]!.ui).toEqual({ x: 604, y: 84 });
    expect(findLayer(main.layers, "card_2")!.layer.props).toEqual({ position: [16, 120], size: [358, 220], scale: { link: "grow_2.output" } });
    // The originals are untouched.
    expect(findLayer(main.layers, "card")!.layer.props.scale).toEqual({ link: "grow.output" });
    expect(main.patches.toggle!.inputs.flip).toEqual({ link: "tap.tap" });
  });

  it("keeps links to items that exist where you paste", () => {
    const doc = tapToGrow();
    const outcome = pasteInto(doc, serializeClipboardFragment(createClipboardFragment(doc, "main", { patches: ["grow"] })!));
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.doc.components.main!.patches.grow_2!.inputs.progress).toEqual({ link: "pop.output" });
  });

  it("drops links to items that don't exist in the target", () => {
    const doc = tapToGrow();
    const text = serializeClipboardFragment(createClipboardFragment(doc, "main", { layers: ["card"], patches: ["tap"] })!);
    const outcome = pasteInto(createEmptyDocument(), text);
    expect(outcome.result.ok).toBe(true);
    const main = outcome.result.doc.components.main!;
    expect(main.layers.map((l) => l.id)).toEqual(["card"]);
    expect(main.layers[0]!.props.scale).toBeUndefined();
    expect(main.patches.tap!.inputs.layer).toEqual({ layer: "card" });
  });

  it("keeps knob links where the knob exists with the same type, and pastes the knob's value elsewhere", () => {
    const doc = build(
      [
        { op: "addKnob", knob: { id: "bounce", name: "Bounce", type: "number", value: 12 } },
        { op: "addKnob", knob: { id: "radius", name: "Radius", type: "number", value: 24 } },
        { op: "setInput", target: "pop.bounciness", value: { link: "$knob.bounce" } },
        { op: "setInput", target: "@card.cornerRadius", value: { link: "$knob.radius" } },
      ],
      tapToGrow(),
    );
    const fragment = createClipboardFragment(doc, "main", { layers: ["card"], patches: ["pop"] })!;
    expect(fragment.knobs).toEqual({ bounce: { type: "number", value: 12 }, radius: { type: "number", value: 24 } });
    const text = serializeClipboardFragment(fragment);
    expect(parseClipboardFragment(text)!.knobs).toEqual(fragment.knobs);

    const same = pasteInto(doc, text).result.doc.components.main!;
    expect(same.patches.pop_2!.inputs.bounciness).toEqual({ link: "$knob.bounce" });
    expect(findLayer(same.layers, "card_2")!.layer.props.cornerRadius).toEqual({ link: "$knob.radius" });

    // Another prototype: one knob is missing and the other is a different type there.
    const other = build([{ op: "addKnob", knob: { id: "radius", name: "Radius", type: "boolean", value: true } }]);
    const elsewhere = pasteInto(other, text);
    expect(elsewhere.result.ok).toBe(true);
    const main = elsewhere.result.doc.components.main!;
    expect(main.patches.pop!.inputs.bounciness).toBe(12);
    expect(findLayer(main.layers, "card")!.layer.props.cornerRadius).toBe(24);
  });

  it("copies subtrees without selecting descendants twice", () => {
    const doc = build([
      { op: "addLayer", layer: { id: "group", type: "group", name: "Group", children: [{ id: "dot", type: "oval", name: "Dot" }] } },
    ]);
    const fragment = createClipboardFragment(doc, "main", { layers: ["dot", "group"] })!;
    expect(fragment.layers.map((l) => l.id)).toEqual(["group"]);
    const outcome = pasteInto(doc, serializeClipboardFragment(fragment));
    expect(outcome.result.doc.components.main!.layers.map((l) => [l.id, l.children?.map((c) => c.id)])).toEqual([
      ["group", ["dot"]],
      ["group_2", ["dot_2"]],
    ]);
  });

  it("rejects text that isn't a fragment", () => {
    expect(parseClipboardFragment("hello")).toBeNull();
    expect(parseClipboardFragment('{"type":"other"}')).toBeNull();
    expect(parseClipboardFragment({ type: "sonobe/clipboard", formatVersion: 1, layers: [{ id: 3 }], patches: {}, assets: {} })).toBeNull();
    expect(parseClipboardFragment({ type: "sonobe/clipboard", formatVersion: 2, layers: [], patches: {}, assets: {} })).toBeNull();
    expect(createClipboardFragment(createEmptyDocument(), "main", { layers: ["nope"] })).toBeNull();
  });
});
