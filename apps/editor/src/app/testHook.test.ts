import { afterEach, describe, expect, it } from "vitest";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { createEditorSession, type EditorSession } from "../state/session.ts";
import { installTestHook, type SonobeTestHook } from "./testHook.ts";

let session: EditorSession | null = null;

afterEach(() => {
  session?.dispose();
  session = null;
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
});
