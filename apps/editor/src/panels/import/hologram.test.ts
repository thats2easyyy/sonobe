import type { Op } from "@sonobe/core";
import { buildDoc, MOCK_DEFINITIONS } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserHost, createMemoryProjectStorage } from "../../host/browserHost.ts";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { duplicateSelection } from "../../state/editActions.ts";
import { agentImportTarget, createHologramStore, hideCoveredChrome, HOLOGRAM_STALE_MS, hologramStore, importedScreen, IMPORT_LABEL, pointerEndsHologram, viewerHoloMode, watchHolograms, type HologramState } from "./hologram.ts";
import { prefersReducedMotion } from "./hologramDraw.ts";
import { pasteDesignCapture } from "./importDesign.ts";

const registry = createPatchRegistry({ definitions: MOCK_DEFINITIONS });
let session: EditorSession | null = null;
afterEach(() => {
  session?.dispose();
  session = null;
});

function setup() {
  const doc = buildDoc({ layers: [{ id: "card", type: "rectangle", props: { size: [100, 100] } }], patches: {} }, registry);
  const host = createBrowserHost({ storage: createMemoryProjectStorage(), channelName: null, recentKey: null, fileSystemAccess: false });
  session = createEditorSession({ host, registry, document: doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  return session;
}

const CLAUDE = { kind: "agent" as const, name: "Claude" };

/** A screen with a header and a title, like import_design adds. */
const screenOps = (id: string): Op[] => [
  {
    op: "addLayer",
    layer: {
      ref: id,
      type: "group",
      name: "Receipt",
      props: { position: [0, 0], size: [402, 874] },
      children: [
        { type: "rectangle", name: "Header", props: { position: [0, 0], size: [402, 120] } },
        { type: "text", name: "Total", props: { position: [20, 140], size: [200, 24], text: "Total" } },
      ],
    },
  },
];

describe("import labels", () => {
  it("match imports and re-imports, and nothing else", () => {
    for (const label of ["imported Receipt", "re-imported Receipt", "Import “Receipt”", "Re-import “Receipt”", "reimported Receipt", "Importing the settings screen"]) expect(IMPORT_LABEL.test(label), label).toBe(true);
    for (const label of ["Paste", "pasted 3 layers", "Duplicate Card", "important tweak", "Importantly", "added press animation"]) expect(IMPORT_LABEL.test(label), label).toBe(false);
  });

  it("count Claude's applies marked as imports whatever their label, and unmarked ones only when they add a new screen", () => {
    const s = setup();
    const before = s.document.getState().doc;
    const result = s.document.getState().apply(screenOps("screen"), { label: "set up the receipt", author: CLAUDE, source: "import" });
    const { doc, lastChange } = s.document.getState();
    const marked = lastChange!;
    expect(marked.source).toBe("import");
    const target = { componentId: doc.project.root, screenId: result.idMap.screen };
    expect(agentImportTarget(marked, doc, before)).toEqual(target);
    // The label fallback: an unmarked change that says "imported" and adds a new screen.
    const { source: _source, ...unmarked } = marked;
    expect(agentImportTarget({ ...unmarked, label: "imported Receipt" }, doc, before)).toEqual(target);
    expect(agentImportTarget({ ...unmarked, label: "re-imported Receipt" }, doc, before)).toEqual(target);
    // Saying "imported" isn't enough when the screen was already there, and nothing else counts.
    expect(agentImportTarget({ ...unmarked, label: "imported the icons" }, doc, doc)).toBeNull();
    expect(agentImportTarget(unmarked, doc, before)).toBeNull();
    expect(agentImportTarget({ ...marked, author: { kind: "human", name: "You" } }, doc, before)).toBeNull();
    expect(agentImportTarget({ ...marked, kind: "undo" }, doc, before)).toBeNull();
    expect(agentImportTarget(null, doc, before)).toBeNull();
  });
});

describe("importedScreen", () => {
  it("picks the outermost changed layer that holds the most of the change", () => {
    const s = setup();
    const result = s.document.getState().apply(screenOps("screen"), { label: "imported Receipt", author: CLAUDE });
    const change = s.document.getState().lastChange!;
    const screenId = result.idMap.screen!;
    // A layer elsewhere whose link the import dropped is touched too, but it isn't the screen.
    const target = importedScreen(s.document.getState().doc, { affected: { ...change.affected, layers: [...change.affected.layers, "card"] } });
    expect(target).toEqual({ componentId: s.document.getState().doc.project.root, screenId });
  });

  it("finds nothing when no layer changed", () => {
    const s = setup();
    expect(importedScreen(s.document.getState().doc, { affected: { components: ["main"], layers: [], patches: [] } })).toBeNull();
    expect(importedScreen(s.document.getState().doc, { affected: { components: ["main"], layers: ["gone"], patches: [] } })).toBeNull();
  });
});

describe("hologram requests", () => {
  it("builds and takes one request at a time", () => {
    const store = createHologramStore();
    store.getState().build({ componentId: "main", screenId: "a" });
    const first = store.getState().request!;
    store.getState().build({ componentId: "main", screenId: "b" });
    const second = store.getState().request!;
    expect(second.nonce).toBeGreaterThan(first.nonce);
    store.getState().take(first.nonce);
    expect(store.getState().request?.screenId).toBe("b");
    store.getState().take(second.nonce);
    expect(store.getState().request).toBeNull();
  });

  it("says which screen a playing hologram covers, and stops only for that screen", () => {
    const store = createHologramStore();
    const a = { componentId: "main", screenId: "a" };
    store.getState().cover(a);
    expect(store.getState().covering).toEqual(a);
    const before = store.getState();
    store.getState().cover({ ...a });
    expect(store.getState()).toBe(before);
    store.getState().cover(null);
    expect(store.getState().covering).toBeNull();
  });

  it("hides the covered screen's selection chrome and all hover, and nothing else", () => {
    const chrome = { quad: "…" };
    const overlay = { selected: ["screen"], hovered: "title", chrome };
    expect(hideCoveredChrome(null, overlay)).toBe(overlay);
    expect(hideCoveredChrome("screen", overlay)).toEqual({ selected: [], hovered: null, chrome: null });
    // Something else selected keeps its chrome.
    expect(hideCoveredChrome("screen", { selected: ["other"], hovered: null, chrome })).toEqual({ selected: ["other"], hovered: null, chrome });
    expect(hideCoveredChrome("screen", { selected: ["screen", "other"], hovered: null, chrome })).toEqual({ selected: ["other"], hovered: null, chrome: null });
  });

  it("plays for Claude's import_design, not for its other changes, the person's pastes or duplicates", () => {
    const s = setup();
    const store = hologramStore(s);
    const stop = watchHolograms(s);
    const doc = () => s.document.getState();

    doc().apply(screenOps("pasted"), { label: "pasted 3 layers", author: CLAUDE });
    expect(store.getState().request).toBeNull();
    doc().apply(screenOps("mine"), { label: "Paste" });
    expect(store.getState().request).toBeNull();
    s.selection.getState().select({ layers: ["card"] });
    expect(duplicateSelection(s).ok).toBe(true);
    expect(store.getState().request).toBeNull();
    // An agent edit to an existing layer that happens to say "imported".
    doc().apply([{ op: "updateLayer", id: "card", props: { position: [10, 10] } }], { label: "imported the brand color", author: CLAUDE });
    expect(store.getState().request).toBeNull();

    // import_design with a label of Claude's own.
    const result = doc().apply(screenOps("receipt"), { label: "set up the receipt screen", author: CLAUDE, source: "import" });
    expect(store.getState().request).toMatchObject({ componentId: doc().doc.project.root, screenId: result.idMap.receipt });
    store.getState().take(store.getState().request!.nonce);

    // Undoing it doesn't play it again.
    doc().undo(CLAUDE);
    expect(store.getState().request).toBeNull();
    stop();
    doc().apply(screenOps("later"), { label: "re-imported Receipt", author: CLAUDE, source: "import" });
    expect(store.getState().request).toBeNull();
  });

  it("shares one watcher per session among the surfaces that draw it", () => {
    const s = setup();
    const store = hologramStore(s);
    const canvas = watchHolograms(s);
    const viewer = watchHolograms(s);
    const builds: number[] = [];
    store.subscribe((state, previous) => state.request !== previous.request && state.request && builds.push(state.request.nonce));
    s.document.getState().apply(screenOps("a"), { label: "imported A", author: CLAUDE, source: "import" });
    expect(builds).toHaveLength(1);
    canvas();
    canvas();
    s.document.getState().apply(screenOps("b"), { label: "imported B", author: CLAUDE, source: "import" });
    expect(builds).toHaveLength(2);
    viewer();
    s.document.getState().apply(screenOps("c"), { label: "imported C", author: CLAUDE, source: "import" });
    expect(builds).toHaveLength(2);
  });

  it("ends a show early on an undo, and stops it when its screen goes away or another document opens", () => {
    const s = setup();
    const store = hologramStore(s);
    const stop = watchHolograms(s);
    const doc = () => s.document.getState();
    const result = doc().apply(screenOps("receipt"), { label: "Import “Receipt”", source: "import" });
    const target = { componentId: doc().doc.project.root, screenId: result.idMap.receipt! };
    const timeline = { downStart: 200, downEnd: 1800, upStart: 2100, upEnd: 3400, end: 3800 };
    store.getState().play({ ...target, nonce: 1, start: 0, timeline, reduced: false, lead: "canvas" });
    doc().apply([{ op: "updateLayer", id: "card", props: { position: [10, 10] } }], { label: "Move Card" });
    expect(store.getState().show?.endedAt).toBeNull();
    doc().undo();
    expect(store.getState().show?.endedAt).toEqual(expect.any(Number));
    // Undoing the import itself removes it.
    doc().undo();
    expect(store.getState().show).toBeNull();

    doc().redo();
    store.getState().play({ ...target, nonce: 2, start: 0, timeline, reduced: false, lead: "viewer" });
    doc().newDocument();
    expect(store.getState().show).toBeNull();
    stop();
  });

  it("plays a show on one timeline: playing takes its request, an early end fades it, and a stop is only for that show", () => {
    const store = createHologramStore();
    store.getState().build({ componentId: "main", screenId: "a" });
    const request = store.getState().request!;
    const timeline = { downStart: 200, downEnd: 1800, upStart: 2100, upEnd: 3400, end: 3800 };
    store.getState().play({ componentId: "main", screenId: "a", nonce: request.nonce, start: 5, timeline, reduced: false, lead: "canvas" });
    expect(store.getState()).toMatchObject({ request: null, show: { nonce: request.nonce, start: 5, lead: "canvas", endedAt: null } });
    store.getState().end(request.nonce + 1);
    expect(store.getState().show?.endedAt).toBeNull();
    store.getState().end(request.nonce);
    const ended = store.getState().show!.endedAt;
    expect(ended).toEqual(expect.any(Number));
    store.getState().end(request.nonce);
    expect(store.getState().show!.endedAt).toBe(ended);
    store.getState().stop(request.nonce + 1);
    expect(store.getState().show).not.toBeNull();
    store.getState().stop(request.nonce);
    expect(store.getState().show).toBeNull();
  });

  it("knows which components the mounted canvases draw", () => {
    const store = createHologramStore();
    const one = store.getState().addCanvas("main");
    const two = store.getState().addCanvas("main");
    const other = store.getState().addCanvas("card");
    expect(store.getState().canvases).toEqual(["main", "main", "card"]);
    one();
    one();
    expect(store.getState().canvases).toEqual(["main", "card"]);
    two();
    other();
    expect(store.getState().canvases).toEqual([]);
  });

  it("keeps playing through a pan: a middle-button drag or a drag with Space held", () => {
    expect(pointerEndsHologram({ button: 0 }, false)).toBe(true);
    expect(pointerEndsHologram({ button: 2 }, false)).toBe(true);
    expect(pointerEndsHologram({ button: 1 }, false)).toBe(false);
    expect(pointerEndsHologram({ button: 0 }, true)).toBe(false);
  });
});

describe("the Viewer's part", () => {
  const timeline = { downStart: 200, downEnd: 1800, upStart: 2100, upEnd: 3400, end: 3800 };
  const request = { componentId: "main", screenId: "screen", nonce: 4, at: 1000 };
  const show = { ...request, start: 1003, timeline, reduced: false, lead: "canvas" as const, endedAt: null };
  const state = (s: Partial<Pick<HologramState, "request" | "show" | "canvases">>) => ({ request: null, show: null, canvases: [], ...s });
  const everywhere = () => true;

  it("plays along with a show wherever the prototype draws its component", () => {
    expect(viewerHoloMode(state({ show }), everywhere, 1500, null)).toEqual({ kind: "follow", show });
    expect(viewerHoloMode(state({ show }), () => false, 1500, null)).toEqual({ kind: "idle" });
  });

  it("covers while a canvas that draws the component takes the request, and plays it alone when none does", () => {
    expect(viewerHoloMode(state({ request, canvases: ["main"] }), everywhere, 1010, null)).toEqual({ kind: "wait", request });
    // The patches-only view (no canvas), or a canvas on another component.
    expect(viewerHoloMode(state({ request }), everywhere, 1010, null)).toEqual({ kind: "lead", request });
    expect(viewerHoloMode(state({ request, canvases: ["card"] }), everywhere, 1010, null)).toEqual({ kind: "lead", request });
    expect(viewerHoloMode(state({ request }), () => false, 1010, null)).toEqual({ kind: "idle" });
  });

  it("takes a stale request only when it was already covering for it", () => {
    const late = 1000 + HOLOGRAM_STALE_MS + 1;
    expect(viewerHoloMode(state({ request, canvases: ["main"] }), everywhere, late, request.nonce)).toEqual({ kind: "lead", request });
    expect(viewerHoloMode(state({ request, canvases: ["main"] }), everywhere, late, null)).toEqual({ kind: "idle" });
    expect(viewerHoloMode(state({ request }), everywhere, late, 3)).toEqual({ kind: "idle" });
  });

  it("plays for a pasted design capture (the dialog goes through the same importCapture)", async () => {
    const s = setup();
    const capture = {
      format: "sonobe.design-capture",
      version: 1,
      source: { kind: "chrome", title: "Receipt" },
      viewport: { width: 402, height: 874 },
      root: { kind: "frame", name: "Receipt", box: [0, 0, 402, 300], fill: "#FFFFFFFF", children: [] },
      images: {},
    };
    const outcome = await pasteDesignCapture(s, JSON.stringify(capture), () => undefined, { desktop: null });
    expect(outcome?.ok).toBe(true);
    expect(hologramStore(s).getState().request).toMatchObject({ componentId: s.document.getState().doc.project.root, screenId: outcome!.screenId });
    expect(s.document.getState().lastChange).toMatchObject({ kind: "apply", source: "import", label: "Import “Receipt”" });
  });
});

describe("reduced motion", () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = (attrs: Record<string, string>, osReduces: boolean) => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: osReduces }) });
    vi.stubGlobal("document", { documentElement: { getAttribute: (name: string) => attrs[name] ?? null } });
  };

  it("follows Settings → Motion over the OS setting, either way", () => {
    env({}, true);
    expect(prefersReducedMotion()).toBe(true);
    env({ "data-motion": "full" }, true);
    expect(prefersReducedMotion()).toBe(false);
    env({ "data-motion": "reduce" }, false);
    expect(prefersReducedMotion()).toBe(true);
    env({ "data-reduced-motion": "true", "data-motion": "full" }, false);
    expect(prefersReducedMotion()).toBe(true);
    env({}, false);
    expect(prefersReducedMotion()).toBe(false);
  });
});
