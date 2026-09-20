// @vitest-environment happy-dom
import type { Op } from "@sonobe/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler, type ManualScheduler } from "../../runtime/scheduler.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { hologramStore } from "./hologram.ts";
import { HOLO } from "./hologramPlan.ts";
import { attachViewerHologram } from "./HologramViewer.ts";

let session: EditorSession;
let scheduler: ManualScheduler;
let content: HTMLDivElement;
let now = 10_000;
const covers: (string | null)[] = [];
let detach: (() => void) | null = null;
let frames = new Map<number, FrameRequestCallback>();
let frameId = 0;

/** A 2D context that takes every call: happy-dom has no canvas. */
const fakeContext = () => {
  const gradient = { addColorStop: () => undefined };
  return new Proxy({} as Record<string | symbol, unknown>, { get: (target, key) => (key in target ? target[key] : () => gradient), set: (target, key, value) => ((target[key] = value), true) });
};

beforeEach(() => {
  now = 10_000;
  covers.length = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(fakeContext as never);
  vi.stubGlobal(
    "Path2D",
    class {
      rect() {}
    },
  );
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => (frames.set(++frameId, callback), frameId));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  scheduler = createManualScheduler();
  session = createEditorSession({ host: null, scheduler, textMeasurer: "approximate", autoplay: false });
  const screen = document.createElement("div");
  content = document.createElement("div");
  screen.append(content, document.createElement("div"));
  document.body.append(screen);
});

afterEach(() => {
  detach?.();
  detach = null;
  session.dispose();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const root = () => session.document.getState().doc.project.root;

/** Add a screen to the prototype, and let the runtime draw it. */
function addScreen(id = "imported"): string {
  const ops: Op[] = [{ op: "addLayer", component: root(), layer: { id, type: "group", name: "Receipt", props: { position: [0, 0], size: [402, 874] }, children: [{ type: "rectangle", name: "Header", props: { position: [0, 0], size: [402, 120] } }] } }];
  expect(session.document.getState().apply(ops, { label: "Import “Receipt”", source: "import" }).ok).toBe(true);
  scheduler.frames(2);
  return id;
}

const attach = () => (detach = attachViewerHologram(session, content, { onCover: (id) => covers.push(id) }));
const veil = () => content.parentElement!.querySelector<HTMLCanvasElement>(".sb-vw-holo");
/** Let the veil draw an animation frame `ms` into the show. */
const drawAt = (ms: number, start: number) => {
  now = start + ms;
  const due = [...frames.values()];
  frames.clear();
  for (const callback of due) callback(now);
};

describe("the Viewer's hologram", () => {
  it("plays an import alone when no canvas draws its component, over the screen, under its cutout", () => {
    const screenId = addScreen();
    attach();
    const store = hologramStore(session);
    store.getState().build({ componentId: root(), screenId });
    const show = store.getState().show!;
    expect(show).toMatchObject({ lead: "viewer", screenId, start: 10_000, endedAt: null });
    expect(store.getState().request).toBeNull();
    // Right after the prototype, before the screen's cutout overlay; it never takes a pointer.
    expect(content.nextElementSibling).toBe(veil());
    expect(veil()!.dataset.phase).toBe("power");
    // The screen's selection outline waits under the veil.
    expect(covers).toEqual([screenId]);

    drawAt(show.timeline.downStart + 100, show.start);
    expect(veil()!.dataset.phase).toBe("down");
    drawAt(show.timeline.upEnd + 10, show.start);
    expect(veil()!.dataset.phase).toBe("glow");
    expect(covers).toEqual([screenId, null]);
    // Done: it stops the show it played.
    drawAt(show.timeline.end + 1, show.start);
    expect(veil()).toBeNull();
    expect(store.getState().show).toBeNull();
  });

  it("covers while a canvas takes the request, then plays along on the canvas's timeline", () => {
    const screenId = addScreen();
    attach();
    const store = hologramStore(session);
    const off = store.getState().addCanvas(root());
    store.getState().build({ componentId: root(), screenId });
    // Waiting for the canvas: covered already, and the request is left for it.
    expect(veil()).not.toBeNull();
    const request = store.getState().request!;
    expect(store.getState().show).toBeNull();

    now += 5;
    const timeline = { downStart: 200, downEnd: 1800, upStart: 2100, upEnd: 3400, end: 3800 };
    store.getState().play({ componentId: root(), screenId, nonce: request.nonce, start: now, timeline, reduced: false, lead: "canvas" });
    drawAt(2500, now);
    expect(veil()!.dataset.phase).toBe("up");
    // The canvas's early end fades it out here too, and brings the outline back at once.
    store.getState().end(request.nonce);
    expect(covers.at(-1)).toBeNull();
    const ended = now;
    drawAt(HOLO.endFadeMs + 1, ended);
    expect(veil()).toBeNull();
    // The canvas owns the show: the Viewer doesn't stop it.
    expect(store.getState().show?.nonce).toBe(request.nonce);
    off();
  });

  it("fades out when the canvas stops the show before its end", () => {
    const screenId = addScreen();
    attach();
    const store = hologramStore(session);
    const off = store.getState().addCanvas(root());
    store.getState().build({ componentId: root(), screenId });
    const nonce = store.getState().request!.nonce;
    const timeline = { downStart: 200, downEnd: 1800, upStart: 2100, upEnd: 3400, end: 3800 };
    store.getState().play({ componentId: root(), screenId, nonce, start: now, timeline, reduced: false, lead: "canvas" });
    store.getState().stop(nonce);
    expect(veil()).not.toBeNull();
    drawAt(HOLO.endFadeMs + 1, now);
    expect(veil()).toBeNull();
    off();
  });

  it("carries on alone when the canvas lets a request go stale", () => {
    const screenId = addScreen();
    attach();
    const store = hologramStore(session);
    const off = store.getState().addCanvas(root());
    store.getState().build({ componentId: root(), screenId });
    const request = store.getState().request!;
    store.getState().take(request.nonce);
    // Same nonce and timeline start: no jump.
    expect(store.getState().show).toMatchObject({ nonce: request.nonce, start: request.at, lead: "viewer" });
    off();
  });

  it("plays nothing for a component the prototype doesn't draw", () => {
    attach();
    const store = hologramStore(session);
    const ops: Op[] = [{ op: "addComponent", component: { id: "sheet", name: "Sheet", kind: "layerComponent", size: [402, 400] } }];
    expect(session.document.getState().apply(ops, { label: "New component" }).ok).toBe(true);
    store.getState().build({ componentId: "sheet", screenId: "anything" });
    expect(veil()).toBeNull();
    expect(store.getState().request).not.toBeNull();
    expect(store.getState().show).toBeNull();
  });

  it("gives up on a screen the prototype never draws, and removes itself when detached", () => {
    attach();
    const store = hologramStore(session);
    store.getState().build({ componentId: root(), screenId: "missing" });
    expect(veil()).not.toBeNull();
    drawAt(700, 10_000);
    expect(veil()).toBeNull();
    expect(store.getState().show).toBeNull();

    const screenId = addScreen();
    store.getState().build({ componentId: root(), screenId });
    expect(veil()).not.toBeNull();
    detach!();
    detach = null;
    expect(veil()).toBeNull();
    expect(store.getState().show).toBeNull();
  });
});
