// @vitest-environment happy-dom
import type { Op } from "@sonobe/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler, type ManualScheduler } from "../../runtime/scheduler.ts";
import { createEditorSession, type EditorSession } from "../../state/session.ts";
import { designStore, initialDesignData } from "../design/designStore.ts";
import { HOLOGRAM_STALE_MS, hologramStore } from "./hologram.ts";
import { HOLO, type HoloPlan } from "./hologramPlan.ts";
import { attachViewerHologram, followScreen, prototypePlan } from "./HologramViewer.ts";

let session: EditorSession;
let scheduler: ManualScheduler;
let content: HTMLDivElement;
let now = 10_000;
const covers: (string | null)[] = [];
let detach: (() => void) | null = null;
let frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
/** Every call the veil's 2D context took, by name. */
let calls: string[] = [];

/** A 2D context that takes every call: happy-dom has no canvas. Its gradients refuse stops outside 0–1, as a real canvas does. */
const fakeContext = () => {
  const gradient = {
    addColorStop: (offset: number) => {
      if (!(offset >= 0 && offset <= 1)) throw new RangeError(`The provided value (${offset}) is outside the range (0.0, 1.0).`);
    },
  };
  return new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => (calls.push(String(key)), gradient)),
    set: (target, key, value) => ((target[key] = value), true),
  });
};

/** A show's plan: a phone screen's timeline, no wireframe. */
const PLAN: HoloPlan = { screen: { x: 0, y: 0, width: 402, height: 874 }, radii: [0, 0, 0, 0], pieces: [], reduced: false, timeline: { downStart: 200, downEnd: 1800, upStart: 2100, upEnd: 3400, end: 3800 } };

beforeEach(() => {
  now = 10_000;
  covers.length = 0;
  calls = [];
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
  designStore.setState(initialDesignData());
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

    // Planned from the running prototype: the screen and its header's wireframe.
    expect(show.plan.screen).toMatchObject({ width: 402, height: 874 });
    expect(show.plan.pieces.map((p) => p.shape)).toEqual(["box"]);

    const { timeline } = show.plan;
    drawAt(timeline.downStart + 100, show.start);
    expect(veil()!.dataset.phase).toBe("down");
    drawAt(timeline.upEnd + 10, show.start);
    expect(veil()!.dataset.phase).toBe("glow");
    // The outline comes back once the closing bloom has peaked, as on the canvas.
    expect(covers).toEqual([screenId]);
    drawAt(timeline.upEnd + (timeline.end - timeline.upEnd) * 0.35, show.start);
    expect(covers).toEqual([screenId, null]);
    // Done: it stops the show it played.
    drawAt(timeline.end + 1, show.start);
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
    store.getState().play({ componentId: root(), screenId, nonce: request.nonce, start: now, plan: PLAN, lead: "canvas" });
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
    store.getState().play({ componentId: root(), screenId, nonce, start: now, plan: PLAN, lead: "canvas" });
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

  it("draws once an animation frame, not again for each of the prototype's frames", () => {
    const screenId = addScreen();
    attach();
    hologramStore(session).getState().build({ componentId: root(), screenId });
    const draws = () => calls.filter((c) => c === "clearRect").length;
    const before = draws();
    drawAt(500, 10_000);
    scheduler.frames(1);
    drawAt(516, 10_000);
    scheduler.frames(1);
    expect(draws() - before).toBe(2);
  });

  it("covers a screen it plays alone until the prototype draws it, then plans the wireframe from it", () => {
    attach();
    const store = hologramStore(session);
    // Asked for before the runtime has drawn the new screen.
    const ops: Op[] = [{ op: "addLayer", component: root(), layer: { id: "late", type: "group", name: "Receipt", props: { position: [0, 0], size: [402, 874] }, children: [{ type: "text", name: "Total", props: { position: [20, 20], size: [200, 24], text: "Total" } }] } }];
    expect(session.document.getState().apply(ops, { label: "Import “Receipt”", source: "import" }).ok).toBe(true);
    store.getState().build({ componentId: root(), screenId: "late" });
    expect(store.getState().show).toBeNull();
    expect(veil()).not.toBeNull();
    expect(store.getState().request).not.toBeNull();
    scheduler.frames(2);
    expect(store.getState().show).toMatchObject({ lead: "viewer", start: 10_000 });
    expect(store.getState().show!.plan.pieces.map((p) => p.shape)).toEqual(["text"]);
  });

  it("plays nothing for an import Design with Claude's live preview drew on a canvas, and plays one no canvas previewed", () => {
    attach();
    const store = hologramStore(session);
    const importScreen = (id: string) => {
      const ops: Op[] = [{ op: "addLayer", component: root(), layer: { id, type: "group", name: "Checkout", props: { position: [0, 0], size: [402, 874] }, children: [{ type: "rectangle", name: "Header", props: { position: [0, 0], size: [402, 120] } }] } }];
      expect(session.document.getState().apply(ops, { label: "imported Checkout", author: { kind: "agent", name: "Assistant" }, source: "import" }).ok).toBe(true);
      scheduler.frames(2);
    };
    const adding = () => designStore.setState({ drafts: [{ source: "assistant", key: "t1", runId: "r1", turn: 1, toolUseId: "t1", html: "<p>Checkout</p>", fields: { name: "Checkout" }, status: "adding", since: Date.now(), progress: null, error: null, resync: false }] });
    // The canvas draws the component and previews the draft being added: its preview fades onto the layers, and the Viewer shows them as they land.
    const offCanvas = store.getState().addCanvas(root());
    adding();
    importScreen("previewed");
    expect(store.getState()).toMatchObject({ request: null, show: null });
    expect(veil()).toBeNull();
    expect(covers).toEqual([]);

    // With no canvas on the component nothing previewed the draft: the Viewer's hologram is the reveal.
    offCanvas();
    importScreen("unpreviewed");
    expect(store.getState().show).toMatchObject({ lead: "viewer", screenId: "unpreviewed" });
    expect(veil()).not.toBeNull();
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

    // Its first frame long after it went stale (a hidden tab), with a canvas that never took it.
    const off = store.getState().addCanvas(root());
    now = 20_000;
    store.getState().build({ componentId: root(), screenId: "missing" });
    expect(veil()).not.toBeNull();
    drawAt(HOLOGRAM_STALE_MS + 500, 20_000);
    expect(veil()).toBeNull();
    off();

    const screenId = addScreen();
    store.getState().build({ componentId: root(), screenId });
    expect(veil()).not.toBeNull();
    detach!();
    detach = null;
    expect(veil()).toBeNull();
    expect(store.getState().show).toBeNull();
  });

  it("covers nothing, and never throws, for a screen the prototype draws beside the device", () => {
    const device = content.parentElement!;
    Object.defineProperty(device, "clientWidth", { value: 402 });
    Object.defineProperty(device, "clientHeight", { value: 874 });
    device.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 402, bottom: 874, width: 402, height: 874, toJSON: () => ({}) }) as DOMRect;
    const ops: Op[] = [{ op: "addLayer", component: root(), layer: { id: "beside", type: "group", name: "Beside", props: { position: [640, 0], size: [402, 874] }, children: [{ type: "rectangle", name: "Header", props: { position: [0, 0], size: [402, 120] } }] } }];
    expect(session.document.getState().apply(ops, { label: "Import “Beside”", source: "import" }).ok).toBe(true);
    scheduler.frames(2);
    attach();
    const store = hologramStore(session);
    expect(() => store.getState().build({ componentId: root(), screenId: "beside" })).not.toThrow();
    const show = store.getState().show!;
    calls = [];
    for (const ms of [show.plan.timeline.downStart + 100, show.plan.timeline.upStart + 100, show.plan.timeline.upEnd + 10]) expect(() => drawAt(ms, show.start)).not.toThrow();
    // The device shows none of the screen: no veil, laser or bloom.
    expect(calls).not.toContain("fillRect");
  });
});

