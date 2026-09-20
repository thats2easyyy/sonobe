/**
 * When the import hologram plays, and on which surfaces. Imports through the dialog and pasted
 * captures ask for it from importCapture; Claude's import_design marks its apply with source "import",
 * which watchHolograms turns into the same request. An import that Design with Claude's live preview
 * drew asks for none: that preview fades onto the layers instead (requestHologram). The canvas that
 * draws the component takes the request, builds the screen and publishes the show: its plan and when
 * it started, so the Viewer's device screen traces the same wireframe in step. When no canvas draws
 * that component (patches-only view, another component), the Viewer takes the request and plays it
 * alone. A request nobody takes goes stale after HOLOGRAM_STALE_MS, and the watcher drops it.
 */

import { findLayer, type Author, type Id, type LayerNode, type SonobeDocument } from "@sonobe/core";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { CaptureTarget } from "../../state/bounds.ts";
import type { DocumentChange } from "../../state/document.ts";
import type { EditorSession } from "../../state/session.ts";
import { designStore, previewedImport } from "../design/designStore.ts";
import type { HoloPlan } from "./hologramPlan.ts";

export interface HologramTarget {
  componentId: Id;
  /** The imported screen: the layer whose bounds the hologram covers. */
  screenId: Id;
}

export interface HologramRequest extends HologramTarget {
  /** Tells requests apart. */
  nonce: number;
  /** performance.now() when it was asked for. */
  at: number;
}

/** A hologram playing: every surface that shows the screen draws it from this one timeline. */
export interface HologramShow extends HologramTarget {
  /** The request's nonce. */
  nonce: number;
  /** performance.now() at the timeline's zero. */
  start: number;
  /** The wireframe, in the points of the surface that planned it, and the timeline (reduced motion: a short crossfade). */
  plan: HoloPlan;
  /** The canvas builds it (the Viewer plays along), or the Viewer plays it alone. */
  lead: "canvas" | "viewer";
  /** performance.now() when a click, a key or an undo ended it early: everything fades out. */
  endedAt: number | null;
}

export interface HologramState {
  request: HologramRequest | null;
  show: HologramShow | null;
  /** The screen a playing hologram covers: the canvas hides its selection chrome meanwhile. */
  covering: HologramTarget | null;
  /** Components the mounted canvases draw: a request for one waits for that canvas to take it. */
  canvases: readonly Id[];
  /** Play the hologram over a screen that was just imported. */
  build(target: HologramTarget): void;
  /** Drop the request (it went stale). */
  take(nonce: number): void;
  /** Start the show for a request (taking it). */
  play(show: Omit<HologramShow, "endedAt">): void;
  /** End the show early: it fades out. */
  end(nonce: number): void;
  /** The show finished, or its screen went away. */
  stop(nonce: number): void;
  /** Start covering a screen, or stop (null). */
  cover(target: HologramTarget | null): void;
  /** A canvas draws this component now. Returns the unregister. */
  addCanvas(componentId: Id): () => void;
}

/** A request the canvas hasn't taken within this long is dropped: the screen wasn't on screen. */
export const HOLOGRAM_STALE_MS = 1000;

const now = () => (typeof performance !== "undefined" ? performance.now() : 0);

/** Whether a request can still be taken at `at`: it isn't stale yet. */
const freshRequest = (request: HologramRequest | null, at: number): boolean => request !== null && at - request.at <= HOLOGRAM_STALE_MS;

export function createHologramStore(): StoreApi<HologramState> {
  let nonce = 0;
  return createStore<HologramState>()((set, get) => ({
    request: null,
    show: null,
    covering: null,
    canvases: [],
    build: (target) => set({ request: { ...target, nonce: ++nonce, at: now() } }),
    take: (n) => {
      if (get().request?.nonce === n) set({ request: null });
    },
    play: (show) => set((s) => ({ show: { ...show, endedAt: null }, request: s.request?.nonce === show.nonce ? null : s.request })),
    end: (n) => {
      const show = get().show;
      if (show?.nonce === n && show.endedAt === null) set({ show: { ...show, endedAt: now() } });
    },
    stop: (n) => {
      if (get().show?.nonce === n) set({ show: null });
    },
    cover: (target) => {
      const current = get().covering;
      if (current?.componentId !== target?.componentId || current?.screenId !== target?.screenId) set({ covering: target });
    },
    addCanvas: (componentId) => {
      set((s) => ({ canvases: [...s.canvases, componentId] }));
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        set((s) => {
          const i = s.canvases.indexOf(componentId);
          return i < 0 ? {} : { canvases: [...s.canvases.slice(0, i), ...s.canvases.slice(i + 1)] };
        });
      };
    },
  }));
}

/** What the Viewer does about the hologram: nothing, draw a show, cover while a canvas takes the request, or play it alone. */
export type ViewerHoloMode = { kind: "idle" } | { kind: "follow"; show: HologramShow } | { kind: "wait"; request: HologramRequest } | { kind: "lead"; request: HologramRequest };

/**
 * The Viewer's part now. A show plays along wherever the prototype draws its component. A request
 * waits for a canvas that draws its component, and nobody else's: then the Viewer plays it alone. A
 * stale request is the Viewer's only if it was already covering for it (`waitingOn`, its nonce).
 */
