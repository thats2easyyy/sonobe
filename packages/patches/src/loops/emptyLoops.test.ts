/**
 * The empty-loop deck from the retro (a looped Swipe Card component that reads whether the card above
 * it is gone through Loop Select and Delay One Frame), run on the real patches: the variant that is
 * empty by construction explains itself and its suggested fix works, and the variants that go empty
 * for a moment come back without a restart.
 */

import { applyOps, type SonobeDocument } from "@sonobe/core";
import type { RuntimeIssue } from "@sonobe/engine";
import { buildDoc, createTestRuntime, runFrames, tap, type ComponentInput, type DocInput } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchRegistry } from "../registry.ts";

const registry = createPatchRegistry();
const L = (link: string) => ({ link });
const emptyLoops = (issues: RuntimeIssue[]) => issues.filter((i) => i.code === "empty_loop");

const swipeCard: ComponentInput = {
  id: "swipe_card",
  kind: "patchComponent",
  inputs: { cardAboveGone: { type: "boolean", default: false }, drag: { type: "point", default: [0, 0] } },
  outputs: { position: { type: "point", link: "pos.output" }, gone: { type: "boolean", link: "card_gone.output" } },
  patches: {
    pos: { type: "splitter", typeParam: "point", inputs: { value: L("$in.drag") } },
    card_gone: { type: "splitter", typeParam: "boolean", inputs: { value: L("$in.cardAboveGone") } },
  },
};

/**
 * "delayThenSelect": Loop Select reads Delay One Frame, which passes one value on the first frame, so
 * indices 1 to 3 are past the end on every frame. "selectThenDelay": Loop Select reads the component and
 * Delay One Frame comes after, which works.
 */
function deck(wiring: "delayThenSelect" | "selectThenDelay", count = 4, outOfRange?: string): SonobeDocument {
  const patches: DocInput["patches"] = {
    places: { type: "loop", inputs: { count } },
    card_count: { type: "loopCount", inputs: { loop: L("places.index") } },
    last_index: { type: "subtract", typeParam: "number", inputs: { value1: L("card_count.count"), value2: 1 } },
    index_above: { type: "add", typeParam: "number", inputs: { value1: L("places.index"), value2: 1 } },
    index_above_last: { type: "min", typeParam: "number", inputs: { value1: L("index_above.output"), value2: L("last_index.output") } },
    is_top: { type: "greaterThanOrEqual", typeParam: "number", inputs: { value1: L("places.index"), value2: L("last_index.output") } },
    drag_card: { type: "drag", inputs: { layer: { layer: "card" } } },
    swipe: { type: "component", component: "swipe_card", name: "Card Swipe", inputs: { drag: L("drag_card.position"), cardAboveGone: L("above_gone_or_top.output") } },
  };
  if (wiring === "selectThenDelay") {
    patches.above_gone = { type: "loopSelect", typeParam: "boolean", name: "Card Above: Gone", inputs: { loop: L("swipe.gone"), index: L("index_above_last.output") } };
    patches.gone_last_frame = { type: "delay1", typeParam: "boolean", name: "Gone Last Frame", inputs: { value: L("above_gone.output") } };
    patches.above_gone_or_top = { type: "ifElse", typeParam: "boolean", name: "Card Above Gone", inputs: { condition: L("is_top.output"), ifTrue: true, ifFalse: L("gone_last_frame.output") } };
  } else {
    patches.gone_last_frame = { type: "delay1", typeParam: "boolean", name: "Gone Last Frame", inputs: { value: L("swipe.gone") } };
    patches.above_gone = { type: "loopSelect", typeParam: "boolean", name: "Card Above: Gone", inputs: { loop: L("gone_last_frame.output"), index: L("index_above_last.output"), ...(outOfRange ? { outOfRange } : {}) } };
    patches.above_gone_or_top = { type: "ifElse", typeParam: "boolean", name: "Card Above Gone", inputs: { condition: L("is_top.output"), ifTrue: true, ifFalse: L("above_gone.output") } };
  }
  return buildDoc({ components: [swipeCard], layers: [{ id: "card", type: "rectangle", name: "Card", props: { position: L("swipe.position"), size: [300, 400] } }], patches }, registry);
}

const withCount = (doc: SonobeDocument, n: number) => {
  const next = structuredClone(doc);
  next.components.main!.patches.places!.inputs.count = n;
  return next;
};

