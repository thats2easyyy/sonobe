import { describe, expect, it } from "vitest";
import { activeVariant, camelCaseName, headerPortSpecs, readScriptHeader, titleCaseKey } from "./header.ts";

const read = (source: string, file = "test.js") => readScriptHeader(source, file);
const errorOf = (source: string): string => {
  try {
    read(source);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected the header to fail");
};

describe("readScriptHeader: native scripts", () => {
  it("reads literal port lists without running the script", () => {
    const header = read(`// Counter label
"use strict";
export const inputs = [
  { key: "count", name: "Count", type: "number", default: 3, min: 0, step: 1 },
  { key: "reset", type: "pulse" }, // trailing comment
];
export const outputs = [{ key: "label", type: "text", description: 'The text.' }]
export const alwaysEvaluate = true;
throw new Error("never runs");
export function evaluate(patch) {}`);
    expect(header.mode).toBe("native");
    expect(header.alwaysEvaluate).toBe(true);
    expect(header.inputs.map((p) => [p.key, p.name, p.type, p.default])).toEqual([
      ["count", "Count", "number", 3],
      ["reset", "Reset", "pulse", undefined],
    ]);
    const specs = headerPortSpecs(header, undefined);
    expect(specs.inputs[0]).toMatchObject({ key: "count", type: "number", default: 3, min: 0, step: 1 });
    expect(specs.inputs[1]).not.toHaveProperty("default");
    expect(specs.outputs[0]).toEqual({ key: "label", name: "Label", type: "text", description: "The text." });
  });

  it("fills names, zero defaults, enum options, colors, and loop defaults", () => {
    const header = read(`export const inputs = [
  { key: "itemCount", type: "number" },
  { key: "max_speed", type: "number" },
  { key: "tint", type: "color", default: "#f00" },
  { key: "size", type: "enum", enumOptions: ["small", { key: "large", name: "Large" }], default: "large" },
  { key: "values", type: "number", wholeLoop: true, default: { loop: [1, 2] } },
  { key: "position", type: "point" },
];
export const outputs = [];`);
    const specs = headerPortSpecs(header, undefined);
    expect(specs.inputs.map((p) => p.name)).toEqual(["Item Count", "Max Speed", "Tint", "Size", "Values", "Position"]);
    expect(specs.inputs.map((p) => p.default)).toEqual([0, 0, "#FF0000FF", "large", { loop: [1, 2] }, [0, 0]]);
    expect(specs.inputs[3]!.enumOptions).toEqual([{ key: "small", name: "small" }, { key: "large", name: "Large" }]);
    expect(header.wholeLoop).toBe(true);
    expect(titleCaseKey("URLPath")).toBe("URL Path");
  });

  it("resolves variant ports to the active variant", () => {
    const header = read(`export const inputs = [{ key: "value", type: "variant", default: 5 }];
export const outputs = [{ key: "output", type: "variant" }];
export const variants = ["number", "point"];`);
    expect(activeVariant(header, undefined)).toBe("number");
    expect(activeVariant(header, "point")).toBe("point");
    expect(activeVariant(header, "color")).toBe("number");
    expect(headerPortSpecs(header, "point").inputs[0]).toMatchObject({ type: "point", default: [0, 0] });
    expect(headerPortSpecs(header, undefined).inputs[0]).toMatchObject({ type: "number", default: 5 });
  });

  it("gives scripts with no header no ports", () => {
    expect(read("export function evaluate() {}")).toMatchObject({ inputs: [], outputs: [], variants: null, alwaysEvaluate: false });
    expect(read("")).toMatchObject({ inputs: [], outputs: [] });
  });

  it("reports problems with a file, line, and column", () => {
    expect(errorOf("export const inputs = [{ key: 'a', type: 'number', default: SIZE }];")).toBe("scripts/test.js:1:61 Write the port list as plain values. SIZE at line 1 isn't allowed here.");
    expect(errorOf("const x = 1;\nexport const inputs = [];")).toBe("scripts/test.js:2:1 Move export const inputs above the other code so Sonobe can read the ports without running the script.");
    expect(errorOf("export const inputs = [{ key: 'a', type: 'any' }];")).toMatch(/:1:42 "any" isn't a port type\. Use "json"/);
    expect(errorOf("export const inputs = [{ key: 'a', type: 'numbr' }];")).toMatch(/Did you mean "number"\?/);
    expect(errorOf("export const inputs = [{ key: 'a', type: 'number', nmae: 'A' }];")).toMatch(/"nmae" isn't a port field\. Did you mean "name"/);
    expect(errorOf("export const inputs = [{ key: 'a', type: 'number' }];\nexport const outputs = [{ key: 'a', type: 'text' }];")).toMatch(/The key "a" is used twice/);
    expect(errorOf("export const inputs = [{ key: 'mode', type: 'enum' }];")).toMatch(/needs enumOptions/);
    expect(errorOf("export const inputs = [{ key: 'v', type: 'variant' }];")).toMatch(/needs export const variants/);
    expect(errorOf("export const variants = ['number'];\nexport const inputs = [{ key: 'v', type: 'variant' }];")).toMatch(/at least 2 types/);
    expect(errorOf("export const inputs = [{ key: 'tap', type: 'pulse', default: true }];")).toMatch(/Pulse ports don't take a default/);
    expect(errorOf("export const inputs = [{ key: 'a', type: 'number', min: 5, max: 1 }];")).toMatch(/min \(5\) is larger than max \(1\)/);
    expect(errorOf("export const inputs = [{ key: 'c', type: 'color', default: 'red-ish' }];")).toMatch(/doesn't fit its type color/);
    expect(errorOf("export const inputs = [{ key: `a${1}`, type: 'number' }];")).toMatch(/plain values/);
    expect(errorOf("export const inputs = [{ key: 'a', type: 'number' }] .map(x => x);")).toMatch(/plain values/);
    expect(errorOf("export const inputs = [{ key: '1a', type: 'number' }];")).toMatch(/starts with a letter/);
    expect(errorOf("export const inputs = [{ type: 'number' }];")).toMatch(/needs a key/);
    expect(errorOf(`export const inputs = [${Array.from({ length: 33 }, (_, i) => `{ key: "k${i}", type: "number" }`).join(",")}];`)).toMatch(/at most 32 inputs/);
  });

  it("tolerates code after the header that the tokenizer handles, including regexes and templates", () => {
    const header = read(`export const inputs = [{ key: "text", type: "text" }];
export const outputs = [{ key: "words", type: "number" }];
const splitter = /\\s+/g;
const note = \`words: \${1 + 1} { not a brace }\`;
export function evaluate(patch) { patch.output("words", patch.input("text").split(splitter).length); }`);
    expect(header.outputs.map((p) => p.key)).toEqual(["words"]);
  });

  it("memoizes by file and source", () => {
    const source = "export const inputs = [{ key: 'a', type: 'number' }];";
    expect(read(source, "one.js")).toBe(read(source, "one.js"));
    expect(read(source, "two.js")).not.toBe(read(source, "one.js"));
  });
});

describe("readScriptHeader: Origami-style scripts", () => {
  it("reads PatchInput and PatchOutput lists with derived keys", () => {
    const header = read(`var patch = new Patch();
patch.inputs = [
  new PatchInput("Email Address", types.STRING, "a@b.c"),
  new PatchInput("", types.NUMBER),
  new PatchInput("Position", types.POSITION, { x: 10, y: 20 }),
  new PatchInput("3D Size", types.INTEGER, 2),
  new PatchInput("Tint", types.COLOR, { x: 1, y: 0, z: 0, w: 1 }),
  new PatchInput("Choice", types.ENUM, 1),
];
patch.outputs = [new PatchOutput("Done", types.PULSE), new PatchOutput("Email Address", types.BOOLEAN)];
patch.loopAware = true;
patch.alwaysNeedsToEvaluate = true;
patch.evaluate = function () {};
return patch;`);
    expect(header.mode).toBe("compat");
    expect(header.alwaysEvaluate).toBe(true);
    expect(header.wholeLoop).toBe(true);
    expect(header.inputs.map((p) => [p.key, p.name, p.type, p.default])).toEqual([
      ["emailAddress", "Email Address", "text", "a@b.c"],
      ["input2", "Input 2", "number", undefined],
      ["position", "Position", "point", [10, 20]],
      ["port3dSize", "3D Size", "number", 2],
      ["tint", "Tint", "color", "#FF0000FF"],
      ["choice", "Choice", "index", 1],
    ]);
    expect(header.inputs[3]!.step).toBe(1);
    expect(header.outputs.map((p) => [p.key, p.type])).toEqual([
      ["done", "pulse"],
      ["output2", "boolean"],
    ]);
    expect(camelCaseName("URL Path")).toBe("urlPath");
  });

  it("reads variants and reports bad type constants", () => {
    const header = read(`const p = new Patch();
p.inputs = [new PatchInput("Value", types.VARIANT)];
p.outputs = [new PatchOutput("Output", types.VARIANT)];
p.variants = [types.NUMBER, types.POSITION];
return p;`);
    expect(header.variants).toEqual(["number", "point"]);
    expect(header.origamiVariants).toEqual(["NUMBER", "POSITION"]);
    expect(errorOf("var patch = new Patch();\npatch.inputs = [new PatchInput('A', types.NUMBR)];\nreturn patch;")).toMatch(/types\.NUMBR isn't a port type\. Did you mean "NUMBER"\?/);
  });
});
