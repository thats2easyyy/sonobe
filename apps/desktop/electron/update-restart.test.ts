import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeWindowsForRestart,
  createQuitResume,
  moveConflict,
  reopenPlan,
  resolveClosePrompt,
  restartConfirmation,
  restartKeepingWork,
  takeReopenRecord,
  writeReopenRecord,
  type ClosePromptDeps,
  type ClosePromptQuestion,
  type CloseOutcome,
  type CloseReason,
  type FlushReply,
  type ReopenRecord,
  type ReopenWindow,
  type RestartSteps,
  type RestartWindow,
} from "./update-restart.ts";

const temp = mkdtempSync(path.join(tmpdir(), "sonobe-restart-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const DRAFT = "draft-0001-abcd";

type Flush = FlushReply | null | "hangs" | "fails";

/**
 * The prompt over a scripted person and editor: what was asked, in order, and what came of it. `flush` and
 * `choose` may be lists, one entry for each time the draft is written and each time the question is asked
 * (the last entry repeats).
 */
function prompt(over: { reason?: CloseReason; canSave?: boolean; flush?: Flush | Flush[]; choose?: string | string[]; save?: string | null | false | Error }) {
  const events: string[] = [];
  const questions: ClosePromptQuestion[] = [];
  let landFlush: (reply: FlushReply | null) => void = () => undefined;
  const flushes: Flush[] = "flush" in over ? (Array.isArray(over.flush) ? [...over.flush] : [over.flush as Flush]) : [{ draft: DRAFT, pending: false }];
  const choices = Array.isArray(over.choose) ? [...over.choose] : [over.choose ?? "Cancel"];
  const deps: ClosePromptDeps = {
    reason: over.reason ?? "close",
    name: "Checkout",
    canSave: over.canSave ?? true,
    flush: () => {
      events.push("flush");
      const flush = flushes.length > 1 ? flushes.shift() : flushes[0];
      if (flush === "fails") return Promise.reject(new Error("timeout"));
      if (flush === "hangs") return new Promise((resolve) => (landFlush = resolve));
      return Promise.resolve(flush ?? null);
    },
    ask: async (question) => {
      events.push("ask");
      questions.push(question);
      return (choices.length > 1 ? choices.shift() : choices[0])!;
    },
    save: async () => {
      events.push("save");
      if (over.save instanceof Error) throw over.save;
      return over.save === undefined ? "/Users/me/Checkout.sonobe" : over.save;
    },
    discard: async () => void events.push("discard"),
    showError: async (message, detail) => void events.push(`error: ${message} ${detail}`),
  };
  return { outcome: resolveClosePrompt(deps), events, question: () => questions.at(-1)!, questions, landFlush: (reply: FlushReply | null) => landFlush(reply) };
}

describe("the unsaved-changes prompt, closing a window or quitting", () => {
  it("asks Save, Don't Save or Cancel without waiting for the draft, which is written meanwhile", async () => {
    const p = prompt({ flush: "hangs", choose: "Cancel" });
    expect(await p.outcome).toEqual({ closed: false });
    expect(p.events).toEqual(["flush", "ask"]);
    expect(p.question()).toEqual({ message: "Do you want to save the changes you made to “Checkout”?", detail: "Your changes will be lost if you don't save them.", buttons: ["Save", "Don't Save", "Cancel"] });
  });

  it("saves, then deletes the draft and closes", async () => {
    const p = prompt({ choose: "Save" });
    expect(await p.outcome).toEqual({ closed: true, savedTo: "/Users/me/Checkout.sonobe" });
    expect(p.events).toEqual(["flush", "ask", "save", "discard"]);
  });

  it("stays open when the save is cancelled or fails, and keeps the draft", async () => {
    const cancelled = prompt({ choose: "Save", save: false });
    expect(await cancelled.outcome).toEqual({ closed: false });
    const failed = prompt({ choose: "Save", save: new Error("The disk is full.") });
    expect(await failed.outcome).toEqual({ closed: false });
    expect(failed.events).toEqual(["flush", "ask", "save", "error: Sonobe couldn't save your prototype. The disk is full."]);
    expect(cancelled.events).not.toContain("discard");
  });

  it("deletes the draft on Don't Save, once the write that was under way has landed", async () => {
    const p = prompt({ flush: "hangs", choose: "Don't Save" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(p.events).toEqual(["flush", "ask"]);
    p.landFlush({ draft: DRAFT, pending: false });
    expect(await p.outcome).toEqual({ closed: true });
    expect(p.events).toEqual(["flush", "ask", "discard"]);
  });

  it("offers no Save to a page that can't save", async () => {
    const p = prompt({ canSave: false, choose: "Don't Save" });
    expect(await p.outcome).toEqual({ closed: true });
    expect(p.question().buttons).toEqual(["Don't Save", "Cancel"]);
  });
});

describe("a quit that stops at the unsaved-changes prompt", () => {
  it("carries on once the window has closed, at each window that asks in turn", () => {
    let quits = 0;
    const resume = createQuitResume(() => void quits++);
    resume.began();
    // Save or Don't Save in the first window: the quit is asked for again, and stops at the second.
    resume.answered(true);
    expect(quits).toBe(1);
    resume.began();
    resume.answered(true);
    expect(quits).toBe(2);
  });

  it("is off once the person cancels, so closing a window later doesn't quit the app", () => {
    let quits = 0;
    const resume = createQuitResume(() => void quits++);
    resume.began();
    resume.answered(false);
    resume.answered(true);
    expect(quits).toBe(0);
  });

  it("never quits for a window that was only closed", () => {
    let quits = 0;
    createQuitResume(() => void quits++).answered(true);
    expect(quits).toBe(0);
  });
});

describe("the unsaved-changes prompt, restarting for an update", () => {
  it("offers Keep Draft once the draft holds every edit, writes it once more on Keep Draft, and closes without deleting it", async () => {
    const p = prompt({ reason: "restart", choose: "Keep Draft" });
    expect(await p.outcome).toEqual({ closed: true, draft: DRAFT });
    // Claude can edit while the question is up: the second write is what Keep Draft keeps.
    expect(p.events).toEqual(["flush", "ask", "flush"]);
    expect(p.question()).toMatchObject({ detail: "Sonobe keeps your changes as a draft and opens it again after the update.", buttons: ["Save", "Keep Draft", "Cancel"] });
  });

  it("waits for the draft before it asks, because the buttons depend on it", async () => {
    const p = prompt({ reason: "restart", flush: "hangs", choose: "Keep Draft" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(p.events).toEqual(["flush"]);
    p.landFlush({ draft: DRAFT, pending: false });
    await new Promise((resolve) => setTimeout(resolve, 5));
    // Asked, answered Keep Draft, and writing the draft again: the window isn't closed before that lands.
    expect(p.events).toEqual(["flush", "ask", "flush"]);
    p.landFlush({ draft: DRAFT, pending: false });
    expect(await p.outcome).toEqual({ closed: true, draft: DRAFT });
  });

  it("asks again without Keep Draft when an edit made while the question was up didn't reach the draft", async () => {
    for (const second of [{ draft: DRAFT, pending: true }, null, "fails"] as const) {
      const p = prompt({ reason: "restart", flush: [{ draft: DRAFT, pending: false }, second], choose: ["Keep Draft", "Cancel"] });
      expect(await p.outcome, String(second)).toEqual({ closed: false });
      expect(p.events).toEqual(["flush", "ask", "flush", "ask"]);
      expect(p.questions.map((q) => q.buttons)).toEqual([["Save", "Keep Draft", "Cancel"], ["Save", "Don't Save", "Cancel"]]);
      expect(p.questions[1]!.detail).toBe("Sonobe couldn't keep a draft of your changes. Your changes will be lost if you don't save them.");
    }
    // Save is still there the second time, and saves what the document holds now.
    const saved = prompt({ reason: "restart", flush: [{ draft: DRAFT, pending: false }, { draft: DRAFT, pending: true }], choose: ["Keep Draft", "Save"] });
    expect(await saved.outcome).toEqual({ closed: true, savedTo: "/Users/me/Checkout.sonobe" });
    expect(saved.events).toEqual(["flush", "ask", "flush", "ask", "save", "discard"]);
  });

  it("doesn't keep a draft other than the one it offered", async () => {
    const p = prompt({ reason: "restart", flush: [{ draft: DRAFT, pending: false }, { draft: "draft-0002-efgh", pending: false }], choose: ["Keep Draft", "Cancel"] });
    expect(await p.outcome).toEqual({ closed: false });
    expect(p.questions[1]!.buttons).toEqual(["Save", "Don't Save", "Cancel"]);
  });

  it("keeps the restart from happening on Cancel", async () => {
    const p = prompt({ reason: "restart", choose: "Cancel" });
    expect(await p.outcome).toEqual({ closed: false });
    expect(p.events).toEqual(["flush", "ask"]);
  });

  it("reports where Save put the document, and deletes the draft it no longer needs", async () => {
    const p = prompt({ reason: "restart", choose: "Save", save: "/Users/me/New.sonobe" });
    expect(await p.outcome).toEqual({ closed: true, savedTo: "/Users/me/New.sonobe" });
    expect(p.events).toEqual(["flush", "ask", "save", "discard"]);
    // An editor that doesn't say where it saved still closes; the window's own project is used.
    expect(await prompt({ reason: "restart", choose: "Save", save: null }).outcome).toEqual({ closed: true });
  });

  it("never promises a draft that isn't there: a copy that's only marked unsaved has none", async () => {
    const p = prompt({ reason: "restart", flush: { draft: null, pending: false }, choose: "Don't Save" });
    expect(await p.outcome).toEqual({ closed: true });
    expect(p.question()).toEqual({ message: "Do you want to save the changes you made to “Checkout”?", detail: "Your changes will be lost if you don't save them.", buttons: ["Save", "Don't Save", "Cancel"] });
  });

  it("says so when the draft couldn't be written, and offers only Save, Don't Save or Cancel", async () => {
    for (const flush of [{ draft: DRAFT, pending: true }, null, "fails"] as const) {
      const p = prompt({ reason: "restart", flush, choose: "Cancel" });
      expect(await p.outcome).toEqual({ closed: false });
      expect(p.question().buttons, String(flush)).toEqual(["Save", "Don't Save", "Cancel"]);
      expect(p.question().detail).toBe("Sonobe couldn't keep a draft of your changes. Your changes will be lost if you don't save them.");
    }
  });

  it("words the promise for a move to Applications, not an update", async () => {
    const p = prompt({ reason: "move", choose: "Keep Draft" });
    await p.outcome;
    expect(p.question().detail).toBe("Sonobe keeps your changes as a draft and opens it again once it has moved.");
  });
});

/** A window that closes with `outcome`, recording what was asked of it. */
function fakeWindow(name: string, log: string[], outcome: CloseOutcome, project: string | null | Error = null): RestartWindow {
  return {
    project: async () => {
      if (project instanceof Error) throw project;
      return project;
    },
    focus: () => void log.push(`focus ${name}`),
    requestClose: async (reason) => {
      log.push(`close ${name} (${reason})`);
      return outcome;
    },
  };
}

describe("closeWindowsForRestart", () => {
  it("closes each window in turn and says what each had open, as it is after a Save", async () => {
    const log: string[] = [];
    const windows = [
      fakeWindow("a", log, { closed: true, draft: DRAFT }, "/p/A.sonobe"),
      fakeWindow("b", log, { closed: true, savedTo: "/p/New.sonobe" }, null),
      fakeWindow("c", log, { closed: true }, "/p/C.sonobe"),
      fakeWindow("d", log, { closed: true }, new Error("The editor didn't answer")),
    ];
    expect(await closeWindowsForRestart(windows, "restart")).toEqual({
      closed: true,
      windows: [
        { project: "/p/A.sonobe", draft: DRAFT },
        { project: "/p/New.sonobe", draft: null },
        { project: "/p/C.sonobe", draft: null },
        { project: null, draft: null },
      ],
    });
    expect(log).toEqual(["focus a", "close a (restart)", "focus b", "close b (restart)", "focus c", "close c (restart)", "focus d", "close d (restart)"]);
  });

  it("stops at the first window the person keeps open, and leaves the rest alone", async () => {
    const log: string[] = [];
    const windows = [fakeWindow("a", log, { closed: true }), fakeWindow("b", log, { closed: false }), fakeWindow("c", log, { closed: true })];
    expect(await closeWindowsForRestart(windows, "restart")).toEqual({ closed: false });
    expect(log).toEqual(["focus a", "close a (restart)", "focus b", "close b (restart)"]);
  });
});

describe("the reopen record", () => {
  const file = path.join(temp, "reopen-after-update.json");
  const record: ReopenRecord = { version: 1, windows: [{ project: "/p/A.sonobe", draft: DRAFT }, { project: null, draft: "draft-0002-efgh" }] };
  afterEach(() => rmSync(file, { force: true }));

  it("round-trips, and is gone once taken", () => {
    writeReopenRecord(file, record);
    expect(readdirSync(temp)).toEqual(["reopen-after-update.json"]);
    expect(takeReopenRecord(file)).toEqual(record);
    expect(existsSync(file)).toBe(false);
    expect(takeReopenRecord(file)).toBeNull();
  });

  it("keeps only what it can open: absolute folders and well-formed draft ids", () => {
    writeFileSync(file, JSON.stringify({ version: 1, toVersion: "0.3.0", windows: [{ project: "relative.sonobe", draft: "../../etc" }, { project: "/p/B.sonobe" }, "nonsense", { draft: DRAFT, project: 7 }] }));
    expect(takeReopenRecord(file)).toEqual({ version: 1, windows: [{ project: "/p/B.sonobe", draft: null }, { project: null, draft: DRAFT }] });
  });

  it("is deleted, and opens nothing, when it's damaged, from another format, or empty", () => {
    for (const text of ["{ not json", JSON.stringify({ version: 2, windows: [{ project: "/p/A.sonobe" }] }), JSON.stringify({ version: 1, windows: [] }), JSON.stringify({ version: 1, windows: [{ project: null, draft: null }] })]) {
      writeFileSync(file, text);
      expect(takeReopenRecord(file), text).toBeNull();
      expect(existsSync(file)).toBe(false);
    }
  });

  it("opens a window's draft while it's there for the taking, else its project", () => {
    const exists = (dir: string) => dir !== "/p/Gone.sonobe";
    const plan = (windows: ReopenWindow[], drafts: string[] = [DRAFT]) => reopenPlan({ ...record, windows }, { drafts, exists });
    expect(plan([{ project: "/p/A.sonobe", draft: DRAFT }])).toEqual([{ kind: "draft", id: DRAFT, project: "/p/A.sonobe" }]);
    // The draft was taken or deleted in between: the saved project still opens.
    expect(plan([{ project: "/p/A.sonobe", draft: DRAFT }], [])).toEqual([{ kind: "project", path: "/p/A.sonobe" }]);
    expect(plan([{ project: null, draft: DRAFT }])).toEqual([{ kind: "draft", id: DRAFT, project: null }]);
    expect(plan([{ project: "/p/Gone.sonobe", draft: DRAFT }])).toEqual([{ kind: "draft", id: DRAFT, project: null }]);
    expect(plan([{ project: "/p/Gone.sonobe", draft: null }, { project: null, draft: "draft-0002-efgh" }])).toEqual([]);
  });
});

describe("restartConfirmation", () => {
  it("asks nothing when no Claude session is connected", () => {
    expect(restartConfirmation([], "0.3.0", "darwin")).toBeNull();
  });

  it("names the sessions a restart interrupts, and says they carry on", () => {
    expect(restartConfirmation(["Claude Code"], "0.3.0", "darwin")).toEqual({
      message: "Restart Sonobe to update to 0.3.0?",
      detail: "Claude Code is connected. A tool call that's running now will stop. The session carries on once Sonobe is back. If the update changes Sonobe's tools, start a new session to see them.",
      buttons: ["Restart", "Cancel"],
    });
    expect(restartConfirmation(["Claude Code", "Claude Desktop", "Claude Code"], "0.3.0", "linux")?.detail).toBe("2 Claude Code sessions and Claude Desktop are connected. A tool call that's running now will stop. The sessions carry on once Sonobe is back. If the update changes Sonobe's tools, start a new session to see them.");
    expect(restartConfirmation(["Claude Code"], null, "darwin")?.message).toBe("Restart Sonobe?");
  });

  it("says to reconnect on Windows, where the installer stops the relay", () => {
    expect(restartConfirmation(["Claude Code"], "0.3.0", "win32")?.detail).toBe("Claude Code is connected. A tool call that's running now will stop. Reconnect it once Sonobe is back.");
  });
});

describe("moveConflict", () => {
  it("asks before replacing a Sonobe in Applications, and never replaces one that's running", () => {
    expect(moveConflict("exists")).toMatchObject({ replace: "ask", question: { message: "Replace the Sonobe that's in your Applications folder?", buttons: ["Replace", "Cancel"] } });
    expect(moveConflict("existsAndRunning")).toEqual({ replace: false, message: "Another Sonobe is running from your Applications folder.", detail: "Quit that one, then choose Move to Applications again." });
  });
});

describe("restartKeepingWork", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function steps(over: { confirm?: boolean; windows?: RestartWindow[]; noWindowsLeft?: boolean; install?: () => Promise<void>; record?: () => void } = {}) {
    const log: string[] = [];
    const s: RestartSteps = {
      reason: "restart",
      confirm: async () => (log.push("confirm"), over.confirm ?? true),
      windows: () => over.windows ?? [fakeWindow("a", log, { closed: true, draft: DRAFT }, "/p/A.sonobe")],
      setRestarting: (on) => void log.push(`restarting ${on}`),
      record: (windows) => {
        log.push(`record ${JSON.stringify(windows)}`);
        over.record?.();
      },
      noWindowsLeft: async () => (log.push("wait for no windows"), over.noWindowsLeft ?? true),
      install: () => (log.push("install"), over.install ? over.install() : new Promise(() => undefined)),
      recover: async (windows) => void log.push(`recover ${JSON.stringify(windows)}`),
      giveUpMs: 30_000,
    };
    return { run: restartKeepingWork(s), log };
  }

  it("closes the windows, writes the record, waits for the last window, and only then installs", async () => {
    const s = steps();
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.log).toEqual(["confirm", "restarting true", "focus a", "close a (restart)", `record [{"project":"/p/A.sonobe","draft":"${DRAFT}"}]`, "wait for no windows", "install"]);
  });

  it("does nothing at all when the person says no to the confirmation", async () => {
    const s = steps({ confirm: false });
    expect(await s.run).toEqual({ result: "cancelled" });
    expect(s.log).toEqual(["confirm"]);
  });

  it("calls the restart off when a window stays open: no record, no install, and the update stays ready", async () => {
    const log: string[] = [];
    const s = steps({ windows: [fakeWindow("a", log, { closed: false })] });
    expect(await s.run).toEqual({ result: "cancelled" });
    expect(s.log).toEqual(["confirm", "restarting true", "restarting false"]);
  });

  it("brings the work back when the updater reports a failure", async () => {
    const s = steps({ install: () => Promise.reject(new Error("No update available, can't quit and install")) });
    expect(await s.run).toMatchObject({ result: "failed", error: { message: "No update available, can't quit and install" } });
    expect(s.log.slice(-3)).toEqual(["install", "restarting false", `recover [{"project":"/p/A.sonobe","draft":"${DRAFT}"}]`]);
  });

  it("brings the work back when the app is still running 30 s after install", async () => {
    const s = steps();
    let result: unknown = null;
    void s.run.then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toMatchObject({ result: "failed", error: { message: "Sonobe is still running 30 s after it was asked to restart." } });
    expect(s.log.at(-1)).toContain("recover");
  });

  it("never installs while a window is left, or when the record couldn't be written", async () => {
    const stuck = steps({ noWindowsLeft: false });
    expect(await stuck.run).toMatchObject({ result: "failed", error: { message: expect.stringContaining("stayed open") } });
    expect(stuck.log).not.toContain("install");
    const unwritable = steps({
      record: () => {
        throw new Error("EACCES: permission denied");
      },
    });
    expect(await unwritable.run).toMatchObject({ result: "failed", error: { message: "EACCES: permission denied" } });
    expect(unwritable.log).not.toContain("install");
    expect(unwritable.log.at(-1)).toContain("recover");
  });

  it("closes the windows the same way for a move to Applications, and brings the work back when the app stays", async () => {
    const log: string[] = [];
    const run = restartKeepingWork({
      reason: "move",
      confirm: async () => true,
      windows: () => [fakeWindow("a", log, { closed: true, draft: DRAFT })],
      setRestarting: (on) => void log.push(`restarting ${on}`),
      record: () => void log.push("record"),
      noWindowsLeft: async () => true,
      // The person kept the copy that's already in Applications.
      install: () => Promise.reject(new Error("Sonobe stayed where it is.")),
      recover: async (windows) => void log.push(`recover ${windows.length}`),
    });
    expect(await run).toMatchObject({ result: "failed", error: { message: "Sonobe stayed where it is." } });
    expect(log).toEqual(["restarting true", "focus a", "close a (move)", "record", "restarting false", "recover 1"]);
  });

  it("treats an install that comes back without restarting as a failure too", async () => {
    const s = steps({ install: async () => undefined });
    expect(await s.run).toMatchObject({ result: "failed", error: { message: "Sonobe didn't restart." } });
  });
});

it("keeps the record's text readable for someone who finds the file", () => {
  const file = path.join(temp, "readable.json");
  writeReopenRecord(file, { version: 1, windows: [{ project: "/p/A.sonobe", draft: null }] });
  expect(readFileSync(file, "utf8")).toContain('"project": "/p/A.sonobe"');
  rmSync(file);
});
