import { createPatchRegistry } from "@sonobe/patches";
import { describe, expect, it } from "vitest";
import { createDemoDocument } from "../../../state/demoDocument.ts";
import { applyOps } from "@sonobe/core";
import { COMMON_GROUP, COMMON_PATCH_TYPES, COMPONENTS_GROUP, docsExcerpt, pickerBrowseItems, pickerGroup, pickerItems } from "./picker.ts";

const registry = createPatchRegistry();
const demo = createDemoDocument(registry);
const withComponent = applyOps(demo, [{ op: "createComponent", component: "main", name: "Heart Logic", patchIds: ["liked", "like_spring"] }], { registry }).doc;

describe("pickerBrowseItems", () => {
  const groups = (doc = demo) => {
    const order: string[] = [];
    for (const item of pickerBrowseItems(pickerItems(registry, doc))) if (order.at(-1) !== pickerGroup(item)) order.push(pickerGroup(item));
    return order;
  };

  it("starts with the Common group in flow order, Interaction first", () => {
    const browse = pickerBrowseItems(pickerItems(registry, demo));
    expect(browse.slice(0, COMMON_PATCH_TYPES.length).map((i) => i.spec.type)).toEqual([...COMMON_PATCH_TYPES]);
    expect(browse.slice(0, COMMON_PATCH_TYPES.length).every((i) => pickerGroup(i) === COMMON_GROUP)).toBe(true);
  });

  it("keeps every patch in its category and gives the copies their own ids", () => {
    const items = pickerItems(registry, demo);
    const browse = pickerBrowseItems(items);
    expect(browse).toHaveLength(items.length + COMMON_PATCH_TYPES.length);
    expect(new Set(browse.map((i) => i.id)).size).toBe(browse.length);
  });

  it("puts project components right after Common, then the categories", () => {
    expect(groups(withComponent).slice(0, 3)).toEqual([COMMON_GROUP, COMPONENTS_GROUP, "Interaction"]);
    expect(groups()[1]).toBe("Interaction");
  });
});

describe("docsExcerpt", () => {
  it("takes the opening paragraph as plain text", () => {
    const docs = "## How it works\nInteraction watches **one layer** for `touches`.\nLeave it empty for all.\n\n- **Down** is a state.";
    expect(docsExcerpt(docs)).toBe("Interaction watches one layer for touches. Leave it empty for all.");
  });

  it("keeps whole sentences within about 140 characters", () => {
    const docs = "Drag moves a layer with the pointer. It does not move anything by itself, so link its outputs to a position. Use it for cards and sheets that follow a finger across the screen.";
    expect(docsExcerpt(docs)).toBe("Drag moves a layer with the pointer. It does not move anything by itself, so link its outputs to a position.");
  });

  it("skips sentences that repeat the summary", () => {
    const docs = "Drag moves a layer with the pointer. Link its outputs to a position.";
    expect(docsExcerpt(docs, "Moves a layer with the pointer")).toBe("Link its outputs to a position.");
  });

  it("has nothing for docs without a paragraph", () => {
    expect(docsExcerpt(undefined)).toBeUndefined();
    expect(docsExcerpt("## Heading\n- item")).toBeUndefined();
  });
});
