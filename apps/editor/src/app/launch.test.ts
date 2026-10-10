// @vitest-environment happy-dom
import { createEmptyDocument, type Op } from "@sonobe/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserHost, createMemoryProjectStorage, type ProjectStorage } from "../host/browserHost.ts";
import type { HostAdapter } from "../host/types.ts";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { createMemoryTrustPersistence } from "../runtime/scriptTrust.ts";
import { createDemoDocument } from "../state/demoDocument.ts";
import { createEditorSession, type EditorSession } from "../state/session.ts";
import type { ToastOptions } from "../ui/Toast.tsx";
import { getLaunchHost, LAUNCH_WAIT_MS, launchOutcome, startLaunch, toLaunchInfo, type LaunchInfo } from "./launch.ts";
import { getAppSession } from "./session.ts";

vi.mock("../state/demoDocument.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/demoDocument.ts")>();
  return { ...actual, createDemoDocument: vi.fn(actual.createDemoDocument) };
});

const headless = () => ({ autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" as const, trustPersistence: createMemoryTrustPersistence(), drafts: { debounceMs: 0, maxWaitMs: 0 } });
const addRect = (name: string): Op => ({ op: "addLayer", layer: { type: "rectangle", name } });

const sessions: EditorSession[] = [];
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.mocked(createDemoDocument).mockClear();
  delete (window as { sonobeHost?: unknown }).sonobeHost;
  delete (window as { __sonobeFakeLaunch?: unknown }).__sonobeFakeLaunch;
});

/** Project and draft storage with what the tests open: a saved prototype, one with a JavaScript patch, and a draft of unsaved changes to the first. */
async function disk() {
  const storage = createMemoryProjectStorage();
  const drafts = createMemoryProjectStorage();
  const host = (): HostAdapter => createBrowserHost({ storage, drafts, locks: null, channelName: null, recentKey: null, fileSystemAccess: false });
  const author = createEditorSession({ host: host(), document: createEmptyDocument({ name: "Checkout" }), ...headless() });
  sessions.push(author);
  author.document.getState().apply([addRect("Card")], { label: "Add Card" });
  expect((await author.document.getState().saveTo("browser:Checkout")).ok).toBe(true);
  author.document.getState().newDocument({ name: "Scripted" });
  author.document.getState().apply([{ op: "addPatch", patch: { id: "js_1", type: "javascript", ui: { x: 0, y: 0 } } }], { label: "Add script" });
  expect((await author.document.getState().saveTo("browser:Scripted")).ok).toBe(true);
  expect((await author.openProject("browser:Checkout")).ok).toBe(true);
  author.document.getState().apply([addRect("Unsaved badge")], { label: "Add badge" });
  await author.drafts!.flush();
  const [draft] = await host().drafts!.list();
  return { storage, drafts, host, draft: draft!.id };
}

/** Starts the app's session as a window the desktop app opened with `info` would, and waits for it. */
async function launch(host: HostAdapter, info: Partial<LaunchInfo> | Promise<unknown>) {
  const notices: ToastOptions[] = [];
  const settled = startLaunch({ launch: async () => info }, { host, ...headless() }, (options) => notices.push(options));
  const session = getAppSession();
  sessions.push(session);
  return { session, settled: settled!, notices };
}

const layerNames = (session: EditorSession) => {
  const doc = session.document.getState().doc;
  return Object.values(doc.components[doc.project.root]!.layers).map((layer) => layer.name);
};

