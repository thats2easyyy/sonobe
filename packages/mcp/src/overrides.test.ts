/** Simulation-only overrides: turning requests into ops, teaching errors, and re-applying them. */

import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { isHostError, type SimOverrideRequest } from "./host.ts";
import {
  applyOverrides,
  overrideEntries,
  overrideKeys,
  type NewOverride,
  type OverrideEntry,
} from "./overrides.ts";

const registry = createPatchRegistry();

function build(doc: SonobeDocument, ops: unknown[]): SonobeDocument {
  const r = applyOps(doc, ops as Op[], { registry });
  expect(r.ok, JSON.stringify(r.errors)).toBe(true);
  return r.doc;
}

/** Two stacked cards, tap-to-grow on the top one, and a Badge component with one instance. */
function deck(): SonobeDocument {
  let doc = build(createEmptyDocument({ name: "Deck" }), [
    { op: "addLayer", layer: { type: "rectangle", name: "Card 2", props: { size: [300, 400] } } },
    {
      op: "addLayer",
      layer: { type: "rectangle", name: "Card 1", props: { size: [300, 400], opacity: 0.9 } },
    },
    {
      op: "addLayer",
      layer: { type: "group", name: "Badge", children: [{ type: "oval", name: "Dot" }] },
    },
    {
      op: "addPatch",
      patch: {
        ref: "tap",
        type: "interaction",
        name: "Tap Card",
        inputs: { layer: { layer: "card_1" } },
      },
    },
    {
      op: "addPatch",
      patch: {
        ref: "grown",
        type: "switch",
        name: "Card Grown",
        inputs: { flip: { link: "$tap.tap" } },
      },
    },
    {
      op: "addPatch",
      patch: {
        ref: "spring",
        type: "popAnimation",
        name: "Grow Spring",
        inputs: { number: { link: "$grown.on" }, bounciness: 5 },
      },
    },
    { op: "connect", from: "$spring.output", to: "@card_1.scale" },
  ]);
  doc = build(doc, [{ op: "createComponent", name: "Badge Piece", layerIds: ["badge"] }]);
  return doc;
}

const entries = (doc: SonobeDocument, request: SimOverrideRequest): OverrideEntry[] =>
  overrideEntries(doc, request, registry).map((e: NewOverride, i) => ({ ...e, id: `ov_${i + 1}` }));

function thrown(fn: () => unknown): { code: string; message: string; hint?: string } {
  try {
    fn();
  } catch (err) {
    if (isHostError(err))
      return { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) };
    throw err;
  }
  throw new Error("Expected a HostError");
}