export function viewerHoloMode(state: Pick<HologramState, "request" | "show" | "canvases">, shownHere: (componentId: Id) => boolean, now: number, waitingOn: number | null): ViewerHoloMode {
  if (state.show) return shownHere(state.show.componentId) ? { kind: "follow", show: state.show } : { kind: "idle" };
  const request = state.request;
  if (!request || !shownHere(request.componentId)) return { kind: "idle" };
  if (now - request.at > HOLOGRAM_STALE_MS) return waitingOn === request.nonce ? { kind: "lead", request } : { kind: "idle" };
  return state.canvases.includes(request.componentId) ? { kind: "wait", request } : { kind: "lead", request };
}

/**
 * The canvas overlay's selection and hover while a hologram covers `covered`: the screen's outline,
 * handles and size badge would sit on the hologram's frame, so they wait for it to finish.
 */
export function hideCoveredChrome<C>(covered: Id | null, overlay: { selected: readonly Id[]; hovered: Id | null; chrome: C | null }): { selected: readonly Id[]; hovered: Id | null; chrome: C | null } {
  if (covered === null) return overlay;
  const selected = overlay.selected.filter((id) => id !== covered);
  return { selected, hovered: null, chrome: selected.length === overlay.selected.length ? overlay.chrome : null };
}

const stores = new WeakMap<EditorSession, StoreApi<HologramState>>();

/** The session's hologram requests and show. */
export function hologramStore(session: EditorSession): StoreApi<HologramState> {
  let store = stores.get(session);
  if (!store) {
    store = createHologramStore();
    stores.set(session, store);
  }
  return store;
}

/**
 * Ask for the hologram over a screen that was just imported, unless Design with Claude drew it: while
 * the draft the canvas previews is being added to that component, the preview is the import's one
 * reveal, on the canvas and in the Viewer.
 */
export function requestHologram(session: EditorSession, target: HologramTarget, author: Author | null): void {
  const store = hologramStore(session);
  // Only a canvas draws the preview: with none on that component, the Viewer's hologram is the reveal.
  if (store.getState().canvases.includes(target.componentId) && previewedImport(designStore.getState(), Date.now(), target.componentId, session.document.getState().doc.project.root, author)) return;
  store.getState().build(target);
}

/** "imported Profile", "re-imported Profile", "Import “Profile”": but not "important" or "Paste". */
export const IMPORT_LABEL = /^(re-?)?import(s|ed|ing)?\b/i;

/**
 * The screen an agent's change imported, when it imported one. Claude's import_design marks its apply
 * with source "import". A change without the mark still counts when its label starts with "imported"
 * or "re-imported" and it added a new screen, a top-level layer of its component: an edit that only
 * says "imported", or adds a layer inside an existing screen, doesn't.
 */
export function agentImportTarget(change: DocumentChange | null | undefined, doc: SonobeDocument, before: SonobeDocument): HologramTarget | null {
  if (!change || change.kind !== "apply" || change.author.kind !== "agent") return null;
  const marked = change.source === "import";
  if (!marked && (change.source !== undefined || !IMPORT_LABEL.test(change.label.trim()))) return null;
  const target = importedScreen(doc, change);
  if (!target || marked) return target;
  const screen = doc.components[target.componentId]?.layers.some((layer) => layer.id === target.screenId);
  const existed = findLayer(before.components[target.componentId]?.layers ?? [], target.screenId);
  return screen && !existed ? target : null;
}

/**
 * The screen a change imported: of the layers it touched that still exist, the outermost one holding
 * the most of them (a screen and everything in it, not a layer elsewhere whose link it dropped).
 */
export function importedScreen(doc: SonobeDocument, change: Pick<DocumentChange, "affected">): HologramTarget | null {
  const affected = new Set(change.affected.layers);
  if (affected.size === 0) return null;
  let best: { componentId: Id; screenId: Id; count: number } | null = null;
  const count = (layer: LayerNode): number => (affected.has(layer.id) ? 1 : 0) + (layer.children ?? []).reduce((sum, child) => sum + count(child), 0);
  for (const componentId of change.affected.components) {
    const component = doc.components[componentId];
    if (!component || component.kind === "patchComponent") continue;
    const visit = (layers: readonly LayerNode[]) => {
      for (const layer of layers) {
        if (!affected.has(layer.id)) {
          if (layer.children?.length) visit(layer.children);
          continue;
        }
        const n = count(layer);
        if (!best || n > best.count) best = { componentId, screenId: layer.id, count: n };
      }
    };
    visit(component.layers);
  }
  const found = best as { componentId: Id; screenId: Id } | null;
  return found ? { componentId: found.componentId, screenId: found.screenId } : null;
}

/** Keys that don't end the hologram on their own (⌘-scroll zooms, space-drag pans). */
const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt", "CapsLock", "Fn", " "]);

/** Whether a pointerdown ends the hologram: not a pan (a middle-button drag, or a drag with Space held). */
export function pointerEndsHologram(event: Pick<PointerEvent, "button">, spaceHeld: boolean): boolean {
  return event.button !== 1 && !(event.button === 0 && spaceHeld);
}