describe("startLaunch", () => {
  it("is null with no host to ask, and the editor starts as it always has", () => {
    expect(getLaunchHost()).toBeNull();
    (window as { sonobeHost?: unknown }).sonobeHost = { platform: "darwin", launching: false, launch: async () => null };
    expect(getLaunchHost()).toBeNull();
    (window as { sonobeHost?: unknown }).sonobeHost = { platform: "darwin" };
    expect(getLaunchHost()).toBeNull();
    expect(startLaunch(getLaunchHost())).toBeNull();
    expect(launchOutcome()).toEqual({ pending: false, reopening: false, opened: false, pristine: null });
  });

  it("asks the desktop app in a window it opened for something, and the e2e fake in dev", async () => {
    (window as { sonobeHost?: unknown }).sonobeHost = { launching: true, launch: async () => ({ reopening: true, open: null, problems: [] }) };
    expect(await getLaunchHost()!.launch()).toMatchObject({ reopening: true });
    delete (window as { sonobeHost?: unknown }).sonobeHost;
    (window as { __sonobeFakeLaunch?: unknown }).__sonobeFakeLaunch = { launching: true, launch: async () => ({ open: { kind: "project", path: "browser:Checkout" } }) };
    expect(await getLaunchHost()!.launch()).toEqual({ open: { kind: "project", path: "browser:Checkout" } });
  });

  it("starts the session on the project: it's the document when the launch settles, and the demo is never built", async () => {
    const { host } = await disk();
    const { session, settled, notices } = await launch(host(), { open: { kind: "project", path: "browser:Checkout" } });
    expect(launchOutcome()).toMatchObject({ pending: true, opened: false });
    expect(session.document.getState().doc.project.name).toBe("Untitled");
    await settled;
    expect(session.document.getState()).toMatchObject({ projectPath: "browser:Checkout", dirty: false });
    expect(layerNames(session)).toEqual(["Card"]);
    expect(session.selection.getState().componentPath).toEqual([session.document.getState().doc.project.root]);
    expect(launchOutcome()).toEqual({ pending: false, reopening: false, opened: true, pristine: null });
    expect(createDemoDocument).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
    // One session, the app's: the editor renders the one the launch started.
    expect(getAppSession()).toBe(session);
  });

  it("shows the demo and says why when the project can't be opened, with the document as untouched as a plain launch's", async () => {
    const { host } = await disk();
    const { session, settled, notices } = await launch(host(), { open: { kind: "project", path: "browser:Gone" } });
    await settled;
    expect(session.document.getState()).toMatchObject({ projectPath: null, dirty: false });
    expect(session.document.getState().doc.project.name).toBe("Photo Zoom");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ id: "launch-project", title: "Couldn't open “Gone”", tone: "danger", duration: "persistent" });
    expect(notices[0]!.description).toBeTruthy();
    const outcome = launchOutcome();
    expect(outcome).toMatchObject({ pending: false, opened: false, reopening: false });
    // What the Recovered offer compares with: nothing has touched the demo since the launch put it in.
    expect(outcome.pristine).toBe(session.document.getState().lastChange);
    expect(outcome.pristine).not.toBeNull();
  });

  it("brings a draft back as the draft, over its project", async () => {
    const { host, draft } = await disk();
    const { session, settled, notices } = await launch(host(), { reopening: true, open: { kind: "draft", id: draft, project: "browser:Checkout" } });
    await settled;
    expect(session.document.getState()).toMatchObject({ projectPath: "browser:Checkout", dirty: true });
    expect(layerNames(session)).toEqual(["Card", "Unsaved badge"]);
    expect(session.drafts!.current()?.id).toBe(draft);
    expect(launchOutcome()).toEqual({ pending: false, reopening: true, opened: true, pristine: null });
    expect(notices).toEqual([]);
    expect(createDemoDocument).not.toHaveBeenCalled();
  });

  it("opens the project when its draft doesn't come back, and says the draft didn't", async () => {
    const { host } = await disk();
    const { session, settled, notices } = await launch(host(), { reopening: true, open: { kind: "draft", id: "draft-0000-gone", project: "browser:Checkout" } });
    await settled;
    expect(session.document.getState()).toMatchObject({ projectPath: "browser:Checkout", dirty: false });
    expect(layerNames(session)).toEqual(["Card"]);
    expect(notices.map((notice) => notice.id)).toEqual(["launch-draft"]);
    expect(notices[0]).toMatchObject({ title: "Sonobe couldn't bring back that draft", tone: "danger", duration: "persistent" });
    expect(launchOutcome()).toMatchObject({ opened: true, reopening: true });
  });

  it("falls back to the demo when a draft with no project doesn't come back", async () => {
    const { host } = await disk();
    const { session, settled, notices } = await launch(host(), { open: { kind: "draft", id: "draft-0000-gone", project: null } });
    await settled;
    expect(session.document.getState().doc.project.name).toBe("Photo Zoom");
    expect(notices.map((notice) => notice.id)).toEqual(["launch-draft"]);
    expect(launchOutcome()).toMatchObject({ opened: false });
  });

  it("asks before running the scripts of a project it starts on, like any project from disk", async () => {
    const { host } = await disk();
    const { session, settled } = await launch(host(), { open: { kind: "project", path: "browser:Scripted" } });
    await settled;
    expect(session.scriptTrust.getState()).toMatchObject({ required: true, trusted: false, scriptCount: 1, projectPath: "browser:Scripted" });
    expect(session.scriptTrust.allowed()).toBe(false);
  });

  it("says which paths weren't prototypes, and shows the demo when nothing was", async () => {
    const { host } = await disk();
    const { session, settled, notices } = await launch(host(), {
      open: null,
      problems: [
        { path: "/Volumes/Work/Old Flow.sonobe", reason: "missing" },
        { path: "/Users/me/Notes", reason: "notProject" },
      ],
    });
    await settled;
    expect(session.document.getState().doc.project.name).toBe("Photo Zoom");
    expect(notices.map((notice) => [notice.id, notice.title])).toEqual([
      ["launch-missing-0", "“Old Flow” isn't there right now"],
      ["launch-not-project-1", "“Notes” isn't a Sonobe prototype"],
    ]);
    expect(notices.every((notice) => notice.duration === "persistent" && notice.description)).toBe(true);
    expect(launchOutcome()).toMatchObject({ opened: false, reopening: false });
  });

  it("keeps one session when the app answers after the editor gave up waiting: the project opens into the one on screen", async () => {
    const { host } = await disk();
    let answer!: (info: unknown) => void;
    const { session, settled } = await launch(host(), new Promise((resolve) => (answer = resolve)));
    // What main.tsx does: render when the launch settles or after LAUNCH_WAIT_MS, whichever is first.
    expect(LAUNCH_WAIT_MS).toBeLessThanOrEqual(2000);
    expect(launchOutcome().pending).toBe(true);
    expect(getAppSession()).toBe(session);
    expect(session.document.getState().doc.project.name).toBe("Untitled");
    answer({ open: { kind: "project", path: "browser:Checkout" } });
    await settled;
    expect(getAppSession()).toBe(session);
    expect(session.document.getState().projectPath).toBe("browser:Checkout");
    expect(createDemoDocument).not.toHaveBeenCalled();
  });

  it("leaves an empty prototype the person already started on alone when the launch fails late", async () => {
    const { host } = await disk();
    let answer!: (info: unknown) => void;
    const { session, settled, notices } = await launch(host(), new Promise((resolve) => (answer = resolve)));
    session.document.getState().apply([addRect("Started meanwhile")], { label: "Add layer" });
    answer({ open: null, problems: [{ path: "/gone/Old.sonobe", reason: "missing" }] });
    await settled;
    expect(layerNames(session)).toEqual(["Started meanwhile"]);
    expect(notices).toHaveLength(1);
    expect(launchOutcome()).toMatchObject({ pending: false, opened: false, pristine: null });
  });

  it("starts as a plain launch when the app's answer never comes or isn't one", async () => {
    const { host } = await disk();
    const { session, settled, notices } = await launch(host(), Promise.reject(new Error("No handler registered")));
    await settled;
    expect(session.document.getState().doc.project.name).toBe("Photo Zoom");
    expect(notices).toEqual([]);
    expect(launchOutcome()).toMatchObject({ pending: false, opened: false, reopening: false });
  });
});

