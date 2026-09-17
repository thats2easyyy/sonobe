// @vitest-environment happy-dom
import type { Op } from "@sonobe/core";
import type { InputEvent } from "@sonobe/engine";
import { buildDoc, createMockRegistry, defineMock, port } from "@sonobe/engine/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsoleStore } from "../state/console.ts";
import { createDocumentStore } from "../state/document.ts";
import { createRuntimeHost, type RuntimeHost } from "./runtimeHost.ts";
import { createManualScheduler } from "./scheduler.ts";

const warner = defineMock({
  type: "warner",
  name: "Warner",
  inputs: [],
  outputs: [],
  evaluate(ctx) {
    if (ctx.frame === 1) ctx.services.log("warn", "careful", 7);
  },
});

const registry = createMockRegistry([warner]);
const hosts: RuntimeHost[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
});

const tapDoc = () =>
  buildDoc(
    {
      layers: [{ id: "card", type: "rectangle", props: { position: [0, 0], size: [200, 200] } }],
      patches: {
        tap: { type: "interaction", inputs: { layer: { layer: "card" } } },
        toggle: { type: "switch", inputs: { flip: { link: "tap.tap" } } },
        logger: { type: "logger", inputs: { value: { link: "toggle.on" } } },
      },
    },
    registry,
  );

function setup(options: { autoplay?: boolean; statsIntervalMs?: number } = {}) {
  const scheduler = createManualScheduler();
  const consoleStore = createConsoleStore({ schedule: (fn) => fn() });
  const store = createDocumentStore({ registry, document: tapDoc() });
  const host = createRuntimeHost({ registry, document: store, scheduler, console: consoleStore, textMeasurer: "approximate", ...options });
  hosts.push(host);
  return { scheduler, store, host, consoleStore };
}

const down: InputEvent = { kind: "pointer", phase: "down", pointerId: 1, x: 50, y: 50 };
const up: InputEvent = { kind: "pointer", phase: "up", pointerId: 1, x: 50, y: 50 };

describe("runtime host", () => {
  it("runs frames while playing and hot-swaps the document on the next frame", () => {
    const { scheduler, store, host } = setup();
    expect(host.state.getState().playing).toBe(true);
    scheduler.frames(3);
    expect(host.runtime.frame).toBe(2);

    const op: Op = { op: "addLayer", layer: { id: "badge", type: "oval", name: "Badge" } };
    store.getState().apply([op], { label: "Add Badge" });
    expect(host.document()).toBe(store.getState().doc);
    expect(host.runtime.document).not.toBe(store.getState().doc);
    scheduler.frame();
    expect(host.runtime.document).toBe(store.getState().doc);
    expect(host.scene()!.roots.map((n) => n.key)).toEqual(["card", "badge"]);
    expect(host.runtime.frame).toBe(3);
  });

  it("pauses, refreshes edits while paused, and restarts", () => {
    const { scheduler, store, host } = setup();
    scheduler.frames(4);
    host.pause();
    expect(scheduler.pending).toBe(0);
    scheduler.frame();
    expect(host.runtime.frame).toBe(3);

    store.getState().apply([{ op: "updateLayer", id: "card", props: { color: "#FF0000FF" } }], { label: "Color" });
    scheduler.frame();
    expect(host.runtime.document).toBe(store.getState().doc);
    expect(host.runtime.time).toBeCloseTo(3 / 60, 5);

    host.restart();
    scheduler.frame();
    expect(host.runtime.frame).toBe(0);
    host.play();
    scheduler.frames(2);
    expect(host.runtime.frame).toBe(2);
    expect(host.isPlaying()).toBe(true);
  });

  it("restarts when the document is replaced", () => {
    const { scheduler, store, host } = setup();
    scheduler.frames(5);
    store.getState().replaceDocument(tapDoc());
    scheduler.frame();
    expect(host.runtime.frame).toBe(0);
  });

  it("streams live values at most hz times a second, only on change", () => {
    const { scheduler, host } = setup();
    scheduler.frame();
    const cb = vi.fn();
    host.subscribeValues(["toggle.on", "tap.down"], cb, { hz: 10 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toEqual({ "toggle.on": false, "tap.down": false });

    scheduler.frames(30);
    expect(cb).toHaveBeenCalledTimes(1);

    host.runtime.dispatch([down]);
    scheduler.frame();
    host.runtime.dispatch([up]);
    scheduler.frames(12);
    const last = cb.mock.calls.at(-1)![0];
    expect(last["toggle.on"]).toBe(true);
    expect(cb.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("reports pulses on the frame they fire", () => {
    const { scheduler, host } = setup();
    const fires: { frame: number; addresses: string[] }[] = [];
    host.subscribePulses((fire) => fires.push(fire));
    scheduler.frame();
    host.runtime.dispatch([down]);
    scheduler.frame();
    host.runtime.dispatch([up]);
    scheduler.frames(3);
    expect(fires).toEqual([{ frame: 2, addresses: ["tap.tap"], component: "main", instancePath: "" }]);
  });

  it("routes logs to the console with the patch id and turns issues into diagnostics", () => {
    const scheduler = createManualScheduler();
    const consoleStore = createConsoleStore({ schedule: (fn) => fn() });
    const doc = buildDoc({ patches: { careful: { type: "warner" }, logger: { type: "logger", inputs: { value: 42 } } } }, registry);
    const host = createRuntimeHost({ registry, document: doc, scheduler, console: consoleStore, textMeasurer: "approximate", statsIntervalMs: 0 });
    hosts.push(host);
    scheduler.frames(3);
    const entries = consoleStore.getState().entries;
    expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ level: "log", source: "logger", componentPath: "main", message: "logger 42" }), expect.objectContaining({ level: "warn", source: "careful", message: "careful 7" })]));
    expect(host.state.getState().diagnostics).toEqual([{ code: "patch_warning", severity: "warning", message: "careful 7", component: "main", itemIds: ["careful"] }]);
    expect(host.state.getState().fps).toBeGreaterThan(50);
  });

  it("draws into attached viewers and reports bounds", () => {
    const { scheduler, host } = setup({ autoplay: false });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const viewer = host.attachRenderer(container, { captureInput: false, scale: 0.5 });
    scheduler.frame();
    expect(viewer.renderer.elementForKey("card")).toBeDefined();
    const bounds = host.viewerBounds();
    expect(bounds).toMatchObject({ scale: 0.5, prototypeSize: [390, 844] });
    viewer.dispose();
    expect(host.viewerBounds()).toBeNull();
    container.remove();
  });

  it("creates deterministic simulations independent of the live runtime", () => {
    const { scheduler, host } = setup();
    scheduler.frames(2);
    const a = host.createSimulation();
    const b = host.createSimulation();
    for (const sim of [a, b]) sim.step({ frames: 4, events: [[], [down], [up], []] });
    expect(a.values(["toggle.on"]).values).toEqual({ "toggle.on": true });
    expect(b.values(["toggle.on"])).toEqual(a.values(["toggle.on"]));
    expect(host.runtime.getValue("toggle.on")).toBe(false);
    expect(host.runtime.frame).toBe(1);
    a.dispose();
    b.dispose();
  });
});
