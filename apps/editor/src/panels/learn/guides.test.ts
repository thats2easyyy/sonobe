import { describe, expect, it } from "vitest";
import { createGuideCatalog, getGuideCatalog, parseGuide, parseLevelMap, resolveGuideHref, searchGuides } from "./guides.ts";
import { parseMarkdown } from "./markdown.ts";

describe("bundled guides", () => {
  const catalog = getGuideCatalog();

  it("bundles every numbered guide and the README", () => {
    expect(catalog.readme?.title).toBe("Learn Sonobe");
    expect(catalog.guides.length).toBeGreaterThanOrEqual(11);
    expect(catalog.guides[0]!.slug).toBe("01-first-prototype");
    expect(catalog.guides.map((g) => g.number)).toEqual([...catalog.guides.map((g) => g.number)].sort());
  });

  it("builds the level map from the README's learning-path table", () => {
    expect(catalog.levels.map((row) => row.level)).toEqual([0, 1, 2, 3, 4]);
    expect(catalog.levels[0]!.guides.map((g) => g.slug)).toEqual(["01-first-prototype", "02-isat"]);
    expect(catalog.levels[0]!.audience).toMatch(/new to prototyping/i);
    expect(catalog.levels[4]!.guides).toContainEqual({ slug: "05-springs-and-feel", anchor: "handoff-to-engineers", label: "handoff to engineers" });
    expect(catalog.anyLevel.map((g) => g.slug)).toEqual(["10-coming-from-origami", "11-working-with-claude", "12-importing-designs"]);
  });

  it("links between guides resolve to guides that exist", () => {
    for (const guide of [...catalog.guides, catalog.readme!]) {
      for (const link of guide.next) expect(catalog.get(link.slug), `${guide.slug} → ${link.slug}`).toBeDefined();
    }
    for (const row of catalog.levels) for (const link of row.guides) expect(catalog.get(link.slug), link.slug).toBeDefined();
  });

  it("parses meta lines", () => {
    const first = catalog.get("01-first-prototype")!;
    expect(first).toMatchObject({ title: "Your first prototype", levels: [0], levelLabel: "Level 0", minutes: 5, anyLevel: false });
    expect(first.next.map((n) => n.slug)).toEqual(["02-isat"]);
    expect(first.outcomes[0]).toMatch(/card that grows/);
    expect(catalog.get("02-isat")!).toMatchObject({ levels: [0, 1], levelLabel: "Level 0–1" });
    expect(catalog.get("10-coming-from-origami")!).toMatchObject({ anyLevel: true, levelLabel: "Any level", audience: "for Origami Studio users" });
    expect(catalog.get("09-debugging")!.next.map((n) => n.slug)).toEqual(["10-coming-from-origami", "11-working-with-claude"]);
  });

  it("searches titles, headings, and prose", () => {
    const results = searchGuides(catalog.guides, "spring");
    expect(results[0]!.guide.slug).toBe("05-springs-and-feel");
    const mcp = searchGuides(catalog.guides, "claude desktop");
    expect(mcp[0]!.guide.slug).toBe("11-working-with-claude");
    expect(mcp[0]!.heading?.text).toBe("Connect Claude Desktop");
    expect(searchGuides(catalog.guides, "zzqxnotaword")).toEqual([]);
    expect(searchGuides(catalog.guides, "")).toHaveLength(catalog.guides.length);
  });
});

describe("guide parsing", () => {
  it("resolves links between guides", () => {
    expect(resolveGuideHref("02-isat.md")).toEqual({ slug: "02-isat", anchor: null });
    expect(resolveGuideHref("./05-springs-and-feel.md#handoff-to-engineers")).toEqual({ slug: "05-springs-and-feel", anchor: "handoff-to-engineers" });
    expect(resolveGuideHref("#try-it")).toEqual({ slug: null, anchor: "try-it" });
    expect(resolveGuideHref("README.md")).toEqual({ slug: "README", anchor: null });
    expect(resolveGuideHref("https://example.com/a.md")).toBeNull();
    expect(resolveGuideHref("../research/notes.md")).toBeNull();
    expect(resolveGuideHref("image.png")).toBeNull();
  });

  it("falls back to guide levels when there's no README table", () => {
    const catalog = createGuideCatalog({
      "docs/guides/01-a.md": "# A\n\nLevel 0 · Next: [B](02-b.md)",
      "docs/guides/02-b.md": "# B\n\nLevel 1",
      "docs/guides/03-c.md": "# C\n\nAny level",
    });
    expect(catalog.readme).toBeNull();
    expect(catalog.levels.map((r) => [r.level, r.guides.map((g) => g.slug)])).toEqual([
      [0, ["01-a"]],
      [1, ["02-b"]],
    ]);
    expect(catalog.anyLevel.map((g) => g.slug)).toEqual(["03-c"]);
  });

  it("handles guides without a meta line", () => {
    const guide = parseGuide("notes", "# Notes\n\nJust some prose.");
    expect(guide).toMatchObject({ title: "Notes", levels: [], levelLabel: "", minutes: null, summary: "Just some prose.", next: [] });
  });

  it("ignores tables that aren't a level map", () => {
    expect(parseLevelMap(parseMarkdown("| Word | Meaning |\n|---|---|\n| Layer | Something |"))).toEqual([]);
  });
});
