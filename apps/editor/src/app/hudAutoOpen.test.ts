import { describe, expect, it } from "vitest";
import { createManualScheduler } from "../runtime/scheduler.ts";
import { createLayoutStore } from "../shell/layoutStore.ts";
import { createEditorSession } from "../state/session.ts";
import { createHudAutoOpener, hudTabForNewErrors } from "./hudAutoOpen.ts";

describe("HUD auto-open", () => {
  it("picks the tab for new errors", () => {
    expect(hudTabForNewErrors({ console: 0, runtime: 0 }, { console: 1, runtime: 0 })).toBe("console");
    expect(hudTabForNewErrors({ console: 1, runtime: 0 }, { console: 1, runtime: 2 })).toBe("diagnostics");
    expect(hudTabForNewErrors({ console: 2, runtime: 1 }, { console: 0, runtime: 0 })).toBeNull();
  });

  it("opens the collapsed HUD on the first error only", () => {
    const layout = createLayoutStore({ storageKey: null });
    expect(layout.getState().collapsed.hud).toBe(true);
    const opener = createHudAutoOpener(() => layout.getState());
    expect(opener.update({ console: 0, runtime: 0 })).toBeNull();
    expect(opener.update({ console: 1, runtime: 0 })).toBe("console");
    expect(layout.getState()).toMatchObject({ hudTab: "console", collapsed: { hud: false } });
    layout.getState().toggleCollapsed("hud", true);
    expect(opener.update({ console: 3, runtime: 1 })).toBeNull();
    expect(layout.getState().collapsed.hud).toBe(true);
    expect(opener.opened).toBe(true);
  });

  it("doesn't switch tabs when the HUD is already open", () => {
    const layout = createLayoutStore({ storageKey: null });
    layout.getState().setHudTab("performance");
    const opener = createHudAutoOpener(() => layout.getState(), { console: 0, runtime: 0 });
    expect(opener.update({ console: 0, runtime: 1 })).toBeNull();
    expect(layout.getState().hudTab).toBe("performance");
  });

  it("counts console errors from a real session", () => {
    const session = createEditorSession({ host: null, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
    const layout = createLayoutStore({ storageKey: null });
    const opener = createHudAutoOpener(() => layout.getState());
    const off = session.console.subscribe((s) => opener.update({ console: s.counts.error, runtime: 0 }));
    session.console.getState().push("warn", ["Just a warning"]);
    session.console.getState().flush();
    expect(layout.getState().collapsed.hud).toBe(true);
    session.console.getState().push("error", ["Something broke"]);
    session.console.getState().flush();
    off();
    session.dispose();
    expect(layout.getState()).toMatchObject({ hudTab: "console", collapsed: { hud: false } });
  });
});
