import type { PatchSpec } from "@sonobe/core";
import { describe, expect, it } from "vitest";
import { SPECS } from "../specs.ts";
import { loopOf } from "./loops.ts";
import {
  decodeDefault,
  defaultToInput,
  findSpecPort,
  nodePorts,
  portDefaultLiteral,
  resolvePortDefault,
  resolvePortType,
  variadicIndex,
  variadicKeys,
} from "./ports.ts";

const mock: PatchSpec = {
  type: "mockOption",
  name: "Mock Option",
  category: "state",
  summary: "A mock patch for port helper tests.",
  variants: ["number", "color", "anchor"],
  inputs: [
    { key: "option", name: "Option", type: "index", default: 0, description: "Which option." },
    { key: "value", name: "Value", type: "variant", default: 1, description: "Value." },
    { key: "mode", name: "Mode", type: "enum", enumOptions: [{ key: "fast", name: "Fast" }, { key: "slow", name: "Slow" }], description: "Mode." },
    { key: "data", name: "Data", type: "json", default: { a: [1, "x"] }, description: "Data." },
    { key: "items", name: "Items", type: "variant", default: { loop: [] }, wholeLoop: true, description: "Items." },
  ],
  outputs: [{ key: "output", name: "Output", type: "variant", description: "Out." }],
  variadic: { key: "choice", name: "Choice", type: "variant", default: 0, min: 2, max: 4, defaultCount: 3, startIndex: 0, direction: "outputs", description: "Per option." },
  variantDefaults: { color: { value: "#FF0000FF", choice: "#00FF00FF" } },
};

describe("port helpers", () => {
  it("resolves port types for a variant", () => {
    expect(resolvePortType(mock, "variant", "color")).toBe("color");
    expect(resolvePortType(mock, "variant", "bogus")).toBe("number");
    expect(resolvePortType(mock, "index", "color")).toBe("index");
    expect(resolvePortType({ ...mock, variants: undefined }, "variant")).toBe("any");
  });

  it("expands variadic keys with startIndex and direction", () => {
    expect(variadicKeys(mock)).toEqual(["choice0", "choice1", "choice2"]);
    expect(variadicKeys(mock, 10)).toEqual(["choice0", "choice1", "choice2", "choice3"]);
    expect(variadicKeys(mock, 1)).toEqual(["choice0", "choice1"]);
    expect(variadicKeys({ ...mock, variadic: undefined })).toEqual([]);
    expect(variadicIndex(mock, "choice3")).toBe(3);
    expect(variadicIndex(mock, "choice4")).toBeUndefined();
    expect(variadicIndex(mock, "choice01")).toBeUndefined();
    expect(variadicIndex(mock, "choice")).toBeUndefined();
    expect(findSpecPort(mock, "choice2")).toMatchObject({ direction: "outputs", port: { key: "choice2", name: "Choice 2", type: "variant" } });

    const ports = nodePorts(mock, "color", 2);
    expect(ports.inputs.map((p) => p.key)).toEqual(["option", "value", "mode", "data", "items"]);
    expect(ports.outputs.map((p) => [p.key, p.type, p.variadicIndex])).toEqual([["output", "color", undefined], ["choice0", "color", 1], ["choice1", "color", 2]]);
  });

  it("picks default literals per variant", () => {
    expect(portDefaultLiteral(mock, "value")).toBe(1);
    expect(portDefaultLiteral(mock, "value", "color")).toBe("#FF0000FF");
    expect(portDefaultLiteral(mock, "value", "anchor")).toBeUndefined();
    expect(portDefaultLiteral(mock, "items", "anchor")).toEqual({ loop: [] });
    expect(portDefaultLiteral(mock, "choice2", "color")).toBe("#00FF00FF");
    expect(portDefaultLiteral(mock, "option", "anchor")).toBe(0);
    expect(portDefaultLiteral(mock, "nope")).toBeUndefined();
  });

  it("resolves runtime defaults", () => {
    expect(resolvePortDefault(mock, "value", "color")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(resolvePortDefault(mock, "value", "anchor")).toEqual([0, 0]);
    expect(resolvePortDefault(mock, "mode")).toBe("fast");
    expect(resolvePortDefault(mock, "data")).toEqual({ a: [1, "x"] });
    expect(resolvePortDefault(mock, "items")).toEqual(loopOf([]));
    expect(resolvePortDefault(mock, "option")).toBe(0);
    expect(resolvePortDefault(mock, "nope")).toBeUndefined();
    expect(resolvePortDefault(SPECS.transition!, "end", "point")).toEqual([100, 100]);
    expect(resolvePortDefault(SPECS.transition!, "start", "color")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });

  it("decodes document-encoded defaults", () => {
    expect(defaultToInput(3)).toBe(3);
    expect(defaultToInput({})).toEqual({ json: {} });
    expect(defaultToInput([1, "a"])).toEqual({ json: [1, "a"] });
    expect(defaultToInput({ loop: [1] })).toEqual({ loop: [1] });
    expect(decodeDefault(null, "layer")).toBeNull();
    expect(decodeDefault("#FFFFFF80", "color")).toEqual({ r: 1, g: 1, b: 1, a: 128 / 255 });
    expect(decodeDefault({ loop: [1, 2] }, "number")).toEqual(loopOf([1, 2]));
    expect(decodeDefault(undefined, "point3d")).toEqual([0, 0, 0]);
  });
});
