import { applyOps, createEmptyDocument, createRegistry, findLayer } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { createDocumentStore } from "../../state/document.ts";
import { createEditTransaction } from "./editTransaction.ts";
import { moveOps } from "./ops.ts";

const registry = createRegistry();

function setup() {
  let time = 1_000;
  const base = applyOps(createEmptyDocument(), [{ op: "addLayer", layer: { id: "card", type: "rectangle", props: { position: [0, 0] } } }], { registry }).doc;
  const store = createDocumentStore({ registry, document: base, now: () => time });
  const position = () => findLayer(store.getState().doc.components.main!.layers, "card")!.layer.props.position;
  return { store, position, advance: (ms: number) => (time += ms) };
}

describe("createEditTransaction", () => {
  it("merges a drag into one undo entry", () => {
    const { store, position, advance } = setup();
    const txn = createEditTransaction(store, { label: "Move Card", defaultComponent: "main" });
    for (let i = 1; i <= 10; i++) {
      txn.update(moveOps("main", [{ id: "card", position: [i, i] }]));
      advance(16);
    }
    txn.commit();
    expect(position()).toEqual([10, 10]);
    expect(store.getState().historyEntries()).toHaveLength(1);
    expect(store.getState().undoLabel).toBe("You: Move Card");
    store.getState().undo();
    expect(position()).toEqual([0, 0]);
  });

  it("squashes history that split during a long pause", () => {
    const { store, position, advance } = setup();
    const txn = createEditTransaction(store, { label: "Move Card" });
    txn.update(moveOps("main", [{ id: "card", position: [5, 5] }]));
    advance(5_000);
    txn.update(moveOps("main", [{ id: "card", position: [40, 50] }]));
    expect(store.getState().historyEntries()).toHaveLength(2);
    txn.commit();
    expect(store.getState().historyEntries()).toHaveLength(1);
    expect(position()).toEqual([40, 50]);
    expect(store.getState().undoLabel).toBe("You: Move Card");
    store.getState().undo();
    expect(position()).toEqual([0, 0]);
    expect(store.getState().canUndo).toBe(false);
  });

  it("holds a document gesture open from the first change until it commits", () => {
    const { store, position, advance } = setup();
    const txn = createEditTransaction(store, { label: "Move Card", key: "drag", gesture: true });
    expect(store.getState().gesture).toBeNull();
    txn.update(moveOps("main", [{ id: "card", position: [5, 5] }]));
    expect(store.getState().gesture).toBe("drag");
    // A pause doesn't split a gesture's history the way it splits a timed run's.
    advance(5_000);
    txn.update(moveOps("main", [{ id: "card", position: [40, 50] }]));
    expect(store.getState().gesture).toBe("drag");
    expect(store.getState().historyEntries()).toHaveLength(1);
    txn.commit();
    expect(store.getState().gesture).toBeNull();
    expect(store.getState().historyEntries()).toHaveLength(1);
    expect(position()).toEqual([40, 50]);
    store.getState().undo();
    expect(position()).toEqual([0, 0]);
  });

  it("closes its gesture when it's cancelled, and when it ends where it began", () => {
    const { store, position } = setup();
    const cancelled = createEditTransaction(store, { label: "Move Card", gesture: true });
    cancelled.update(moveOps("main", [{ id: "card", position: [5, 5] }]));
    expect(store.getState().gesture).not.toBeNull();
    cancelled.cancel();
    expect(store.getState().gesture).toBeNull();
    expect(position()).toEqual([0, 0]);

    const back = createEditTransaction(store, { label: "Move Card", gesture: true });
    back.update(moveOps("main", [{ id: "card", position: [5, 5] }]));
    back.update(moveOps("main", [{ id: "card", position: [0, 0] }]));
    back.commit();
    expect(store.getState().gesture).toBeNull();
    expect(store.getState().canUndo).toBe(false);
  });

  it("keeps its gesture's steps apart from someone else's change in the middle", () => {
    const { store, position, advance } = setup();
    const txn = createEditTransaction(store, { label: "Move Card", gesture: true });
    txn.update(moveOps("main", [{ id: "card", position: [5, 5] }]));
    advance(10);
    store.getState().apply([{ op: "rename", id: "card", name: "Hero" }], { label: "rename", author: { kind: "agent", name: "Claude" } });
    advance(10);
    txn.update(moveOps("main", [{ id: "card", position: [7, 7] }]));
    expect(store.getState().gesture).not.toBeNull();
    txn.commit();
    expect(store.getState().gesture).toBeNull();
    expect(store.getState().historyEntries()).toHaveLength(3);
    expect(position()).toEqual([7, 7]);
  });

  it("never merges with an earlier gesture", () => {
    const { store, advance } = setup();
    const first = createEditTransaction(store, { label: "Move Card" });
    first.update(moveOps("main", [{ id: "card", position: [1, 1] }]));
    first.commit();
    advance(10);
    const second = createEditTransaction(store, { label: "Move Card" });
    second.update(moveOps("main", [{ id: "card", position: [2, 2] }]));
    second.commit();
    expect(store.getState().historyEntries()).toHaveLength(2);
  });

  it("cancels back to the starting document", () => {
    const { store, position, advance } = setup();
    const txn = createEditTransaction(store, { label: "Move Card" });
    txn.update(moveOps("main", [{ id: "card", position: [5, 5] }]));
    advance(3_000);
    txn.update(moveOps("main", [{ id: "card", position: [9, 9] }]));
    txn.cancel();
    expect(position()).toEqual([0, 0]);
    expect(txn.changed).toBe(false);
    expect(txn.update(moveOps("main", [{ id: "card", position: [1, 1] }]))).toBeNull();
  });

  it("doesn't squash over someone else's change", () => {
    const { store, position, advance } = setup();
    const txn = createEditTransaction(store, { label: "Move Card" });
    txn.update(moveOps("main", [{ id: "card", position: [5, 5] }]));
    advance(10);
    store.getState().apply([{ op: "rename", id: "card", name: "Hero" }], { label: "rename", author: { kind: "agent", name: "Claude" } });
    advance(10);
    txn.update(moveOps("main", [{ id: "card", position: [7, 7] }]));
    txn.commit();
    expect(store.getState().historyEntries()).toHaveLength(3);
    expect(position()).toEqual([7, 7]);
    expect(findLayer(store.getState().doc.components.main!.layers, "card")!.layer.name).toBe("Hero");
  });

  it("ignores no-op updates", () => {
    const { store } = setup();
    const txn = createEditTransaction(store, { label: "Move Card" });
    txn.update(moveOps("main", [{ id: "card", position: [0, 0] }]));
    txn.commit();
    expect(txn.changed).toBe(false);
    expect(store.getState().canUndo).toBe(false);
  });
});
