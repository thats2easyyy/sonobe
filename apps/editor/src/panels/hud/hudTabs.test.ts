import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HUD_TABS } from "./hudTabs.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../../../${rel}`, import.meta.url)), "utf8");

describe("HUD tab names in the docs", () => {
  const labels = HUD_TABS.map((tab) => tab.label);

  it("ARCHITECTURE §9 lists the tabs in order", () => {
    const line = read("ARCHITECTURE.md").split("\n").find((l) => l.trim().startsWith("Bottom HUD:"))!;
    expect(line.replace(/^\s*Bottom HUD:\s*/, "").replace(/\s*\(.*\)\s*$/, "").split(" · ")).toEqual(labels);
  });

  it("the guides name real tabs", () => {
    const guide09 = read("docs/guides/09-debugging.md");
    const guide10 = read("docs/guides/10-coming-from-origami.md");
    expect(guide09).toContain("next to the Console, AI Activity and Performance tabs");
    expect(guide10).toContain("Console, Diagnostics, AI Activity and Performance tabs");
    // "FPS" is the live readout in the HUD bar, never a tab.
    for (const text of [guide09, guide10]) expect(text).not.toMatch(/AI Activity,? and FPS/);
  });
});
