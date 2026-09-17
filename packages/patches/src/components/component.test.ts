import { applyOps, resolveNodePorts } from "@sonobe/core";
import type { Op, SonobeDocument } from "@sonobe/core";
import { createSpringState, fromBouncinessSpeed, isLoop, makeLoop, stepSpring } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, pointerEvent, runFrames, runPatch, sequenceDefinition, type ComponentInput } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchRegistry } from "../registry.ts";
import { component, notInlinedMessage } from "./component.ts";

const items = (value: unknown) => (isLoop(value) ? value.items : value);

const pressFeedback: ComponentInput = {
  id: "press_feedback",
  name: "Press Feedback",
  kind: "patchComponent",
  inputs: { depth: { type: "number", default: 0.95 }, down: { type: "boolean", default: false } },
  outputs: { scale: { type: "number", link: "shrink.output" } },
  patches: {
    pop: { type: "popAnimation", inputs: { number: { link: "$in.down" }, bounciness: 0, speed: 20 } },
    shrink: { type: "transition", typeParam: "number", inputs: { progress: { link: "pop.output" }, start: 1, end: { link: "$in.depth" } } },
  },
};

describe("component: definition", () => {
  it("derives ports from the component's published interface", () => {
    const doc = buildDoc({ components: [pressFeedback] });
    const ports = component.dynamicPorts!({ type: "component", component: "press_feedback", inputs: {}, ui: { x: 0, y: 0 } }, doc);
    expect(ports.inputs.map((p) => [p.key, p.type, p.default])).toEqual([
      ["depth", "number", 0.95],
      ["down", "boolean", false],
    ]);
    expect(ports.outputs.map((p) => [p.key, p.type])).toEqual([["scale", "number"]]);
    expect(component.dynamicPorts!({ type: "component", component: "missing", inputs: {}, ui: { x: 0, y: 0 } }, doc)).toEqual({ inputs: [], outputs: [] });
  });

  it("is a real, implemented definition in the patch registry", () => {
    const registry = createPatchRegistry();
    expect(registry.definitions.get("component")).toBe(component);
    expect(registry.isImplemented("component")).toBe(true);
    const doc = buildDoc({ components: [pressFeedback] });
    expect(resolveNodePorts(doc, { type: "component", component: "press_feedback", inputs: {}, ui: { x: 0, y: 0 } }, registry)!.outputs.map((p) => p.key)).toEqual(["scale"]);
  });

  it("outputs zero values and explains once when a host evaluates it directly", () => {
    const doc = buildDoc({ components: [pressFeedback] });
    const r = runPatch(component, [{}, {}], { id: "save_press", component: "press_feedback", doc });
    expect(r.frames.map((f) => f.outputs.scale)).toEqual([0, 0]);
    expect(r.logs).toEqual([{ level: "warn", args: [notInlinedMessage("save_press")] }]);
    expect(r.issues).toEqual([]);
  });
});