/**
 * Ends a show early, wherever it plays: a click or a key (not a modifier or Space) fades it out,
 * while wheel, Space-drag and middle-button pans keep it playing. Returns the removal.
 */
function listenForEarlyEnd(end: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  let spaceHeld = false;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === " ") spaceHeld = true;
    if (!event.repeat && !MODIFIER_KEYS.has(event.key)) end();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === " ") spaceHeld = false;
  };
  const onBlur = () => (spaceHeld = false);
  const onPointerDown = (event: PointerEvent) => {
    if (pointerEndsHologram(event, spaceHeld)) end();
  };
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
  };
}

/** The longest a screenshot waits for a hologram to finish: a tall full-page build runs about 5 s. */
export const HOLOGRAM_CAPTURE_WAIT_MS = 6000;

/** The next frame, or a moment later in a window that doesn't paint (hidden windows may not run requestAnimationFrame). */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 50);
    if (typeof requestAnimationFrame !== "function") return;
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Holds a screenshot of the canvas or the Viewer back until no hologram covers them, so Claude's
 * get_screenshot right after import_design shows the design rather than the veil, and the person's
 * reveal plays out. The patch graph never waits.
 */
async function hologramSettled(store: StoreApi<HologramState>, target: CaptureTarget, doc: Document | undefined): Promise<void> {
  if (target === "graph.bounds") return;
  // A stale request plays nowhere unless the Viewer already covers for it, and then its veil is mounted.
  const busy = () => {
    const s = store.getState();
    return freshRequest(s.request, now()) || s.show !== null || !!doc?.querySelector(".sb-holo, .sb-vw-holo");
  };
  if (!busy()) return;
  const deadline = performance.now() + HOLOGRAM_CAPTURE_WAIT_MS;
  while (busy() && performance.now() < deadline) await nextFrame();
  // Let the design paint without the veil before the capture.
  await nextFrame();
}

function startWatching(session: EditorSession): () => void {
  const store = hologramStore(session);
  const removeSettler = session.bounds?.addSettler?.((target) => hologramSettled(store, target, globalThis.document));
  const unsubscribeDocument = session.document.getState().subscribeRevision((state, previous) => {
    const change = state.lastChange;
    if (!change || change === previous.lastChange) return;
    // This runs inside the change (Claude's import_design waits on it): a hologram that fails only
    // goes without its show.
    try {
      const show = store.getState().show;
      if (show) {
        // Another document, or the import undone: nothing left to build. Any other undo ends it early.
        const gone = !findLayer(state.doc.components[show.componentId]?.layers ?? [], show.screenId);
        if (change.kind === "replace" || change.kind === "reload" || gone) store.getState().stop(show.nonce);
        else if (change.kind === "undo") store.getState().end(show.nonce);
      }
      const target = agentImportTarget(change, state.doc, previous.doc);
      if (target) requestHologram(session, target, change.author);
    } catch {
      // The design landed; only its build animation is lost.
    }
  });
  let removeListeners: (() => void) | null = null;
  let listeningTo: number | null = null;
  const sync = (s: HologramState) => {
    const playing = s.show && s.show.endedAt === null ? s.show.nonce : null;
    if (playing === listeningTo) return;
    removeListeners?.();
    removeListeners = playing === null ? null : listenForEarlyEnd(() => store.getState().end(playing));
    listeningTo = playing;
  };
  // Drop a request nobody took once it's stale (its screen isn't drawn anywhere), so it can't hold
  // captures back or play late. A Viewer covering for it plays it alone either way.
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let expiring: HologramRequest | null = null;
  const expire = ({ request }: HologramState) => {
    if (request === expiring) return;
    clearTimeout(expiry);
    expiring = request;
    if (!request) return;
    const later = () => (expiry = setTimeout(check, request.at + HOLOGRAM_STALE_MS - now() + 1));
    const check = () => {
      if (store.getState().request !== request) return;
      if (freshRequest(request, now())) later();
      else store.getState().take(request.nonce);
    };
    later();
  };
  const unsubscribeStore = store.subscribe((s) => {
    sync(s);
    expire(s);
  });
  sync(store.getState());
  expire(store.getState());
  return () => {
    unsubscribeDocument();
    unsubscribeStore();
    clearTimeout(expiry);
    removeListeners?.();
    removeSettler?.();
  };
}

const watchers = new WeakMap<EditorSession, { users: number; stop: () => void }>();

/**
 * Plays the hologram for Claude's imports, drops requests nobody takes, and ends shows early on a
 * click, a key or an undo. The surfaces that draw it (the canvas, the Viewer) each call it; they
 * share one watcher per session. Returns the release.
 */
export function watchHolograms(session: EditorSession): () => void {
  let watcher = watchers.get(session);
  if (!watcher) {
    watcher = { users: 0, stop: startWatching(session) };
    watchers.set(session, watcher);
  }
  const current = watcher;
  current.users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--current.users > 0) return;
    current.stop();
    if (watchers.get(session) === current) watchers.delete(session);
  };
}
