/**
 * Behavioral evals: Claude Code builds each case's prototype through Sonobe's MCP tools alone, then
 * the finished project is simulated and checked on layer properties. See evals/README.md.
 *
 *   node evals/run.ts --list
 *   node evals/run.ts --case study-smoke-read --model haiku
 *   node evals/run.ts --case "retro-*" --runs 3
 *   node evals/run.ts --client fake                 play the reference solutions instead of Claude
 *   node evals/run.ts --case example-01-tap-to-grow --check path/to/Project.sonobe
 */

import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { SonobeDocument } from "@sonobe/core";
import { saveProjectToDisk } from "@sonobe/core/node";
import { createPatchRegistry } from "@sonobe/patches";
import { formatReport } from "../examples/lib/scenarios.ts";
import {
  buildStartDocument,
  CASES_DIR,
  EVALS_DIR,
  listCaseIds,
  loadCase,
  renderPrompt,
  selectCaseIds,
  type EvalCase,
} from "./lib/cases.ts";
import { checkProject, type CheckReport } from "./lib/checks.ts";
import { createClaudeClient, mcpConfig, type AgentClient } from "./lib/client.ts";
import { createFakeClient, solutionFor } from "./lib/fake.ts";
import { serveFile } from "./lib/serve.ts";
import {
  formatDuration,
  formatMarkdown,
  formatTokens,
  localTime,
  resultText,
  summarize,
  type EvalResults,
  type RunRecord,
} from "./lib/summary.ts";
import { parseStreamJson, summarizeSession } from "./lib/transcript.ts";

export const DEFAULT_MAX_TURNS = 50;
export const DEFAULT_TIMEOUT_SEC = 600;

const REPO = path.dirname(EVALS_DIR);
const DEFAULT_SONOBE = path.join(REPO, "packages", "cli", "dist", "sonobe.mjs");

const HELP = `Usage: node evals/run.ts [options]

Runs Claude Code headless on each eval case, then checks the prototype it built.

  --case <id>        A case id, or a prefix ending in * ("retro-*"). Repeat or comma-separate. Default: all.
  --model <name>     Claude model (haiku, sonnet, opus, or a full name). Default: Claude Code's.
  --runs <n>         Runs per case (default 1).
  --max-turns <n>    Turn budget per run (default: the case's, else ${DEFAULT_MAX_TURNS}).
  --timeout <s>      Time budget per run in seconds (default: the case's, else ${DEFAULT_TIMEOUT_SEC}).
  --budget-usd <n>   Stop a run past this estimated cost (claude --max-budget-usd).
  --jobs <n>         Runs at the same time (default 1).
  --client <name>    claude (default), or fake: play each case's reference solution instead.
  --claude <path>    The claude command (default: claude on PATH).
  --sonobe <path>    The Sonobe CLI the MCP server runs (default: packages/cli/dist/sonobe.mjs;
                     build it with npm run build -w @sonobe/cli, or pass packages/cli/src/main.ts).
  --user-config      Load your own Claude Code settings, CLAUDE.md and skills (default: left out).
  --out <dir>        Results folder (default: evals/results/<time>).
  --keep             Keep each run's working folder.
  --check <dir>      Check a project folder against one --case, without Claude.
  --list             List the cases.

Writes results.json and summary.md, plus each run's transcript and finished project.
Exits 0 when every run passed, 1 when some failed, 2 on a usage error.`;

interface Options {
  cases: string[];
  model?: string;
  runs: number;
  maxTurns?: number;
  timeoutSec?: number;
  budgetUsd?: number;
  jobs: number;
  client: "claude" | "fake";
  claude: string;
  sonobe: string;
  userConfig: boolean;
  out?: string;
  keep: boolean;
  check?: string;
  list: boolean;
  help: boolean;
}

export class UsageError extends Error {}

function positiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0)
    throw new UsageError(`${flag} must be a whole number above 0 (got "${value}").`);
  return n;
}

