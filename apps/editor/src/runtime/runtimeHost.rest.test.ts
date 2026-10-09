// @vitest-environment happy-dom
/**
 * The frame loop at rest (ARCHITECTURE.md §5.2, §9): while playing, the host stops asking for frames
 * once nothing in the prototype moves, and everything that can change a frame starts it again. One
 * test per wake source in the list above `refresh` in runtimeHost.ts; a source without one is a
 * prototype that can freeze.
 */

import type { Op, SonobeDocument } from "@sonobe/core";
import type { SceneFrame } from "@sonobe/engine";
import { buildDoc, createMockRegistry, defineMock, port } from "@sonobe/engine/testing";
import { DomTextMeasurer } from "@sonobe/renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocumentStore } from "../state/document.ts";
import { createRuntimeHost, type RuntimeHost, type RuntimeHostOptions } from "./runtimeHost.ts";
import { createManualScheduler, type ManualScheduler } from "./scheduler.ts";
import { createMemoryTrustPersistence, createScriptTrustStore } from "./scriptTrust.ts";

const js = defineMock({ type: "javascript", name: "JavaScript", inputs: [], outputs: [port("output", "number")], evaluate: (ctx) => ctx.output("output", 42) });
/** Reads Dark Mode from the device. */
const dark = defineMock({ type: "dark", name: "Dark", inputs: [], outputs: [port("on", "boolean")], evaluate: (ctx) => ctx.output("on", ctx.services.device().darkMode) });
/** Reads a layer output the renderer reports. */
const natural = defineMock({
  type: "natural",
  name: "Natural",
  inputs: [port("layer", "layer", { default: null })],
  outputs: [port("size", "size")],
  evaluate: (ctx) => ctx.output("size", (ctx.services.layerOutput!(ctx.input("layer"), "naturalSize") as number[] | undefined) ?? [0, 0]),
});
/** Counts its evaluations, to show a frame ran. */
const ticks = defineMock<{ n: number }>({ type: "ticks", name: "Ticks", inputs: [], outputs: [], state: () => ({ n: 0 }), evaluate: (ctx) => void ctx.state.n++ });

