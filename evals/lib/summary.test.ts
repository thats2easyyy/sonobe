import { describe, expect, it } from "vitest";
import type { CheckReport } from "./checks.ts";
import {
  formatDuration,
  formatMarkdown,
  formatTokens,
  median,
  summarize,
  type EvalResults,
  type RunRecord,
} from "./summary.ts";

const passed: CheckReport = {
  pass: true,
  scenarios: [],
  document: [],
  answer: [],
  diagnostics: { errors: 0, warnings: 0, codes: [] },
  score: { passed: 4, total: 4 },
};
const failed: CheckReport = {
  ...passed,
  pass: false,
  score: { passed: 1, total: 2 },
  scenarios: [
    {
      name: "Tapping grows the card",
      pass: false,
      results: [
        { description: "It grows", pass: true, detail: "ok" },
        {
          description: "It ends at 1.12×",
          pass: false,
          detail: "@card.scale at end is 1 (wanted == 1.12 ± 0.002)",
        },
      ],
      warnings: [],
      issues: [],
    },
  ],
};

function run(overrides: Partial<RunRecord>): RunRecord {
  return {
    case: "example-01-tap-to-grow",
    title: "Tap to Grow",
    run: 1,
    pass: true,
    outcome: "completed",
    durationMs: 60_000,
    turns: 10,
    tokens: { input: 10, output: 1000, cacheRead: 40_000, cacheWrite: 2000, total: 43_010 },
    costUsd: 0.1,
    toolCalls: 12,
    tools: { apply_ops: 3 },
    errors: [],
    checks: passed,
    answer: "",
    files: {
      transcript: "example-01-tap-to-grow/run-1/transcript.jsonl",
      project: "example-01-tap-to-grow/run-1/project",
    },
    ...overrides,
  };
}

const runs = [
  run({}),
  run({
    run: 2,
    pass: false,
    outcome: "max_turns",
    turns: 30,
    durationMs: 180_000,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 900_000 },
    checks: failed,
    errors: [
      {
        call: 2,
        tool: "apply_ops",
        code: "unknown_ref",
        message: "",
        retried: true,
        recovered: true,
      },
      {
        call: 5,
        tool: "connect",
        code: "type_mismatch",
        message: "",
        retried: false,
        recovered: false,
      },
    ],
  }),
  run({
    case: "retro-knob-presets",
    title: "Two feels",
    errors: [
      {
        call: 0,
        tool: "set_knobs",
        code: "unknown_ref",
        message: "",
        retried: true,
        recovered: false,
      },
    ],
  }),
];

describe("summarize", () => {
  const summary = summarize(runs);

  it("counts runs, passes and totals", () => {
    expect(summary).toMatchObject({ runs: 3, passed: 2 });
    expect(summary.passRate).toBeCloseTo(2 / 3);
    expect(summary.totals).toMatchObject({
      tokens: 43_010 * 2 + 900_000,
      toolCalls: 36,
      errors: 3,
      recovered: 1,
      durationMs: 300_000,
    });
    expect(summary.totals.costUsd).toBeCloseTo(0.3);
  });

  it("sums up each case with medians", () => {
    expect(summary.cases).toEqual([
      {
        id: "example-01-tap-to-grow",
        title: "Tap to Grow",
        runs: 2,
        passed: 1,
        medianTurns: 20,
        medianTokens: (43_010 + 900_000) / 2,
        medianDurationMs: 120_000,
        errors: 2,
        recovered: 1,
      },
      {
        id: "retro-knob-presets",
        title: "Two feels",
        runs: 1,
        passed: 1,
        medianTurns: 10,
        medianTokens: 43_010,
        medianDurationMs: 60_000,
        errors: 1,
        recovered: 0,
      },
    ]);
  });

  it("groups errors by code, most common first", () => {
    expect(summary.errorsByCode).toEqual([
      {
        code: "unknown_ref",
        count: 2,
        recovered: 1,
        retried: 2,
        tools: ["apply_ops", "set_knobs"],
      },
      { code: "type_mismatch", count: 1, recovered: 0, retried: 0, tools: ["connect"] },
    ]);
  });
});

describe("formatMarkdown", () => {
  const results = (runsPerCase: number): EvalResults => ({
    format: "sonobe.eval-results",
    version: 1,
    startedAt: "2026-09-19T18:40:00.000Z",
    finishedAt: "2026-09-19T18:50:00.000Z",
    client: "claude",
    clientVersion: "2.1.278",
    model: "haiku",
    commit: "a25ca8d",
    runsPerCase,
    budget: {},
    runs,
    summary: summarize(runs),
  });

  it("leads with the pass rate and lists every run", () => {
    const md = formatMarkdown(results(1));
    expect(md).toContain("Claude Code 2.1.278 · model haiku · 1 run per case · commit a25ca8d");
    expect(md).toContain(
      "**2 of 3 runs passed (67%).** 3 tool errors, 1 recovered. 986k tokens, $0.30 at list prices, 5 min.",
    );
    expect(md).toContain(
      "| example-01-tap-to-grow | ✗ out of turns | 1/2 | 30 | 900k | 3 min | 12 | 2 (1 recovered) |",
    );
    expect(md).toContain("| unknown_ref | 2 | 1 | 2 | apply_ops, set_knobs |");
  });

  it("says what went wrong in each failed run", () => {
    const md = formatMarkdown(results(1));
    expect(md).toContain("### example-01-tap-to-grow, run 2 (out of turns)");
    expect(md).toContain(
      "- Tapping grows the card › It ends at 1.12×: @card.scale at end is 1 (wanted == 1.12 ± 0.002)",
    );
    expect(md).toContain("- Transcript: `example-01-tap-to-grow/run-1/transcript.jsonl`");
  });

  it("sums up per case when each case ran more than once", () => {
    const md = formatMarkdown(results(2));
    expect(md).toContain("| Case | Passed | Median turns | Median tokens | Median time | Errors |");
    expect(md).toContain("| example-01-tap-to-grow | 1/2 | 20 | 472k | 2 min | 2 (1 recovered) |");
  });
});

describe("formatting", () => {
  it("formats tokens, durations and medians", () => {
    expect([950, 4210, 42_100, 1_230_000].map(formatTokens)).toEqual([
      "950",
      "4.2k",
      "42k",
      "1.23M",
    ]);
    expect([21_400, 60_000, 184_000].map(formatDuration)).toEqual(["21 s", "1 min", "3 min 4 s"]);
    expect([median([]), median([3, 1, 2]), median([4, 1, 2, 3])]).toEqual([0, 2, 2.5]);
  });
});
