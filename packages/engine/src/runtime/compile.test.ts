import { describe, expect, it } from "vitest";
import { buildDoc, createMockRegistry, createTestRuntime, defineMock, port, sequenceDefinition, type ComponentInput } from "../testing/index.ts";
import { createEngineRegistry } from "./builtins.ts";
import { compileDocument } from "./compile.ts";

const registry = createMockRegistry();

function values(rt: ReturnType<typeof createTestRuntime>, frames: number, addresses: string[]): unknown[][] {
  const out: unknown[][] = [];
  for (let i = 0; i < frames; i++) {
    rt.step();
    out.push(addresses.map((a) => rt.getValue(a)));
  }
  return out;
}

describe("compile: topological order", () => {
  it("evaluates a chain in dependency order regardless of ids, in one frame", () => {
    const doc = buildDoc({
      patches: {
        a_out: { type: "multiply", inputs: { a: { link: "m_mid.output" }, b: 3 } },
        m_mid: { type: "add", inputs: { value1: { link: "z_src.output" }, value2: 1 } },
        z_src: { type: "splitter", inputs: { value: 4 } },
      },
    });
    expect(compileDocument(doc, registry).order.map((n) => n.id)).toEqual(["z_src", "m_mid", "a_out"]);
    const rt = createTestRuntime(doc);
    rt.step();
    expect(rt.getValue("a_out.output")).toBe(15);
    expect(rt.issues()).toEqual([]);
  });

  it("closes a cycle with exactly one frame of latency", () => {
    const doc = buildDoc({
      patches: {
        acc: { type: "add", inputs: { value1: { link: "hold.output" }, value2: 1 } },
        hold: { type: "splitter", inputs: { value: { link: "acc.output" } } },
      },
    });
    const rt = createTestRuntime(doc);
    expect(values(rt, 4, ["acc.output", "hold.output"])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
  });

  it("breaks cycles at Delay One Frame and reads its port default on frame 0", () => {
    const doc = buildDoc({
      patches: {
        sum: { type: "add", inputs: { value1: { link: "z_delay.output" }, value2: 1 } },
        z_delay: { type: "delay1", inputs: { value: { link: "sum.output" } } },
      },
    });
    const graph = compileDocument(doc, registry);
    expect(graph.order.map((n) => n.id)).toEqual(["z_delay", "sum"]);
    expect(graph.order[0]!.feedback).toEqual([true]);
    const rt = createTestRuntime(doc);
    expect(values(rt, 3, ["z_delay.output", "sum.output"])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it("delay1 outside a cycle delays by one frame and seeds with the first value", () => {
    const seq = sequenceDefinition("seq", "number", [5, 7, 7, 9, 9]);
    const reg = createMockRegistry([seq]);
    const doc = buildDoc({ patches: { src: { type: "seq" }, d: { type: "delay1", inputs: { value: { link: "src.value" } } } } }, reg);
    const rt = createTestRuntime(doc, reg);
    expect(values(rt, 5, ["d.output"]).flat()).toEqual([5, 5, 7, 7, 9]);
    expect(rt.needsNextFrame).toBe(false);
  });

  it("a feedback loop that keeps changing requests the next frame, whether Delay One Frame or a plain cable closes it", () => {
    const needs = (rt: ReturnType<typeof createTestRuntime>, frames: number, address: string) => {
      const out: [unknown, boolean][] = [];
      for (let i = 0; i < frames; i++) {
        rt.step();
        out.push([rt.getValue(address), rt.needsNextFrame]);
      }
      return out;
    };
    const accumulator = buildDoc({
      patches: {
        acc: { type: "add", inputs: { value1: { link: "d.output" }, value2: 1 } },
        d: { type: "delay1", inputs: { value: { link: "acc.output" } } },
      },
    });
    expect(needs(createTestRuntime(accumulator), 4, "acc.output")).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, true],
    ]);
    const cycle = buildDoc({
      patches: {
        acc: { type: "add", inputs: { value1: { link: "hold.output" }, value2: 1 } },
        hold: { type: "splitter", inputs: { value: { link: "acc.output" } } },
      },
    });
    expect(needs(createTestRuntime(cycle), 3, "acc.output")).toEqual([
      [1, true],
      [2, true],
      [3, true],
    ]);
  });

  it("a feedback loop settles once its back-edge reads stop changing", () => {
    const minimum = defineMock({
      type: "minimum",
      name: "Minimum",
      inputs: [port("a", "number", { default: 0 }), port("b", "number", { default: 0 })],
      outputs: [port("output", "number")],
      evaluate(ctx) {
        ctx.output("output", Math.min(ctx.input<number>("a"), ctx.input<number>("b")));
      },
    });
    const reg = createMockRegistry([minimum]);
    const doc = buildDoc(
      {
        patches: {
          acc: { type: "add", inputs: { value1: { link: "d.output" }, value2: 1 } },
          clamp: { type: "minimum", inputs: { a: { link: "acc.output" }, b: 3 } },
          d: { type: "delay1", inputs: { value: { link: "clamp.output" } } },
        },
      },
      reg,
    );
    const rt = createTestRuntime(doc, reg);
    const rows: [unknown, boolean][] = [];
    for (let i = 0; i < 6; i++) {
      rt.step();
      rows.push([rt.getValue("clamp.output"), rt.needsNextFrame]);
    }
    expect(rows).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [3, false],
      [3, false],
      [3, false],
    ]);
  });

  it("rejects a direct self-edge with an issue and uses the port default", () => {
    const doc = structuredClone(buildDoc({ patches: { a: { type: "add", inputs: { value2: 2 } } } }));
    doc.components.main!.patches.a!.inputs.value1 = { link: "a.output" };
    const rt = createTestRuntime(doc);
    rt.step();
    rt.step();
    expect(rt.issues().map((i) => i.code)).toContain("self_edge");
    expect(rt.getValue("a.output")).toBe(2);
  });
});

