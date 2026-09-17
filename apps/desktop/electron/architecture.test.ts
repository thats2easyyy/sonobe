/** ARCHITECTURE.md's desktop sections (§9.1 env switches, §12 quality gates) match the desktop app. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const architecture = read("../../../ARCHITECTURE.md");

/** The lines from a heading that starts with `title` up to the next heading. */
function section(markdown: string, title: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^#{2,4} /.test(line) && line.replace(/^#+ /, "").startsWith(title));
  if (start < 0) throw new Error(`ARCHITECTURE.md has no "${title}" heading`);
  const end = lines.findIndex((line, i) => i > start && /^#{2,4} /.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

const switches = (source: string) => new Set([...source.matchAll(/\bSONOBE_[A-Z_]+\b/g)].map((m) => m[0]).filter((name) => !name.startsWith("SONOBE_SMOKE_")));

describe("§9.1 env switches", () => {
  const documented = switches(section(architecture, "9.1"));

  it("lists every switch the desktop main process reads", () => {
    const read1 = switches(read("./env.ts"));
    expect(read1.size).toBeGreaterThanOrEqual(10);
    for (const name of read1) expect(documented, name).toContain(name);
  });

  it("lists the switches the CLI launcher and MCP guides read", () => {
    for (const name of switches(read("../scripts/build.mjs"))) expect(documented, name).toContain(name);
    for (const name of switches(read("../../../packages/mcp/src/guides.ts"))) expect(documented, name).toContain(name);
  });
});

describe("§12 quality gates", () => {
  const gates = section(architecture, "12.");
  const e2e = gates.split("\n").find((line) => line.startsWith("- `npm run e2e`"))!;

  it("doesn't claim npm run e2e drives Electron when Playwright only has a Chromium project", () => {
    const config = read("../../../playwright.config.ts");
    expect(e2e).toBeDefined();
    if (!config.includes("_electron")) expect(e2e).not.toMatch(/electron/i);
    expect(config).toMatch(/projects: \[\{ name: "chromium"/);
  });

  it("documents the Electron smoke run as its own command, outside CI", () => {
    const pkg = JSON.parse(read("../package.json")) as { name: string; scripts: Record<string, string> };
    expect(pkg.scripts.smoke).toBe("node tests/smoke.mjs");
    expect(gates).toContain(`\`npm run smoke -w ${pkg.name}\``);
    const ci = read("../../../.github/workflows/ci.yml");
    if (!ci.includes("smoke")) expect(gates).toMatch(/isn't part of `npm run e2e` or CI/);
    expect(read("../tests/smoke.mjs")).toContain("SONOBE_SMOKE_SKIP_EDITOR_BUILD");
  });
});
