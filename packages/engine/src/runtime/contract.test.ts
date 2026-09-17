import { applyOps, type LayerRef } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, defineMock, port, runFrames, type ComponentInput } from "../testing/index.ts";
import type { InputEvent, LogSource, PatchDefinition, SceneNode } from "../types.ts";
import { compileDocument } from "./compile.ts";
import { isLoop } from "./loop.ts";
import { createRuntime } from "./runtime.ts";

const items = (v: unknown) => (isLoop(v) ? v.items : v);
const pointer = (phase: "down" | "up", pointerId: number, x: number, y: number, extra: Partial<Extract<InputEvent, { kind: "pointer" }>> = {}): InputEvent => ({ kind: "pointer", phase, pointerId, x, y, ...extra });

const doubler: ComponentInput = {
  id: "doubler",
  kind: "patchComponent",
  inputs: { x: { type: "number", default: 3 } },
  outputs: { y: { type: "number", link: "mul.output" } },
  patches: { mul: { type: "multiply", inputs: { a: { link: "$in.x" }, b: 2 } } },
};

const card: ComponentInput = {
  id: "card",
  kind: "layerComponent",
  size: [200, 100],
  inputs: { title: { type: "text", default: "Untitled" } },
  outputs: { on: { type: "boolean", link: "toggle.on" } },
  layers: [
    { id: "button", type: "rectangle", name: "Button", props: { size: [200, 100] } },
    { id: "label", type: "text", name: "Label", props: { text: { link: "$in.title" } } },
  ],
  patches: {
    touch: { type: "interaction", inputs: { layer: { layer: "button" } } },
    toggle: { type: "switch", inputs: { flip: { link: "touch.tap" } } },
  },
};

describe("contract: muted behavior", () => {
  it("variant outputs pass the first variant input, other outputs match non-variant inputs by type; zero and evaluate", () => {
    const watcher: PatchDefinition = {
      type: "watcher",
      name: "Watcher",
      category: "utility",
      summary: "Mock watcher.",
      mutedBehavior: "evaluate",
      inputs: [port("value", "number", { default: 4 })],
      outputs: [port("muted", "boolean"), port("value", "number")],
      evaluate(ctx) {
        ctx.output("muted", ctx.muted);
        ctx.output("value", ctx.muted ? -1 : ctx.input<number>("value"));
      },
    };
    const mixed = defineMock({
      type: "mixed",
      name: "Mixed",
      variants: ["number", "text"],
      inputs: [port("value", "variant", { default: 0 }), port("count", "number", { default: 0 })],
      outputs: [port("output", "variant"), port("total", "number")],
      evaluate() {},
    });
    const reg = createMockRegistry([watcher, mixed]);
    const doc = buildDoc(
      {
        patches: {
          t: { type: "transition", typeParam: "number", muted: true, inputs: { progress: 0.25, start: 10, end: 20 } },
          tp: { type: "transition", typeParam: "point", muted: true, inputs: { progress: 0.5, start: [1, 2], end: [3, 4] } },
          m: { type: "mixed", typeParam: "number", muted: true, inputs: { value: 7, count: 3 } },
          v: { type: "velocity", muted: true, inputs: { value: 5 } },
          w: { type: "watcher", muted: true },
          live: { type: "watcher" },
        },
      },
      reg,
    );
    const rt = createTestRuntime(doc, reg);
    rt.step();
    expect(rt.getValue("t.output")).toBe(10);
    expect(rt.getValue("tp.output")).toEqual([1, 2]);
    expect([rt.getValue("m.output"), rt.getValue("m.total")]).toEqual([7, 3]);
    expect(rt.getValue("v.velocity")).toBe(0);
    expect([rt.getValue("w.muted"), rt.getValue("w.value")]).toEqual([true, -1]);
    expect([rt.getValue("live.muted"), rt.getValue("live.value")]).toEqual([false, 4]);
  });
});

