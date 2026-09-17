import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzySearch, highlightSegments, type FuzzyKey } from "./fuzzy.ts";

const names = (results: { item: { name: string } }[]) => results.map((r) => r.item.name);

interface PatchEntry {
  name: string;
  aliases?: string[];
  ports?: string[];
  summary?: string;
}

const keys: FuzzyKey<PatchEntry>[] = [
  { name: "name", get: (p) => p.name },
  { name: "aliases", get: (p) => p.aliases, weight: 0.8 },
  { name: "ports", get: (p) => p.ports, weight: 0.6 },
  { name: "summary", get: (p) => p.summary, weight: 0.3 },
];

describe("fuzzyMatch", () => {
  it("requires characters in order", () => {
    expect(fuzzyMatch("pop", "Pop Animation")).not.toBeNull();
    expect(fuzzyMatch("pop", "Loop Builder")).toBeNull();
    expect(fuzzyMatch("xyz", "Switch")).toBeNull();
  });

  it("returns an empty match for an empty query", () => {
    expect(fuzzyMatch("  ", "Switch")).toEqual({ score: 0, indices: [] });
  });

  it("prefers word-boundary hits over scattered ones", () => {
    const acronym = fuzzyMatch("ca", "Classic Animation")!;
    expect(acronym.indices).toEqual([0, 8]);
    const scattered = fuzzyMatch("ca", "Scale")!;
    expect(acronym.score).toBeGreaterThan(scattered.score);
  });

  it("finds camelCase boundaries", () => {
    expect(fuzzyMatch("pa", "popAnimation")!.indices).toEqual([0, 3]);
  });

  it("prefers the consecutive alignment", () => {
    expect(fuzzyMatch("anim", "Pop Animation")!.indices).toEqual([4, 5, 6, 7]);
  });

  it("ranks exact > prefix > boundary substring", () => {
    const exact = fuzzyMatch("switch", "Switch")!.score;
    const prefix = fuzzyMatch("switch", "Switch Case")!.score;
    const inner = fuzzyMatch("switch", "Option Switch")!.score;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(inner);
  });
});

describe("fuzzySearch", () => {
  const patches: PatchEntry[] = [
    { name: "Scale", summary: "Scales a number" },
    { name: "Option Switch", ports: ["Set to 0", "Set to 1"] },
    { name: "Pop Animation", aliases: ["spring", "bouncy"], ports: ["Number", "Bounciness", "Speed"] },
    { name: "Switch", ports: ["Flip", "Turn On", "Turn Off"], summary: "Remembers on or off" },
    { name: "Classic Animation", ports: ["Number", "Duration", "Curve"] },
    { name: "Transition", summary: "Maps progress to a range" },
  ];

  it("returns everything in original order for an empty query", () => {
    expect(names(fuzzySearch(patches, "", keys))).toEqual(patches.map((p) => p.name));
    expect(fuzzySearch(patches, "", keys, { limit: 2 })).toHaveLength(2);
  });

  it("puts exact name matches first", () => {
    expect(names(fuzzySearch(patches, "switch", keys)).slice(0, 2)).toEqual(["Switch", "Option Switch"]);
  });

  it("ranks acronyms of names above scattered matches", () => {
    expect(names(fuzzySearch(patches, "ca", keys))[0]).toBe("Classic Animation");
  });

  it("matches aliases with a lower weight than names", () => {
    const results = fuzzySearch(patches, "spring", keys);
    expect(names(results)[0]).toBe("Pop Animation");
    expect(results[0]!.matches.aliases).toEqual({ value: "spring", indices: [0, 1, 2, 3, 4, 5] });
  });

  it("lets each word match a different field", () => {
    const results = fuzzySearch(patches, "switch flip", keys);
    expect(names(results)).toEqual(["Switch"]);
    expect(Object.keys(results[0]!.matches).sort()).toEqual(["name", "ports"]);
  });

  it("breaks ties by original order and respects limit", () => {
    const tie = fuzzySearch([{ name: "Alpha" }, { name: "Alpha" }], "alpha", keys);
    expect(tie.map((r) => r.index)).toEqual([0, 1]);
    expect(fuzzySearch(patches, "a", keys, { limit: 3 })).toHaveLength(3);
  });
});

describe("highlightSegments", () => {
  it("groups matched runs", () => {
    expect(highlightSegments("Switch", [0, 1, 4])).toEqual([
      { text: "Sw", match: true },
      { text: "it", match: false },
      { text: "c", match: true },
      { text: "h", match: false },
    ]);
    expect(highlightSegments("Text", undefined)).toEqual([{ text: "Text", match: false }]);
  });
});

describe("word-start matching", () => {
  it("keeps acronyms and prefixes but drops letters scattered inside words", () => {
    expect(fuzzyMatch("tu", "Tidy Up", { wordStart: true })).not.toBeNull();
    expect(fuzzyMatch("align", "Align Left Edges", { wordStart: true })).not.toBeNull();
    expect(fuzzyMatch("comp", "Create Component", { wordStart: true })).not.toBeNull();
    expect(fuzzyMatch("copy", "Close Prototype", { wordStart: true })).toBeNull();
    expect(fuzzyMatch("copy", "Close Prototype")).not.toBeNull();
    expect(fuzzyMatch("phone", "patchEditor.insertPatch", { wordStart: true })).toBeNull();
  });
});

