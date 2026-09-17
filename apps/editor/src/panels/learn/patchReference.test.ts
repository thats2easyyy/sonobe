import { createPatchRegistry } from "@sonobe/patches";
import { CATEGORY_ORDER } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { formatPortDefault, listPatchReference, patchAvailability, patchPortRows, searchPatchReference } from "./patchReference.ts";

const registry = createPatchRegistry();
const items = listPatchReference(registry);

describe("patch reference", () => {
  it("lists every registry patch in category order", () => {
    expect(items).toHaveLength(registry.patches.size);
    const ranks = items.map((i) => CATEGORY_ORDER.indexOf(i.category));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(items.find((i) => i.type === "popAnimation")).toMatchObject({ name: "Pop Animation", categoryLabel: "Animation" });
  });

  it("searches names, aliases, and summaries", () => {
    expect(searchPatchReference(items, "pop animation")[0]!.item.type).toBe("popAnimation");
    expect(searchPatchReference(items, "bouncy").map((r) => r.item.type)).toContain("popAnimation");
    expect(searchPatchReference(items, "")).toHaveLength(items.length);
    const animation = searchPatchReference(items, "", "animation");
    expect(animation.length).toBeGreaterThan(0);
    expect(animation.every((r) => r.item.category === "animation")).toBe(true);
    expect(searchPatchReference(items, "zzqxnotapatch")).toEqual([]);
  });

  it("formats port defaults", () => {
    expect(formatPortDefault(undefined)).toBe("");
    expect(formatPortDefault(5)).toBe("5");
    expect(formatPortDefault(0.123456)).toBe("0.123");
    expect(formatPortDefault(true)).toBe("on");
    expect(formatPortDefault("#FF375FFF")).toBe("#FF375FFF");
    expect(formatPortDefault([0, 0.5])).toBe("[0, 0.5]");
    expect(formatPortDefault({ r: 1, g: 0, b: 0, a: 1 })).toBe('{"r":1,"g":0,"b":0,"a":1}');
  });

  it("builds port rows, including variadic ports", () => {
    const pop = registry.patches.get("popAnimation")!;
    expect(patchPortRows(pop, "inputs").map((r) => r.key)).toEqual(pop.inputs.map((p) => p.key));
    const variadic = items.find((i) => i.spec.variadic && (i.spec.variadic.direction ?? "inputs") === "inputs")!;
    const rows = patchPortRows(variadic.spec, "inputs");
    expect(rows.at(-1)!.variadic).toEqual({ min: variadic.spec.variadic!.min, max: variadic.spec.variadic!.max });
    expect(patchAvailability(pop)).toMatchObject({ status: null });
  });
});