export function parseOptions(argv: string[]): Options {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        case: { type: "string", multiple: true },
        model: { type: "string" },
        runs: { type: "string" },
        "max-turns": { type: "string" },
        timeout: { type: "string" },
        "budget-usd": { type: "string" },
        jobs: { type: "string" },
        client: { type: "string" },
        claude: { type: "string" },
        sonobe: { type: "string" },
        "user-config": { type: "boolean" },
        out: { type: "string" },
        keep: { type: "boolean" },
        check: { type: "string" },
        list: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  const v = parsed.values;
  const client = v.client ?? "claude";
  if (client !== "claude" && client !== "fake")
    throw new UsageError(`--client must be claude or fake (got "${client}").`);
  const budget = v["budget-usd"] === undefined ? undefined : Number(v["budget-usd"]);
  if (budget !== undefined && !(budget > 0))
    throw new UsageError("--budget-usd must be a number above 0.");
  const options: Options = {
    cases: (v.case ?? [])
      .flatMap((c) => c.split(","))
      .map((c) => c.trim())
      .filter(Boolean),
    runs: positiveInt(v.runs, "--runs") ?? 1,
    jobs: positiveInt(v.jobs, "--jobs") ?? 1,
    client,
    claude: v.claude ?? "claude",
    sonobe: path.resolve(v.sonobe ?? DEFAULT_SONOBE),
    userConfig: v["user-config"] === true,
    keep: v.keep === true,
    list: v.list === true,
    help: v.help === true,
  };
  const maxTurns = positiveInt(v["max-turns"], "--max-turns");
  const timeoutSec = positiveInt(v.timeout, "--timeout");
  if (maxTurns !== undefined) options.maxTurns = maxTurns;
  if (timeoutSec !== undefined) options.timeoutSec = timeoutSec;
  if (budget !== undefined) options.budgetUsd = budget;
  if (v.model) options.model = v.model;
  if (v.out) options.out = path.resolve(v.out);
  if (v.check) options.check = path.resolve(v.check);
  return options;
}

