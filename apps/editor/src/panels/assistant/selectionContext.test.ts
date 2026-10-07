import { applyOps, createEmptyDocument, type Op, type SonobeDocument } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { getRegistry } from "../../state/registry.ts";
import { explainPrompt, MAX_SELECTION_ITEMS, selectionContext, selectionCount, selectionKey, selectionLabel, selectionStarters } from "./selectionContext.ts";
import type { AssistantSelectionContext } from "./types.ts";

const registry = getRegistry();

function build(ops: Op[]): SonobeDocument {
  const result = applyOps(createEmptyDocument({ name: "Camera Demo" }), ops, { registry });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.doc;
}

const doc = build([
  { op: "addLayer", layer: { id: "level_line", type: "rectangle", name: "Level Line", props: {} } },
  { op: "addPatch", patch: { id: "flight_timer", type: "wait", name: "Flight Timer", inputs: {} } },
  { op: "addPatch", patch: { id: "camera", type: "camera", inputs: {} } },
  { op: "addComment", comment: { id: "note_1", text: "The photo's flight\nIt shrinks along a curve.", rect: [0, 0, 300, 200] } },
]);
const main = doc.project.root;
const selected = (items: { layers?: string[]; patches?: string[]; comments?: string[] }, componentPath = [main]) => ({ componentPath, layers: items.layers ?? [], patches: items.patches ?? [], comments: items.comments ?? [] });

describe("selectionContext", () => {
  it("is null when nothing is selected, or nothing selected still exists", () => {
    expect(selectionContext(doc, registry, selected({}))).toBeNull();
    expect(selectionContext(doc, registry, selected({ patches: ["gone"], layers: ["also_gone"] }))).toBeNull();
    expect(selectionContext(doc, registry, selected({ patches: ["flight_timer"] }, [main, "not_a_component"]))).toBeNull();
  });

  it("lists patches, then layers, then comments, with the names and types the Assistant reads", () => {
    expect(selectionContext(doc, registry, selected({ layers: ["level_line"], patches: ["flight_timer", "camera", "gone"], comments: ["note_1"] }))).toEqual({
      component: { id: main, name: "Main" },
      items: [
        { kind: "patch", id: "flight_timer", name: "Flight Timer", type: "wait" },
        // A patch nobody named goes by its type's name.
        { kind: "patch", id: "camera", name: "Camera", type: "camera" },
        { kind: "layer", id: "level_line", name: "Level Line", type: "rectangle" },
        { kind: "comment", id: "note_1", name: "The photo's flight" },
      ],
    });
  });

  it("lists at most 50 items and counts the rest", () => {
    const many = build(Array.from({ length: MAX_SELECTION_ITEMS + 7 }, (_, i): Op => ({ op: "addLayer", layer: { id: `box_${i}`, type: "rectangle", name: `Box ${i}`, props: {} } })));
    const context = selectionContext(many, registry, selected({ layers: Array.from({ length: MAX_SELECTION_ITEMS + 7 }, (_, i) => `box_${i}`) }, [many.project.root]))!;
    expect(context.items).toHaveLength(MAX_SELECTION_ITEMS);
    expect(context.more).toBe(7);
    expect(selectionCount(context)).toBe(MAX_SELECTION_ITEMS + 7);
  });
});

const one: AssistantSelectionContext = { component: { id: "main", name: "Main" }, items: [{ kind: "patch", id: "flight_timer", name: "Flight Timer", type: "wait" }] };
const two: AssistantSelectionContext = { ...one, items: [...one.items, { kind: "layer", id: "level_line", name: "Level Line", type: "rectangle" }] };
const four: AssistantSelectionContext = { ...two, items: [...two.items, { kind: "patch", id: "camera", name: "Camera", type: "camera" }], more: 1 };

describe("what the chat says about a selection", () => {
  it("asks about one item as this, and about several as these", () => {
    expect(explainPrompt(one)).toBe("What does this do, and how does it work?");
    expect(explainPrompt(two)).toBe("What do these do, and how do they work together?");
    expect(selectionStarters(one)).toEqual(["What does this do?", "How does this work?", "What's happening here?"]);
    expect(selectionStarters(four)).toEqual(["What do these do?", "How do these work together?", "What's happening here?"]);
  });

  it("names it for a label", () => {
    expect(selectionLabel(one)).toBe("Flight Timer");
    expect(selectionLabel(two)).toBe("Flight Timer and Level Line");
    expect(selectionLabel(four)).toBe("Flight Timer, Level Line and 2 more");
    // One listed and more counted: still a count.
    expect(selectionLabel({ ...one, more: 3 })).toBe("Flight Timer and 3 more");
  });

  it("keys a selection by its items, their names and its component", () => {
    expect(selectionKey(one)).toBe(selectionKey({ component: { id: "main", name: "Renamed" }, items: [{ ...one.items[0]! }] }));
    for (const other of [two, { ...one, more: 1 }, { ...one, component: { id: "card", name: "Card" } }, { ...one, items: [{ ...one.items[0]!, name: "Flight Clock" }] }, { ...one, items: [{ ...one.items[0]!, kind: "layer" as const }] }]) {
      expect(selectionKey(other), JSON.stringify(other)).not.toBe(selectionKey(one));
    }
  });
});
