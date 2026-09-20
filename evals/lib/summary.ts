/** The results of an eval session: one record per run, a summary, and the Markdown report. */

import { failureLines, type CheckReport } from "./checks.ts";
import type { Outcome, Tokens, ToolError } from "./transcript.ts";

export interface RunRecord {
  case: string;
  title: string;
  /** 1-based. */
  run: number;
  pass: boolean;
  outcome: Outcome;
  /** Wall time of the Claude Code process. */
  durationMs: number;
  turns: number;
  tokens: Tokens;
  costUsd?: number;
  toolCalls: number;
  tools: Record<string, number>;
  errors: ToolError[];
  checks: CheckReport;
  answer: string;
  problem?: string;
  /** Relative to the results folder. */
  files: { transcript: string; project: string };
}

export interface CaseSummary {
  id: string;
  title: string;
  runs: number;
  passed: number;
  medianTurns: number;
  medianTokens: number;
  medianDurationMs: number;
  errors: number;
  recovered: number;
}

export interface CodeSummary {
  code: string;
  count: number;
  recovered: number;
  retried: number;
  tools: string[];
}

export interface ResultSummary {
  runs: number;
  passed: number;
  /** 0…1 */
  passRate: number;
  cases: CaseSummary[];
  errorsByCode: CodeSummary[];
  totals: {
    tokens: number;
    costUsd: number;
    durationMs: number;
    toolCalls: number;
    errors: number;
    recovered: number;
  };
}

export interface EvalResults {
  format: "sonobe.eval-results";
  version: 1;
  startedAt: string;
  finishedAt: string;
  /** "claude" or "fake". */
  client: string;
  clientVersion?: string;
  model?: string;
  commit?: string;
  runsPerCase: number;
  budget: { maxTurns?: number; timeoutSec?: number };
  runs: RunRecord[];
  summary: ResultSummary;
}

