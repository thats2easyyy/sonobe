import { createEmptyDocument, type Author } from "@sonobe/core";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryListEntry } from "../../state/document.ts";
import { CLAUDE_AUTHOR } from "../../state/document.ts";
import type { AgentChange } from "../../state/presence.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { deriveActivityFeed, formatRelativeTime, undoActionLabel, type ChangeActivity } from "./activityModel.ts";

const registry = createPatchRegistry();

function feedOf(session: EditorSession) {
  const doc = session.document.getState();
  const presence = session.presence.getState();
  return deriveActivityFeed({ history: doc.historyEntries(), redo: doc.redoEntries(), recent: presence.recent, working: presence.working });
}

describe("deriveActivityFeed from a live session", () => {
  let session: EditorSession;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 16, 10, 0, 0));
    session = createEditorSession({ host: null, registry, document: createEmptyDocument(), autoplay: false, textMeasurer: "approximate", scheduler: createManualScheduler() });
  });

  afterEach(() => {
    session.dispose();
    vi.useRealTimers();
  });

  const tick = () => vi.advanceTimersByTime(1000);

  it("shows agent changes and working items, not human edits", () => {
    const doc = session.document.getState();
    doc.apply([{ op: "addLayer", layer: { id: "card", type: "rectangle", name: "Card" } }], { label: "Add Card" });
    tick();
    const r = doc.apply(
      [
        { op: "addPatch", patch: { id: "press", type: "interaction", inputs: { layer: { layer: "card" } } } },
        { op: "addPatch", patch: { id: "pop", type: "popAnimation" } },
      ],
      { label: "added press animation", author: CLAUDE_AUTHOR },
    );
    expect(r.ok).toBe(true);
    tick();
    const workId = session.presence.getState().begin({ intent: "tuning the spring", ids: ["pop"], component: "main" });

    const feed = feedOf(session);
    expect(feed.map((item) => item.kind)).toEqual(["working", "change"]);
    expect(feed[0]).toMatchObject({ kind: "working", workId, intent: "tuning the spring", ids: ["pop"], component: "main" });
    expect(feed[1]).toMatchObject({ kind: "change", label: "added press animation", opCount: 2, status: "applied", newer: 0, canUndo: true, canRedo: false, components: ["main"] });
    expect((feed[1] as ChangeActivity).ids).toEqual(expect.arrayContaining(["press", "pop"]));
  });

  it("counts newer groups, tracks undone changes, and adds finish notes", () => {
    const doc = session.document.getState();
    doc.apply([{ op: "addPatch", patch: { id: "a", type: "switch" } }], { label: "added a switch", author: CLAUDE_AUTHOR });
    tick();
    doc.apply([{ op: "addPatch", patch: { id: "b", type: "counter" } }], { label: "added a counter", author: CLAUDE_AUTHOR });
    tick();
    doc.apply([{ op: "addLayer", layer: { id: "box", type: "rectangle" } }], { label: "Add Box" });
    tick();

    let changes = feedOf(session).filter((i): i is ChangeActivity => i.kind === "change");
    expect(changes.map((c) => [c.label, c.newer])).toEqual([
      ["added a counter", 1],
      ["added a switch", 2],
    ]);
    expect(undoActionLabel(changes[1]!)).toBe("Undo this + 2 newer");

    session.document.getState().undo();
    session.document.getState().undo();
    tick();
    changes = feedOf(session).filter((i): i is ChangeActivity => i.kind === "change");
    expect(changes.map((c) => [c.label, c.status, c.canUndo, c.canRedo, c.newer])).toEqual([
      ["added a counter", "undone", false, true, 0],
      ["added a switch", "applied", true, false, 0],
    ]);

    const workId = session.presence.getState().begin({ intent: "building a counter" });
    tick();
    session.presence.getState().finish(workId, { summary: "finished the counter" });
    const feed = feedOf(session);
    expect(feed[0]).toMatchObject({ kind: "note", verb: "finish", label: "finished the counter" });
    expect(feed.some((i) => i.kind === "working")).toBe(false);
  });

  it("keeps changes from before the history was cleared as past, not undoable", () => {
    const doc = session.document.getState();
    doc.apply([{ op: "addPatch", patch: { id: "a", type: "switch" } }], { label: "added a switch", author: CLAUDE_AUTHOR });
    tick();
    session.document.getState().newDocument();
    const [change] = feedOf(session);
    expect(change).toMatchObject({ kind: "change", label: "added a switch", status: "past", canUndo: false, canRedo: false });
  });
});

describe("deriveActivityFeed (pure)", () => {
  const agent: Author = { kind: "agent", name: "Claude" };
  const entry = (txnId: string, timestamp: number, author: Author = agent): HistoryListEntry => ({ txnId, label: txnId, author, revision: 1, opCount: 1, timestamp, description: "" });
  const recorded = (id: string, kind: AgentChange["kind"], timestamp: number, txnId?: string): AgentChange => ({ id, kind, author: agent, label: `${kind} ${txnId ?? id}`, description: "", ids: ["x"], components: ["main"], revision: 1, opCount: 1, timestamp, ...(txnId ? { txnId } : {}) });

  it("orders by time and doesn't repeat a change that's still in history", () => {
    const feed = deriveActivityFeed({
      history: [entry("t2", 200), entry("h1", 150, { kind: "human", name: "You" })],
      redo: [],
      recent: [recorded("c3", "undo", 300, "t9"), recorded("c2", "apply", 200, "t2"), recorded("c1", "apply", 100, "t1"), recorded("c0", "apply", 90, "t1")],
      working: [],
    });
    expect(feed.map((i) => i.key)).toEqual(["note:c3", "txn:t2", "past:c1"]);
    expect(feed[1]).toMatchObject({ ids: ["x"], components: ["main"] });
  });
});

describe("formatRelativeTime", () => {
  it("formats recent and older times", () => {
    const now = new Date(2026, 8, 16, 14, 30, 0).getTime();
    expect(formatRelativeTime(now - 3000, now)).toBe("just now");
    expect(formatRelativeTime(now - 42_000, now)).toBe("42s ago");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelativeTime(new Date(2026, 8, 16, 9, 7).getTime(), now)).toBe("09:07");
    expect(formatRelativeTime(now + 5000, now)).toBe("just now");
  });
});
