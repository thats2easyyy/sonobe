/** Mock patch definitions for runtime tests. The real library lives in @sonobe/patches. */

import type { Color, LayerRef, PortSpec, Value, ValueType } from "@sonobe/core";
import { createSpringState, fromBouncinessSpeed, stepSpring, type SpringState } from "../physics/spring.ts";
import { createEngineRegistry } from "../runtime/builtins.ts";
import type { RuntimePatchDefinition } from "../runtime/evaluate.ts";
import { isLoop } from "../runtime/loop.ts";
import type { EngineRegistry, PatchDefinition } from "../types.ts";

/** A port declaration with a derived name and description. */
export function port(key: string, type: ValueType | "variant", extra: Partial<PortSpec> = {}): PortSpec {
  const name = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  return { key, name, type, description: `${name}.`, ...extra };
}

type MockInput<S> = Omit<RuntimePatchDefinition<S>, "category" | "summary"> & Partial<Pick<RuntimePatchDefinition<S>, "category" | "summary">>;

/** Declare a definition with default category and summary. */
export function defineMock<S = undefined>(def: MockInput<S>): RuntimePatchDefinition<S> {
  return { category: "utility", summary: `Mock ${def.name}.`, ...def };
}

export const mockInteraction = defineMock<{ position: [number, number] }>({
  type: "interaction",
  name: "Interaction",
  category: "interaction",
  alwaysEvaluate: true,
  mutedBehavior: "zero",
  inputs: [port("layer", "layer", { default: null }), port("enabled", "boolean", { default: true })],
  outputs: [port("down", "boolean"), port("tap", "pulse"), port("position", "point")],
  state: () => ({ position: [0, 0] }),
  evaluate(ctx) {
    const snap = ctx.services.pointer(ctx.input<LayerRef | null>("layer") ?? null);
    const enabled = ctx.input<boolean>("enabled");
    if (snap.down || snap.ended) ctx.state.position = snap.position;
    ctx.output("down", enabled && snap.down);
    if (enabled && snap.tapped) ctx.pulse("tap");
    ctx.output("position", ctx.state.position);
  },
});

export const mockSwitch = defineMock<{ on: boolean }>({
  type: "switch",
  name: "Switch",
  category: "state",
  mutedBehavior: "zero",
  inputs: [port("flip", "pulse"), port("turnOn", "pulse"), port("turnOff", "pulse")],
  outputs: [port("on", "boolean")],
  state: () => ({ on: false }),
  evaluate(ctx) {
    if (ctx.pulsed("turnOff")) ctx.state.on = false;
    else if (ctx.pulsed("turnOn")) ctx.state.on = true;
    else if (ctx.pulsed("flip")) ctx.state.on = !ctx.state.on;
    ctx.output("on", ctx.state.on);
  },
});

export const mockCounter = defineMock<{ count: number }>({
  type: "counter",
  name: "Counter",
  category: "state",
  inputs: [port("increase", "pulse"), port("decrease", "pulse"), port("jump", "pulse"), port("jumpToNumber", "number", { default: 0 })],
  outputs: [port("count", "number")],
  state: () => ({ count: 0 }),
  evaluate(ctx) {
    if (ctx.pulsed("jump")) ctx.state.count = ctx.input<number>("jumpToNumber");
    else ctx.state.count += (ctx.pulsed("increase") ? 1 : 0) - (ctx.pulsed("decrease") ? 1 : 0);
    ctx.output("count", ctx.state.count);
  },
});

export const mockAdd = defineMock({
  type: "add",
  name: "Add",
  category: "math",
  variants: ["number", "point"],
  variadic: { key: "value", name: "Value", type: "variant", default: 0, min: 2, max: 6, defaultCount: 2, description: "A value to add." },
  inputs: [],
  outputs: [port("output", "variant")],
  evaluate(ctx) {
    if (ctx.typeParam === "point") {
      const total = [0, 0];
      for (let n = 1; n <= ctx.inputCount; n++) {
        const v = ctx.input<number[]>(`value${n}`);
        total[0]! += v[0] ?? 0;
        total[1]! += v[1] ?? 0;
      }
      ctx.output("output", total);
      return;
    }
    let total = 0;
    for (let n = 1; n <= ctx.inputCount; n++) total += ctx.input<number>(`value${n}`);
    ctx.output("output", total);
  },
});

export const mockMultiply = defineMock({
  type: "multiply",
  name: "Multiply",
  category: "math",
  inputs: [port("a", "number", { default: 1 }), port("b", "number", { default: 1 })],
  outputs: [port("output", "number")],
  evaluate(ctx) {
    ctx.output("output", ctx.input<number>("a") * ctx.input<number>("b"));
  },
});

