import { describe, expect, it } from "vitest";
import { applyOpsDeletion, DELETE_CONFIRM_THRESHOLD, deleteConfirmation, deletionPrompt, estimateRemovals, isDestructiveApplyOps, isReadOnlyRefusal, removalsFromResult } from "./guardrails.ts";

const removes = (count: number, op = "removeLayer") => Array.from({ length: count }, (_, i) => ({ op, id: `item_${i}` }));
const summary = (fields: Partial<Record<"layers" | "patches" | "comments" | "components" | "assets" | "scripts", number>>) => {
  const s = { layers: 0, patches: 0, comments: 0, components: 0, assets: 0, scripts: 0, ...fields, total: 0 };
  s.total = s.layers + s.patches + s.comments + s.components + s.assets + s.scripts;
  return s;
};

describe("applyOpsDeletion", () => {
  it("lets small batches through", () => {
    expect(applyOpsDeletion({ ops: removes(DELETE_CONFIRM_THRESHOLD) })).toBeNull();
    expect(applyOpsDeletion({ ops: [{ op: "addLayer" }, ...removes(3)] })).toBeNull();
  });

  it("asks before a batch that removes more than the threshold, counting every remove op", () => {
    const prompt = applyOpsDeletion({ ops: [...removes(6), ...removes(4, "removePatch"), { op: "removeComment", id: "note" }, { op: "setInput" }] });
    expect(prompt).toEqual({
      count: 11,
      title: "Delete 11 items?",
      message: "The Assistant wants to remove 6 layers, 4 patches, 1 comment in one change. You can undo it afterwards.",
    });
  });

  it("never asks for dry runs or malformed input, and honours a custom threshold", () => {
    expect(applyOpsDeletion({ ops: removes(40), dryRun: true })).toBeNull();
    expect(applyOpsDeletion(null)).toBeNull();
    expect(applyOpsDeletion({ ops: "nope" })).toBeNull();
    expect(applyOpsDeletion({ ops: removes(3) }, 2)?.count).toBe(3);
  });
});

describe("destructive batches", () => {
  it("treats remove ops and deleting a script's source as destructive", () => {
    expect(isDestructiveApplyOps({ ops: [{ op: "removeComponent", id: "library" }] })).toBe(true);
    expect(isDestructiveApplyOps({ ops: [{ op: "setScript", file: "a.js", source: null }] })).toBe(true);
    expect(isDestructiveApplyOps({ ops: [{ op: "setScript", file: "a.js", source: "export const x = 1;" }, { op: "setInput" }] })).toBe(false);
    expect(isDestructiveApplyOps({ ops: [{ op: "removeLayer", id: "a" }], dryRun: true })).toBe(false);
    expect(estimateRemovals({ ops: [{ op: "removeLayer", id: "a" }, { op: "setScript", file: "a.js" }] })).toMatchObject({ layers: 1, scripts: 1, total: 2 });
    expect(estimateRemovals({ ops: [{ op: "addLayer" }] })).toBeNull();
  });

  it("reads the server's cascade-aware removed summary", () => {
    const result = { content: [], structuredContent: { ok: true, dryRun: true, removed: { layers: 41, patches: 0, comments: 0, components: 0, assets: 0, scripts: 0, total: 41 } } };
    expect(removalsFromResult(result)).toMatchObject({ layers: 41, total: 41 });
    expect(removalsFromResult({ content: [], structuredContent: { ok: true } })).toBeNull();
    expect(removalsFromResult({ content: [], structuredContent: { removed: { layers: "lots", total: -3 } } })).toMatchObject({ layers: 0, total: 0 });
  });

  it("asks for one removeLayer that takes a 40-child group with it, or a populated component", () => {
    expect(deletionPrompt(summary({ layers: 41 }))).toEqual({ count: 41, title: "Delete 41 items?", message: "The Assistant wants to remove 41 layers in one change. You can undo it afterwards." });
    expect(deletionPrompt(summary({ components: 1, patches: 20 }))?.message).toContain("20 patches, 1 component");
    expect(deletionPrompt(summary({ layers: 10 }))).toBeNull();
  });

  it("counts what the reply already removed without asking", () => {
    expect(deletionPrompt(summary({ layers: 10 }), 0)).toBeNull();
    expect(deletionPrompt(summary({ layers: 5 }), 5)).toBeNull();
    // Two batches of 10 are 20 removals in one reply, so the second one asks.
    const second = deletionPrompt(summary({ layers: 10 }), 10);
    expect(second).toEqual({ count: 10, title: "Delete 10 more items?", message: "The Assistant wants to remove 10 layers. It already removed 10 items in this reply without asking. You can undo it afterwards." });
    expect(deletionPrompt(summary({ patches: 1 }), 10)?.title).toBe("Delete 1 more item?");
    expect(deletionPrompt(summary({}), 50)).toBeNull();
  });
});

describe("deleteConfirmation", () => {
  it("reads delete_items' confirmation_required result", () => {
    const pending = deleteConfirmation({
      content: [{ type: "text", text: "Confirmation required." }],
      structuredContent: { ok: false, status: "confirmation_required", confirmToken: "abc123", summary: "Deleting 14 items from main: Card, Title, and 12 more." },
    });
    expect(pending).toEqual({ token: "abc123", summary: "Deleting 14 items from main: Card, Title, and 12 more.", count: 14 });
  });

  it("ignores ordinary results", () => {
    expect(deleteConfirmation({ content: [{ type: "text", text: "Deleted 2 items" }], structuredContent: { ok: true } })).toBeNull();
    expect(deleteConfirmation({ content: [] })).toBeNull();
  });
});

describe("isReadOnlyRefusal", () => {
  it("spots the agent_read_only code in structured or text content", () => {
    expect(isReadOnlyRefusal({ isError: true, content: [], structuredContent: { ok: false, error: { code: "agent_read_only" } } })).toBe(true);
    expect(isReadOnlyRefusal({ isError: true, content: [{ type: "text", text: "Error agent_read_only: Claude is read only" }] })).toBe(true);
    expect(isReadOnlyRefusal({ isError: false, content: [{ type: "text", text: "agent_read_only" }] })).toBe(false);
    expect(isReadOnlyRefusal({ isError: true, content: [{ type: "text", text: "Error not_found" }] })).toBe(false);
  });
});
