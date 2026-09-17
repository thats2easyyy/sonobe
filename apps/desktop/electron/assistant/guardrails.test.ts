import { describe, expect, it } from "vitest";
import { applyOpsDeletion, DELETE_CONFIRM_THRESHOLD, deleteConfirmation, isReadOnlyRefusal } from "./guardrails.ts";

const removes = (count: number, op = "removeLayer") => Array.from({ length: count }, (_, i) => ({ op, id: `item_${i}` }));

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