describe("the Viewer's plan", () => {
  it("maps the plan's points onto the screen where the prototype draws it", () => {
    const at = followScreen({ screen: { x: 100, y: 50, width: 402, height: 874 } }, { x: 10, y: 20, width: 201, height: 437 });
    expect(at({ x: 100, y: 50, width: 402, height: 874 })).toEqual({ x: 10, y: 20, width: 201, height: 437 });
    expect(at({ x: 120, y: 90, width: 40, height: 20 })).toEqual({ x: 20, y: 40, width: 20, height: 10 });
  });

  it("plans from the running prototype: the wireframe and the screen's corners, or the veil alone until it's drawn", () => {
    const ops: Op[] = [{ op: "addLayer", component: root(), layer: { id: "event", type: "group", name: "Card", props: { position: [40, 220], size: [322, 400], cornerRadius: 24, clip: true }, children: [{ type: "image", name: "Cover", props: { position: [0, 0], size: [322, 160] } }] } }];
    expect(session.document.getState().apply(ops, { label: "Import “Card”", source: "import" }).errors).toEqual([]);
    const target = { componentId: root(), screenId: "event" };
    const early = prototypePlan(session, target, false);
    expect(early).toMatchObject({ drawn: false, plan: { screen: { width: 322, height: 400 }, radii: [24, 24, 24, 24], pieces: [] } });
    scheduler.frames(2);
    const { plan, drawn } = prototypePlan(session, target, false);
    expect(drawn).toBe(true);
    expect(plan.screen).toEqual({ x: 40, y: 220, width: 322, height: 400 });
    expect(plan.radii).toEqual([24, 24, 24, 24]);
    // The cover image across the card's top takes its top corners.
    expect(plan.pieces).toMatchObject([{ shape: "image", radii: [24, 24, 0, 0] }]);
    // The same sweeps as the veil-only plan, so taking over from it doesn't jump.
    expect(plan.timeline.downEnd).toBe(early.plan.timeline.downEnd);
    expect(prototypePlan(session, target, true).plan.reduced).toBe(true);
  });
});