export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Totals, per case and per error code. */
export function summarize(runs: readonly RunRecord[]): ResultSummary {
  const cases: CaseSummary[] = [];
  for (const id of [...new Set(runs.map((r) => r.case))]) {
    const mine = runs.filter((r) => r.case === id);
    const errors = mine.flatMap((r) => r.errors);
    cases.push({
      id,
      title: mine[0]!.title,
      runs: mine.length,
      passed: mine.filter((r) => r.pass).length,
      medianTurns: median(mine.map((r) => r.turns)),
      medianTokens: median(mine.map((r) => r.tokens.total)),
      medianDurationMs: median(mine.map((r) => r.durationMs)),
      errors: errors.length,
      recovered: errors.filter((e) => e.recovered).length,
    });
  }
  const byCode = new Map<string, CodeSummary>();
  for (const e of runs.flatMap((r) => r.errors)) {
    const s = byCode.get(e.code) ?? { code: e.code, count: 0, recovered: 0, retried: 0, tools: [] };
    s.count++;
    if (e.recovered) s.recovered++;
    if (e.retried) s.retried++;
    if (!s.tools.includes(e.tool)) s.tools.push(e.tool);
    byCode.set(e.code, s);
  }
  const errors = runs.flatMap((r) => r.errors);
  const passed = runs.filter((r) => r.pass).length;
  return {
    runs: runs.length,
    passed,
    passRate: runs.length ? passed / runs.length : 0,
    cases,
    errorsByCode: [...byCode.values()].sort(
      (a, b) => b.count - a.count || a.code.localeCompare(b.code),
    ),
    totals: {
      tokens: runs.reduce((n, r) => n + r.tokens.total, 0),
      costUsd: runs.reduce((n, r) => n + (r.costUsd ?? 0), 0),
      durationMs: runs.reduce((n, r) => n + r.durationMs, 0),
      toolCalls: runs.reduce((n, r) => n + r.toolCalls, 0),
      errors: errors.length,
      recovered: errors.filter((e) => e.recovered).length,
    },
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-09-19 18:40" in the local time zone. */
export function localTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 950 → "950", 42_100 → "42.1k", 1_230_000 → "1.23M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** 21_400 → "21 s", 184_000 → "3 min 4 s". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

const OUTCOME_TEXT: Record<Outcome, string> = {
  completed: "",
  max_turns: "out of turns",
  budget: "out of budget",
  error: "stopped by an error",
  timeout: "out of time",
  no_result: "no result",
};

/** "✓", or "✗ out of turns". */
export function resultText(r: Pick<RunRecord, "pass" | "outcome">): string {
  const how = OUTCOME_TEXT[r.outcome];
  return `${r.pass ? "✓" : "✗"}${how ? ` ${how}` : ""}`;
}

function errorsText(errors: number, recovered: number): string {
  return errors ? `${errors} (${recovered} recovered)` : "–";
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The short Markdown report written next to results.json. */
export function formatMarkdown(results: EvalResults): string {
  const { summary } = results;
  const when = localTime(new Date(results.startedAt));
  const about = [
    when,
    results.client === "fake"
      ? "fake client (reference solutions)"
      : `Claude Code${results.clientVersion ? ` ${results.clientVersion}` : ""}`,
    results.model ? `model ${results.model}` : "",
    `${results.runsPerCase} run${results.runsPerCase === 1 ? "" : "s"} per case`,
    results.commit ? `commit ${results.commit}` : "",
  ].filter(Boolean);
  const lines = ["# Sonobe evals", "", about.join(" · "), ""];
  const { totals } = summary;
  lines.push(
    `**${summary.passed} of ${summary.runs} run${summary.runs === 1 ? "" : "s"} passed (${Math.round(summary.passRate * 100)}%).** ` +
      `${totals.errors} tool error${totals.errors === 1 ? "" : "s"}, ${totals.recovered} recovered. ` +
      `${formatTokens(totals.tokens)} tokens${totals.costUsd ? `, $${totals.costUsd.toFixed(2)} at list prices` : ""}, ${formatDuration(totals.durationMs)}.`,
    "",
  );
  if (results.runsPerCase === 1) {
    lines.push(
      "| Case | Result | Score | Turns | Tokens | Time | Tool calls | Errors |",
      "|---|---|---|---|---|---|---|---|",
    );
    for (const r of results.runs)
      lines.push(
        `| ${cell(r.case)} | ${resultText(r)} | ${r.checks.score.passed}/${r.checks.score.total} | ${r.turns} | ${formatTokens(r.tokens.total)} | ${formatDuration(r.durationMs)} | ${r.toolCalls} | ${errorsText(r.errors.length, r.errors.filter((e) => e.recovered).length)} |`,
      );
  } else {
    lines.push(
      "| Case | Passed | Median turns | Median tokens | Median time | Errors |",
      "|---|---|---|---|---|---|",
    );
    for (const c of summary.cases)
      lines.push(
        `| ${cell(c.id)} | ${c.passed}/${c.runs} | ${c.medianTurns} | ${formatTokens(c.medianTokens)} | ${formatDuration(c.medianDurationMs)} | ${errorsText(c.errors, c.recovered)} |`,
      );
  }
  if (summary.errorsByCode.length) {
    lines.push(
      "",
      "## Tool errors by code",
      "",
      "Recovered: the next call to the same tool succeeded.",
      "",
      "| Code | Errors | Recovered | Retried | Tools |",
      "|---|---|---|---|---|",
    );
    for (const e of summary.errorsByCode)
      lines.push(
        `| ${cell(e.code)} | ${e.count} | ${e.recovered} | ${e.retried} | ${cell(e.tools.join(", "))} |`,
      );
  }
  const failed = results.runs.filter((r) => !r.pass || r.problem);
  if (failed.length) {
    lines.push("", "## What went wrong");
    for (const r of failed) {
      lines.push(
        "",
        `### ${r.case}, run ${r.run}${r.outcome === "completed" ? "" : ` (${OUTCOME_TEXT[r.outcome]})`}`,
        "",
      );
      if (r.problem) lines.push(`- ${r.problem}`);
      const shown = failureLines(r.checks);
      for (const line of shown.slice(0, 12)) lines.push(`- ${line}`);
      if (shown.length > 12) lines.push(`- … and ${shown.length - 12} more in results.json`);
      if (r.files.transcript)
        lines.push(`- Transcript: \`${r.files.transcript}\`, project: \`${r.files.project}\``);
    }
  }
  return `${lines.join("\n")}\n`;
}
