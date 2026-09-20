import { afterEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { createEditorSession, type EditorSession } from "../state/session.ts";
import { installTestHook, type SonobeTestHook } from "./testHook.ts";

const importDesign = vi.hoisted(() => vi.fn(async () => ({ ok: true, screenId: "profile", screenName: "Profile" })));

vi.mock("../panels/import/importDesign.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../panels/import/importDesign.ts")>()), importDesign }));

let session: EditorSession | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
  importDesign.mockClear();
});

describe("installTestHook", () => {
  it("reads the document and runtime values and applies ops", () => {
    session = createEditorSession({ host: null, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
    const target = {} as Window & { __sonobe?: SonobeTestHook };
    const remove = installTestHook(session, target);
    const sonobe = target.__sonobe!;

    expect(sonobe.doc().project.name).toBe("Photo Zoom");
    session.runtime.stepFrame();
    expect(sonobe.frame()).toBeGreaterThanOrEqual(0);
    expect(sonobe.getValue("@photo.scale")).toBe(1);
    expect(sonobe.playing()).toBe(false);

    const revision = sonobe.revision();
    const result = sonobe.apply([{ op: "setProject", changes: { name: "Hooked" } }]);
    expect(result.ok).toBe(true);
    expect(sonobe.revision()).toBe(revision + 1);
    expect(session.document.getState().undoLabel).toContain("Test change");

    remove();
    expect(target.__sonobe).toBeUndefined();
  });

  it("imports HTML through the browser editor's iframe capture, never the desktop app's", async () => {
    session = createEditorSession({ host: null, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
    const target = {} as Window & { __sonobe?: SonobeTestHook };
    installTestHook(session, target);
    const html = '<body data-name="Profile"><p>Hi</p></body>';

    expect(await target.__sonobe!.importHtml(html, { name: "Profile", replace: "card" })).toEqual({ ok: true, screenId: "profile", screenName: "Profile" });
    expect(importDesign).toHaveBeenCalledWith(session, { html, name: "Profile", replace: "card" }, { desktop: null });

    await target.__sonobe!.importHtml("<p>Plain</p>");
    expect(importDesign).toHaveBeenLastCalledWith(session, { html: "<p>Plain</p>" }, { desktop: null });
  });
});