export const mockTransition = defineMock({
  type: "transition",
  name: "Transition",
  category: "animation",
  variants: ["number", "point", "color"],
  variantDefaults: { color: { start: "#FFFFFFFF", end: "#000000FF" } },
  inputs: [port("progress", "number", { default: 0 }), port("start", "variant", { default: 0 }), port("end", "variant", { default: 1 })],
  outputs: [port("output", "variant")],
  evaluate(ctx) {
    const p = ctx.input<number>("progress");
    if (ctx.typeParam === "color") {
      const a = ctx.input<Color>("start");
      const b = ctx.input<Color>("end");
      ctx.output("output", { r: a.r + (b.r - a.r) * p, g: a.g + (b.g - a.g) * p, b: a.b + (b.b - a.b) * p, a: a.a + (b.a - a.a) * p });
    } else if (ctx.typeParam === "point") {
      const a = ctx.input<number[]>("start");
      const b = ctx.input<number[]>("end");
      ctx.output("output", a.map((n, i) => n + ((b[i] ?? 0) - n) * p));
    } else {
      const a = ctx.input<number>("start");
      ctx.output("output", a + (ctx.input<number>("end") - a) * p);
    }
  },
});

export const mockPopAnimation = defineMock<{ spring: SpringState | null }>({
  type: "popAnimation",
  name: "Pop Animation",
  category: "animation",
  alwaysEvaluate: true,
  inputs: [port("number", "number", { default: 0 }), port("bounciness", "number", { default: 5 }), port("speed", "number", { default: 10 })],
  outputs: [port("output", "number")],
  state: () => ({ spring: null }),
  evaluate(ctx) {
    const target = ctx.input<number>("number");
    const spring = (ctx.state.spring ??= createSpringState(target));
    spring.target = target;
    if (!stepSpring(spring, fromBouncinessSpeed(ctx.input<number>("bounciness"), ctx.input<number>("speed")), ctx.dt)) ctx.requestNextFrame();
    ctx.output("output", spring.value);
  },
});

export const mockLoop = defineMock({
  type: "loop",
  name: "Loop",
  category: "loops",
  inputs: [port("count", "number", { default: 3, step: 1 })],
  outputs: [port("index", "index", { wholeLoop: true })],
  evaluate(ctx) {
    const n = Math.max(0, Math.floor(ctx.input<number>("count")));
    ctx.output("index", Array.from({ length: n }, (_, i) => i));
  },
});

export const mockLoopSum = defineMock({
  type: "loopSum",
  name: "Loop Sum",
  category: "loops",
  inputs: [port("loop", "number", { wholeLoop: true, default: { loop: [] } as unknown as Value })],
  outputs: [port("sum", "number")],
  evaluate(ctx) {
    let sum = 0;
    for (const n of ctx.inputItems<number>("loop")) sum += n;
    ctx.output("sum", sum);
  },
});

export const mockWhenPrototypeStarts = defineMock<{ fired: boolean }>({
  type: "whenPrototypeStarts",
  name: "When Prototype Starts",
  category: "state",
  inputs: [],
  outputs: [port("started", "pulse")],
  state: () => ({ fired: false }),
  evaluate(ctx) {
    if (ctx.state.fired) return;
    ctx.state.fired = true;
    ctx.pulse("started");
  },
});

export const mockRestartPrototype = defineMock({
  type: "restartPrototype",
  name: "Restart Prototype",
  inputs: [port("restart", "pulse")],
  outputs: [],
  evaluate(ctx) {
    if (ctx.pulsed("restart") && ctx.frame > 0) ctx.services.restart();
  },
});

export const mockLogger = defineMock({
  type: "logger",
  name: "Logger",
  inputs: [port("value", "any", { default: null })],
  outputs: [],
  evaluate(ctx) {
    if (ctx.frame === 0 || ctx.changed("value")) ctx.services.log("log", ctx.id, ctx.input("value"));
  },
});

export const mockTime = defineMock({
  type: "time",
  name: "Time",
  category: "state",
  alwaysEvaluate: true,
  inputs: [],
  outputs: [port("time", "number"), port("frame", "index")],
  evaluate(ctx) {
    ctx.output("time", ctx.time);
    ctx.output("frame", ctx.frame);
  },
});

export const mockRandom = defineMock<{ value: number | null }>({
  type: "random",
  name: "Random",
  category: "math",
  inputs: [port("randomize", "pulse")],
  outputs: [port("value", "number")],
  state: () => ({ value: null }),
  evaluate(ctx) {
    if (ctx.state.value === null || ctx.pulsed("randomize")) ctx.state.value = ctx.services.random();
    ctx.output("value", ctx.state.value);
  },
});