describe("toLaunchInfo", () => {
  it("keeps a well-formed answer", () => {
    const info: LaunchInfo = { reopening: true, open: { kind: "draft", id: "draft-0001-abcd", project: "/work/Checkout.sonobe" }, problems: [{ path: "/work/Notes", reason: "notProject" }] };
    expect(toLaunchInfo(info)).toEqual(info);
    expect(toLaunchInfo({ reopening: false, open: { kind: "project", path: "/work/Checkout.sonobe" }, problems: [] }).open).toEqual({ kind: "project", path: "/work/Checkout.sonobe" });
  });

  it("reads anything else as nothing to open", () => {
    for (const value of [null, undefined, "launch", 3, {}, { open: "x" }, { open: { kind: "project" } }, { open: { kind: "draft", id: 7 } }, { open: { kind: "window", path: "/x" } }]) {
      expect(toLaunchInfo(value), JSON.stringify(value)).toEqual({ reopening: false, open: null, problems: [] });
    }
    expect(toLaunchInfo({ reopening: "yes", open: { kind: "draft", id: "d", project: 4 }, problems: [{ path: 3 }, null, { path: "/a", reason: "odd" }] })).toEqual({ reopening: false, open: { kind: "draft", id: "d", project: null }, problems: [{ path: "/a", reason: "missing" }] });
  });
});