function gitCommit(): string | undefined {
  try {
    return (
      execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: REPO,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

/** A path relative to the working folder when it's inside it. */
const displayPath = (p: string) => {
  const rel = path.relative(process.cwd(), p);
  return rel && !rel.startsWith("..") ? rel : p;
};

const firstLine = (s: string) => (s.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 300);

interface Session {
  options: Options;
  client: AgentClient;
  clientVersion?: string;
  out: string;
  registry: ReturnType<typeof createPatchRegistry>;
  /** Each case's start document, built once. */
  starts: Map<string, Promise<SonobeDocument>>;
  print(text: string): void;
}

async function runOne(session: Session, evalCase: EvalCase, run: number): Promise<RunRecord> {
  const { options, client, out, registry } = session;
  let start = session.starts.get(evalCase.id);
  if (!start) session.starts.set(evalCase.id, (start = buildStartDocument(evalCase, registry)));
  const startDoc = await start;
  const work = await mkdtemp(path.join(tmpdir(), `sonobe-eval-${evalCase.id}-`));
  const projectDir = path.join(work, "Prototype.sonobe");
  await saveProjectToDisk(projectDir, startDoc);
  const mcpConfigPath = path.join(work, "mcp.json");
  await writeFile(
    mcpConfigPath,
    `${JSON.stringify(mcpConfig({ node: process.execPath, sonobe: options.sonobe, project: projectDir }), null, 2)}\n`,
  );

  const runDir = path.join(out, evalCase.id, `run-${run}`);
  await mkdir(runDir, { recursive: true });
  const transcriptPath = path.join(runDir, "transcript.jsonl");
  const stream = createWriteStream(transcriptPath);
  const served = evalCase.serve
    ? await serveFile(path.join(evalCase.dir, evalCase.serve))
    : undefined;
  const vars = served ? { url: served.url } : {};
  const maxTurns = options.maxTurns ?? evalCase.budget.maxTurns ?? DEFAULT_MAX_TURNS;
  const timeoutSec = options.timeoutSec ?? evalCase.budget.timeoutSec ?? DEFAULT_TIMEOUT_SEC;
  let result;
  try {
    result = await client.run({
      evalCase,
      prompt: renderPrompt(evalCase, vars),
      cwd: work,
      mcpConfigPath,
      maxTurns,
      timeoutMs: timeoutSec * 1000,
      vars,
      ...(options.model ? { model: options.model } : {}),
      ...(options.budgetUsd !== undefined ? { budgetUsd: options.budgetUsd } : {}),
      ...(options.userConfig ? { userConfig: true } : {}),
      onLine: (line) => stream.write(`${line}\n`),
    });
  } finally {
    await new Promise<void>((resolve) => stream.end(resolve));
    await served?.close();
  }
  if (result.stderr.trim()) await writeFile(path.join(runDir, "stderr.txt"), result.stderr);

  const stats = summarizeSession(parseStreamJson(result.transcript), { timedOut: result.timedOut });
  if (stats.outcome === "no_result" && result.exitCode !== 0)
    stats.problem = `${client.name === "claude" ? "Claude Code" : "The fake client"} exited with code ${result.exitCode}${result.stderr.trim() ? `: ${firstLine(result.stderr)}` : ""}`;
  let checks: CheckReport;
  try {
    checks = await checkProject(evalCase, projectDir, { registry, startDoc, answer: stats.answer });
  } catch (err) {
    checks = {
      pass: false,
      scenarios: [],
      document: [],
      answer: [],
      diagnostics: { errors: 0, warnings: 0, codes: [] },
      score: { passed: 0, total: 0 },
      error: `The checks failed to run: ${(err as Error).message}`,
    };
  }
  await cp(projectDir, path.join(runDir, "project"), { recursive: true });
  if (options.keep) session.print(`  kept ${work}\n`);
  else await rm(work, { recursive: true, force: true });

  const record: RunRecord = {
    case: evalCase.id,
    title: evalCase.title,
    run,
    pass: checks.pass,
    outcome: stats.outcome,
    durationMs: result.wallMs,
    turns: stats.turns,
    tokens: stats.tokens,
    toolCalls: stats.toolCalls.length,
    tools: stats.tools,
    errors: stats.errors,
    checks,
    answer: stats.answer,
    files: {
      transcript: path.relative(out, transcriptPath),
      project: path.relative(out, path.join(runDir, "project")),
    },
  };
  if (stats.costUsd !== undefined) record.costUsd = stats.costUsd;
  if (stats.problem) record.problem = stats.problem;
  if (stats.clientVersion && !session.clientVersion) session.clientVersion = stats.clientVersion;
  return record;
}

/** A run that couldn't happen (its start didn't build, Claude Code didn't start): failed, with the reason. */
function brokenRun(evalCase: EvalCase, run: number, err: unknown): RunRecord {
  return {
    case: evalCase.id,
    title: evalCase.title,
    run,
    pass: false,
    outcome: "error",
    durationMs: 0,
    turns: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    toolCalls: 0,
    tools: {},
    errors: [],
    checks: {
      pass: false,
      scenarios: [],
      document: [],
      answer: [],
      diagnostics: { errors: 0, warnings: 0, codes: [] },
      score: { passed: 0, total: 0 },
    },
    answer: "",
    problem: `The run couldn't happen: ${err instanceof Error ? err.message : String(err)}`,
    files: { transcript: "", project: "" },
  };
}

function progressLine(r: RunRecord, runs: number): string {
  const errors = r.errors.length
    ? ` · ${r.errors.length} error${r.errors.length === 1 ? "" : "s"} (${r.errors.filter((e) => e.recovered).length} recovered)`
    : "";
  return `${resultText(r)} ${r.case}${runs > 1 ? ` · run ${r.run}` : ""} · ${r.checks.score.passed}/${r.checks.score.total} checks · ${r.turns} turns · ${formatTokens(r.tokens.total)} tokens · ${formatDuration(r.durationMs)}${errors}${r.problem ? `\n    ${r.problem}` : ""}`;
}

function printCheck(report: CheckReport, print: (text: string) => void): void {
  if (report.error) print(`✗ ${report.error}\n`);
  for (const s of report.scenarios) print(`${formatReport(s)}\n`);
  for (const c of [...report.document, ...report.answer])
    print(`${c.pass ? "✓" : "✗"} ${c.description}\n    ${c.detail}\n`);
  print(
    `\n${report.pass ? "Passed" : "Failed"}: ${report.score.passed} of ${report.score.total} checks.\n`,
  );
}

/** Run the evals; resolves to the exit code. `print` gets everything meant for the terminal. */
export async function main(
  argv: string[],
  print: (text: string) => void = (text) => process.stdout.write(text),
): Promise<number> {
  const options = parseOptions(argv);
  if (options.help) {
    print(`${HELP}\n`);
    return 0;
  }
  let ids: string[];
  try {
    ids = selectCaseIds(listCaseIds(), options.cases);
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  const cases = ids.map((id) => loadCase(path.join(CASES_DIR, id)));

  if (options.list) {
    for (const c of cases) {
      const solved = solutionFor(c) ? "" : " (no reference solution)";
      print(
        `${c.id.padEnd(34)} ${c.title}${c.tags.length ? ` [${c.tags.join(", ")}]` : ""}${solved}\n`,
      );
    }
    return 0;
  }

  const registry = createPatchRegistry();
  if (options.check) {
    if (cases.length !== 1) throw new UsageError("--check needs exactly one --case.");
    const evalCase = cases[0]!;
    const report = await checkProject(evalCase, options.check, {
      registry,
      startDoc: await buildStartDocument(evalCase, registry),
      checkAnswer: false,
    });
    printCheck(report, print);
    return report.pass ? 0 : 1;
  }

  if (!existsSync(options.sonobe))
    throw new UsageError(
      `The Sonobe CLI isn't at ${options.sonobe}. Build it with npm run build -w @sonobe/cli, or pass --sonobe packages/cli/src/main.ts to run the sources.`,
    );
  const client =
    options.client === "fake" ? createFakeClient() : createClaudeClient(options.claude);
  const clientVersion = await client.version();
  const startedAt = new Date();
  const stamp = `${localTime(startedAt).replace(" ", "-").replace(":", "")}${String(startedAt.getSeconds()).padStart(2, "0")}`;
  const out =
    options.out ??
    path.join(
      EVALS_DIR,
      "results",
      `${stamp}${options.client === "fake" ? "-fake" : options.model ? `-${options.model.replace(/[^A-Za-z0-9.-]+/g, "-")}` : ""}`,
    );
  await mkdir(out, { recursive: true });
  const session: Session = {
    options,
    client,
    out,
    registry,
    starts: new Map(),
    print,
    ...(clientVersion ? { clientVersion } : {}),
  };

  const tasks = cases.flatMap((c) =>
    Array.from({ length: options.runs }, (_, i) => ({ evalCase: c, run: i + 1 })),
  );
  print(
    `${tasks.length} run${tasks.length === 1 ? "" : "s"} of ${cases.length} case${cases.length === 1 ? "" : "s"} with ${options.client === "fake" ? "the fake client" : `Claude Code${clientVersion ? ` ${clientVersion}` : ""}${options.model ? ` (${options.model})` : ""}`} → ${displayPath(out)}\n`,
  );
  const records: RunRecord[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      const task = tasks[i]!;
      records[i] = await runOne(session, task.evalCase, task.run).catch((err: unknown) =>
        brokenRun(task.evalCase, task.run, err),
      );
      print(`${progressLine(records[i], options.runs)}\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.jobs, tasks.length) }, worker));

  const commit = gitCommit();
  const results: EvalResults = {
    format: "sonobe.eval-results",
    version: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    client: options.client,
    runsPerCase: options.runs,
    budget: {
      ...(options.maxTurns ? { maxTurns: options.maxTurns } : {}),
      ...(options.timeoutSec ? { timeoutSec: options.timeoutSec } : {}),
    },
    runs: records,
    summary: summarize(records),
  };
  if (session.clientVersion) results.clientVersion = session.clientVersion;
  if (options.model) results.model = options.model;
  if (commit) results.commit = commit;
  await writeFile(path.join(out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  const markdown = formatMarkdown(results);
  await writeFile(path.join(out, "summary.md"), markdown);
  print(`\n${markdown}\nWrote ${displayPath(path.join(out, "summary.md"))} and results.json.\n`);
  return results.summary.passed === results.summary.runs ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      if (err instanceof UsageError)
        process.stderr.write("Run node evals/run.ts --help for the options.\n");
      process.exit(err instanceof UsageError ? 2 : 1);
    },
  );
}
