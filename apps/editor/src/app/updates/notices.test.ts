import { describe, expect, it } from "vitest";
import type { ToastOptions } from "../../ui/Toast.tsx";
import { attachUpdateNotices, describeUpdate, MOVE_NOTICE_ID, moveNotice, noticeFor, UPDATE_NOTICE_ID, UPDATED_NOTICE_ID, updatedNotice } from "./notices.ts";
import { fakeUpdatesHost, updateStatus, type FakeUpdatesOptions } from "./testing.ts";
import { createUpdateStore, followUpdates } from "./updateStore.ts";
import type { UpdateStatus } from "./updatesHost.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const network = { kind: "network", phase: "check", message: "Sonobe couldn't reach the release feed to check for updates.", hint: "Check your internet connection, then choose Check for Updates again." } as const;
const rejected = { kind: "rejected", phase: "download", message: "macOS wouldn't install the update: its signature doesn't match this copy of Sonobe.", hint: "Download the new version from the release page and replace Sonobe in your Applications folder." } as const;
const unpublished = { kind: "no-release", phase: "check", message: "There's no published version of Sonobe to update to right now.", hint: "Nothing to do for now." } as const;
/** What a 503 or a rate limit from the feed, or a proxy's page in its place, comes out as. */
const unanswered = { kind: "other", phase: "check", message: "Sonobe couldn't check for updates.", hint: "Try again later, or look at the release page for the newest version. (The updater said: 503 Service Unavailable)" } as const;