describe("contract: PatchContext", () => {
  it("isPulseSource, isFeedback, and a boolean already on at frame 0 counts as rising", () => {
    const probe = defineMock({
      type: "ctxProbe",
      name: "Ctx Probe",
      inputs: [port("fromPulse", "pulse"), port("fromState", "pulse"), port("loopBack", "number", { default: 0 })],
      outputs: [port("pulseSource", "boolean"), port("stateSource", "boolean"), port("feedback", "boolean"), port("rising", "boolean"), port("out", "number")],
      evaluate(ctx) {
        ctx.output("pulseSource", ctx.isPulseSource("fromPulse"));
        ctx.output("stateSource", ctx.isPulseSource("fromState"));
        ctx.output("feedback", ctx.isFeedback("loopBack"));
        ctx.output("rising", ctx.pulsed("fromState"));
        ctx.output("out", ctx.input<number>("loopBack") + 1);
      },
    });
    const reg = createMockRegistry([probe]);
    const doc = buildDoc(
      {
        patches: {
          start: { type: "whenPrototypeStarts" },
          on: { type: "switch", inputs: { turnOn: { link: "start.started" } } },
          p: { type: "ctxProbe", inputs: { fromPulse: { link: "start.started" }, fromState: { link: "on.on" }, loopBack: { link: "hold.output" } } },
          hold: { type: "splitter", inputs: { value: { link: "p.out" } } },
        },
      },
      reg,
    );
    const rt = createTestRuntime(doc, reg);
    rt.step();
    expect(["pulseSource", "stateSource", "feedback", "rising"].map((k) => rt.getValue(`p.${k}`))).toEqual([true, false, true, true]);
    rt.step();
    expect(rt.getValue("p.rising")).toBe(false);
    expect(compileDocument(doc, reg).order.find((n) => n.id === "hold")!.feedback).toEqual([false]);
  });

  it("inputCount: variadic clamp, inputCountRange clamp, else node.inputCount ?? 0", () => {
    const counter = (type: string, extra: Partial<PatchDefinition> = {}) =>
      defineMock({
        type,
        name: type,
        inputs: [],
        outputs: [port("count", "number")],
        evaluate(ctx) {
          ctx.output("count", ctx.inputCount);
        },
        ...extra,
      });
    const variadic = counter("variadicProbe", { variadic: { key: "item", name: "Item", type: "number", default: 0, min: 1, max: 4, defaultCount: 2, description: "Item." } });
    const ranged = Object.assign(counter("rangedProbe"), { inputCountRange: { min: 2, max: 8, defaultCount: 3 } });
    const reg = createMockRegistry([variadic, ranged, counter("plainProbe")]);
    const doc = structuredClone(
      buildDoc(
        {
          patches: {
            v_default: { type: "variadicProbe" },
            v_many: { type: "variadicProbe" },
            r_default: { type: "rangedProbe" },
            r_many: { type: "rangedProbe" },
            r_some: { type: "rangedProbe" },
            p_default: { type: "plainProbe" },
            p_set: { type: "plainProbe" },
          },
        },
        reg,
      ),
    );
    const patches = doc.components.main!.patches;
    patches.v_many!.inputCount = 99;
    patches.r_many!.inputCount = 20;
    patches.r_some!.inputCount = 5;
    patches.p_set!.inputCount = 7;
    const rt = createTestRuntime(doc, reg);
    rt.step();
    expect(["v_default", "v_many", "r_default", "r_many", "r_some", "p_default", "p_set"].map((id) => rt.getValue(`${id}.count`))).toEqual([2, 4, 3, 8, 5, 0, 7]);
  });

  it("warnOnce logs once per patch instance and key until restart, even for frame-0-only warnings; logs carry their source", () => {
    const warner = defineMock({
      type: "warner",
      name: "Warner",
      inputs: [],
      outputs: [],
      evaluate(ctx) {
        if (ctx.frame === 0) {
          ctx.warnOnce("launch", `launch ${ctx.id}`);
          ctx.warnOnce("launch", `again ${ctx.id}`);
        }
        ctx.warnOnce("every", `every ${ctx.id}`);
      },
    });
    const noisy: ComponentInput = { id: "noisy", kind: "patchComponent", patches: { w: { type: "warner" } } };
    const reg = createMockRegistry([warner]);
    const logs: [unknown, LogSource | undefined][] = [];
    const rt = createTestRuntime(buildDoc({ components: [noisy], patches: { w1: { type: "warner" }, w2: { type: "warner" }, inst: { type: "component", component: "noisy" } } }, reg), reg, {
      onLog: (_level, args, source) => logs.push([args[0], source]),
    });
    runFrames(rt, 3);
    const expected = [
      ["launch w1", { patchId: "w1", componentPath: "main" }],
      ["every w1", { patchId: "w1", componentPath: "main" }],
      ["launch w2", { patchId: "w2", componentPath: "main" }],
      ["every w2", { patchId: "w2", componentPath: "main" }],
      ["launch w", { patchId: "w", componentPath: "main/inst" }],
      ["every w", { patchId: "w", componentPath: "main/inst" }],
    ];
    expect(logs).toHaveLength(6);
    expect(logs).toEqual(expect.arrayContaining(expected));
    expect(rt.issues()).toEqual(expect.arrayContaining([{ code: "patch_warning", severity: "warning", message: "launch w", patchId: "w", componentPath: "main/inst" }]));
    expect(rt.issues().find((i) => i.patchId === "w1")).not.toHaveProperty("componentPath");
    rt.restart();
    rt.step();
    expect(logs).toHaveLength(12);
    expect(logs.slice(6)).toEqual(expect.arrayContaining(expected));
  });
});

