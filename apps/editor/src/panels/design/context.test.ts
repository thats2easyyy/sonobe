import { fileURLToPath } from "node:url";
import { applyOps, createEmptyDocument, formatStyleDigest, styleDigest, type SonobeDocument, type StyleDigest } from "@sonobe/core";
import { loadProjectFromDisk } from "@sonobe/core/node";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { getRegistry } from "../../state/registry.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { canvasContext, designTarget } from "./context.ts";
import type { DesignResult } from "./designStore.ts";

// The digest itself is tested in packages/core (styles.test.ts). A longer stand-in exercises the cap.
const digest = vi.hoisted(() => ({ text: null as string | null }));
vi.mock("@sonobe/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sonobe/core")>();
  return { ...actual, formatStyleDigest: (d: StyleDigest) => digest.text ?? actual.formatStyleDigest(d) };
});

let tabBar: SonobeDocument;
let session: EditorSession;

beforeAll(async () => {
  tabBar = await loadProjectFromDisk(fileURLToPath(new URL("../../../../../examples/05-tab-bar", import.meta.url)));
});

afterEach(() => {
  session?.dispose();
  digest.text = null;
});

const open = (doc: SonobeDocument) => (session = createEditorSession({ host: null, document: doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" }));
const noBounds = () => null;
const result = (layerId: string, component = "main"): DesignResult => ({ kind: "added", layerId, component, name: "Checkout", txnId: "t1", dropped: [], droppedCount: 0, coveredScreen: null, reply: "" });

describe("designTarget", () => {
  it("is the one selected layer, unless the box pinned a new screen", () => {
    open(tabBar);
    const design = { newScreen: false, result: null };
    expect(designTarget(session, design)).toBeNull();

    session.selection.getState().select({ layers: ["focus_card"] });
    expect(designTarget(session, design)).toEqual({ id: "focus_card", name: "Focus Card", type: "group", isResult: false });
    expect(designTarget(session, { ...design, newScreen: true })).toBeNull();

    session.selection.getState().select({ layers: ["focus_card", "walk_card"] });
    expect(designTarget(session, design)).toBeNull();
  });

  it("knows the screen Claude just made", () => {
    open(tabBar);
    session.selection.getState().select({ layers: ["screen_home"] });
    expect(designTarget(session, { newScreen: false, result: result("screen_home") })?.isResult).toBe(true);
    expect(designTarget(session, { newScreen: false, result: result("screen_home", "card") })?.isResult).toBe(false);
    expect(designTarget(session, { newScreen: false, result: result("walk_card") })?.isResult).toBe(false);
  });
});

describe("canvasContext", () => {
  it("names the component, its screens front first, and no target for a new screen", () => {
    open(tabBar);
    expect(canvasContext(session, null, noBounds)).toEqual({
      component: { id: "main", name: "Main", size: [402, 874] },
      screens: [
        { id: "app_home_indicator", name: "Home Indicator" },
        { id: "tab_bar", name: "Tab Bar" },
        { id: "app_status_bar", name: "Status Bar" },
        { id: "screens", name: "Screens" },
      ],
      styles: formatStyleDigest(styleDigest(tabBar, "main")),
    });
    expect(canvasContext(session, null, noBounds).styles).toMatch(/^styles main \(\d+ layers\)\ncolors /);
  });

  it("gives the picked layer's frame from the canvas and the screen holding it", () => {
    open(tabBar);
    session.selection.getState().select({ layers: ["focus_card"] });
    const target = designTarget(session, { newScreen: false, result: null });
    const bounds = (id: string) => (id === "focus_card" ? { x: 24.004, y: 164, width: 354, height: 200 } : null);
    expect(canvasContext(session, target, bounds).target).toEqual({ id: "focus_card", name: "Focus Card", type: "group", frame: [24, 164, 354, 200], screen: { id: "screens", name: "Screens" } });

    // Without the canvas, the layer's own props; a top-level layer is a screen itself.
    session.selection.getState().select({ layers: ["tab_bar"] });
    expect(canvasContext(session, designTarget(session, { newScreen: false, result: null }), noBounds).target).toEqual({ id: "tab_bar", name: "Tab Bar", type: "group", frame: [0, 784, 402, 90] });
  });

  it("keeps the first 30 screens and the first 1,500 characters of styles", () => {
    const layers = Array.from({ length: 35 }, (_, i) => ({ op: "addLayer" as const, layer: { id: `screen_${i}`, type: "group", name: `Screen ${i}` } }));
    const built = applyOps(createEmptyDocument({ name: "Many" }), layers, { registry: getRegistry() });
    expect(built.ok).toBe(true);
    open(built.doc);
    digest.text = `styles main (35 layers)\n${"colors #111118FF text×12 · ".repeat(100)}`;
    const context = canvasContext(session, null, noBounds);
    expect(context.screens).toHaveLength(30);
    expect(context.screens[0]).toEqual({ id: "screen_34", name: "Screen 34" });
    expect(context.screens.at(-1)).toEqual({ id: "screen_5", name: "Screen 5" });
    expect(context.styles).toHaveLength(1500);
    expect(context.styles).toBe(digest.text.slice(0, 1500));
  });
});