describe("noticeFor", () => {
  it("says a downloaded update is ready, until dismissed, with Restart to Update", () => {
    const notice = noticeFor(updateStatus({ state: "downloading", version: "0.2.0", progress: 0.9 }), updateStatus({ state: "ready", version: "0.2.0" }));
    expect(notice).toMatchObject({ id: UPDATE_NOTICE_ID, title: "Sonobe 0.2.0 is ready", duration: "persistent", action: { label: "Restart to Update", run: "restart" } });
    expect(notice?.description).toContain("opens what you had open again");
  });

  it("says a version is available where this copy can't install it, with why and a Download", () => {
    const reason = "This copy of Sonobe was built locally, so it can't replace itself. Download the new version instead.";
    const notice = noticeFor(updateStatus({ mode: "notify", state: "checking" }), updateStatus({ mode: "notify", state: "available", version: "0.2.0", reason }));
    expect(notice).toEqual({ id: UPDATE_NOTICE_ID, title: "Sonobe 0.2.0 is available", description: reason, tone: "info", duration: "persistent", action: { label: "Download", run: "openRelease" } });
  });

  it("shows a notice once per change, so one that was dismissed stays dismissed", () => {
    const ready = updateStatus({ state: "ready", version: "0.2.0" });
    expect(noticeFor(ready, { ...ready })).toBeNull();
    expect(noticeFor(ready, { ...ready, autoCheck: false })).toBeNull();
    // Restart to Update began: nothing new to say.
    expect(noticeFor(ready, { ...ready, restarting: true })).toBeNull();
    const available = updateStatus({ mode: "notify", state: "available", version: "0.2.0" });
    expect(noticeFor(available, { ...available })).toBeNull();
    // A newer version than the one already announced is news.
    expect(noticeFor(available, { ...available, version: "0.3.0" })?.title).toBe("Sonobe 0.3.0 is available");
  });

  it("shows the notice for the state a window opens into, when there's something to act on", () => {
    expect(noticeFor(null, updateStatus({ state: "ready", version: "0.2.0" }))?.title).toBe("Sonobe 0.2.0 is ready");
    expect(noticeFor(null, updateStatus({ mode: "notify", state: "available", version: "0.2.0" }))?.title).toBe("Sonobe 0.2.0 is available");
    expect(noticeFor(null, updateStatus({ state: "failed", version: "0.2.0", error: rejected }))?.title).toBe(rejected.message);
    expect(noticeFor(null, updateStatus({ state: "idle" }))).toBeNull();
    expect(noticeFor(null, updateStatus({ state: "upToDate" }))).toBeNull();
  });

  it("doesn't repeat a manual check's answer in a window that opens later", () => {
    // `manual` stays true until the next check, for good with automatic checks off: a new window's first status answers nobody.
    expect(noticeFor(null, updateStatus({ state: "upToDate", manual: true, asks: 1 }))).toBeNull();
    expect(noticeFor(null, updateStatus({ state: "checking", manual: true, asks: 1 }))).toBeNull();
    expect(noticeFor(null, updateStatus({ state: "downloading", version: "0.2.0", progress: 0.3, manual: true, asks: 1 }))).toBeNull();
    expect(noticeFor(null, updateStatus({ state: "failed", manual: true, asks: 1, error: network }))).toBeNull();
    expect(noticeFor(null, updateStatus({ state: "failed", manual: true, asks: 1, error: unanswered }))).toBeNull();
  });

  it("brings the ready notice back after a cancelled restart", () => {
    const ready = updateStatus({ state: "ready", version: "0.2.0" });
    expect(noticeFor({ ...ready, restarting: true }, ready)?.action?.run).toBe("restart");
  });

  it("says nothing while an automatic check runs, finds nothing, or downloads", () => {
    const idle = updateStatus();
    expect(noticeFor(idle, updateStatus({ state: "checking" }))).toBeNull();
    expect(noticeFor(updateStatus({ state: "checking" }), updateStatus({ state: "upToDate" }))).toBeNull();
    expect(noticeFor(updateStatus({ state: "checking" }), updateStatus({ state: "downloading", version: "0.2.0", progress: 0 }))).toBeNull();
    expect(noticeFor(updateStatus({ state: "downloading", version: "0.2.0", progress: 0.1 }), updateStatus({ state: "downloading", version: "0.2.0", progress: 0.2 }))).toBeNull();
  });

  it("answers a check the person asked for, whatever it finds", () => {
    const asked = updateStatus({ state: "checking", manual: true });
    expect(noticeFor(updateStatus(), asked)?.title).toBe("Checking for updates…");
    expect(noticeFor(asked, updateStatus({ state: "upToDate", manual: true }))).toMatchObject({ title: "Sonobe is up to date", description: "Version 0.1.0 is the newest.", tone: "success" });
    expect(noticeFor(asked, updateStatus({ state: "downloading", manual: true, version: "0.2.0", progress: 0 }))?.title).toBe("Sonobe 0.2.0 is downloading");
    // Asked while an update is downloading or ready: only `asks` changes, and the answer is the state.
    expect(noticeFor(updateStatus({ state: "ready", version: "0.2.0" }), updateStatus({ state: "ready", version: "0.2.0", manual: true, asks: 1 }))?.title).toBe("Sonobe 0.2.0 is ready");
    expect(noticeFor(updateStatus({ state: "downloading", version: "0.2.0", progress: 0.4 }), updateStatus({ state: "downloading", version: "0.2.0", progress: 0.4, manual: true, asks: 1 }))?.title).toBe("Sonobe 0.2.0 is downloading");
  });

  it("answers again each time the person asks, after the first answer went away or was dismissed", () => {
    const downloading = updateStatus({ state: "downloading", version: "0.2.0", progress: 0.4, manual: true, asks: 1 });
    expect(noticeFor(downloading, { ...downloading, asks: 2 })?.title).toBe("Sonobe 0.2.0 is downloading");
    expect(noticeFor(downloading, { ...downloading, progress: 0.5 })).toBeNull();
    const ready = updateStatus({ state: "ready", version: "0.2.0", manual: true, asks: 2 });
    expect(noticeFor(ready, { ...ready, asks: 3 })).toMatchObject({ title: "Sonobe 0.2.0 is ready", duration: "persistent" });
    const upToDate = updateStatus({ state: "upToDate", manual: true, asks: 1 });
    expect(noticeFor(upToDate, { ...upToDate, state: "checking", asks: 2 })?.title).toBe("Checking for updates…");
  });

  it("keeps an automatic check that failed to itself, whatever went wrong with it", () => {
    const checking = updateStatus({ state: "checking" });
    expect(noticeFor(checking, updateStatus({ state: "failed", error: network }))).toBeNull();
    expect(noticeFor(checking, updateStatus({ state: "failed", error: unpublished }))).toBeNull();
    // The feed answered 503, or a proxy answered in its place: nobody asked, and no version was found to act on.
    expect(noticeFor(checking, updateStatus({ state: "failed", error: unanswered }))).toBeNull();
    // Even a kind that would be loud for a download says nothing for a check.
    expect(noticeFor(checking, updateStatus({ state: "failed", error: { ...rejected, phase: "check" } }))).toBeNull();
    // A download that lost its connection is tried again at the next check.
    expect(noticeFor(updateStatus({ state: "downloading", version: "0.2.0", progress: 0.2 }), updateStatus({ state: "failed", version: "0.2.0", error: { ...network, phase: "download" } }))).toBeNull();
  });

  it("says what failed and what to do when the person asked, or when a download can't be installed", () => {
    const asked = updateStatus({ state: "checking", manual: true });
    expect(noticeFor(asked, updateStatus({ state: "failed", manual: true, error: network }))).toEqual({ id: UPDATE_NOTICE_ID, title: network.message, description: network.hint, tone: "warn" });
    expect(noticeFor(asked, updateStatus({ state: "failed", manual: true, error: unpublished }))).toMatchObject({ title: unpublished.message, tone: "neutral" });
    // A check the person asked for that the feed didn't answer: a warning that goes away, with the release page to look at.
    expect(noticeFor(asked, updateStatus({ state: "failed", manual: true, error: unanswered }))).toEqual({ id: UPDATE_NOTICE_ID, title: unanswered.message, description: unanswered.hint, tone: "warn", action: { label: "Open release page", run: "openRelease" } });
    // Not asked for, but the person would otherwise never learn the update didn't go in.
    expect(noticeFor(updateStatus({ state: "downloading", version: "0.2.0", progress: 1 }), updateStatus({ state: "failed", version: "0.2.0", error: rejected }))).toEqual({
      id: UPDATE_NOTICE_ID,
      title: rejected.message,
      description: rejected.hint,
      tone: "danger",
      duration: "persistent",
      action: { label: "Open release page", run: "openRelease" },
    });
  });

  it("says nothing in a copy that never checks", () => {
    expect(noticeFor(null, updateStatus({ mode: "off", state: "ready", version: "0.2.0" }))).toBeNull();
    expect(updatedNotice(updateStatus({ mode: "off", updatedFrom: "0.0.9" }))).toBeNull();
    expect(moveNotice(updateStatus({ mode: "off", offerMove: true, canMove: true }))).toBeNull();
  });

  it("has words for every state but idle", () => {
    for (const state of ["checking", "upToDate", "available", "downloading", "ready"] as const) expect(describeUpdate(updateStatus({ state, version: "0.2.0" }))?.title, state).toBeTruthy();
    expect(describeUpdate(updateStatus({ state: "available" }))?.title).toBe("A new version of Sonobe is available");
    expect(describeUpdate(updateStatus({ state: "idle" }))).toBeNull();
    expect(describeUpdate(updateStatus({ state: "failed" }))).toBeNull();
  });
});