const registry = createMockRegistry([js, dark, natural, ticks]);
const hosts: RuntimeHost[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** A card that turns on with a tap and grows from a knob, a text field, and a clock that is unplugged. */
const stillDoc = (): SonobeDocument => {
  const doc = buildDoc(
    {
      layers: [
        { id: "card", type: "rectangle", name: "Card", props: { position: [0, 0], size: [200, 200], opacity: { link: "fade.output" } } },
        { id: "field", type: "textField", name: "Field", props: { position: [0, 300], size: [200, 40] } },
        { id: "echo", type: "text", name: "Echo", props: { position: [0, 400], text: { link: "@field.value" } } },
      ],
      patches: {
        tap: { type: "interaction", inputs: { layer: { layer: "card" } } },
        toggle: { type: "switch", inputs: { flip: { link: "tap.tap" } } },
        fade: { type: "transition", typeParam: "number", inputs: { progress: { link: "toggle.on" }, start: 1, end: 0.5 } },
        mode: { type: "dark" },
        ticks: { type: "ticks" },
      },
    },
    registry,
  );
  return doc;
};

/** A prototype that never settles: a clock drives a layer. */
const movingDoc = () =>
  buildDoc({ layers: [{ id: "card", type: "rectangle", name: "Card", props: { size: [100, 100], rotation: { link: "clock.time" } } }], patches: { clock: { type: "time" } } }, registry);

function setup(options: Partial<RuntimeHostOptions> & { doc?: SonobeDocument } = {}) {
  const { doc, ...rest } = options;
  const scheduler = createManualScheduler();
  const store = createDocumentStore({ registry, document: doc ?? stillDoc() });
  const host = createRuntimeHost({ registry, document: store, scheduler, textMeasurer: "approximate", platform: null, ...rest });
  hosts.push(host);
  return { scheduler, store, host };
}

/** Run frames until the loop rests (it must, within a second of frames). */
function settle(scheduler: ManualScheduler, host: RuntimeHost) {
  for (let i = 0; i < 60 && !host.isResting(); i++) scheduler.frame();
  expect(host.isResting()).toBe(true);
  expect(scheduler.pending).toBe(0);
}

function rested(options: Parameters<typeof setup>[0] = {}) {
  const made = setup(options);
  settle(made.scheduler, made.host);
  return made;
}

function attach(host: RuntimeHost, options: Parameters<RuntimeHost["attachRenderer"]>[1] = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const viewer = host.attachRenderer(container, { scale: 1, ...options });
  vi.spyOn(viewer.renderer.stage, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 390, height: 844, right: 390, bottom: 844, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  return { container, viewer };
}

const apply = (store: ReturnType<typeof setup>["store"], ops: Op[]) => store.getState().apply(ops, { label: "Edit" });

describe("the frame loop at rest", () => {
  it("stops asking for frames once nothing moves, and says so", () => {
    const { scheduler, host } = setup({ statsIntervalMs: 0 });
    expect(host.isResting()).toBe(false);
    scheduler.frames(3);
    expect(host.isResting()).toBe(true);
    expect(scheduler.pending).toBe(0);
    expect(host.state.getState()).toMatchObject({ playing: true, resting: true, fps: 0, frame: 2 });
    scheduler.frames(100);
    expect(host.runtime.frame).toBe(2);
    expect(host.isPlaying()).toBe(true);
  });

  it("keeps running a prototype that moves, and meters its frames", () => {
    const { scheduler, host } = setup({ doc: movingDoc(), statsIntervalMs: 0 });
    scheduler.frames(120);
    expect(host.runtime.frame).toBe(119);
    expect(host.isResting()).toBe(false);
    expect(host.state.getState()).toMatchObject({ resting: false, displayHz: 60 });
    expect(host.state.getState().fps).toBeGreaterThan(55);
  });

  it("isn't at rest while paused, and settles again after play", () => {
    const { scheduler, host } = rested();
    host.pause();
    expect(host.isResting()).toBe(false);
    expect(host.state.getState()).toMatchObject({ playing: false, resting: false });
    host.play();
    expect(scheduler.pending).toBe(1);
    const frame = host.runtime.frame;
    settle(scheduler, host);
    expect(host.runtime.frame).toBe(frame + 1);
  });
});

describe("what wakes a resting loop", () => {
  it("a pointer press in a viewer", () => {
    const { scheduler, host } = rested();
    const { container } = attach(host);
    const pointer = (type: string, init: PointerEventInit) => container.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "mouse", pointerId: 1, ...init }));
    pointer("pointerdown", { clientX: 50, clientY: 50, button: 0, buttons: 1 });
    expect(host.isResting()).toBe(false);
    expect(scheduler.pending).toBe(1);
    pointer("pointerup", { clientX: 50, clientY: 50, button: 0 });
    scheduler.frame();
    expect(host.runtime.getValue("toggle.on")).toBe(true);
    settle(scheduler, host);
    expect(host.runtime.getValue("@card.opacity")).toBe(0.5);
  });

  it("a key, the wheel, and typing in a text field", () => {
    const { scheduler, host } = rested();
    const { container, viewer } = attach(host);
    const events = vi.spyOn(host.runtime, "dispatch");
    container.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    expect(events.mock.lastCall?.[0]?.[0]).toMatchObject({ kind: "key", phase: "down" });
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);

    container.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, clientX: 50, clientY: 50, bubbles: true, cancelable: true }));
    expect(events.mock.lastCall?.[0]?.[0]).toMatchObject({ kind: "wheel" });
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);

    const field = viewer.renderer.elementForKey("field")!.querySelector("input, textarea") as HTMLInputElement;
    field.value = "hello";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);
    expect(host.runtime.getValue("@echo.text")).toBe("hello");
  });

  it("the Inspector's Fire", () => {
    const { scheduler, host } = rested();
    host.fireLayerPulses([{ layerId: "field", key: "field", prop: "beginEditing" }]);
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);
    expect(host.scene()!.roots[1]!.textField).toMatchObject({ editing: true });
  });

  it("an edit, an undo, and a structural edit", () => {
    const { scheduler, store, host } = rested();
    apply(store, [{ op: "setInput", target: "fade.start", value: 0.8 }]);
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);
    expect(host.runtime.getValue("@card.opacity")).toBe(0.8);

    store.getState().undo();
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);
    expect(host.runtime.getValue("@card.opacity")).toBe(1);

    apply(store, [{ op: "addLayer", layer: { id: "badge", type: "oval", name: "Badge" } }]);
    settle(scheduler, host);
    expect(host.scene()!.roots.map((n) => n.key)).toContain("badge");
  });

  it("a knob tune and a preset switch", () => {
    const { scheduler, store, host } = setup();
    // A second preset starts as a copy of the first, so the tune below leaves it at 0.5.
    apply(store, [
      { op: "addKnob", knob: { id: "end", name: "End", type: "number", value: 0.5 } },
      { op: "addKnobPreset", preset: { name: "Faint" } },
      { op: "setInput", target: "fade.start", value: { link: "$knob.end" } },
    ]);
    settle(scheduler, host);
    expect(host.runtime.getValue("@card.opacity")).toBe(0.5);

    apply(store, [{ op: "setKnobValue", id: "end", value: 0.7 }]);
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);
    expect(host.runtime.getValue("@card.opacity")).toBe(0.7);

    apply(store, [{ op: "applyKnobPreset", id: "faint" }]);
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);
    expect(host.runtime.getValue("@card.opacity")).toBe(0.5);
  });

  it("turning the device", () => {
    const { scheduler, store, host } = rested();
    const portrait = host.scene()!.size;
    const device = store.getState().doc.project.device;
    apply(store, [{ op: "setProject", changes: { device: { ...device, orientation: "landscape" } } }]);
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);
    expect(host.scene()!.size).toEqual([portrait[1], portrait[0]]);
  });

  it("a replaced document", () => {
    const { scheduler, store, host } = rested();
    store.getState().replaceDocument(movingDoc());
    expect(scheduler.pending).toBe(1);
    scheduler.frame();
    expect(host.runtime.frame).toBe(0);
    expect(host.scene()!.roots.map((n) => n.key)).toEqual(["card"]);
    scheduler.frames(10);
    expect(host.isResting()).toBe(false);
  });

  it("restart", () => {
    const { scheduler, host } = rested();
    const restarts = vi.fn();
    host.subscribeRestart(restarts);
    host.restart();
    expect(scheduler.pending).toBe(1);
    scheduler.frame();
    expect(host.runtime.frame).toBe(0);
    expect(restarts).toHaveBeenCalledTimes(1);
    settle(scheduler, host);
    expect(host.runtime.frame).toBe(2);
  });

  it("script trust granted", async () => {
    const trust = createScriptTrustStore({ persistence: createMemoryTrustPersistence(), confirm: async () => true });
    const { scheduler, store, host } = setup({ scriptTrust: trust });
    store.getState().replaceDocument(buildDoc({ patches: { js_1: { type: "javascript" } } }, registry), { projectPath: "/p/Scripts.sonobe" });
    settle(scheduler, host);
    expect(host.runtime.getValue("js_1.output")).not.toBe(42);
    expect(await host.requestScriptTrust()).toBe(true);
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);
    expect(host.runtime.getValue("js_1.output")).toBe(42);
  });

  it("the system's appearance changing", () => {
    const listeners = new Set<() => void>();
    const query = { matches: false, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) };
    vi.spyOn(window, "matchMedia").mockImplementation(() => query as unknown as MediaQueryList);
    const { scheduler, host } = rested();
    expect(host.runtime.getValue("mode.on")).toBe(false);
    query.matches = true;
    for (const fn of listeners) fn();
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);
    expect(host.runtime.getValue("mode.on")).toBe(true);
  });

  it("an image that finishes loading in a viewer", () => {
    const doc = buildDoc(
      { layers: [{ id: "photo", type: "image", name: "Photo", props: { size: [100, 100] } }], patches: { size: { type: "natural", inputs: { layer: { layer: "photo" } } } } },
      registry,
    );
    doc.assets.pic = { id: "pic", kind: "image", name: "Pic", file: "pic.png" };
    doc.components.main!.layers[0]!.props.image = { asset: "pic" };
    const { scheduler, host } = setup({ doc, resolveAssetUrl: () => "https://x.test/pic.png" });
    const { viewer } = attach(host);
    settle(scheduler, host);
    const img = viewer.renderer.elementForKey("photo")!.querySelector("img")!;
    Object.defineProperties(img, { naturalWidth: { value: 640 }, naturalHeight: { value: 480 } });
    img.dispatchEvent(new Event("load"));
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);
    expect(host.runtime.getValue("size.size")).toEqual([640, 480]);
  });

  it("a font that finishes loading", () => {
    const fonts = new EventTarget();
    const measurer = new DomTextMeasurer({ document: { fonts } as unknown as Document, measureWidth: (text) => text.length * 7 });
    const { scheduler, host } = rested({ textMeasurer: measurer });
    const frame = host.runtime.frame;
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);
    expect(host.runtime.frame).toBeGreaterThan(frame);
  });

  it("profiling turned on runs one timing window, then rests again", () => {
    const { scheduler, host } = rested();
    const frame = host.runtime.frame;
    const stop = host.profilePatches();
    expect(scheduler.pending).toBe(1);
    scheduler.frames(30);
    expect(host.isResting()).toBe(false);
    settle(scheduler, host);
    expect(host.runtime.frame - frame).toBeGreaterThanOrEqual(60);
    expect(host.runtime.frame - frame).toBeLessThan(70);
    expect(host.patchTimings().map((t) => t.patchId)).toContain("ticks");
    stop();
    expect(scheduler.pending).toBe(0);
  });

  it("a host created with profiling on rests after its first window", () => {
    const { scheduler, host } = setup({ profile: true });
    scheduler.frames(40);
    expect(host.isResting()).toBe(false);
    for (let i = 0; i < 40 && !host.isResting(); i++) scheduler.frame();
    expect(host.isResting()).toBe(true);
    expect(host.state.getState().profiling).toBe(true);
  });

  it("a frame stepped by hand that starts something moving", () => {
    const countdown = defineMock<{ left: number }>({
      type: "countdown",
      name: "Countdown",
      inputs: [],
      outputs: [port("left", "number")],
      state: () => ({ left: 0 }),
      evaluate(ctx) {
        // Armed from outside the frame loop, as a test or a tool stepping the prototype would.
        if (armed) ctx.state.left = 5;
        armed = false;
        if (ctx.state.left > 0 && --ctx.state.left > 0) ctx.requestNextFrame();
        ctx.output("left", ctx.state.left);
      },
    });
    let armed = false;
    const reg = createMockRegistry([countdown]);
    const scheduler = createManualScheduler();
    const host = createRuntimeHost({ registry: reg, document: buildDoc({ patches: { c: { type: "countdown" } } }, reg), scheduler, textMeasurer: "approximate", platform: null });
    hosts.push(host);
    settle(scheduler, host);
    armed = true;
    host.stepFrame();
    expect(host.runtime.getValue("c.left")).toBe(4);
    expect(scheduler.pending).toBe(1);
    settle(scheduler, host);
    expect(host.runtime.getValue("c.left")).toBe(0);
  });

  it("a viewer attached before the first scene", () => {
    const { scheduler, host } = setup({ autoplay: false });
    expect(scheduler.pending).toBe(0);
    const { viewer } = attach(host);
    expect(scheduler.pending).toBe(1);
    scheduler.frame();
    expect(viewer.renderer.elementForKey("card")).toBeDefined();
  });
});

