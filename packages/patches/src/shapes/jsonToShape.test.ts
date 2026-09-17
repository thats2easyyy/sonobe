import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { buildJsonShape, jsonToShape } from "./jsonToShape.ts";

const build = (json: unknown, space: [number, number] = [1, 1]) => buildJsonShape(json, space);

describe("jsonToShape", () => {
  it("draws the default triangle", () => {
    const h = createPatchHarness(jsonToShape);
    expect(h.step().outputs).toEqual({ shape: { path: "M50 0 L100 100 L0 100 Z" }, error: false, errorMessage: "" });
  });

  it("scales every point by Coordinate Space", () => {
    const json = { path: [{ type: "moveTo", point: [0.2, 0.55] }, { type: "lineTo", point: [0.42, 0.75] }, { type: "lineTo", point: [0.8, 0.3] }] };
    const h = createPatchHarness(jsonToShape, { inputs: { json, coordinateSpace: [64, 64] } });
    expect(h.step().outputs.shape).toEqual({ path: "M12.8 35.2 L26.88 48 L51.2 19.2" });
    expect(build({ path: [{ type: "moveTo", point: { x: 10, y: 5 } }, { type: "lineTo", point: [20, 5] }] }, [-1, 0]).shape).toEqual({ path: "M-10 0 L-20 0" });
  });

  it("accepts a bare list of commands and matches types case-insensitively", () => {
    expect(build([{ type: "MOVETO", point: [1, 2] }, { type: "lineto", point: ["3", "4.5"] }, { type: "ClosePath" }])).toEqual({
      shape: { path: "M1 2 L3 4.5 Z" },
      error: false,
      errorMessage: "",
    });
  });

  it("reads curveTo with control1 and control2, or Origami's curveFrom / point / curveTo layout", () => {
    const start = { type: "moveTo", point: [0, 0] };
    expect(build({ path: [start, { type: "curveTo", point: [30, 0], control1: [10, 10], control2: [20, 10] }] }).shape).toEqual({ path: "M0 0 C10 10 20 10 30 0" });
    expect(build({ path: [start, { type: "curveTo", curveTo: { x: 30, y: 0 }, curveFrom: { x: 10, y: 10 }, point: { x: 20, y: 10 } }] }).shape).toEqual({
      path: "M0 0 C10 10 20 10 30 0",
    });
  });

  it("parses JSON text", () => {
    expect(build('{"path":[{"type":"moveTo","point":[1,2]},{"type":"lineTo","point":[3,4]}]}').shape).toEqual({ path: "M1 2 L3 4" });
    const broken = build('{"path": [');
    expect(broken.shape).toEqual({ path: "" });
    expect(broken.error).toBe(true);
    expect(broken.errorMessage.startsWith("The JSON couldn't be read: ")).toBe(true);
  });

  it("outputs the empty shape without an error for null, empty text, or an empty list", () => {
    expect(build(null)).toEqual({ shape: { path: "" }, error: false, errorMessage: "" });
    expect(build("  ")).toEqual({ shape: { path: "" }, error: false, errorMessage: "" });
    expect(build({ path: [] })).toEqual({ shape: { path: "" }, error: false, errorMessage: "" });
  });

  it("stops at the first invalid command and names it", () => {
    expect(build(5).errorMessage).toBe('Expected an object with a "path" list of commands.');
    expect(build({ foo: 1 }).errorMessage).toBe('Expected an object with a "path" list of commands.');
    expect(build({ path: [{ type: "lineTo", point: [1, 1] }] }).errorMessage).toBe("Command 1 (lineTo): start the path with moveTo first.");
    expect(build({ path: [{ type: "arc" }] }).errorMessage).toBe("Command 1 (arc): unknown type. Use moveTo, lineTo, curveTo, or closePath.");
    expect(build({ path: ["nope"] }).errorMessage).toBe("Command 1: unknown type. Use moveTo, lineTo, curveTo, or closePath.");
    const badPoint = build({ path: [{ type: "moveTo", point: [0, 0] }, { type: "lineTo", point: { x: "a", y: 1 } }, { type: "lineTo", point: [5, 5] }] });
    expect(badPoint).toEqual({ shape: { path: "M0 0" }, error: true, errorMessage: 'Command 2 (lineTo): needs a "point" with numeric x and y.' });
    expect(build({ path: [{ type: "moveTo", point: [0, 0] }, { type: "curveTo", point: [1, 1] }] }).errorMessage).toBe(
      'Command 2 (curveTo): needs "control1", "control2", and "point" points.',
    );
    expect(build({ path: [{ type: "moveTo", point: [0, 0] }, { type: "curveTo", curveTo: [1, 1] }] }).errorMessage).toBe(
      'Command 2 (curveTo): needs "curveFrom", "point", and "curveTo" points.',
    );
    expect(build({ path: [{ type: "moveTo", point: [1e308, 0] }] }, [10, 1]).errorMessage).toBe('Command 1 (moveTo): needs a "point" with numeric x and y.');
  });

  it("draws at most 100,000 commands", () => {
    const path = Array.from({ length: 100_001 }, (_, i) => ({ type: "moveTo", point: [i % 10, 0] }));
    const result = build({ path });
    expect(result.error).toBe(true);
    expect(result.errorMessage).toBe("Only the first 100,000 commands are drawn.");
    expect(result.shape.path.split("M")).toHaveLength(100_001);
  });

  it("reuses its result while inputs stay the same", () => {
    const h = createPatchHarness(jsonToShape, { inputs: { json: { path: [{ type: "moveTo", point: [1, 1] }] } } });
    const first = h.step().outputs.shape;
    expect(h.step().outputs.shape).toBe(first);
    h.set({ coordinateSpace: [2, 2] });
    expect(h.step().outputs.shape).toEqual({ path: "M2 2" });
  });

  it("evaluates per loop index", () => {
    const h = createPatchHarness(jsonToShape, { inputs: { json: loopOf([{ path: [{ type: "moveTo", point: [1, 1] }] }, "{"]) } });
    const frame = h.step();
    expect(frame.outputs.shape).toEqual(loopOf([{ path: "M1 1" }, { path: "" }]));
    expect(frame.outputs.error).toEqual(loopOf([false, true]));
  });
});
