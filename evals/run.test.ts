/** The runner from end to end, with the fake client playing reference solutions against the CLI's sources. */

import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { EvalResults } from "./lib/summary.ts";
import { main, parseOptions, UsageError } from "./run.ts";

const CLI_SOURCE = path.join(import.meta.dirname, "..", "packages", "cli", "src", "main.ts");
const temps: string[] = [];

afterAll(async () => {
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

describe("parseOptions", () => {
  it("reads cases, budgets and the client", () => {
    const o = parseOptions([
      "--case",
      "retro-*,study-smoke-read",
      "--case",
      "example-01-tap-to-grow",
      "--model",
      "haiku",
      "--runs",
      "3",
      "--max-turns",
      "20",
      "--timeout",
      "90",
      "--jobs",
      "2",
      "--client",
      "fake",
    ]);
    expect(o).toMatchObject({
      cases: ["retro-*", "study-smoke-read", "example-01-tap-to-grow"],
      model: "haiku",
      runs: 3,
      maxTurns: 20,
      timeoutSec: 90,
      jobs: 2,
      client: "fake",
      keep: false,
      userConfig: false,
    });
    expect(o.sonobe).toMatch(/packages\/cli\/dist\/sonobe\.mjs$/);
  });

  it("explains a bad option", () => {
    expect(() => parseOptions(["--runs", "0"])).toThrow(UsageError);
    expect(() => parseOptions(["--runs", "two"])).toThrow(/--runs must be a whole number above 0/);
    expect(() => parseOptions(["--client", "gpt"])).toThrow(/--client must be claude or fake/);
    expect(() => parseOptions(["--colour"])).toThrow(UsageError);
  });
});

describe("main", () => {
  it("lists the cases", async () => {
    let out = "";
    expect(await main(["--list", "--case", "retro-*"], (t) => (out += t))).toBe(0);
    expect(out).toMatch(
      /^retro-empty-loop-deck\s+A deck that survives its last card \[retro, loops, gestures\]$/m,
    );
    expect(out).not.toContain("example-01");
  });

  it("runs cases, checks them and writes the results", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "sonobe-eval-run-"));
    temps.push(outDir);
    let out = "";
    const code = await main(
      [
        "--client",
        "fake",
        "--sonobe",
        CLI_SOURCE,
        "--case",
        "study-smoke-read,retro-knob-presets",
        "--out",
        outDir,
        "--jobs",
        "2",
      ],
      (t) => (out += t),
    );
    expect(code, out).toBe(0);
    expect(out).toContain("✓ study-smoke-read · 6/6 checks");
    const results = JSON.parse(
      readFileSync(path.join(outDir, "results.json"), "utf8"),
    ) as EvalResults;
    expect(results).toMatchObject({
      format: "sonobe.eval-results",
      client: "fake",
      runsPerCase: 1,
      summary: { runs: 2, passed: 2 },
    });
    expect(results.runs.map((r) => [r.case, r.pass, r.tools])).toEqual([
      ["retro-knob-presets", true, { add_patches: 1, set_knobs: 1 }],
      ["study-smoke-read", true, { get_document_info: 1, get_outline: 1 }],
    ]);
    for (const r of results.runs) {
      expect(existsSync(path.join(outDir, r.files.transcript))).toBe(true);
      expect(existsSync(path.join(outDir, r.files.project, "project.json"))).toBe(true);
    }
    expect(readFileSync(path.join(outDir, "summary.md"), "utf8")).toContain(
      "**2 of 2 runs passed (100%).**",
    );
  }, 60_000);

  it("checks a project folder by hand", async () => {
    let out = "";
    const code = await main(
      [
        "--case",
        "example-01-tap-to-grow",
        "--check",
        path.join(import.meta.dirname, "..", "examples", "01-tap-to-grow"),
      ],
      (t) => (out += t),
    );
    expect(code, out).toBe(0);
    expect(out).toContain("Passed: 9 of 9 checks.");
  });
});