describe("what a resting loop answers without a frame", () => {
  it("a viewer attached later draws the scene at once, and a new scale or hit-target overlay redraws it", () => {
    const { scheduler, host } = rested();
    const frame = host.runtime.frame;
    const { viewer } = attach(host);
    expect(viewer.renderer.elementForKey("card")).toBeDefined();
    const drawn = viewer.renderer.getStats().frames;
    viewer.setScale(0.5);
    viewer.setShowHitTargets(true, ["card"]);
    expect(viewer.renderer.getStats().frames).toBe(drawn + 2);
    expect(viewer.renderer.elementForKey("card")!.querySelector(".sonobe-hit")).not.toBeNull();
    expect(scheduler.pending).toBe(0);
    expect(host.runtime.frame).toBe(frame);
    expect(host.viewerBounds()).toMatchObject({ prototypeSize: [390, 844] });
    expect(host.layerBounds({ layerId: "card" })).toMatchObject({ key: "card" });
  });

  it("a new value subscription and a scope change are read at once", () => {
    let scope = "";
    const { scheduler, host } = rested({ scope: () => scope });
    const values = vi.fn();
    host.subscribeValues(["toggle.on"], values);
    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.lastCall![0]).toEqual({ "toggle.on": false });
    scope = "nowhere";
    host.refreshScope();
    expect(values).toHaveBeenCalledTimes(2);
    expect(scheduler.pending).toBe(0);
  });
});

