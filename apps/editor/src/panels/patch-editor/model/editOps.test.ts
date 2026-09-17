// @vitest-environment happy-dom
import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { alignPositions, commentAroundOps, duplicatePatchOps, insertPatchOps, movePatchOps, replacePatchOps, spliceOptions, splicePatchOps } from "./editOps.ts";
import { pickerItems, searchPicker } from "./picker.ts";

const registry = createPatchRegistry();
const demo = createDemoDocument(registry);

function apply(doc: SonobeDocument, ops: Op[]) {
  const r = applyOps(doc, ops, { registry, defaultComponent: "main" });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return r;
}

describe("insertPatchOps", () => {
  it("adds a patch at a rounded position with its variant", () => {
    const r = apply(demo, insertPatchOps("main", "transition", { x: 10.4, y: 20.6 }, { typeParam: "color" }));
    const id = r.idMap.inserted!;
    expect(r.doc.components.main!.patches[id]).toMatchObject({ type: "transition", typeParam: "color", ui: { x: 10, y: 21 } });
  });
});

describe("duplicatePatchOps", () => {
  it("copies values and outside connections, and rewires links between copies", () => {
    const component = demo.components.main!;
    const plan = duplicatePatchOps(component, ["zoom_spring", "photo_scale"], new Map([["zoom_spring", { x: 500, y: 700 }], ["photo_scale", { x: 740, y: 700 }]]));
    const r = apply(demo, plan.ops);
    const spring = r.doc.components.main!.patches[r.idMap.dup_zoom_spring!]!;
    const scale = r.doc.components.main!.patches[r.idMap.dup_photo_scale!]!;
    expect(spring.ui).toEqual({ x: 500, y: 700 });
    expect(spring.inputs).toMatchObject({ number: { link: "zoomed.on" }, bounciness: 6, speed: 12 });
    expect(scale.inputs.progress).toEqual({ link: `${r.idMap.dup_zoom_spring}.output` });
    expect(spring.name).toBe("Zoom Spring");
  });
});

describe("replacePatchOps", () => {
  it("swaps the type in place and keeps cables that still fit", () => {
    const plan = replacePatchOps(demo, "main", registry, "zoom_spring", "classicAnimation");
    if ("error" in plan) throw new Error(plan.error);
    const r = apply(demo, plan.ops);
    const main = r.doc.components.main!;
    expect(main.patches.zoom_spring).toBeUndefined();
    const id = r.idMap.replacement!;
    expect(main.patches[id]).toMatchObject({ type: "classicAnimation", typeParam: "number", name: "Zoom Spring", ui: { x: 480, y: 60 } });
    expect(main.patches[id]!.inputs.number).toEqual({ link: "zoomed.on" });
    expect(main.patches.photo_scale!.inputs.progress).toEqual({ link: `${id}.output` });
    expect(main.patches.card_shadow!.inputs.progress).toEqual({ link: `${id}.output` });
    expect(plan.dropped).toBe(0);
  });

  it("reports a missing type", () => {
    expect(replacePatchOps(demo, "main", registry, "zoomed", "nope")).toEqual({ error: 'There\'s no patch type "nope".' });
  });
});

describe("splicePatchOps", () => {
  it("puts a patch between the two ends of a cable", () => {
    const withNot = apply(demo, insertPatchOps("main", "reverseProgress", { x: 600, y: 250 }));
    const id = withNot.idMap.inserted!;
    const plan = splicePatchOps(withNot.doc, "main", registry, id, { from: "zoom_spring.output", to: "photo_scale.progress" });
    if ("error" in plan) throw new Error(plan.error);
    const r = apply(withNot.doc, plan.ops);
    expect(r.doc.components.main!.patches[id]!.inputs.progress).toEqual({ link: "zoom_spring.output" });
    expect(r.doc.components.main!.patches.photo_scale!.inputs.progress).toEqual({ link: `${id}.output` });
  });

  it("refuses patches with no fitting ports", () => {
    const doc = apply(demo, insertPatchOps("main", "variableBroadcaster", { x: 0, y: 900 }));
    const plan = splicePatchOps(doc.doc, "main", registry, doc.idMap.inserted!, { from: "zoom_spring.output", to: "photo_scale.progress" });
    expect(plan).toMatchObject({ error: expect.stringMatching(/no output/) });
  });
});