describe("compile: issues", () => {
  it("unknown types, unimplemented specs and dangling links raise issues and keep defaults", () => {
    const specOnly = { type: "specOnly", name: "Spec Only", category: "utility" as const, summary: "No evaluator.", inputs: [], outputs: [port("output", "number", { default: 7 })] };
    const reg = createEngineRegistry(createMockRegistry().definitions.values(), { specs: [specOnly] });
    const doc = structuredClone(
      buildDoc({ patches: { only: { type: "specOnly" }, use: { type: "multiply", inputs: { a: { link: "only.output" }, b: 2 } } } }, reg),
    );
    doc.components.main!.patches.ghost = { type: "ghost", inputs: {}, ui: { x: 0, y: 0 } };
    doc.components.main!.patches.lost = { type: "multiply", inputs: { a: { link: "nope.output" } }, ui: { x: 0, y: 0 } };
    const rt = createTestRuntime(doc, reg);
    rt.step();
    const codes = rt.issues().map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["unimplemented_patch", "unknown_patch_type", "dangling_link"]));
    expect(rt.getValue("only.output")).toBe(7);
    expect(rt.getValue("use.output")).toBe(14);
    expect(rt.getValue("lost.output")).toBe(1);
  });

  it("a patch that throws raises one issue and keeps its last outputs", () => {
    let calls = 0;
    const flaky = sequenceDefinition("flaky", "number", [3]);
    flaky.evaluate = (ctx) => {
      calls++;
      if (ctx.frame === 1) throw new Error("boom");
      ctx.output("value", ctx.frame + 10);
    };
    const reg = createMockRegistry([flaky]);
    const rt = createTestRuntime(buildDoc({ patches: { f: { type: "flaky" } } }, reg), reg);
    const seen = values(rt, 3, ["f.value"]).flat();
    expect(calls).toBe(3);
    expect(seen).toEqual([10, 10, 12]);
    expect(rt.issues().filter((i) => i.code === "patch_threw")).toHaveLength(1);
  });
});

describe("compile: back-edge selection (core's feedback rule)", () => {
  const place = (doc: ReturnType<typeof buildDoc>, positions: Record<string, number>) => {
    const next = structuredClone(doc);
    for (const [id, x] of Object.entries(positions)) next.components.main!.patches[id]!.ui = { x, y: 0 };
    return next;
  };

  it("a visually backwards cable reads the previous frame, whatever the ids", () => {
    const doc = place(
      buildDoc({
        patches: {
          a_second: { type: "add", inputs: { value1: { link: "z_first.output" }, value2: 1 } },
          z_first: { type: "splitter", inputs: { value: { link: "a_second.output" } } },
        },
      }),
      { z_first: 0, a_second: 200 },
    );
    const graph = compileDocument(doc, registry);
    expect(graph.order.map((n) => [n.id, n.feedback])).toEqual([
      ["z_first", [true]],
      ["a_second", [false, false]],
    ]);
    const rt = createTestRuntime(doc);
    expect(values(rt, 2, ["z_first.output", "a_second.output"])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("in the same column, the cable into the lowest target id reads the previous frame", () => {
    const doc = place(
      buildDoc({
        patches: {
          c_split: { type: "splitter", inputs: { value: { link: "b_add.output" } } },
          b_add: { type: "add", inputs: { value1: { link: "c_split.output" }, value2: 1 } },
        },
      }),
      { c_split: 0, b_add: 0 },
    );
    expect(compileDocument(doc, registry).order.map((n) => [n.id, n.feedback])).toEqual([
      ["b_add", [true, false]],
      ["c_split", [false]],
    ]);
  });

  it("edges into Delay One Frame win over visually backwards cables", () => {
    const doc = place(
      buildDoc({
        patches: {
          sum: { type: "add", inputs: { value1: { link: "d.output" }, value2: 1 } },
          d: { type: "delay1", inputs: { value: { link: "sum.output" } } },
        },
      }),
      { sum: 0, d: 600 },
    );
    expect(compileDocument(doc, registry).order.map((n) => [n.id, n.feedback])).toEqual([
      ["d", [true]],
      ["sum", [false, false]],
    ]);
  });

  it("patches inside a component are placed where their component patch sits", () => {
    const doubler: ComponentInput = {
      id: "doubler",
      kind: "patchComponent",
      inputs: { x: { type: "number", default: 3 } },
      outputs: { y: { type: "number", link: "mul.output" } },
      patches: { mul: { type: "multiply", inputs: { a: { link: "$in.x" }, b: 2 } } },
    };
    const doc = buildDoc({
      components: [doubler],
      patches: {
        acc: { type: "add", inputs: { value1: { link: "dbl.y" }, value2: 1 } },
        dbl: { type: "component", component: "doubler", inputs: { x: { link: "acc.output" } } },
      },
    });
    // Default placement puts acc left of dbl: the cable back into acc reads the previous frame.
    expect(values(createTestRuntime(doc), 3, ["acc.output"]).flat()).toEqual([1, 3, 7]);
    // Moving the component patch to the left makes the cable into it the backwards one.
    expect(values(createTestRuntime(place(doc, { dbl: 0, acc: 400 })), 3, ["acc.output"]).flat()).toEqual([7, 15, 31]);
  });
});