describe("the other two notices", () => {
  it("says Sonobe was updated, with its release notes", () => {
    expect(updatedNotice(updateStatus({ current: "0.2.0", updatedFrom: "0.1.0", notesUrl: "https://example.test/v0.2.0" }))).toEqual({ id: UPDATED_NOTICE_ID, title: "Sonobe was updated to 0.2.0", tone: "success", action: { label: "Release notes", run: "openNotes" } });
    expect(updatedNotice(updateStatus())).toBeNull();
  });

  it("offers the move to Applications while it's on offer", () => {
    expect(moveNotice(updateStatus({ mode: "notify", offerMove: true, canMove: true }))).toMatchObject({ id: MOVE_NOTICE_ID, title: "Move Sonobe to your Applications folder", duration: "persistent", action: { label: "Move", run: "move" } });
    expect(moveNotice(updateStatus({ mode: "notify", canMove: true }))).toBeNull();
  });
});

/** A store following a fake host, with the toasts it would have shown. */
async function attached(initial: Partial<UpdateStatus> = {}, options: FakeUpdatesOptions = {}) {
  const host = fakeUpdatesHost(initial, options);
  const store = createUpdateStore(() => host);
  const shown: ToastOptions[] = [];
  const dismissed: string[] = [];
  const opened: string[] = [];
  const toast = Object.assign((toastOptions: ToastOptions) => void shown.push(toastOptions), { dismiss: (id: string) => void dismissed.push(id) });
  const unfollow = followUpdates(store, host);
  const detach = attachUpdateNotices(store, toast, (url) => void opened.push(url));
  await settle();
  return { host, store, shown, dismissed, opened, titles: () => shown.map((t) => t.title), detach: () => (detach(), unfollow()) };
}