export const mockVelocity = defineMock<{ previous: number | null; velocity: number }>({
  type: "velocity",
  name: "Velocity",
  category: "animation",
  alwaysEvaluate: true,
  mutedBehavior: "zero",
  inputs: [port("value", "number", { default: 0 })],
  outputs: [port("velocity", "number")],
  state: () => ({ previous: null, velocity: 0 }),
  evaluate(ctx) {
    const v = ctx.input<number>("value");
    if (ctx.state.previous === null) {
      ctx.state.previous = v;
      ctx.state.velocity = 0;
    } else if (ctx.dt > 0) {
      ctx.state.velocity = (v - ctx.state.previous) / ctx.dt;
      ctx.state.previous = v;
    }
    ctx.output("velocity", ctx.state.velocity);
  },
});

export const mockPulseOnChange = defineMock({
  type: "pulseOnChange",
  name: "Pulse on Change",
  category: "state",
  inputs: [port("value", "number", { default: 0 })],
  outputs: [port("changed", "pulse")],
  evaluate(ctx) {
    if (ctx.changed("value")) ctx.pulse("changed");
  },
});

export const mockLayerInfo = defineMock({
  type: "layerInfo",
  name: "Layer Info",
  category: "layers",
  alwaysEvaluate: true,
  mutedBehavior: "zero",
  inputs: [port("layer", "layer", { default: null })],
  outputs: [port("size", "size"), port("position", "point"), port("contentSize", "size"), port("enabled", "boolean")],
  evaluate(ctx) {
    const ref = ctx.input<LayerRef | null>("layer");
    const info = ref ? ctx.services.layerInfo(ref) : undefined;
    ctx.output("size", info ? info.size : [0, 0]);
    ctx.output("position", info ? info.position : [0, 0]);
    ctx.output("contentSize", info ? info.contentSize : [0, 0]);
    ctx.output("enabled", info?.enabled ?? false);
  },
});

export const mockSplitter = defineMock({
  type: "splitter",
  name: "Splitter",
  variants: ["number", "boolean", "text", "color", "point", "size", "json", "layer"],
  inputs: [port("value", "variant", { default: 0 })],
  outputs: [port("output", "variant")],
  evaluate(ctx) {
    ctx.output("output", ctx.input("value"));
  },
});

/** Every mock definition. */
export const MOCK_DEFINITIONS: readonly RuntimePatchDefinition[] = [
  mockInteraction,
  mockSwitch,
  mockCounter,
  mockAdd,
  mockMultiply,
  mockTransition,
  mockPopAnimation,
  mockLoop,
  mockLoopSum,
  mockWhenPrototypeStarts,
  mockRestartPrototype,
  mockLogger,
  mockTime,
  mockRandom,
  mockVelocity,
  mockPulseOnChange,
  mockLayerInfo,
  mockSplitter,
];

/** A registry of the mocks plus `extra` definitions (which replace mocks of the same type). */
export function createMockRegistry(extra: readonly PatchDefinition[] = []): EngineRegistry {
  const byType = new Map<string, PatchDefinition>();
  for (const def of MOCK_DEFINITIONS) byType.set(def.type, def);
  for (const def of extra) byType.set(def.type, def);
  return createEngineRegistry(byType.values());
}

/**
 * A source patch that outputs `values[frame]` on its `value` output (holding the last entry).
 * With valueType "pulse", `true` fires a one-frame pulse; Loops pass through whole.
 */
export function sequenceDefinition(type: string, valueType: ValueType, values: readonly unknown[]): RuntimePatchDefinition {
  return defineMock({
    type,
    name: `Sequence ${type}`,
    alwaysEvaluate: true,
    inputs: [],
    outputs: [port("value", valueType)],
    evaluate(ctx) {
      if (!values.length) return;
      const v = values[Math.min(ctx.frame, values.length - 1)];
      if (valueType === "pulse" && !isLoop(v)) {
        if (v === true) ctx.pulse("value");
      } else ctx.output("value", v as Value);
    },
  });
}

/**
 * A probe that counts its evaluations per instance × loop index, reports its component path,
 * and records `dispose <path>#<index>` into `log` when its state is dropped.
 */
export function probeDefinition(log: string[], type = "probe"): RuntimePatchDefinition<{ label: string; count: number }> {
  return defineMock<{ label: string; count: number }>({
    type,
    name: "Probe",
    inputs: [port("value", "number", { default: 0 })],
    outputs: [port("count", "number"), port("path", "text"), port("value", "number")],
    state: () => ({ label: "", count: 0 }),
    evaluate(ctx) {
      ctx.state.count += 1;
      ctx.state.label = `${ctx.componentPath}#${ctx.loopIndex}`;
      ctx.output("count", ctx.state.count);
      ctx.output("path", ctx.state.label);
      ctx.output("value", ctx.input<number>("value"));
    },
    dispose(state) {
      log.push(`dispose ${state.label}`);
    },
  });
}
