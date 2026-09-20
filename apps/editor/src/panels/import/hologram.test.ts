import type { Op } from "@sonobe/core";
import { buildDoc, MOCK_DEFINITIONS } from "@sonobe/engine/testing";
import { createPatchRegistry } from "@sonobe/patches";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserHost, createMemoryProjectStorage } from "../../host/browserHost.ts";
import { createManualScheduler } from "../../runtime/scheduler.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { duplicateSelection } from "../../state/editActions.ts";
import { createHologramStore, hideCoveredChrome, hologramStore, importedScreen, IMPORT_LABEL, isAgentImport, watchAgentImports } from "./hologram.ts";
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

  it("count only Claude's applies", () => {
    const change = { kind: "apply" as const, revision: 2, author: CLAUDE, label: "imported Receipt", affected: { components: [], layers: [], patches: [] }, opCount: 3, timestamp: 0 };
    expect(isAgentImport(change)).toBe(true);
    expect(isAgentImport({ ...change, author: { kind: "human", name: "You" } })).toBe(false);
    expect(isAgentImport({ ...change, kind: "undo" })).toBe(false);
    expect(isAgentImport({ ...change, label: "pasted 3 layers" })).toBe(false);
    expect(isAgentImport(null)).toBe(false);
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
    const stop = watchAgentImports(s);
    const doc = () => s.document.getState();

    doc().apply(screenOps("pasted"), { label: "pasted 3 layers", author: CLAUDE });
    expect(store.getState().request).toBeNull();
    doc().apply(screenOps("mine"), { label: "Paste" });
    expect(store.getState().request).toBeNull();
    s.selection.getState().select({ layers: ["card"] });
    expect(duplicateSelection(s).ok).toBe(true);
    expect(store.getState().request).toBeNull();

    const result = doc().apply(screenOps("receipt"), { label: "imported Receipt", author: CLAUDE });
    expect(store.getState().request).toMatchObject({ componentId: doc().doc.project.root, screenId: result.idMap.receipt });
    store.getState().take(store.getState().request!.nonce);

    // Undoing it doesn't play it again.
    doc().undo(CLAUDE);
    expect(store.getState().request).toBeNull();
    stop();
    doc().apply(screenOps("later"), { label: "re-imported Receipt", author: CLAUDE });
    expect(store.getState().request).toBeNull();
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
