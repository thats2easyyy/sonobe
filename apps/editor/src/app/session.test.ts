import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryProjectStorage } from "../host/browserHost.ts";
import type { HostAdapter } from "../host/types.ts";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { createDemoDocument } from "../state/demoDocument.ts";
import type { EditorSession } from "../state/session.ts";
import { createAppDialogStore } from "./dialogs.ts";
import { createAppBrowserHost, createAppSession } from "./session.ts";

let session: EditorSession | null = null;
let host: HostAdapter | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
  host?.dispose();
  host = null;
});

const headless = { autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" as const };

describe("createAppSession", () => {
  it("starts on the demo and asks the app dialogs before discarding changes", async () => {
    const dialogs = createAppDialogStore();
    session = createAppSession({ host: null, dialogs, ...headless });
    expect(session.document.getState().doc.project.name).toBe("Photo Zoom");
    expect(await session.confirmDiscardChanges("new")).toBe(true);

    session.document.getState().apply([{ op: "setProject", changes: { name: "Edited" } }], { label: "Rename" });
    const pending = session.confirmDiscardChanges("new");
    expect(dialogs.getState().queue[0]).toMatchObject({ kind: "confirmDiscard", name: "Edited", action: "new" });
    dialogs.getState().settle(dialogs.getState().queue[0]!.id, "cancel");
    expect(await pending).toBe(false);

    const discard = session.newProject();
    dialogs.getState().settle(dialogs.getState().queue[0]!.id, "discard");
    expect(await discard).toBe(true);
    expect(session.document.getState().dirty).toBe(false);
  });
});

describe("createAppBrowserHost", () => {
  it("names new projects and picks stored ones through the app dialogs", async () => {
    const dialogs = createAppDialogStore();
    const storage = createMemoryProjectStorage();
    host = createAppBrowserHost(dialogs, { storage, channelName: null, recentKey: null, window: {} });

    const save = host.saveProjectDialog("Photo Zoom");
    await vi.waitFor(() => expect(dialogs.getState().queue[0]?.kind).toBe("promptName"));
    dialogs.getState().settle(dialogs.getState().queue[0]!.id, "Checkout Flow");
    await expect(save).resolves.toBe("browser:Checkout Flow");

    await host.writeProject("browser:Checkout Flow", createDemoDocument());
    const open = host.openProjectDialog();
    await vi.waitFor(() => expect(dialogs.getState().queue[0]).toMatchObject({ kind: "pickProject", names: ["Checkout Flow"] }));
    dialogs.getState().settle(dialogs.getState().queue[0]!.id, "Checkout Flow");
    await expect(open).resolves.toBe("browser:Checkout Flow");
  });

  it("resolves null without a dialog when nothing is saved", async () => {
    const dialogs = createAppDialogStore();
    host = createAppBrowserHost(dialogs, { storage: createMemoryProjectStorage(), channelName: null, recentKey: null, window: {} });
    await expect(host.openProjectDialog()).resolves.toBeNull();
    expect(dialogs.getState().queue).toEqual([]);
  });
});
