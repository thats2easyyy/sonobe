import type { Op } from "@sonobe/core";
import { buildDoc, MOCK_DEFINITIONS } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserHost, createMemoryProjectStorage } from "../../host/browserHost.ts";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { duplicateSelection } from "../../state/editActions.ts";
import { designStore, initialDesignData, type DesignDraft } from "../design/designStore.ts";
import { agentImportTarget, createHologramStore, hideCoveredChrome, HOLOGRAM_STALE_MS, hologramStore, importedScreen, IMPORT_LABEL, pointerEndsHologram, viewerHoloMode, watchHolograms, type HologramState } from "./hologram.ts";
import { prefersReducedMotion } from "./hologramDraw.ts";
import type { HoloPlan } from "./hologramPlan.ts";
import { pasteDesignCapture } from "./importDesign.ts";

const registry = createPatchRegistry({ definitions: MOCK_DEFINITIONS });
let session: EditorSession | null = null;
afterEach(() => {
  session?.dispose();
  session = null;
  designStore.setState(initialDesignData());
  vi.useRealTimers();
});

function setup() {
  const doc = buildDoc({ layers: [{ id: "card", type: "rectangle", props: { size: [100, 100] } }], patches: {} }, registry);
  const host = createBrowserHost({ storage: createMemoryProjectStorage(), channelName: null, recentKey: null, fileSystemAccess: false });
  session = createEditorSession({ host, registry, document: doc, autoplay: false, scheduler: createManualScheduler(), textMeasurer: "approximate" });
  return session;
}

const CLAUDE = { kind: "agent" as const, name: "Claude" };
const ASSISTANT = { kind: "agent" as const, name: "Assistant" };

/** A Design with Claude draft on the canvas: the in-app Assistant's import_design html by default. */
const designDraft = (over: Partial<DesignDraft> = {}): DesignDraft => ({ source: "assistant", key: "t1", runId: "r1", turn: 1, toolUseId: "t1", html: "<p>Receipt</p>", fields: { name: "Receipt" }, status: "adding", since: Date.now(), progress: null, error: null, resync: false, ...over });
/** Claude Code's preview_design draft. */
const mcpDraft = (over: Partial<DesignDraft> = {}): DesignDraft => designDraft({ source: "mcp", key: "mcp:cc-1", runId: "", turn: 0, toolUseId: "", mcp: { author: CLAUDE, client: null, draftRevision: 2, touchedAt: Date.now(), addingFrom: 0 }, ...over });

/** A design capture as a browser extension copies it. */
const receiptCapture = {
  format: "sonobe.design-capture",
  version: 1,
  source: { kind: "chrome", title: "Receipt" },
  viewport: { width: 402, height: 874 },
  root: { kind: "frame", name: "Receipt", box: [0, 0, 402, 300], fill: "#FFFFFFFF", children: [] },
  images: {},
};

