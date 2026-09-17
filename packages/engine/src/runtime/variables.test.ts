import { describe, expect, it } from "vitest";
import { buildDoc, createTestRuntime, type ComponentInput } from "../testing/index.ts";

describe("variables", () => {
  it("a local broadcaster reaches receivers in the same graph on the same frame", () => {
    const rt = createTestRuntime(
      buildDoc({
        patches: {
          use: { type: "multiply", inputs: { a: { link: "r.output" }, b: 2 } },
          r: { type: "variableReceiver", settings: { name: "progress" } },
          b: { type: "variableBroadcaster", settings: { name: " progress " }, inputs: { value: { link: "src.output" } } },
          src: { type: "splitter", inputs: { value: 5 } },
        },
      }),
    );
    rt.step();
    expect(rt.getValue("r.output")).toBe(5);
    expect(rt.getValue("use.output")).toBe(10);
    expect(rt.issues()).toEqual([]);
  });

  it("global variables cascade into components and the nearest broadcaster wins", () => {
    const reader: ComponentInput = {
      id: "reader",
      kind: "patchComponent",
      outputs: { value: { type: "number", link: "r.output" } },
      patches: { r: { type: "variableReceiver", settings: { name: "theme", scope: "global" } } },
    };
    const shadow: ComponentInput = {
      id: "shadow",
      kind: "patchComponent",
      outputs: { value: { type: "number", link: "rd.value" } },
      patches: {
        b: { type: "variableBroadcaster", settings: { name: "theme", scope: "global" }, inputs: { value: 99 } },
        rd: { type: "component", component: "reader" },
      },
    };
    const rt = createTestRuntime(
      buildDoc({
        components: [reader, shadow],
        patches: {
          b0: { type: "variableBroadcaster", settings: { name: "theme", scope: "global" }, inputs: { value: 1 } },
          top: { type: "component", component: "reader" },
          sh: { type: "component", component: "shadow" },
        },
      }),
    );
    rt.step();
    expect(rt.getValue("top.value")).toBe(1);
    expect(rt.getValue("sh.value")).toBe(99);
  });

  it("local variables don't reach into components", () => {
    const reader: ComponentInput = {
      id: "reader",
      kind: "patchComponent",
      outputs: { value: { type: "number", link: "r.output" } },
      patches: { r: { type: "variableReceiver", settings: { name: "theme" } } },
    };
    const rt = createTestRuntime(
      buildDoc({ components: [reader], patches: { b0: { type: "variableBroadcaster", settings: { name: "theme" }, inputs: { value: 4 } }, top: { type: "component", component: "reader" } } }),
    );
    rt.step();
    expect(rt.getValue("top.value")).toBe(0);
    expect(rt.issues().map((i) => i.code)).toContain("unresolved_variable");
  });

  it("type mismatches raise an issue and output the zero value", () => {
    const rt = createTestRuntime(
      buildDoc({
        patches: {
          b: { type: "variableBroadcaster", typeParam: "text", settings: { name: "t" }, inputs: { value: "hi" } },
          r: { type: "variableReceiver", settings: { name: "t" } },
        },
      }),
    );
    rt.step();
    expect(rt.getValue("r.output")).toBe(0);
    expect(rt.issues().map((i) => i.code)).toContain("variable_type_mismatch");
  });

  it("muted broadcasters send zero values", () => {
    const rt = createTestRuntime(
      buildDoc({ patches: { b: { type: "variableBroadcaster", muted: true, settings: { name: "v" }, inputs: { value: 5 } }, r: { type: "variableReceiver", settings: { name: "v" } } } }),
    );
    rt.step();
    expect(rt.getValue("r.output")).toBe(0);
  });

  it("a cycle through a variable reads the previous frame", () => {
    const rt = createTestRuntime(
      buildDoc({
        patches: {
          acc: { type: "add", inputs: { value1: { link: "r.output" }, value2: 1 } },
          b: { type: "variableBroadcaster", settings: { name: "acc" }, inputs: { value: { link: "acc.output" } } },
          r: { type: "variableReceiver", settings: { name: "acc" } },
        },
      }),
    );
    const seen: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      rt.step();
      seen.push(rt.getValue("acc.output"));
    }
    expect(seen).toEqual([1, 2, 3]);
  });
});
