import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { splitParts, splitTextPatch } from "./splitText.ts";

const split = (inputs: Record<string, unknown>) => {
  const frame = createPatchHarness(splitTextPatch, { inputs }).step();
  return { parts: frame.outputs.parts, count: frame.outputs.count };
};

describe("splitText", () => {
  it("splits at a literal token, left to right", () => {
    expect(split({ text: "Home,Search,Profile" })).toEqual({ parts: loopOf(["Home", "Search", "Profile"]), count: 3 });
    expect(split({ text: "a,,b" }).parts).toEqual(loopOf(["a", "", "b"]));
    expect(split({ text: ",a," }).parts).toEqual(loopOf(["", "a", ""]));
    expect(split({ text: "Make something people love", token: " " }).count).toBe(4);
    expect(split({ text: "a.b|c", token: "." }).parts).toEqual(loopOf(["a", "b|c"]));
    expect(split({ text: "a\\nb", token: "\\n" }).parts).toEqual(loopOf(["a", "b"]));
    expect(split({ text: "aXbxc", token: "x" }).parts).toEqual(loopOf(["aXb", "c"]));
  });

  it("keeps the whole text when the token isn't found", () => {
    expect(split({ text: "no commas here" })).toEqual({ parts: loopOf(["no commas here"]), count: 1 });
    expect(split({ text: "" })).toEqual({ parts: loopOf([""]), count: 1 });
    expect(createPatchHarness(splitTextPatch).step().outputs.count).toBe(1);
  });

  it("drops empty parts with Skip Empty", () => {
    expect(split({ text: "a,,b,", skipEmpty: true })).toEqual({ parts: loopOf(["a", "b"]), count: 2 });
    expect(split({ text: "", skipEmpty: true })).toEqual({ parts: loopOf([]), count: 0 });
  });

  it("splits into graphemes with an empty token", () => {
    expect(split({ text: "👋🏽 hi", token: "" }).parts).toEqual(loopOf(["👋🏽", " ", "h", "i"]));
    expect(split({ text: "", token: "" })).toEqual({ parts: loopOf([]), count: 0 });
  });

  it("normalizes text and token to NFC", () => {
    expect(split({ text: "café|thé", token: "|" }).parts).toEqual(loopOf(["café", "thé"]));
    expect(split({ text: "aéb", token: "é" }).parts).toEqual(loopOf(["a", "b"]));
  });

  it("flattens a loop of texts into one loop", () => {
    expect(split({ text: loopOf(["a,b", "c"]) })).toEqual({ parts: loopOf(["a", "b", "c"]), count: 3 });
    expect(split({ text: loopOf([]) })).toEqual({ parts: loopOf([]), count: 0 });
  });

  it("reads item 0 when Token or Skip Empty loop", () => {
    expect(split({ text: "a b,c", token: loopOf([" ", ","]) }).parts).toEqual(loopOf(["a", "b,c"]));
  });

  it("caps parts at 10,000 and warns once per restart", () => {
    const h = createPatchHarness(splitTextPatch, { inputs: { text: ",".repeat(10_000) } });
    expect(h.step().outputs.count).toBe(10_000);
    h.step();
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    h.restart();
    h.step();
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(2);
    expect(splitParts(["a,b,c"], ",", false, 2)).toEqual({ parts: ["a", "b"], capped: true });
  });

  it("evaluates once per frame even with looped inputs", () => {
    const h = createPatchHarness(splitTextPatch, { inputs: { text: loopOf(["a,b", "c,d"]) } });
    const frame = h.step();
    expect(frame.loopCount).toBeUndefined();
    expect(frame.outputs.count).toBe(4);
  });

  it("runs in the engine evaluator and passes the text items through while muted", () => {
    const live = runPatch(splitTextPatch, [{ text: { loop: ["a,b", "c"] } }]);
    expect(live.frames[0]!.outputs).toEqual({ parts: loopOf(["a", "b", "c"]), count: 3 });
    const muted = runPatch(splitTextPatch, [{ text: { loop: ["a,b", "c"] } }], { muted: true });
    expect(muted.frames[0]!.outputs).toEqual({ parts: loopOf(["a,b", "c"]), count: 2 });
  });
});
