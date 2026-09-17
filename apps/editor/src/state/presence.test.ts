import { describe, expect, it } from "vitest";
import { createConsoleStore, formatConsoleArgs } from "./console.ts";
import { createPresenceStore, flashingIds, workingOn } from "./presence.ts";

describe("presence store", () => {
  it("tracks work items and a feed of agent changes", () => {
    let t = 1000;
    const presence = createPresenceStore({ now: () => t, maxRecent: 2 });
    const workId = presence.getState().begin({ ids: ["card", "card"], intent: "adding a press animation" });
    expect(presence.getState().working).toEqual([{ workId, ids: ["card"], intent: "adding a press animation", author: { kind: "agent", name: "Claude" }, startedAt: 1000 }]);
    expect(workingOn(presence.getState(), "card")).toHaveLength(1);

    presence.getState().recordChange({ kind: "apply", author: { kind: "agent", name: "Claude" }, label: "added press animation", ids: ["pop", "grow"], components: ["main"], revision: 3, opCount: 12 });
    expect(presence.getState().recent[0]!.description).toBe("Claude: added press animation (12 ops)");
    expect(flashingIds(presence.getState(), 1500)).toEqual(new Set(["pop", "grow"]));
    expect(flashingIds(presence.getState(), 9000)).toEqual(new Set());

    t = 2000;
    expect(presence.getState().finish(workId, { summary: "press animation is in", revision: 3 })?.workId).toBe(workId);
    expect(presence.getState().working).toEqual([]);
    expect(presence.getState().recent.map((c) => c.kind)).toEqual(["finish", "apply"]);
    presence.getState().recordChange({ kind: "undo", author: { kind: "agent", name: "Claude" }, label: "undo", ids: [], components: [], revision: 4, opCount: 1 });
    expect(presence.getState().recent).toHaveLength(2);
    expect(presence.getState().finish("work_missing")).toBeUndefined();
  });

  it("finishes all work for one author", () => {
    const presence = createPresenceStore();
    presence.getState().begin({ intent: "a", author: { kind: "agent", name: "Claude" } });
    presence.getState().begin({ intent: "b", author: { kind: "agent", name: "Other" } });
    presence.getState().finishAll({ kind: "agent", name: "Claude" });
    expect(presence.getState().working.map((w) => w.intent)).toEqual(["b"]);
  });
});

describe("console store", () => {
  it("collapses repeats, caps capacity, and batches updates", () => {
    const pending: (() => void)[] = [];
    const store = createConsoleStore({ capacity: 3, now: () => 5, schedule: (fn) => void pending.push(fn) });
    store.getState().push("log", ["tap on", { x: 1 }], { source: "tap_card" });
    store.getState().push("log", ["tap on", { x: 1 }], { source: "tap_card" });
    expect(store.getState().entries).toEqual([]);
    expect(pending).toHaveLength(1);
    pending.shift()!();
    expect(store.getState().entries).toEqual([{ id: "log_1", timestamp: 5, level: "log", source: "tap_card", message: 'tap on {"x":1}', count: 2 }]);

    for (const n of [1, 2, 3]) store.getState().push("warn", `w${n}`);
    store.getState().flush();
    expect(store.getState().entries.map((e) => e.message)).toEqual(["w1", "w2", "w3"]);
    expect(store.getState().counts).toEqual({ log: 2, info: 0, warn: 3, error: 0 });
    store.getState().clear();
    expect(store.getState().entries).toEqual([]);
  });

  it("formats values like a browser console", () => {
    expect(formatConsoleArgs(["a", 1, true, null, undefined, [1, 2], new Error("boom")])).toMatch(/^a 1 true null undefined \[1,2\] Error: boom/);
  });
});