describe("component: in the runtime", () => {
  it("reuses one press effect on two buttons, each instance with its own spring", () => {
    const doc = buildDoc({
      components: [pressFeedback],
      layers: [
        { id: "save_button", type: "rectangle", name: "Save Button", props: { position: [24, 720], size: [160, 56], scale: { link: "save_press.scale" } } },
        { id: "cancel_button", type: "rectangle", name: "Cancel Button", props: { position: [218, 720], size: [160, 56], scale: { link: "cancel_press.scale" } } },
      ],
      patches: {
        touch_save: { type: "interaction", inputs: { layer: { layer: "save_button" } } },
        touch_cancel: { type: "interaction", inputs: { layer: { layer: "cancel_button" } } },
        save_press: { type: "component", component: "press_feedback", inputs: { down: { link: "touch_save.down" } } },
        cancel_press: { type: "component", component: "press_feedback", inputs: { down: { link: "touch_cancel.down" }, depth: 0.9 } },
      },
    });
    const rt = createTestRuntime(doc, [component]);
    const save: number[] = [];
    const cancel: number[] = [];
    for (let frame = 0; frame < 90; frame++) {
      runFrames(rt, 1, frame === 1 ? [[pointerEvent("down", 100, 745)]] : undefined);
      save.push(rt.getValue("@save_button.scale") as number);
      cancel.push(rt.getValue("@cancel_button.scale") as number);
    }
    const config = fromBouncinessSpeed(0, 20);
    const spring = createSpringState(0);
    save.forEach((scale, frame) => {
      spring.target = frame >= 1 ? 1 : 0;
      stepSpring(spring, config, frame === 0 ? 0 : 1 / 60);
      expect(scale).toBeCloseTo(1 + (0.95 - 1) * spring.value, 9);
    });
    expect(save.at(-1)).toBeCloseTo(0.95, 3);
    expect(cancel.every((s) => s === 1)).toBe(true);
    expect(rt.issues()).toEqual([]);
  });

  it("loops the component: one copy per item, each remembering its own state", () => {
    const likeToggle: ComponentInput = {
      id: "like_toggle",
      kind: "patchComponent",
      inputs: { tap: { type: "pulse", loopBehavior: "loop" } },
      outputs: { liked: { type: "boolean", link: "toggle.on" } },
      patches: { toggle: { type: "switch", inputs: { flip: { link: "$in.tap" } } } },
    };
    const taps = sequenceDefinition("taps", "pulse", [makeLoop([false, true, false]), makeLoop([false, false, false]), makeLoop([true, true, false])]);
    const registry = createMockRegistry([component, taps]);
    const doc = buildDoc({ components: [likeToggle], patches: { src: { type: "taps" }, like: { type: "component", component: "like_toggle", inputs: { tap: { link: "src.value" } } } } }, registry);
    const rt = createTestRuntime(doc, registry);
    const frames: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      rt.step();
      frames.push(items(rt.getRawValue("like.liked")));
    }
    expect(frames).toEqual([[false, true, false], [false, true, false], [true, false, false]]);
  });

  it("passes the first published input of the same type through while muted", () => {
    const doubler: ComponentInput = {
      id: "doubler",
      kind: "patchComponent",
      inputs: { x: { type: "number", default: 3 } },
      outputs: { y: { type: "number", link: "mul.output" } },
      patches: { mul: { type: "multiply", inputs: { a: { link: "$in.x" }, b: 2 } } },
    };
    const doc = buildDoc({ components: [doubler], patches: { d: { type: "component", component: "doubler", muted: true, inputs: { x: 7 } } } });
    const rt = createTestRuntime(doc, [component]);
    rt.step();
    expect(rt.getValue("d.y")).toBe(7);
  });

  it("makes an instance of a missing component inert, with an issue and default readers", () => {
    const doubler: ComponentInput = {
      id: "doubler",
      kind: "patchComponent",
      inputs: { x: { type: "number", default: 3 } },
      outputs: { y: { type: "number", link: "mul.output" } },
      patches: { mul: { type: "multiply", inputs: { a: { link: "$in.x" }, b: 2 } } },
    };
    const doc = structuredClone(buildDoc({ components: [doubler], patches: { d: { type: "component", component: "doubler" }, out: { type: "multiply", inputs: { a: { link: "d.y" }, b: 10 } } } }));
    doc.components.main!.patches.d!.component = "gone";
    const rt = createTestRuntime(doc, [component]);
    rt.step();
    expect(rt.issues().map((i) => i.code)).toContain("component_not_found");
    expect(rt.getValue("out.output")).toBe(10);
  });

  it("runs component instances with scripts through the real patch registry", () => {
    const source = `export const inputs = [{ key: "name", type: "text" }, { key: "tap", type: "pulse" }];
export const outputs = [{ key: "greeting", type: "text" }];
let taps = 0;
export function evaluate(patch) { if (patch.pulsed("tap")) taps++; patch.output("greeting", \`Hi \${patch.input("name")} (\${taps})\`); }`;
    const registry = createPatchRegistry({ definitions: [sequenceDefinition("names", "text", [makeLoop(["Ada", "Grace"])]), sequenceDefinition("pings", "pulse", [makeLoop([true, false]), makeLoop([true, true])])] });
    const ops: Op[] = [
      { op: "addComponent", component: { id: "greeter", name: "Greeter", kind: "patchComponent" } },
      { op: "updateInterface", component: "greeter", inputs: { name: { key: "name", name: "Name", type: "text" }, tap: { key: "tap", name: "Tap", type: "pulse" } } },
      { op: "setScript", file: "greet.js", source },
      { op: "addPatch", component: "greeter", patch: { id: "js", type: "javascript", settings: { script: "greet.js" } } },
      { op: "connect", component: "greeter", from: "$in.name", to: "js.name" },
      { op: "connect", component: "greeter", from: "$in.tap", to: "js.tap" },
      { op: "updateInterface", component: "greeter", outputs: { greeting: { key: "greeting", name: "Greeting", type: "text", link: "js.greeting" } } },
      { op: "addPatch", patch: { id: "names", type: "names" } },
      { op: "addPatch", patch: { id: "pings", type: "pings" } },
      { op: "addPatch", patch: { id: "hello", type: "component", component: "greeter" } },
      { op: "connect", from: "names.value", to: "hello.name" },
      { op: "connect", from: "pings.value", to: "hello.tap" },
    ];
    const base: SonobeDocument = buildDoc({}, registry);
    const result = applyOps(base, ops, { registry });
    expect(result.errors).toEqual([]);
    const rt = createTestRuntime(result.doc, registry);
    runFrames(rt, 2);
    expect(items(rt.getRawValue("hello.greeting"))).toEqual(["Hi Ada (2)", "Hi Grace (1)"]);
    expect(rt.issues()).toEqual([]);
  });
});
