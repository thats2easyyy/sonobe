// @vitest-environment happy-dom
import { COMPONENT_INSTANCE_LAYER_TYPE } from "@sonobe/core";
import type { InputEvent } from "@sonobe/engine";
import { buildDoc, createMockRegistry, defineMock, port } from "@sonobe/engine/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { createConsoleStore } from "../state/console.ts";
import { createDocumentStore } from "../state/document.ts";
import type { MuteState } from "./platform.ts";
import { createRuntimeHost, issuesToDiagnostics, type PulseFire, type RuntimeHost } from "./runtimeHost.ts";
import { createManualScheduler } from "./scheduler.ts";
import { createMemoryTrustPersistence, createScriptTrustStore } from "./scriptTrust.ts";

const warner = defineMock({
  type: "warner",
  name: "Warner",
  inputs: [],
  outputs: [],
  evaluate(ctx) {
    if (ctx.frame === 1) ctx.services.log("warn", "inside");
  },
});
const js = defineMock({ type: "javascript", name: "JavaScript", inputs: [], outputs: [port("output", "number")], evaluate: (ctx) => ctx.output("output", 42) });
const cam = defineMock<{ ref: unknown; started: boolean }>({
  type: "cam",
  name: "Cam",
  alwaysEvaluate: true,
  inputs: [],
  outputs: [port("feed", "video")],
  state: () => ({ ref: null, started: false }),
  evaluate(ctx) {
    const media = ctx.services.platform.media;
    if (!ctx.state.started && media?.openCamera) {
      ctx.state.started = true;
      void media.openCamera("main/cam#0", { facing: "back", quality: "low" }).then((ref) => {
        ctx.state.ref = ref;
      });
    }
    ctx.output("feed", ctx.state.ref);
  },
});
const registry = createMockRegistry([warner, js, cam]);
const hosts: RuntimeHost[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
  document.body.innerHTML = "";
});

const cardDoc = () =>
  buildDoc(
    {
      components: [
        {
          id: "card",
          kind: "layerComponent",
          size: [100, 100],
          layers: [{ id: "body", type: "rectangle", name: "Body", props: { position: [0, 0], size: [100, 100] } }],
          patches: {
            tap: { type: "interaction", inputs: { layer: { layer: "body" } } },
            toggle: { type: "switch", inputs: { flip: { link: "tap.tap" } } },
            careful: { type: "warner" },
          },
        },
      ],
      layers: [{ id: "card_1", type: COMPONENT_INSTANCE_LAYER_TYPE, name: "Card", component: "card", props: { position: [0, 0] } }],
    },
    registry,
  );

const down: InputEvent = { kind: "pointer", phase: "down", pointerId: 1, x: 50, y: 50 };
const up: InputEvent = { kind: "pointer", phase: "up", pointerId: 1, x: 50, y: 50 };
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;

function track(host: RuntimeHost) {
  hosts.push(host);
  return host;
}

