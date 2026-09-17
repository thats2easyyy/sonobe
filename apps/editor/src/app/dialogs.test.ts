import { describe, expect, it } from "vitest";
import { createAppDialogStore } from "./dialogs.ts";

describe("createAppDialogStore", () => {
  it("queues requests and resolves them in order", async () => {
    const store = createAppDialogStore();
    const name = store.promptName("Photo Zoom");
    const pick = store.pickProject(["A", "B"]);
    expect(store.getState().queue.map((r) => r.kind)).toEqual(["promptName", "pickProject"]);

    const first = store.getState().queue[0]!;
    store.getState().settle(first.id, "Checkout Flow");
    await expect(name).resolves.toBe("Checkout Flow");
    expect(store.getState().queue.map((r) => r.kind)).toEqual(["pickProject"]);

    store.getState().settle(store.getState().queue[0]!.id, null);
    await expect(pick).resolves.toBeNull();
    expect(store.getState().queue).toEqual([]);
  });

  it("maps unknown discard answers to cancel", async () => {
    const store = createAppDialogStore();
    const save = store.confirmDiscard({ name: "X", action: "open" });
    expect(store.getState().queue[0]).toMatchObject({ kind: "confirmDiscard", name: "X", action: "open" });
    store.getState().settle(store.getState().queue[0]!.id, "save");
    await expect(save).resolves.toBe("save");

    const other = store.confirmDiscard({ name: "X", action: "new" });
    store.getState().settle(store.getState().queue[0]!.id, "Checkout");
    await expect(other).resolves.toBe("cancel");
  });

  it("ignores settles for requests that are gone", () => {
    const store = createAppDialogStore();
    void store.promptName("A");
    store.getState().settle(999, "B");
    expect(store.getState().queue).toHaveLength(1);
  });
});