describe("contract: services", () => {
  it("deterministic, restartCount, measureText, readScript and coded issues", () => {
    const svc = defineMock({
      type: "svc",
      name: "Services",
      inputs: [],
      outputs: [port("det", "boolean"), port("restarts", "number"), port("width", "number"), port("script", "text"), port("missing", "boolean")],
      evaluate(ctx) {
        const s = ctx.services;
        ctx.output("det", s.deterministic);
        ctx.output("restarts", s.restartCount);
        ctx.output("width", s.measureText("hello", { fontFamily: "Inter", fontSize: 10, fontWeight: 400, letterSpacing: 0, lineHeight: 0 }, null).width);
        ctx.output("script", s.readScript("js_1.js") ?? "");
        ctx.output("missing", s.readScript("nope.js") === undefined);
        s.issue("invalid_expression", "error", "Bad formula.");
        s.issue("invalid_expression", "error", "Bad formula.");
      },
    });
    const reg = createMockRegistry([svc]);
    const doc = structuredClone(buildDoc({ patches: { s: { type: "svc" } } }, reg));
    doc.scripts["js_1.js"] = "export default 1;";
    const rt = createTestRuntime(doc, reg, { textMeasurer: { measure: (text) => ({ width: text.length * 7, height: 12 }) } });
    rt.step();
    expect(["det", "restarts", "width", "script", "missing"].map((k) => rt.getValue(`s.${k}`))).toEqual([true, 0, 35, "export default 1;", true]);
    expect(rt.services.readScript("scripts/js_1.js")).toBe("export default 1;");
    const coded = () => rt.issues().filter((i) => i.code === "invalid_expression");
    expect(coded()).toEqual([{ code: "invalid_expression", severity: "error", message: "Bad formula.", patchId: "s" }]);
    rt.restart();
    expect(coded()).toEqual([]);
    rt.step();
    expect(rt.getValue("s.restarts")).toBe(1);
    expect(coded()).toHaveLength(1);

    const live = createRuntime(doc, { registry: reg });
    expect(live.services.deterministic).toBe(false);
    expect(live.services.device().timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  });

  it("device time zone and orientation angle; simulated motion has no attitude", () => {
    const doc = buildDoc({});
    const rt = createTestRuntime(doc);
    rt.step();
    expect(rt.services.device().timeZone).toBe("UTC");
    expect(rt.services.device()).not.toHaveProperty("orientationAngle");
    expect(createTestRuntime(doc, undefined, { device: { timeZone: "Asia/Tokyo", orientationAngle: 180 } }).services.device()).toMatchObject({ timeZone: "Asia/Tokyo", orientationAngle: 180 });
    rt.dispatch([
      { kind: "orientation", orientation: "landscape", angle: 90 },
      { kind: "deviceMotion", acceleration: [0, -1, 0], rotationRate: [1, 2, 3] },
    ]);
    rt.step();
    expect(rt.services.device()).toMatchObject({ orientation: "landscape", orientationAngle: 90 });
    expect(rt.services.platform.deviceMotion!()).toEqual({ acceleration: [0, -1, 0], rotationRate: [1, 2, 3] });
    rt.dispatch([{ kind: "deviceMotion", acceleration: [0, 0, -1], rotationRate: [0, 0, 0], attitude: [10, 20, 30] }]);
    rt.step();
    expect(rt.services.platform.deviceMotion!()!.attitude).toEqual([10, 20, 30]);
  });

  it("pointers lists pressed pointers per layer by press time then id, with pressure and buttons", () => {
    const rt = createTestRuntime(
      buildDoc({
        layers: [
          { id: "a", type: "rectangle", name: "A", props: { position: [0, 0], size: [100, 100] } },
          { id: "b", type: "rectangle", name: "B", props: { position: [200, 0], size: [100, 100] } },
        ],
      }),
    );
    rt.step();
    rt.dispatch([pointer("down", 4, 10, 10, { pointerType: "touch", pressure: 0.75 })]);
    rt.step();
    rt.dispatch([pointer("down", 2, 250, 10, { pointerType: "touch" }), pointer("down", 1, 20, 20, { button: 2 })]);
    rt.step();
    expect(rt.services.pointers(null).map((p) => p.id)).toEqual([4, 1, 2]);
    expect(rt.services.pointers({ layerId: "a" })).toEqual([
      { id: 4, position: [10, 10], pressure: 0.75, startTime: 1 / 60, buttons: 1 },
      { id: 1, position: [20, 20], pressure: 0, startTime: 2 / 60, buttons: 2 },
    ]);
    expect(rt.services.pointers({ layerId: "missing" })).toEqual([]);
    expect(rt.services.pointer({ layerId: "a" })).toMatchObject({ pointerCount: 2, pressure: 0.75, buttons: 3, pointerType: "touch" });
  });

  it("mediaInfo reads host info, reported layer outputs and the asset registry; layerOutput reads layer outputs", () => {
    const doc = structuredClone(
      buildDoc({
        layers: [
          { id: "img", type: "image", name: "Image", props: {} },
          { id: "label", type: "text", name: "Label", props: { text: "Hello" } },
        ],
      }),
    );
    doc.assets.photo = { id: "photo", kind: "image", name: "Photo", file: "photo.png", width: 640, height: 480 };
    doc.assets.clip = { id: "clip", kind: "sound", name: "Clip", file: "clip.mp3", duration: 2.5 };
    doc.components.main!.layers[0]!.props.image = { asset: "photo" };
    const rt = createTestRuntime(doc);
    rt.step();
    expect(rt.services.mediaInfo!({ assetId: "photo" })).toEqual({ status: "ready", width: 640, height: 480, duration: 0, name: "Photo" });
    expect(rt.services.mediaInfo!({ assetId: "clip" })).toEqual({ status: "ready", width: 0, height: 0, duration: 2.5, name: "Clip" });
    expect(rt.services.mediaInfo!({ assetId: "ghost" })).toMatchObject({ status: "error" });
    expect(rt.services.mediaInfo!({ url: "https://example.com/cat.png" })).toBeUndefined();
    rt.setLayerOutputs("img", { naturalSize: [1280, 960], loading: true });
    expect(rt.services.mediaInfo!({ assetId: "photo" })).toEqual({ status: "loading", width: 1280, height: 960, duration: 0, name: "Photo" });

    expect(rt.services.layerOutput!({ layerId: "img" }, "naturalSize")).toEqual([1280, 960]);
    expect((rt.services.layerOutput!({ layerId: "label" }, "textSize") as number[])[0]).toBeGreaterThan(0);
    expect(rt.services.layerOutput!({ layerId: "label" }, "nothing")).toBeUndefined();
    expect(rt.services.layerOutput!({ layerId: "missing" }, "naturalSize")).toBeUndefined();

    const hosted = createTestRuntime(doc, undefined, { mediaInfo: (ref) => (ref.url ? { status: "ready", width: 10, height: 20, duration: 0, name: "remote" } : undefined) });
    expect(hosted.services.mediaInfo!({ url: "https://example.com/cat.png" })).toEqual({ status: "ready", width: 10, height: 20, duration: 0, name: "remote" });
  });
});

describe("contract: layer info", () => {
  const infoProbe = defineMock({
    type: "infoProbe",
    name: "Info Probe",
    inputs: [port("layer", "layer", { default: null })],
    outputs: [port("type", "text"), port("parentType", "text"), port("parent", "json"), port("world", "json")],
    evaluate(ctx) {
      const ref = ctx.input<LayerRef | null>("layer");
      const info = ref ? ctx.services.layerInfo(ref) : undefined;
      ctx.output("type", info?.type ?? "");
      ctx.output("parentType", info?.parent ? (ctx.services.layerInfo(info.parent)?.type ?? "unresolved") : "none");
      ctx.output("parent", info?.parent ?? null);
      ctx.output("world", info?.worldTransform ?? null);
    },
  });

  it("carries the layer type, world transform, and a scoped parent reference with its loop instance", () => {
    const framed: ComponentInput = {
      id: "framed",
      kind: "layerComponent",
      size: [200, 100],
      layers: [{ id: "frame", type: "group", name: "Frame", props: { size: [200, 100] }, children: [{ id: "button", type: "rectangle", name: "Button", props: { size: [200, 100] } }] }],
      patches: {
        probe: { type: "infoProbe", inputs: { layer: { layer: "button" } } },
        top: { type: "infoProbe", inputs: { layer: { layer: "frame" } } },
      },
    };
    const reg = createMockRegistry([infoProbe]);
    const rt = createTestRuntime(
      buildDoc(
        {
          components: [framed],
          layers: [
            { id: "frame", type: "oval", name: "Root Frame", props: { position: [300, 300], size: [10, 10] } },
            { id: "c1", type: "componentInstance", name: "Framed", component: "framed", props: { position: [10, 20] } },
            { id: "cell", type: "group", name: "Cell", props: { position: { link: "pos.output" }, size: [50, 50] }, children: [{ id: "badge", type: "rectangle", name: "Badge", props: { size: [10, 10] } }] },
          ],
          patches: {
            pos: { type: "splitter", typeParam: "point", inputs: { value: { loop: [[0, 500], [100, 500]] } } },
            root_probe: { type: "infoProbe", inputs: { layer: { layer: "badge" } } },
          },
        },
        reg,
      ),
      reg,
    );
    rt.step();
    const frame = rt.step();
    expect(rt.getValue("c1/probe.type")).toBe("rectangle");
    expect(rt.getValue("c1/probe.parent")).toEqual({ layerId: "frame" });
    expect(rt.getValue("c1/probe.parentType")).toBe("group");
    expect(rt.getValue("c1/top.parent")).toEqual({ layerId: "c1" });
    expect(rt.getValue("c1/top.parentType")).toBe("componentInstance");
    const button = frame.roots[1]!.children[0]!.children[0]! as SceneNode;
    expect(button.key).toBe("c1/button");
    expect(rt.getValue("c1/probe.world")).toEqual(button.worldTransform);
    expect(items(rt.getRawValue("root_probe.parent"))).toEqual([
      { layerId: "cell", instance: 0 },
      { layerId: "cell", instance: 1 },
    ]);
    expect(items(rt.getRawValue("root_probe.parentType"))).toEqual(["group", "group"]);
  });

  it("services still resolve a stale `{ layerId: info.parent }` wrapper around the parent reference", () => {
    const stale = defineMock({
      type: "staleParent",
      name: "Stale Parent",
      inputs: [port("layer", "layer", { default: null })],
      outputs: [port("parentType", "text"), port("parentSize", "size")],
      evaluate(ctx) {
        const ref = ctx.input<LayerRef | null>("layer");
        const parent = ref ? ctx.services.layerInfo(ref)?.parent : null;
        const wrapped = parent ? ({ layerId: parent, instance: ref!.instance } as unknown as LayerRef) : null;
        const info = wrapped ? ctx.services.layerInfo(wrapped) : undefined;
        ctx.output("parentType", info?.type ?? "unresolved");
        ctx.output("parentSize", info?.size ?? [0, 0]);
      },
    });
    const reg = createMockRegistry([stale]);
    const rt = createTestRuntime(
      buildDoc(
        {
          layers: [{ id: "inbox", type: "group", name: "Inbox", props: { size: [300, 400] }, children: [{ id: "content", type: "rectangle", name: "Content", props: { size: [300, 900] } }] }],
          patches: { s: { type: "staleParent", inputs: { layer: { layer: "content" } } } },
        },
        reg,
      ),
      reg,
    );
    runFrames(rt, 2);
    expect([rt.getValue("s.parentType"), rt.getValue("s.parentSize")]).toEqual(["group", [300, 400]]);
  });
});

describe("contract: addressing inside component instances", () => {
  it("reads patches, published inputs and layers by instance path, in getValue, getRawValue, trace and hit-test keys", () => {
    const rt = createTestRuntime(
      buildDoc({
        components: [doubler, card],
        layers: [{ id: "c1", type: "componentInstance", name: "Card", component: "card", props: { title: "Hello" } }],
        patches: {
          dbl: { type: "component", component: "doubler", inputs: { x: 5 } },
          many: { type: "component", component: "doubler", inputs: { x: { loop: [1, 2, 3] } } },
        },
      }),
    );
    rt.step();
    expect(rt.getValue("dbl/mul.output")).toBe(10);
    expect(rt.getValue("main/dbl/mul.output")).toBe(10);
    expect(rt.getValue("dbl/mul.a")).toBe(5);
    expect(rt.getValue("dbl/$in.x")).toBe(5);
    expect(rt.getValue("$in.x")).toBeUndefined();
    expect(rt.getValue("many/mul.output")).toBe(2);
    expect(rt.getValue("many#2/mul.output")).toBe(6);
    expect(rt.getRawValue("many#1/mul.output")).toBe(4);
    expect(rt.getValue("many#9/mul.output")).toBeUndefined();
    expect(rt.getValue("nobody/mul.output")).toBeUndefined();
    expect(rt.getValue("@c1/label.text")).toBe("Hello");
    const hit = rt.hitTest(150, 80)[0]!;
    expect(hit.key).toBe("c1/button");
    expect(rt.getValue(`@${hit.key}.size`)).toEqual([200, 100]);
    expect(rt.getValue("c1/toggle.on")).toBe(false);
    const traced = rt.trace(["c1/toggle.on", "many#2/mul.output"], 100, [
      { atMs: 0, events: [pointer("down", 1, 150, 80)] },
      { atMs: 17, events: [pointer("up", 1, 150, 80)] },
    ]);
    expect(traced.values["c1/toggle.on"]!.at(-1)).toBe(true);
    expect(traced.values["many#2/mul.output"]!.at(-1)).toBe(6);
  });
});

describe("contract: runtime", () => {
  it("refreshScene rebuilds layout and hit tests after updateDocument without advancing time", () => {
    const doc = buildDoc({ layers: [{ id: "box", type: "rectangle", name: "Box", props: { position: [0, 0], size: [100, 100] } }] });
    const rt = createTestRuntime(doc);
    rt.refreshScene();
    expect(rt.frame).toBe(-1);
    expect(rt.hitTest(50, 50).map((h) => h.key)).toEqual(["box"]);
    rt.step();
    const moved = applyOps(doc, [{ op: "setInput", target: "@box.position", value: [200, 0] }], { registry: createMockRegistry() }).doc;
    rt.updateDocument(moved);
    expect(rt.hitTest(250, 50)).toEqual([]);
    rt.refreshScene();
    expect([rt.frame, rt.time]).toEqual([0, 0]);
    expect(rt.hitTest(250, 50).map((h) => h.key)).toEqual(["box"]);
    expect([rt.scene().frame, rt.scene().roots[0]!.x]).toEqual([0, 200]);
  });

  it("patchTimings is empty while profiling is off and lists patches slowest first when on", () => {
    const doc = buildDoc({ patches: { a: { type: "add", inputs: { value1: 1, value2: 2 } }, pop: { type: "popAnimation", inputs: { number: 1 } } } });
    const rt = createTestRuntime(doc);
    runFrames(rt, 2);
    expect(rt.patchTimings()).toEqual([]);
    rt.setProfiling(true);
    runFrames(rt, 3);
    const partial = rt.patchTimings();
    expect(partial.map((t) => t.patchId).sort()).toEqual(["a", "pop"]);
    expect(partial.every((t) => t.componentPath === "main" && t.ms >= 0)).toBe(true);
    expect(partial.map((t) => t.ms)).toEqual([...partial.map((t) => t.ms)].sort((x, y) => y - x));
    runFrames(rt, 60);
    expect(rt.patchTimings()).toHaveLength(2);
    rt.setProfiling(false);
    expect(rt.patchTimings()).toEqual([]);
    const profiled = createTestRuntime(doc, undefined, { profile: true });
    runFrames(profiled, 1);
    expect(profiled.patchTimings()).toHaveLength(2);
  });

  it("unset colors default to transparent; null-default layer props stay null in the scene", () => {
    const tint = defineMock({
      type: "tint",
      name: "Tint",
      inputs: [port("color", "color")],
      outputs: [port("color", "color")],
      evaluate(ctx) {
        ctx.output("color", ctx.input("color"));
      },
    });
    const reg = createMockRegistry([tint]);
    const doc = structuredClone(
      buildDoc(
        {
          layers: [
            { id: "card", type: "rectangle", name: "Card", props: { cornerRadius: 12 } },
            { id: "square", type: "rectangle", name: "Square", props: { cornerRadii: [1, 2, 3, 4] } },
            { id: "cleared", type: "rectangle", name: "Cleared", props: { cornerRadii: [5, 5, 5, 5] } },
            { id: "linked", type: "rectangle", name: "Linked", props: { cornerRadii: { link: "nothing.output" } } },
            { id: "photo", type: "image", name: "Photo", props: {} },
          ],
          patches: { t: { type: "tint" }, nothing: { type: "splitter", typeParam: "json" } },
        },
        reg,
      ),
    );
    doc.components.main!.layers[2]!.props.cornerRadii = null;
    const rt = createTestRuntime(doc, reg);
    const frame = rt.step();
    expect(rt.getValue("t.color")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    const [cardNode, square, cleared, linked, photo] = frame.roots as SceneNode[];
    expect([cardNode!.props.cornerRadii, cardNode!.props.gradient, cardNode!.props.cornerRadius]).toEqual([null, null, 12]);
    expect(square!.props.cornerRadii).toEqual([1, 2, 3, 4]);
    expect(cleared!.props.cornerRadii).toBeNull();
    expect(linked!.props.cornerRadii).toBeNull();
    expect(photo!.props.image).toBeNull();
  });
});
