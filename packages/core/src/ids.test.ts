import { describe, expect, it } from "vitest";
import { formatAddress, parseAddress } from "./address.ts";
import { isRefToken, isValidId, slugify, uniqueId } from "./ids.ts";
import { didYouMean, didYouMeanText, editDistance } from "./suggest.ts";

describe("ids", () => {
  it("slugifies display names", () => {
    expect(slugify("Card")).toBe("card");
    expect(slugify("Tap Card")).toBe("tap_card");
    expect(slugify("popAnimation")).toBe("popAnimation");
    expect(slugify("PopAnimation")).toBe("popAnimation");
    expect(slugify("URL Field")).toBe("url_field");
    expect(slugify("Café Menü")).toBe("cafe_menu");
    expect(slugify("3D Card")).toBe("item_3d_card");
    expect(slugify("   ", "layer")).toBe("layer");
    expect(slugify("x".repeat(80)).length).toBeLessThanOrEqual(48);
    for (const s of ["Hello, World!", "  --weird__name--  ", "日本語", "a/b.c"]) expect(isValidId(slugify(s))).toBe(true);
  });

  it("makes unique ids with numeric suffixes", () => {
    expect(uniqueId("card", new Set())).toBe("card");
    expect(uniqueId("card", new Set(["card"]))).toBe("card_2");
    expect(uniqueId("card", ["card", "card_2"])).toBe("card_3");
    expect(uniqueId("card_2", new Set(["card_2"]))).toBe("card_3");
    expect(uniqueId("x", (id) => id !== "x_5")).toBe("x_5");
  });

  it("validates ids and refs", () => {
    expect(isValidId("card_2")).toBe(true);
    expect(isValidId("_private")).toBe(true);
    for (const bad of ["2card", "card-2", "", "$in", "$out", "a.b", 3]) expect(isValidId(bad)).toBe(false);
    expect(isRefToken("$card")).toBe(true);
    expect(isRefToken("$in")).toBe(false);
    expect(isRefToken("card")).toBe(false);
  });
});

describe("addresses", () => {
  it("parses every address kind", () => {
    expect(parseAddress("pop.output")).toEqual({ kind: "patch", id: "pop", key: "output" });
    expect(parseAddress("@card.scale")).toEqual({ kind: "layer", id: "card", key: "scale" });
    expect(parseAddress("$in.label")).toEqual({ kind: "componentInput", key: "label" });
    expect(parseAddress("$out.tapped")).toEqual({ kind: "componentOutput", key: "tapped" });
    expect(parseAddress("$tap.tap")).toEqual({ kind: "patch", id: "$tap", key: "tap" });
    expect(parseAddress("@$card.scale")).toEqual({ kind: "layer", id: "$card", key: "scale" });
    expect(parseAddress("pop.output#3")).toEqual({ kind: "patch", id: "pop", key: "output", index: 3 });
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["pop", "pop.", ".output", "@$in.x", "pop.out.put", "2pop.x", "pop.2x", ""]) expect(parseAddress(bad)).toBeUndefined();
  });

  it("formats round-trip", () => {
    for (const a of ["pop.output", "@card.scale", "$in.label", "$out.tapped", "grow.output#2"]) expect(formatAddress(parseAddress(a)!)).toBe(a);
  });
});

describe("did-you-mean", () => {
  it("measures edit distance with transpositions", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("ab", "ba")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
  });

  it("suggests close candidates, names and aliases", () => {
    expect(didYouMean("popAnimaton", ["popAnimation", "switch", "transition"])[0]).toBe("popAnimation");
    expect(didYouMean("spring", [{ value: "popAnimation", aliases: ["spring", "bouncy"] }, { value: "switch" }])).toEqual(["popAnimation"]);
    expect(didYouMean("cornerRadus", ["cornerRadius", "cornerRadii", "color"])[0]).toBe("cornerRadius");
    expect(didYouMean("Pop Animation", ["popAnimation"])).toEqual(["popAnimation"]);
    expect(didYouMean("zzzzzz", ["popAnimation", "switch"])).toEqual([]);
    expect(didYouMeanText(["a", "b"])).toBe(' Did you mean "a" or "b"?');
    expect(didYouMeanText([])).toBe("");
  });
});