describe("spliceOptions", () => {
  const cable = { from: "zoom_spring.output", to: "photo_scale.progress" };

  it("offers every input that takes the cable and every output that drives on, best fit first", () => {
    const withTransition = apply(demo, insertPatchOps("main", "transition", { x: 600, y: 900 }, { typeParam: "number" }));
    const id = withTransition.idMap.inserted!;
    const options = spliceOptions(withTransition.doc, "main", registry, id, cable);
    if ("error" in options) throw new Error(options.error);
    expect(options.length).toBeGreaterThan(1);
    expect(options[0]).toMatchObject({ inputKey: "progress", outputKey: "output", conversions: [] });
    expect(options.map((o) => o.inputKey)).toEqual(expect.arrayContaining(["start", "end"]));
    const plan = splicePatchOps(withTransition.doc, "main", registry, id, cable, { inputKey: "end", outputKey: "output" });
    if ("error" in plan) throw new Error(plan.error);
    const r = apply(withTransition.doc, plan.ops);
    expect(r.doc.components.main!.patches[id]!.inputs.end).toEqual({ link: "zoom_spring.output" });
    expect(r.doc.components.main!.patches.photo_scale!.inputs.progress).toEqual({ link: `${id}.output` });
  });

  it("gives one option when only one pair fits, and the same errors as splicing", () => {
    const withReverse = apply(demo, insertPatchOps("main", "reverseProgress", { x: 600, y: 900 }));
    const one = spliceOptions(withReverse.doc, "main", registry, withReverse.idMap.inserted!, cable);
    expect(Array.isArray(one) && one.length).toBe(1);
    const withBroadcaster = apply(demo, insertPatchOps("main", "variableBroadcaster", { x: 0, y: 900 }));
    expect(spliceOptions(withBroadcaster.doc, "main", registry, withBroadcaster.idMap.inserted!, cable)).toMatchObject({ error: expect.stringMatching(/no output/) });
  });
});

describe("alignPositions and moves", () => {
  it("aligns left edges into a column without overlaps", () => {
    const rects = [
      { id: "a", x: 40, y: 0, width: 100, height: 80 },
      { id: "b", x: 200, y: 30, width: 100, height: 80 },
      { id: "c", x: 10, y: 300, width: 100, height: 80 },
    ];
    const left = alignPositions(rects, "left");
    expect([...left.values()].every((p) => p.x === 10)).toBe(true);
    expect(left.get("b")!.y).toBeGreaterThanOrEqual(left.get("a")!.y + 80 + 16);
    expect(left.get("c")!.y).toBe(300);
    const top = alignPositions(rects, "top");
    expect([...top.values()].every((p) => p.y === 0)).toBe(true);
    expect(top.get("a")!.x).toBeGreaterThanOrEqual(top.get("c")!.x + 100 + 24);
  });

  it("only moves patches whose position changed", () => {
    const ops = movePatchOps(demo.components.main!, new Map([["zoomed", { x: 260, y: 60 }], ["liked", { x: 1, y: 2 }]]));
    expect(ops).toEqual([{ op: "updatePatch", component: "main", id: "liked", ui: { x: 1, y: 2 } }]);
  });

  it("frames a selection with a comment", () => {
    const r = apply(createEmptyDocument(), commentAroundOps("main", [{ x: 100, y: 100, width: 200, height: 80 }], "Notes", "blue"));
    expect(r.doc.components.main!.comments[0]).toMatchObject({ text: "Notes", color: "blue", rect: [80, 64, 240, 136] });
  });
});

describe("patch picker ranking", () => {
  const items = pickerItems(registry, demo);

  it("lists every patch type grouped by category", () => {
    expect(items.length).toBe(registry.patches.size - 1);
    expect(items[0]!.spec.category).toBe("interaction");
  });

  it("ranks exact and everyday matches first, and searches aliases", () => {
    expect(searchPicker(items, "switch")[0]!.spec.type).toBe("switch");
    expect(searchPicker(items, "pop")[0]!.spec.type).toBe("popAnimation");
    expect(searchPicker(items, "spring").slice(0, 3).some((i) => i.spec.type === "popAnimation")).toBe(true);
    const tiers = searchPicker(items, "loop", 6).map((i) => i.spec.tier ?? 2);
    expect(tiers[0]).toBe(1);
  });
});
