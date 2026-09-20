import { createEmptyDocument, findLayer } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { CLAUDE_AUTHOR, createDocumentStore } from "./document.ts";
import { getRegistry } from "./registry.ts";

const registry = getRegistry();
const KEY = "scrub:@card.position";

function setup() {
  let t = 0;
  const store = createDocumentStore({ registry, document: createEmptyDocument(), now: () => t });
  store.getState().apply([{ op: "addLayer", layer: { type: "rectangle", name: "Card" } }], { label: "Add Card" });
  const move = (x: number, gesture?: "begin" | "update" | "end", key = KEY) =>
    store.getState().apply([{ op: "updateLayer", id: "card", props: { position: [x, 0] } }], { label: "Move Card", coalesceKey: key, ...(gesture ? { gesture } : {}) });
  const labels = () => store.getState().historyEntries().map((e) => e.label);
  const position = () => findLayer(store.getState().doc.components.main!.layers, "card")?.layer.props.position;
  const tick = (ms: number) => {
    t += ms;
  };
  return { store, move, labels, position, tick };
}

describe("document store: gestures", () => {
  it("merges a long scrub into one undo step", () => {
    const { store, move, labels, position, tick } = setup();
    move(1, "begin");
    for (let x = 2; x <= 10; x++) {
      tick(1500);
      move(x, "update");
    }
    tick(4000);
    move(11, "end");
    expect(labels()).toEqual(["Move Card", "Add Card"]);
    expect(position()).toEqual([11, 0]);
    expect(store.getState().historyEntries()[0]!.opCount).toBe(11);

    store.getState().undo();
    expect(position()).toBeUndefined();
    expect(labels()).toEqual(["Add Card"]);
    store.getState().redo();
    expect(position()).toEqual([11, 0]);
  });

  it("starts a new step after the gesture ends", () => {
    const { store, move, labels } = setup();
    move(1, "begin");
    move(2, "update");
    move(3, "end");
    move(4, "update");
    move(5, "end");
    expect(labels()).toEqual(["Move Card", "Move Card", "Add Card"]);

    move(6, "begin");
    move(7, "update");
    store.getState().endGesture(KEY);
    move(8, "update");
    expect(labels()).toHaveLength(5);
  });

  it("a begin always starts a new step, and other edits break a gesture", () => {
    const { store, move, labels } = setup();
    move(1, "begin");
    move(2, "begin");
    expect(labels()).toHaveLength(3);
    store.getState().apply([{ op: "addLayer", layer: { type: "oval", name: "Dot" } }], { label: "Add Dot", author: CLAUDE_AUTHOR });
    move(3, "update");
    expect(labels()).toEqual(["Move Card", "Add Dot", "Move Card", "Move Card", "Add Card"]);
  });

  it("an end without changes still closes the gesture", () => {
    const { store, move, labels } = setup();
    move(1, "begin");
    expect(store.getState().apply([], { label: "Move Card", coalesceKey: KEY, gesture: "end" }).applied).toEqual([]);
    move(2, "update");
    expect(labels()).toEqual(["Move Card", "Move Card", "Add Card"]);
  });

  it("merges a run however far apart its steps come, keeps no gesture open, and ends at any other edit", () => {
    const { store, move, labels, position, tick } = setup();
    move(1, "begin");
    move(2, "end");
    const flip = (x: number) => store.getState().apply([{ op: "updateLayer", id: "card", props: { position: [x, 0] } }], { label: "Switch Presets", coalesceKey: "switch", run: true });
    for (let x = 3; x <= 6; x++) {
      tick(5000);
      flip(x);
      expect(store.getState().gesture).toBeNull();
    }
    expect(labels()).toEqual(["Switch Presets", "Move Card", "Add Card"]);
    store.getState().undo();
    expect(position()).toEqual([2, 0]);
    store.getState().redo();

    move(7);
    flip(8);
    expect(labels()).toEqual(["Switch Presets", "Move Card", "Switch Presets", "Move Card", "Add Card"]);
    // A run's key without `run` doesn't join it.
    move(9, undefined, "switch");
    expect(labels()).toHaveLength(6);
  });

  it("keeps gestures with different keys apart, and time windows without a gesture", () => {
    const { move, labels, tick } = setup();
    move(1, "begin", "a");
    move(2, "update", "b");
    expect(labels()).toHaveLength(3);
    move(3);
    tick(500);
    move(4);
    expect(labels()).toHaveLength(4);
    tick(1500);
    move(5);
    expect(labels()).toHaveLength(5);
  });
});