describe("attachUpdateNotices", () => {
  it("shows the ready notice, and Restart to Update asks the app", async () => {
    const t = await attached({ state: "downloading", version: "0.2.0", progress: 0.5 }, { restarts: true });
    expect(t.shown).toEqual([]);
    t.host.push({ state: "ready", progress: null });
    expect(t.titles()).toEqual(["Sonobe 0.2.0 is ready"]);
    t.shown[0]!.action!.onClick();
    await settle();
    expect(t.host.calls).toEqual(["restart"]);
    // It restarted: nothing comes back.
    expect(t.titles()).toEqual(["Sonobe 0.2.0 is ready"]);
  });

  it("brings the ready notice back when the restart is cancelled, with or without a prompt", async () => {
    const t = await attached({ state: "ready", version: "0.2.0" });
    expect(t.titles()).toEqual(["Sonobe 0.2.0 is ready"]);
    // Cancelled at the unsaved-changes prompt: `restarting` went true and back.
    t.shown[0]!.action!.onClick();
    await settle();
    expect(t.titles().slice(1).every((title) => title === "Sonobe 0.2.0 is ready")).toBe(true);
    expect(t.shown.length).toBeGreaterThan(1);
    // Cancelled before any window closed (the Claude sessions question): the status never changed.
    const before = t.shown.length;
    t.host.restart = async () => false;
    t.shown.at(-1)!.action!.onClick();
    await settle();
    expect(t.shown).toHaveLength(before + 1);
    expect(t.shown.at(-1)).toMatchObject({ id: UPDATE_NOTICE_ID, title: "Sonobe 0.2.0 is ready", duration: "persistent" });
  });

  it("opens the release page from Download", async () => {
    const t = await attached({ mode: "notify", state: "available", version: "0.2.0", releaseUrl: "https://example.test/tag/v0.2.0" });
    expect(t.titles()).toEqual(["Sonobe 0.2.0 is available"]);
    t.shown[0]!.action!.onClick();
    expect(t.opened).toEqual(["https://example.test/tag/v0.2.0"]);
  });

  it("answers Check for Updates…, and stays quiet for the automatic check after it", async () => {
    const t = await attached({ state: "upToDate" });
    await t.store.getState().check();
    expect(t.titles()).toEqual(["Checking for updates…", "Sonobe is up to date"]);
    expect(new Set(t.shown.map((toast) => toast.id))).toEqual(new Set([UPDATE_NOTICE_ID]));
    t.host.push({ state: "checking", manual: false });
    t.host.push({ state: "upToDate" });
    expect(t.shown).toHaveLength(2);
  });

  it("answers Check for Updates… again while an update is downloading, and again once it's ready", async () => {
    const t = await attached({ state: "downloading", version: "0.2.0", progress: 0.2 });
    await t.store.getState().check();
    await t.store.getState().check();
    expect(t.titles()).toEqual(["Sonobe 0.2.0 is downloading", "Sonobe 0.2.0 is downloading"]);
    t.host.push({ state: "ready", progress: null });
    await t.store.getState().check();
    expect(t.titles().slice(2)).toEqual(["Sonobe 0.2.0 is ready", "Sonobe 0.2.0 is ready"]);
    expect(t.host.calls).toEqual(["check", "check", "check"]);
  });

  it("says nothing in a window that opens after a manual check was answered", async () => {
    const t = await attached({ state: "upToDate", manual: true, asks: 1 });
    expect(t.shown).toEqual([]);
  });

  it("takes down a notice whose state is over", async () => {
    const t = await attached({ state: "failed", version: "0.2.0", error: rejected });
    expect(t.titles()).toEqual([rejected.message]);
    t.host.push({ state: "checking", error: null });
    expect(t.dismissed).toEqual([UPDATE_NOTICE_ID]);
  });

  it("says Sonobe was updated once, and opens its release notes", async () => {
    const t = await attached({ current: "0.2.0", updatedFrom: "0.1.0", notesUrl: "https://example.test/tag/v0.2.0", state: "idle" });
    expect(t.titles()).toEqual(["Sonobe was updated to 0.2.0"]);
    t.host.push({ state: "checking" });
    t.host.push({ state: "upToDate" });
    expect(t.titles()).toEqual(["Sonobe was updated to 0.2.0"]);
    // The app stops reporting it once a window has heard it: the notice's link is the one it was shown with.
    t.host.push({ updatedFrom: null, notesUrl: null });
    t.shown[0]!.action!.onClick();
    expect(t.opened).toEqual(["https://example.test/tag/v0.2.0"]);
    expect(t.titles()).toEqual(["Sonobe was updated to 0.2.0"]);
  });

  it("offers the move to Applications once, and Move asks the app", async () => {
    const t = await attached({ mode: "notify", canMove: true, offerMove: true, reason: "Sonobe updates itself only from an Applications folder. Move it there." });
    expect(t.titles()).toEqual(["Move Sonobe to your Applications folder"]);
    t.host.push({ state: "available", version: "0.2.0" });
    expect(t.titles()).toEqual(["Move Sonobe to your Applications folder", "Sonobe 0.2.0 is available"]);
    expect(t.shown[1]!.id).not.toBe(t.shown[0]!.id);
    t.shown[0]!.action!.onClick();
    expect(t.host.calls).toEqual(["move"]);
  });

  it("shows nothing in a copy that never checks, and stops when detached", async () => {
    const off = await attached({ mode: "off", state: "idle" });
    off.host.push({ state: "ready", version: "0.2.0" });
    expect(off.shown).toEqual([]);
    const t = await attached({ state: "idle" });
    t.detach();
    t.host.push({ state: "ready", version: "0.2.0" });
    expect(t.shown).toEqual([]);
  });
});