describe("the empty-loop deck", () => {
  it("explains a deck that is empty by construction, and its suggested fix brings the cards back", () => {
    const rt = createTestRuntime(deck("delayThenSelect"), registry);
    runFrames(rt, 3);
    expect(rt.scene().roots).toEqual([]);
    const issues = emptyLoops(rt.issues());
    expect(issues.map((i) => [i.patchId ?? `@${i.layerId}`, i.message])).toEqual([
      [
        "swipe",
        '"Card Swipe" (Component) has 0 copies because "Card Above: Gone" (Loop Select) returned an empty loop: indices 1, 2 and 3 are past the end of its 1-item Loop. The empty loop reached "Card Above Gone" (If / Else) on If False and erased the 4 items on Condition. "Gone Last Frame" (Delay One Frame) closes a feedback loop: on the first frame, and while the loop is empty, it passes one value (false), not a loop.',
      ],
      [
        "@card",
        'Layer "Card" has 0 copies because its Position comes from "Card Swipe" (Component), which has 0 copies because "Card Above: Gone" (Loop Select) returned an empty loop: indices 1, 2 and 3 are past the end of its 1-item Loop. The empty loop reached "Card Above Gone" (If / Else) on If False and erased the 4 items on Condition. "Gone Last Frame" (Delay One Frame) closes a feedback loop: on the first frame, and while the loop is empty, it passes one value (false), not a loop.',
      ],
    ]);
    const fallback = issues[0]!.suggestions!.find((s) => s.ops?.[0] && "value" in s.ops[0] && s.ops[0].value === "fallback")!;
    expect(fallback.description).toBe('Set Out of Range to Use Fallback: an index past the end gives Fallback (set Fallback to what a missing item means). It changes "Card Above: Gone" (Loop Select).');
    const fixed = applyOps(rt.document, fallback.ops!, { registry });
    rt.updateDocument(fixed.doc!);
    runFrames(rt, 3);
    expect(rt.scene().roots.map((n) => n.key)).toEqual(["card#0", "card#1", "card#2", "card#3"]);
    expect(emptyLoops(rt.issues())).toEqual([]);
  });

  it("works from the first frame with Clamp or Use Fallback", () => {
    for (const mode of ["clamp", "fallback"]) {
      const rt = createTestRuntime(deck("delayThenSelect", 4, mode), registry);
      expect(rt.step().roots, mode).toHaveLength(4);
      expect(emptyLoops(rt.issues()), mode).toEqual([]);
    }
  });

  it("comes back when the broken wiring is fixed while it runs (no restart)", () => {
    const rt = createTestRuntime(deck("delayThenSelect"), registry);
    runFrames(rt, 30);
    rt.updateDocument(deck("selectThenDelay"));
    runFrames(rt, 3);
    expect(rt.scene().roots).toHaveLength(4);
    expect(emptyLoops(rt.issues())).toEqual([]);
  });

  it("comes back after its list is empty for a frame, without a warning", () => {
    const doc = deck("selectThenDelay");
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 10);
    rt.updateDocument(withCount(doc, 0));
    expect(rt.step().roots).toEqual([]);
    expect(emptyLoops(rt.issues())).toEqual([]);
    rt.updateDocument(withCount(doc, 4));
    runFrames(rt, 3);
    expect(rt.scene().roots).toHaveLength(4);
  });
});

describe("empty lists on the real patches", () => {
  /** Guide 07's tap-to-grow rows. */
  const rows = (count: number) =>
    buildDoc(
      {
        layers: [{ id: "row", type: "rectangle", name: "Row", props: { position: L("grid.position"), size: [200, 40], scale: L("grow.output") } }],
        patches: {
          rows: { type: "loop", inputs: { count } },
          grid: { type: "gridLayout", inputs: { index: L("rows.index"), columns: 1 } },
          touch: { type: "interaction", inputs: { layer: { layer: "row" } } },
          toggle: { type: "switch", inputs: { flip: L("touch.tap") } },
          grow: { type: "transition", typeParam: "number", inputs: { progress: L("toggle.on"), start: 1, end: 1.1 } },
        },
      },
      registry,
    );

  it("rows that were empty for a frame come back, and a tap still grows only its own row", () => {
    const doc = rows(3);
    const rt = createTestRuntime(doc, registry);
    runFrames(rt, 3);
    rt.updateDocument(withRowCount(doc, 0));
    rt.step();
    rt.updateDocument(doc);
    runFrames(rt, 3);
    const second = rt.scene().roots[1]!;
    runFrames(rt, 2, tap(second.x + 10, second.y + 10));
    runFrames(rt, 10);
    expect((rt.getRawValue("toggle.on") as { items: unknown[] }).items).toEqual([false, true, false]);
  });

  it("an Interaction on a layer with 0 copies runs once (a plain false, not an empty loop), and the list stays quiet", () => {
    const rt = createTestRuntime(
      buildDoc(
        {
          layers: [{ id: "row", type: "text", name: "Row", props: { text: L("matches.output"), position: L("grid.position"), scale: L("grow.output") } }],
          patches: {
            names: { type: "loopBuilder", typeParam: "text", inputCount: 3, inputs: { item0: "a", item1: "b", item2: "c" } },
            include: { type: "loopBuilder", typeParam: "number", inputCount: 3, inputs: { item0: 0, item1: 0, item2: 0 } },
            matches: { type: "loopFilter", typeParam: "text", inputs: { loop: L("names.loop"), include: L("include.loop") } },
            grid: { type: "gridLayout", inputs: { index: L("matches.index"), columns: 1 } },
            touch: { type: "interaction", inputs: { layer: { layer: "row" } } },
            toggle: { type: "switch", inputs: { flip: L("touch.tap") } },
            grow: { type: "transition", typeParam: "number", inputs: { progress: L("toggle.on"), start: 1, end: 1.1 } },
            row_count: { type: "loopCount", inputs: { loop: { layer: "row" } } },
          },
        },
        registry,
      ),
      registry,
    );
    runFrames(rt, 5);
    expect(rt.scene().roots).toEqual([]);
    expect(rt.getRawValue("touch.tap")).toBe(false);
    expect(rt.getRawValue("grow.output")).toBe(1);
    expect(rt.getRawValue("row_count.count")).toBe(0);
    expect(emptyLoops(rt.issues())).toEqual([]);
  });

  function withRowCount(doc: SonobeDocument, n: number) {
    const next = structuredClone(doc);
    next.components.main!.patches.rows!.inputs.count = n;
    return next;
  }
});