describe("what frames feed while the loop rests", () => {
  it("delivers a value that changed inside a subscription's throttle window when it rests", () => {
    const { scheduler, host } = rested();
    const { container } = attach(host);
    const seen: unknown[] = [];
    // One update a second at most: the tap lands well inside the window.
    host.subscribeValues(["toggle.on"], (v) => seen.push(v["toggle.on"]), { hz: 1 });
    const pointer = (type: string, init: PointerEventInit) => container.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "mouse", pointerId: 1, ...init }));
    pointer("pointerdown", { clientX: 50, clientY: 50, button: 0, buttons: 1 });
    pointer("pointerup", { clientX: 50, clientY: 50, button: 0 });
    settle(scheduler, host);
    expect(scheduler.now()).toBeLessThan(1000);
    expect(seen).toEqual([false, true]);
  });

  it("frame listeners (the canvas's live scene) hear nothing while it rests, and hear the next frame", () => {
    const { scheduler, store, host } = rested();
    const frames: SceneFrame[] = [];
    host.subscribeFrame((scene) => frames.push(scene));
    scheduler.frames(30);
    expect(frames).toEqual([]);
    apply(store, [{ op: "setInput", target: "fade.start", value: 0.8 }]);
    scheduler.frame();
    expect(frames).toHaveLength(1);
  });

  it("publishes the last frame's counters and diagnostics when it rests, whatever the stats interval", () => {
    const { scheduler, host } = setup({ statsIntervalMs: 10_000 });
    settle(scheduler, host);
    expect(host.state.getState()).toMatchObject({ frame: host.runtime.frame, resting: true });
  });

  it("keeps saying at rest through a tap that settles within a stats interval", () => {
    const { scheduler, host } = rested({ statsIntervalMs: 250 });
    const states: boolean[] = [];
    host.state.subscribe((s) => states.push(s.resting));
    host.runtime.dispatch([{ kind: "pointer", phase: "move", pointerId: 1, x: 5, y: 5 }]);
    settle(scheduler, host);
    expect(states.every(Boolean)).toBe(true);
  });

  it("time keeps running across a rest: the frame that ends it is 5 s later, and patches see one frame of it", () => {
    const { scheduler, host } = rested({ statsIntervalMs: 0 });
    const before = host.runtime.time;
    scheduler.frame(5000);
    expect(host.runtime.time).toBe(before);
    host.runtime.dispatch([{ kind: "pointer", phase: "move", pointerId: 1, x: 5, y: 5 }]);
    scheduler.frame();
    expect(host.runtime.time).toBeCloseTo(before + 5 + 1 / 60, 6);
    scheduler.frame();
    expect(host.runtime.time).toBeCloseTo(before + 5 + 2 / 60, 6);
    // The rate is counted from the frames that ran, not across the gap.
    expect(host.state.getState().fps).toBeGreaterThan(55);
  });
});
