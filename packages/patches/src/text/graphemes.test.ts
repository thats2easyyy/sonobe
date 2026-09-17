import { describe, expect, it } from "vitest";
import { createPatchHarness } from "../infra/index.ts";
import { createGraphemeSplitter, graphemeSplitter, warnIfCodePointsOnly } from "./graphemes.ts";
import { textLengthPatch } from "./textLength.ts";

describe("graphemeSplitter", () => {
  it("counts user-perceived characters", () => {
    expect(graphemeSplitter.native).toBe(true);
    expect(graphemeSplitter.count("héllo")).toBe(5);
    for (const emoji of ["👍🏽", "🇯🇵", "👩‍👩‍👧"]) expect(graphemeSplitter.count(emoji), emoji).toBe(1);
    expect(graphemeSplitter.count("\r\n")).toBe(1);
    expect(graphemeSplitter.count("")).toBe(0);
    expect(graphemeSplitter.split("👋🏽 hi")).toEqual(["👋🏽", " ", "h", "i"]);
  });

  it("reports the grapheme a UTF-16 offset falls in", () => {
    expect(graphemeSplitter.indexAt("👋🏽 hi", 5)).toBe(2);
    expect(graphemeSplitter.indexAt("🇯🇵x", 2)).toBe(0);
    expect(graphemeSplitter.indexAt("abc", 0)).toBe(0);
    expect(graphemeSplitter.indexAt("abc", 3)).toBe(3);
  });

  it("falls back to code points without a segmenter", () => {
    const fallback = createGraphemeSplitter(null);
    expect(fallback.native).toBe(false);
    expect(fallback.count("👍🏽")).toBe(2);
    expect(fallback.split("a👍")).toEqual(["a", "👍"]);
    expect(fallback.indexAt("👍x", 2)).toBe(1);
    expect(fallback.indexAt("👍x", 1)).toBe(0);
  });

  it("warns once per restart when only code points are available", () => {
    const h = createPatchHarness(textLengthPatch);
    const ctx = { id: "len", componentPath: "main", frame: 0, services: h.services };
    warnIfCodePointsOnly(ctx, "Text Length", createGraphemeSplitter(null));
    warnIfCodePointsOnly({ ...ctx, frame: 1 }, "Text Length", createGraphemeSplitter(null));
    warnIfCodePointsOnly(ctx, "Text Length");
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]!.level).toBe("warn");
    expect(h.logs[0]!.message).toContain("Intl.Segmenter");
  });
});
