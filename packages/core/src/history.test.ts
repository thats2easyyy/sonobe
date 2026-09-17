import { describe, expect, it } from "vitest";
import { createHistory, describeHistoryEntry } from "./history.ts";
import { applyOps } from "./ops/index.ts";
import { buildSampleDocument, mockRegistry, mustApply } from "./testing/fixtures.ts";
import type { SonobeDocument } from "./types.ts";

const human = { kind: "human" as const, name: "You" };
const claude = { kind: "agent" as const, name: "Claude" };
const run = (doc: SonobeDocument, ops: Parameters<typeof applyOps>[1]) => applyOps(doc, ops, { registry: mockRegistry, lenient: true });

describe("history", () => {
  it("undoes and redoes groups by returning ops to apply", () => {
    const h = createHistory({ now: () => 1000 });
    const doc0 = buildSampleDocument();
    const r1 = mustApply(doc0, [{ op: "setInput", target: "pop.speed", value: 20 }]);
    const e1 = h.push({ label: "Change speed", author: human, ops: r1.applied, inverse: r1.inverse });
    expect(e1).toMatchObject({ txnId: "txn_1", revision: 1, label: "Change speed", timestamp: 1000 });
    const r2 = mustApply(r1.doc, [{ op: "addLayer", layer: { type: "rectangle" } }, { op: "addPatch", patch: { type: "switch" } }]);
    h.push({ label: "added press animation", author: claude, ops: r2.applied, inverse: r2.inverse });
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
    expect(describeHistoryEntry(h.peekUndo()!)).toBe("Claude: added press animation (2 ops)");
    expect(describeHistoryEntry(e1)).toBe("You: Change speed");

    const undo = h.undo()!;
    const undone = run(r2.doc, undo.ops);
    expect(undone.doc).toStrictEqual(r1.doc);
    expect(h.revision).toBe(3);
    expect(h.canRedo()).toBe(true);
    expect(h.peekRedo()!.label).toBe("added press animation");

    const redo = h.redo()!;
    expect(run(undone.doc, redo.ops).doc).toStrictEqual(r2.doc);
    expect(h.entries().map((e) => e.label)).toEqual(["added press animation", "Change speed"]);
    expect(h.undo()).toBeDefined();
    expect(h.undo()).toBeDefined();
    expect(h.undo()).toBeUndefined();
    expect(h.redoEntries().map((e) => e.txnId)).toEqual(["txn_1", "txn_2"]);
  });

  it("coalesces rapid edits with the same key and author", () => {
    let t = 0;
    const h = createHistory({ now: () => t, coalesceWindowMs: 500 });
    const original = buildSampleDocument();
    let doc = original;
    for (const speed of [11, 12, 13]) {
      const r = mustApply(doc, [{ op: "setInput", target: "pop.speed", value: speed }]);
      h.push({ label: `Scrub speed to ${speed}`, author: human, ops: r.applied, inverse: r.inverse, coalesceKey: "pop.speed" });
      doc = r.doc;
      t += 100;
    }
    expect(h.entries()).toHaveLength(1);
    expect(h.peekUndo()).toMatchObject({ label: "Scrub speed to 13", revision: 3 });
    expect(h.peekUndo()!.ops).toHaveLength(3);
    expect(run(doc, h.undo()!.ops).doc).toStrictEqual(original);

    h.redo();
    h.push({ label: "a", author: claude, ops: [], inverse: [], coalesceKey: "pop.speed" });
    t += 1000;
    h.push({ label: "b", author: claude, ops: [], inverse: [], coalesceKey: "pop.speed" });
    h.push({ label: "c", author: claude, ops: [], inverse: [], coalesceKey: "other" });
    expect(h.entries().map((e) => e.label)).toEqual(["c", "b", "a", "Scrub speed to 13"]);
  });

  it("clears redo on push, trims to the limit and undoes to a transaction", () => {
    const h = createHistory({ limit: 3, now: () => 0 });
    for (const label of ["one", "two", "three", "four"]) h.push({ label, author: human, ops: [], inverse: [] });
    expect(h.entries().map((e) => e.label)).toEqual(["four", "three", "two"]);
    h.undo();
    h.push({ label: "five", author: human, ops: [], inverse: [] });
    expect(h.canRedo()).toBe(false);
    const steps = h.undoTo("txn_3")!;
    expect(steps.map((s) => s.entry.label)).toEqual(["five", "three"]);
    expect(h.undoTo("txn_99")).toBeUndefined();
    const before = h.revision;
    expect(h.bump()).toBe(before + 1);
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });
});
