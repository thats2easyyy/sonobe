import { describe, expect, it } from "vitest";
import { runPatch } from "@sonobe/engine/testing";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { svgPathShape } from "./svgPathShape.ts";

const HEART = "M12,21C12,21,3,15,3,9C3,6,5.5,4,8,4C10,4,11.5,5.5,12,7C12.5,5.5,14,4,16,4C18.5,4,21,6,21,9C21,15,12,21,12,21Z";

function outputs(inputs: Record<string, unknown>) {
  const h = createPatchHarness(svgPathShape, { inputs });
  return h.step().outputs;
}

describe("svgPathShape", () => {
  it("draws the default star as normalized absolute commands", () => {
    expect(outputs({})).toEqual({
      shape: { path: "M50 0 L61.756 33.82 L97.553 34.549 L69.021 56.18 L79.389 90.451 L50 70 L20.611 90.451 L30.979 56.18 L2.447 34.549 L38.244 33.82 Z" },
      error: false,
      errorMessage: "",
    });
  });

  it("fits View Box into Size without stretching", () => {
    expect(outputs({ pathData: HEART, viewBox: [0, 0, 24, 24], size: [48, 48] }).shape).toEqual({
      path: "M24 42 C24 42 6 30 6 18 C6 12 11 8 16 8 C20 8 23 11 24 14 C25 11 28 8 32 8 C37 8 42 12 42 18 C42 30 24 42 24 42 Z",
    });
    expect(outputs({ pathData: "M0 0 L24 12", viewBox: [0, 0, 24, 12], size: [48, 48] }).shape).toEqual({ path: "M0 12 L48 36" });
    expect(outputs({ pathData: "M10 10 L30 30", viewBox: [10, 10, 20, 20], size: [40, 40] }).shape).toEqual({ path: "M0 0 L40 40" });
    expect(outputs({ pathData: "M0 0 A5 5 0 0 1 10 10", viewBox: [0, 0, 10, 10], size: [20, 20] }).shape).toEqual({ path: "M0 0 A10 10 0 0 1 20 20" });
  });

  it("reads pasted SVG markup and its viewBox while View Box is all zeros", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0 L24 24"/><path d="M24 0 L0 24"/></svg>`;
    expect(outputs({ pathData: svg, size: [48, 48] })).toEqual({ shape: { path: "M0 0 L48 48 M48 0 L0 48" }, error: false, errorMessage: "" });
    expect(outputs({ pathData: svg, viewBox: [0, 0, 48, 48], size: [48, 48] }).shape).toEqual({ path: "M0 0 L24 24 M24 0 L0 24" });
  });

  it("reports unsupported markup after any syntax error", () => {
    const svg = `<svg viewBox="0 0 10 10"><circle r="3"/><path d="M0 0 L10 10 L5" transform="rotate(4)"/></svg>`;
    expect(outputs({ pathData: svg, size: [10, 10] })).toEqual({
      shape: { path: "M0 0 L10 10" },
      error: true,
      errorMessage:
        'Path data stops at character 15: expected a number after "L". Only <path> elements are read; flatten other shapes before copying. Transforms in the SVG are ignored; flatten the artwork before copying.',
    });
    expect(outputs({ pathData: "<svg></svg>" })).toEqual({ shape: { path: "" }, error: true, errorMessage: "The SVG has no <path> elements." });
  });

  it("keeps everything before a syntax error and explains where it stopped", () => {
    expect(outputs({ pathData: "M0 0 L10 10 L5" })).toEqual({
      shape: { path: "M0 0 L10 10" },
      error: true,
      errorMessage: 'Path data stops at character 15: expected a number after "L".',
    });
    expect(outputs({ pathData: "M0 0 Q" }).errorMessage).toBe('Path data stops at character 7: expected a number after "Q".');
  });

  it("outputs the empty shape without an error for empty text or a zero Size with View Box", () => {
    expect(outputs({ pathData: "   " })).toEqual({ shape: { path: "" }, error: false, errorMessage: "" });
    expect(outputs({ pathData: "M0 0 L1 1", viewBox: [0, 0, 24, 24], size: [0, 48] })).toEqual({ shape: { path: "" }, error: false, errorMessage: "" });
  });

  it("refuses path text longer than 1,000,000 characters", () => {
    expect(outputs({ pathData: `M0 0${" ".repeat(1_000_000)}` })).toEqual({ shape: { path: "" }, error: true, errorMessage: "Path data is longer than 1,000,000 characters." });
  });

  it("reuses its result while inputs stay the same", () => {
    const h = createPatchHarness(svgPathShape, { inputs: { pathData: "M0 0 L1 1" } });
    const first = h.step().outputs.shape;
    expect(h.step().outputs.shape).toBe(first);
    h.set({ pathData: "M0 0 L2 2" });
    expect(h.step().outputs.shape).toEqual({ path: "M0 0 L2 2" });
  });

  it("evaluates per loop index", () => {
    const h = createPatchHarness(svgPathShape, { inputs: { pathData: loopOf(["M0 0 L1 1", "M2 2 L"]) } });
    const frame = h.step();
    expect(frame.outputs.shape).toEqual(loopOf([{ path: "M0 0 L1 1" }, { path: "M2 2" }]));
    expect(frame.outputs.error).toEqual(loopOf([false, true]));
  });

  it("outputs null, false, and empty text while muted", () => {
    const result = runPatch(svgPathShape, [{ pathData: "M0 0 L10 10" }], { muted: true });
    expect(result.frames[0]!.outputs).toEqual({ shape: null, error: false, errorMessage: "" });
  });
});
