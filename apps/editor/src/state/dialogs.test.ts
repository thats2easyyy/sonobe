import { describe, expect, it } from "vitest";
import { createDialogStore, getDefaultDialogs, setDefaultDialogs } from "./dialogs.ts";

describe("dialog service", () => {
  it("queues requests and resolves them in any order", async () => {
    const dialogs = createDialogStore();
    const confirm = dialogs.confirm({ title: "Delete 3 layers?", danger: true, confirmLabel: "Delete" });
    const prompt = dialogs.prompt({ title: "Rename", defaultValue: "Card" });
    const { queue } = dialogs.getState();
    expect(queue.map((r) => r.kind)).toEqual(["confirm", "prompt"]);
    expect(queue[0]).toMatchObject({ options: { title: "Delete 3 layers?", danger: true, confirmLabel: "Delete" } });
    dialogs.getState().settle(queue[1]!.id, "Badge");
    await expect(prompt).resolves.toBe("Badge");
    dialogs.getState().settle(queue[0]!.id, true);
    await expect(confirm).resolves.toBe(true);
    expect(dialogs.getState().queue).toEqual([]);
  });

  it("only resolves choices that were offered and treats dismissal as no", async () => {
    const dialogs = createDialogStore();
    const choice = dialogs.choose({ title: "Save?", actions: [{ value: "save", label: "Save", variant: "primary" }, { value: "discard", label: "Don't Save" }] });
    const pick = dialogs.pick({ title: "Open", items: [{ value: "Checkout", label: "Checkout", description: "Saved yesterday" }] });
    const confirm = dialogs.confirm({ title: "Sure?" });
    const [c, p, k] = dialogs.getState().queue;
    dialogs.getState().settle(c!.id, "explode");
    await expect(choice).resolves.toBeNull();
    dialogs.getState().settle(p!.id, "Nope");
    await expect(pick).resolves.toBeNull();
    dialogs.getState().dismiss(k!.id);
    await expect(confirm).resolves.toBe(false);
    dialogs.getState().settle(k!.id, true);
    expect(dialogs.getState().queue).toEqual([]);
  });

  it("dismisses everything at once", async () => {
    const dialogs = createDialogStore();
    const prompt = dialogs.prompt({ title: "Name" });
    const choice = dialogs.choose({ title: "Which?", actions: [{ value: "a", label: "A" }] });
    dialogs.getState().dismissAll();
    await expect(prompt).resolves.toBeNull();
    await expect(choice).resolves.toBeNull();
    expect(dialogs.getState().queue).toEqual([]);
  });

  it("shares one app-wide store until it's replaced", () => {
    expect(getDefaultDialogs()).toBe(getDefaultDialogs());
    const mine = createDialogStore();
    setDefaultDialogs(mine);
    expect(getDefaultDialogs()).toBe(mine);
    setDefaultDialogs(null);
    expect(getDefaultDialogs()).not.toBe(mine);
  });
});
