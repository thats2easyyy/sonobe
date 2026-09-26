import { describe, expect, it } from "vitest";
import { getTemplates, templateTag } from "./templates.ts";

describe("templateTag", () => {
  it("gives every bundled template a tag short enough for one card line", () => {
    const templates = getTemplates();
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      const tag = templateTag(template);
      expect(tag, template.id).not.toBe("");
      expect(tag.length, `${template.id}: "${tag}"`).toBeLessThanOrEqual(26);
    }
  });

  it("falls back to the first sentence of the description", () => {
    expect(templateTag({ id: "99-unlisted", description: "Drag it around. Then let go." })).toBe("Drag it around.");
  });
});