describe("simulation overrides", () => {
  it("say what they change and what it was", () => {
    const doc = deck();
    const root = doc.project.root;
    const list = entries(doc, {
      set: [
        { target: "@card_1.opacity", value: 0 },
        { target: "@card_2.opacity", value: 0.5 },
        { target: "@card_1.scale", value: 1.5 },
        { target: "grow_spring.speed", value: null },
      ],
      ops: [
        { op: "disconnect", to: "grow_spring.number" },
        { op: "connect", from: "tap_card.down", to: "grow_spring.number" },
        { op: "updatePatch", id: "card_grown", muted: true },
      ],
    });
    expect(list.map((e) => e.summary)).toEqual([
      "@card_1.opacity = 0 (was 0.9)",
      "@card_2.opacity = 0.5 (was the default 1)",
      "@card_1.scale = 1.5 (was linked to grow_spring.output)",
      "grow_spring.speed = its default (was the default 10)",
      "grow_spring.number disconnected (was linked to card_grown.on)",
      "grow_spring.number ← tap_card.down (was linked to card_grown.on)",
      "card_grown muted (wasn't muted)",
    ]);
    expect(list.map((e) => e.key)).toEqual([
      `${root}|@card_1.opacity`,
      `${root}|@card_2.opacity`,
      `${root}|@card_1.scale`,
      `${root}|grow_spring.speed`,
      `${root}|grow_spring.number`,
      `${root}|grow_spring.number`,
      `${root}|mute:card_grown`,
    ]);
    expect(list[0]!.note).toBe("overridden in this simulation, was 0.9");
  });

  it("split updateLayer props into one override each and reach into components through instance paths", () => {
    const doc = deck();
    const [a, b] = entries(doc, {
      ops: [{ op: "updateLayer", id: "card_2", props: { opacity: 0, rotation: 5 } }],
    });
    expect([a!.target, b!.target]).toEqual(["@card_2.opacity", "@card_2.rotation"]);
    expect(a!.ops).toEqual([
      { op: "setInput", component: doc.project.root, target: "@card_2.opacity", value: 0 },
    ]);

    const instance = doc.components[doc.project.root]!.layers.find(
      (l) => l.type === "componentInstance",
    )!;
    const [inside] = entries(doc, { set: [{ target: `@${instance.id}/dot.opacity`, value: 0 }] });
    expect(inside).toMatchObject({
      component: instance.component,
      key: `${instance.component}|@dot.opacity`,
    });
    expect(inside!.summary).toContain(`applies to every instance of ${instance.component}`);
  });

  it("refuse one loop copy, outputs and structural ops with a teaching error", () => {
    const doc = deck();
    const perCopy = thrown(() =>
      entries(doc, { set: [{ target: "@card_1.opacity#3", value: 0 }] }),
    );
    expect(perCopy.code).toBe("override_per_copy");
    expect(perCopy.hint).toContain('"@card_1.opacity"');
    expect(perCopy.hint).toContain("isolate: true");
    expect(
      thrown(() => entries(doc, { set: [{ target: "@badge#2/dot.opacity", value: 0 }] })).code,
    ).toBe("override_per_copy");
    expect(
      thrown(() =>
        entries(doc, {
          ops: [{ op: "connect", from: "tap_card.down#1", to: "grow_spring.number" }],
        }),
      ).code,
    ).toBe("override_per_copy");

    const output = thrown(() => entries(doc, { set: [{ target: "card_grown.on", value: true }] }));
    expect(output).toMatchObject({
      code: "override_output",
      hint: "Override what it drives instead: grow_spring.number.",
    });

    for (const op of [
      { op: "removeLayer", id: "card_1" },
      { op: "updateLayer", id: "card_1", name: "Top" },
      { op: "updatePatch", id: "grow_spring", typeParam: "point" },
    ] as Op[])
      expect(thrown(() => entries(doc, { ops: [op] })).code, op.op).toBe("override_op_unsupported");
    expect(
      thrown(() => entries(doc, { set: [{ target: "@card_1.opacity", value: undefined }] })).code,
    ).toBe("invalid_value");
    const typo = thrown(() => entries(doc, { ops: [{ op: "setinput" } as unknown as Op] }));
    expect(typo.message).toContain('"setinput" isn\'t an op kind. Did you mean "setInput"?');
  });

  it("apply on top of the person's document and drop the ones it no longer accepts", () => {
    const doc = deck();
    const list = entries(doc, {
      set: [
        { target: "@card_1.opacity", value: 0 },
        { target: "@card_2.opacity", value: 0.5 },
        { target: "grow_spring.bouncyness", value: 3 },
      ],
    });
    const applied = applyOverrides(doc, list, registry);
    expect(applied.kept.map((e) => e.target)).toEqual(["@card_1.opacity", "@card_2.opacity"]);
    expect(applied.failed[0]!.error.message).toContain('Did you mean "bounciness"');
    const card2 = applied.doc.components[doc.project.root]!.layers.find((l) => l.id === "card_2")!;
    expect(card2.props.opacity).toBe(0.5);
    // The person's document is untouched.
    expect(
      doc.components[doc.project.root]!.layers.find((l) => l.id === "card_2")!.props.opacity,
    ).toBeUndefined();

    const edited = build(doc, [{ op: "removeLayer", id: "card_2" }]);
    const again = applyOverrides(edited, applied.kept, registry);
    expect(again.kept.map((e) => e.target)).toEqual(["@card_1.opacity"]);
    expect(again.failed.map((f) => f.entry.target)).toEqual(["@card_2.opacity"]);
  });

  it("match value addresses to overrides whatever copy they read", () => {
    const doc = deck();
    const root = doc.project.root;
    expect(overrideKeys(doc, "@card_1.opacity#2")).toEqual([`${root}|@card_1.opacity`]);
    expect(overrideKeys(doc, "grow_spring.output")).toEqual([
      `${root}|grow_spring.output`,
      `${root}|mute:grow_spring`,
    ]);
    expect(overrideKeys(doc, "grow_spring")).toEqual([
      `${root}|grow_spring`,
      `${root}|mute:grow_spring`,
    ]);
    expect(overrideKeys(doc, "nope/thing.value")).toEqual([]);
  });
});