/** A show's plan: a phone screen's timeline, no wireframe. */
const PLAN: HoloPlan = { screen: { x: 0, y: 0, width: 402, height: 874 }, radii: [0, 0, 0, 0], pieces: [], reduced: false, timeline: { downStart: 200, downEnd: 1800, upStart: 2100, upEnd: 3400, end: 3800 } };

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

  it("don't count an unmarked change that adds a layer inside an existing screen, whatever its label", () => {
    const s = setup();
    const screenId = s.document.getState().apply(screenOps("screen"), { label: "set up the receipt", author: CLAUDE, source: "import" }).idMap.screen!;
    const before = s.document.getState().doc;
    s.document.getState().apply([{ op: "addLayer", parent: screenId, layer: { ref: "badge", type: "rectangle", name: "Badge", props: { position: [300, 20], size: [60, 24] } } }], { label: "imported a badge", author: CLAUDE });
    const { doc, lastChange } = s.document.getState();
    expect(importedScreen(doc, lastChange!)?.screenId).not.toBe(screenId);
    expect(agentImportTarget(lastChange, doc, before)).toBeNull();
    // Marked by import_design (a screen placed inside a container, say), it counts wherever it lands.
    expect(agentImportTarget({ ...lastChange!, source: "import" }, doc, before)).toEqual({ componentId: doc.project.root, screenId: importedScreen(doc, lastChange!)!.screenId });
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

  it("skips the hologram for an import Design with Claude's live preview drew, and asks for it for every other import", async () => {
    const s = setup();
    const store = hologramStore(s);
    const stop = watchHolograms(s);
    // The canvas that previews the draft (its component, the root).
    const offCanvas = store.getState().addCanvas(s.document.getState().doc.project.root);
    const doc = () => s.document.getState();
    const importAs = (author: typeof CLAUDE, ref: string) => expect(doc().apply(screenOps(ref), { label: "set up the receipt screen", author, source: "import" }).ok, ref).toBe(true);
    const requested = () => {
      const request = store.getState().request;
      if (request) store.getState().take(request.nonce);
      return request !== null;
    };

    // The Assistant's import_design html, being added: the preview over the artboard is its reveal.
    designStore.setState({ drafts: [designDraft()] });
    importAs(ASSISTANT, "assistant");
    expect(store.getState()).toMatchObject({ request: null, show: null });
    // So Claude's screenshot right after it has nothing to wait for.
    const settled = s.bounds.settle("canvas.bounds").then(() => "settled");
    expect(await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, 200, "waiting"))])).toBe("settled");
    // On the Claude subscription, its own preview_design draft, being added by import_design { preview: true }.
    designStore.setState({ drafts: [mcpDraft({ key: "mcp:Assistant", runId: "r1", mcp: { author: ASSISTANT, client: null, draftRevision: 3, touchedAt: Date.now(), addingFrom: 0 } })] });
    importAs(ASSISTANT, "subscription");
    expect(requested()).toBe(false);
    // Claude Code's preview_design draft, the same way.
    designStore.setState({ drafts: [mcpDraft()] });
    importAs(CLAUDE, "claudeCode");
    expect(requested()).toBe(false);
    // The stand-in Assistant of the browser editor's tests imports through importCapture, which asks the same way.
    designStore.setState({ drafts: [designDraft()] });
    expect((await pasteDesignCapture(s, JSON.stringify(receiptCapture), () => undefined, { desktop: null }))?.ok).toBe(true);
    expect(requested()).toBe(false);

    // A draft still being written, or being added to another component, isn't this import's reveal.
    designStore.setState({ drafts: [designDraft({ status: "writing" })] });
    importAs(CLAUDE, "writing");
    expect(requested()).toBe(true);
    designStore.setState({ drafts: [mcpDraft({ fields: { name: "Sheet", component: "sheet" } })] });
    importAs(CLAUDE, "elsewhere");
    expect(requested()).toBe(true);
    // Added and faded: Claude's next plain import (html, a URL, a capture) builds as a hologram again.
    designStore.setState({ drafts: [designDraft({ status: "added", since: Date.now() - 1000 })] });
    importAs(CLAUDE, "plain");
    expect(requested()).toBe(true);
    // And so do the dialog's imports and pasted captures.
    expect((await pasteDesignCapture(s, JSON.stringify(receiptCapture), () => undefined, { desktop: null }))?.ok).toBe(true);
    expect(requested()).toBe(true);

    // Another author's import while a draft is being added isn't that draft's: Claude Code's import over the
    // Assistant's draft, the Assistant's over Claude Code's, and the person's own paste over Claude Code's.
    designStore.setState({ drafts: [designDraft()] });
    importAs(CLAUDE, "overAssistant");
    expect(requested()).toBe(true);
    designStore.setState({ drafts: [mcpDraft()] });
    importAs(ASSISTANT, "overClaudeCode");
    expect(requested()).toBe(true);
    expect((await pasteDesignCapture(s, JSON.stringify(receiptCapture), () => undefined, { desktop: null }))?.ok).toBe(true);
    expect(requested()).toBe(true);

    // With no canvas on the component nothing previewed the draft, so the hologram plays (in the Viewer).
    offCanvas();
    designStore.setState({ drafts: [designDraft()] });
    importAs(ASSISTANT, "noCanvas");
    expect(requested()).toBe(true);
    stop();
  });

  it("lets a request nobody takes go stale: it stops holding screenshots back, and the watcher drops it", async () => {
    vi.useFakeTimers();
    const s = setup();
    const store = hologramStore(s);
    const stop = watchHolograms(s);
    s.bounds.register("canvas.bounds", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    const off = store.getState().addCanvas(s.document.getState().doc.project.root);
    // An import into a component no canvas or Viewer draws: nobody takes its request.
    store.getState().build({ componentId: "settings", screenId: "a" });
    const settled: string[] = [];
    void s.bounds.settle("canvas.bounds").then(() => settled.push("canvas"));
    void s.bounds.settle("viewer.bounds").then(() => settled.push("viewer"));
    // While it's fresh, a canvas could still take it.
    await vi.advanceTimersByTimeAsync(HOLOGRAM_STALE_MS - 100);
    expect(settled).toEqual([]);
    expect(store.getState().request).not.toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(settled.sort()).toEqual(["canvas", "viewer"]);
    expect(store.getState().request).toBeNull();
    // A stale request holds no capture back, even before the watcher drops it.
    store.setState({ request: { componentId: "settings", screenId: "old", nonce: 99, at: performance.now() - HOLOGRAM_STALE_MS - 1 } });
    let later = false;
    void s.bounds.settle("canvas.bounds").then(() => (later = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(later).toBe(true);
    expect(store.getState().request).toBeNull();
    // A request that replaces a fresh one gets its own full second.
    store.getState().build({ componentId: "settings", screenId: "b" });
    await vi.advanceTimersByTimeAsync(HOLOGRAM_STALE_MS / 2);
    store.getState().build({ componentId: "settings", screenId: "c" });
    await vi.advanceTimersByTimeAsync(HOLOGRAM_STALE_MS / 2 + 10);
    expect(store.getState().request?.screenId).toBe("c");
    await vi.advanceTimersByTimeAsync(HOLOGRAM_STALE_MS / 2);
    expect(store.getState().request).toBeNull();
    off();
    stop();
  });

  it("ends a show early on an undo, and stops it when its screen goes away or another document opens", () => {
    const s = setup();
    const store = hologramStore(s);
    const stop = watchHolograms(s);
    const doc = () => s.document.getState();
    const result = doc().apply(screenOps("receipt"), { label: "Import “Receipt”", source: "import" });
    const target = { componentId: doc().doc.project.root, screenId: result.idMap.receipt! };
    store.getState().play({ ...target, nonce: 1, start: 0, plan: PLAN, lead: "canvas" });
    doc().apply([{ op: "updateLayer", id: "card", props: { position: [10, 10] } }], { label: "Move Card" });
    expect(store.getState().show?.endedAt).toBeNull();
    doc().undo();
    expect(store.getState().show?.endedAt).toEqual(expect.any(Number));
    // Undoing the import itself removes it.
    doc().undo();
    expect(store.getState().show).toBeNull();

    doc().redo();
    store.getState().play({ ...target, nonce: 2, start: 0, plan: PLAN, lead: "viewer" });
    doc().newDocument();
    expect(store.getState().show).toBeNull();
    stop();
  });

  it("plays a show on one timeline: playing takes its request, an early end fades it, and a stop is only for that show", () => {
    const store = createHologramStore();
    store.getState().build({ componentId: "main", screenId: "a" });
    const request = store.getState().request!;
    store.getState().play({ componentId: "main", screenId: "a", nonce: request.nonce, start: 5, plan: PLAN, lead: "canvas" });
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

  it("holds screenshots of the canvas and the Viewer until a show is over, and never the patch graph's", async () => {
    const s = setup();
    const store = hologramStore(s);
    const stop = watchHolograms(s);
    s.bounds.register("canvas.bounds", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    store.getState().build({ componentId: "main", screenId: "a" });
    const nonce = store.getState().request!.nonce;
    store.getState().play({ componentId: "main", screenId: "a", nonce, start: 0, plan: PLAN, lead: "canvas" });
    const settled: string[] = [];
    void s.bounds.settle("viewer.bounds").then(() => settled.push("viewer"));
    void s.bounds.measure("canvas.bounds").then(() => settled.push("canvas"));
    await s.bounds.settle("graph.bounds");
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(settled).toEqual([]);
    store.getState().stop(nonce);
    await vi.waitFor(() => expect(settled.sort()).toEqual(["canvas", "viewer"]));
    stop();
    // Without a watcher, nothing holds a capture back.
    store.getState().build({ componentId: "main", screenId: "b" });
    await s.bounds.settle("viewer.bounds");
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
  const request = { componentId: "main", screenId: "screen", nonce: 4, at: 1000 };
  const show = { ...request, start: 1003, plan: PLAN, lead: "canvas" as const, endedAt: null };
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
    const outcome = await pasteDesignCapture(s, JSON.stringify(receiptCapture), () => undefined, { desktop: null });
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