describe("runtime host services", () => {
  it("follows the component being edited for live values, pulses, logs, and diagnostics", () => {
    let scope: string | null = "";
    const scheduler = createManualScheduler();
    const consoleStore = createConsoleStore({ schedule: (fn) => fn() });
    const host = track(createRuntimeHost({ registry, document: cardDoc(), scheduler, console: consoleStore, textMeasurer: "approximate", platform: null, scope: () => scope, statsIntervalMs: 0 }));
    scheduler.frame();
    const values = vi.fn();
    host.subscribeValues(["toggle.on"], values);
    expect(values.mock.calls.at(-1)![0]).toEqual({ "toggle.on": undefined });

    scope = "card_1";
    host.refreshScope();
    expect(host.state.getState().scope).toBe("card_1");
    expect(values.mock.calls.at(-1)![0]).toEqual({ "toggle.on": false });

    const fires: PulseFire[] = [];
    host.subscribePulses((fire) => fires.push(fire));
    host.runtime.dispatch([down]);
    scheduler.frame();
    host.runtime.dispatch([up]);
    scheduler.frames(3);
    expect(fires).toEqual([expect.objectContaining({ addresses: ["tap.tap"], component: "card", instancePath: "card_1" })]);
    expect(host.readValue("toggle.on")).toBe(true);
    expect(host.readValue("toggle.on", "root")).toBeUndefined();
    expect(host.readValue("card_1/toggle.on", "root")).toBe(true);
    expect(host.readValue("toggle.on", { instancePath: "card_1" })).toBe(true);

    expect(consoleStore.getState().entries).toEqual(expect.arrayContaining([expect.objectContaining({ level: "warn", source: "careful", componentPath: "main/card_1", message: "inside" })]));
    expect(host.state.getState().diagnostics).toEqual([expect.objectContaining({ code: "patch_warning", component: "card", itemIds: ["careful"] })]);

    scope = null;
    host.refreshScope();
    expect(values.mock.calls.at(-1)![0]).toEqual({ "toggle.on": undefined });
    expect(issuesToDiagnostics([{ code: "x", severity: "error", message: "m", componentPath: "main/ghost" }], "main", cardDoc())[0]!.component).toBe("main");
  });

  it("records patch timings while someone asks for them", () => {
    const scheduler = createManualScheduler();
    const host = track(createRuntimeHost({ registry, document: cardDoc(), scheduler, textMeasurer: "approximate", platform: null }));
    scheduler.frames(2);
    expect(host.patchTimings()).toEqual([]);
    const stopA = host.profilePatches();
    const stopB = host.profilePatches();
    expect(host.state.getState().profiling).toBe(true);
    scheduler.frames(5);
    expect(host.patchTimings().map((t) => t.patchId)).toEqual(expect.arrayContaining(["toggle", "careful"]));
    stopA();
    stopA();
    expect(host.state.getState().profiling).toBe(true);
    stopB();
    expect(host.state.getState().profiling).toBe(false);
    expect(host.patchTimings()).toEqual([]);
    host.setProfiling(true);
    expect(host.state.getState().profiling).toBe(true);
  });

  it("runs project scripts only after the person trusts the project", async () => {
    const scheduler = createManualScheduler();
    const store = createDocumentStore({ registry, document: buildDoc({}, registry) });
    const trust = createScriptTrustStore({ persistence: createMemoryTrustPersistence(), confirm: async () => true });
    const host = track(createRuntimeHost({ registry, document: store, scheduler, textMeasurer: "approximate", platform: null, scriptTrust: trust, statsIntervalMs: 0 }));
    expect(host.scriptTrust).toBe(trust);
    store.getState().replaceDocument(buildDoc({ patches: { js_1: { type: "javascript" } } }, registry), { projectPath: "/p/Scripts.sonobe" });
    scheduler.frames(2);
    expect(trust.getState()).toMatchObject({ required: true, trusted: false });
    expect(host.runtime.getValue("js_1.output")).not.toBe(42);
    expect(host.state.getState().diagnostics).toEqual([expect.objectContaining({ code: "script_untrusted", itemIds: ["js_1"] })]);

    const sim = host.createSimulation();
    sim.step({ frames: 1 });
    expect(sim.values(["js_1.output"]).values["js_1.output"]).not.toBe(42);
    sim.dispose();

    expect(await host.requestScriptTrust()).toBe(true);
    scheduler.frame();
    expect(host.runtime.frame).toBe(0);
    expect(host.runtime.getValue("js_1.output")).toBe(42);
  });

  it("reports the effective scale and layer rects for screenshots", () => {
    const scheduler = createManualScheduler();
    const doc = buildDoc({ layers: [{ id: "card", type: "rectangle", props: { position: [0, 0], size: [200, 200] } }] }, registry);
    const host = track(createRuntimeHost({ registry, document: doc, scheduler, textMeasurer: "approximate", platform: null, autoplay: false }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const viewer = host.attachRenderer(container, { captureInput: false, scale: 1 });
    scheduler.frame();
    expect(host.state.getState().viewers).toBe(1);
    vi.spyOn(viewer.renderer.stage, "getBoundingClientRect").mockReturnValue(rect(10, 20, 195, 422));
    expect(host.viewerBounds()).toMatchObject({ scale: 0.5, prototypeSize: [390, 844], stage: { x: 10, y: 20, width: 195, height: 422 } });
    vi.spyOn(viewer.renderer.elementForKey("card")!, "getBoundingClientRect").mockReturnValue(rect(10, 20, 100, 100));
    expect(host.layerBounds({ layerId: "card" })).toEqual({ x: 10, y: 20, width: 100, height: 100, scale: 0.5, key: "card" });
    expect(host.layerBounds({ key: "card" })).toMatchObject({ key: "card" });
    expect(host.layerBounds({ layerId: "ghost" })).toBeNull();
    viewer.dispose();
    expect(host.state.getState().viewers).toBe(0);
    expect(host.layerBounds({ layerId: "card" })).toBeNull();
  });

  it("mutes app-wide", () => {
    const mute = createStore<MuteState>()(() => ({ muted: false, reason: null }));
    const host = track(createRuntimeHost({ registry, document: cardDoc(), scheduler: createManualScheduler(), textMeasurer: "approximate", platform: null, mute }));
    expect(host.state.getState().muted).toBe(false);
    host.setMuted(true);
    expect(host.isMuted()).toBe(true);
    expect(mute.getState()).toEqual({ muted: true, reason: "user" });
    expect(host.state.getState().muted).toBe(true);
    mute.setState({ muted: false, reason: null });
    expect(host.state.getState().muted).toBe(false);
  });

  it("draws camera feeds into video layers", async () => {
    const scheduler = createManualScheduler();
    const videoTrack = { stop: vi.fn() };
    const stream = Object.assign(typeof MediaStream === "function" ? new MediaStream() : {}, { getTracks: () => [videoTrack], getAudioTracks: () => [] });
    const doc = buildDoc({ layers: [{ id: "vid", type: "video", props: { position: [0, 0], size: [100, 100], video: { link: "cam.feed" } } }], patches: { cam: { type: "cam" } } }, registry);
    const host = track(
      createRuntimeHost({
        registry,
        document: doc,
        scheduler,
        textMeasurer: "approximate",
        platform: "browser",
        platformOptions: { window: { navigator: { mediaDevices: { getUserMedia: async () => stream } }, document } as never },
        mute: createStore<MuteState>()(() => ({ muted: true, reason: "test" })),
      }),
    );
    const container = document.createElement("div");
    document.body.appendChild(container);
    const viewer = host.attachRenderer(container, { captureInput: false });
    const overlay = () => viewer.renderer.elementForKey("vid")?.querySelector("video[data-sonobe-live]") as HTMLVideoElement | null;
    await vi.waitFor(() => {
      scheduler.frame();
      expect(overlay()).toBeTruthy();
    });
    expect(overlay()!.srcObject).toBe(stream);
    expect(overlay()!.getAttribute("data-sonobe-live")).toBe("camera/main/cam#0");
    host.platform.media!.close("main/cam#0");
    expect(videoTrack.stop).toHaveBeenCalled();
    scheduler.frame();
    expect(overlay()).toBeNull();
  });
});
