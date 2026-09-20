/**
 * Agent clients: Claude Code run headless (claude -p) against `sonobe mcp --headless`, and the
 * command line and MCP config the runner gives it.
 */

import { execFile, spawn } from "node:child_process";
import type { EvalCase } from "./cases.ts";

export interface AgentRunOptions {
  evalCase: EvalCase;
  /** The prompt with its placeholders filled in. */
  prompt: string;
  /** The run folder: Claude Code's working folder, holding mcp.json and the project. */
  cwd: string;
  mcpConfigPath: string;
  model?: string;
  maxTurns: number;
  timeoutMs: number;
  budgetUsd?: number;
  /** Load the person's own Claude Code settings and CLAUDE.md (default: left out, so runs compare). */
  userConfig?: boolean;
  /** Placeholder values for scripted calls ({{url}}). */
  vars: { url?: string };
  /** Each transcript line as it arrives. */
  onLine?(line: string): void;
}

export interface AgentRunResult {
  /** stream-json, one event per line. */
  transcript: string;
  exitCode: number | null;
  timedOut: boolean;
  stderr: string;
  /** Wall time, start to exit. */
  wallMs: number;
}

export interface AgentClient {
  readonly name: "claude" | "fake";
  version(): Promise<string | undefined>;
  run(options: AgentRunOptions): Promise<AgentRunResult>;
}

/** Tools that would hand Claude an example's answer; hidden for cases built from examples. */
export const EXAMPLE_TOOLS = ["mcp__sonobe__list_examples", "mcp__sonobe__get_example"];

/** Variables a Claude Code session sets for the processes it starts; a nested session must not inherit them. */
const PARENT_SESSION_VARS = [
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "CLAUDE_PROJECT_DIR",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
];

/** The environment for a Claude Code run: this one, without a parent session's variables. */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const name of PARENT_SESSION_VARS) delete out[name];
  return out;
}

/** An MCP config with one server, sonobe, serving the project headless. */
export function mcpConfig(options: {
  node: string;
  sonobe: string;
  project: string;
}): Record<string, unknown> {
  return {
    mcpServers: {
      sonobe: {
        command: options.node,
        args: [options.sonobe, "mcp", "--headless", options.project],
      },
    },
  };
}

/**
 * claude's arguments. Only Sonobe's tools are available (no files, shell or web), all of them
 * allowed without asking; the session isn't saved; and without userConfig the person's own
 * settings, CLAUDE.md and skills stay out, so runs on different machines compare. The prompt goes
 * in on stdin.
 */
export function claudeArgs(options: {
  mcpConfigPath: string;
  maxTurns: number;
  hideExamples: boolean;
  model?: string;
  budgetUsd?: number;
  userConfig?: boolean;
}): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--mcp-config",
    options.mcpConfigPath,
    "--strict-mcp-config",
    "--tools",
    "",
    "--allowedTools",
    "mcp__sonobe",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--max-turns",
    String(options.maxTurns),
  ];
  if (!options.userConfig) args.push("--setting-sources", "project,local");
  if (options.hideExamples) args.push("--disallowedTools", ...EXAMPLE_TOOLS);
  if (options.model) args.push("--model", options.model);
  if (options.budgetUsd !== undefined) args.push("--max-budget-usd", String(options.budgetUsd));
  return args;
}

/** "2.1.278 (Claude Code)" → "2.1.278". */
export function parseClaudeVersion(output: string): string | undefined {
  return /\d+\.\d+\.\d+\S*/.exec(output)?.[0];
}

/** Claude Code, run headless. */
export function createClaudeClient(command = "claude"): AgentClient {
  return {
    name: "claude",
    version: () =>
      new Promise((resolve, reject) => {
        execFile(
          command,
          ["--version"],
          { env: childEnv(process.env), timeout: 30_000 },
          (err, stdout) => {
            if (err) {
              const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
              reject(
                new Error(
                  missing
                    ? `Claude Code isn't on this machine's PATH ("${command}"). Install it, pass --claude <path>, or try the runner with --client fake.`
                    : `"${command} --version" failed: ${err.message}`,
                ),
              );
            } else resolve(parseClaudeVersion(stdout));
          },
        );
      }),
    run: (options) =>
      new Promise((resolve, reject) => {
        const args = claudeArgs({
          mcpConfigPath: options.mcpConfigPath,
          maxTurns: options.maxTurns,
          hideExamples: options.evalCase.hideExamples,
          ...(options.model ? { model: options.model } : {}),
          ...(options.budgetUsd !== undefined ? { budgetUsd: options.budgetUsd } : {}),
          ...(options.userConfig ? { userConfig: true } : {}),
        });
        const started = Date.now();
        const child = spawn(command, args, {
          cwd: options.cwd,
          env: childEnv(process.env),
          stdio: ["pipe", "pipe", "pipe"],
        });
        let transcript = "";
        let pending = "";
        let stderr = "";
        let timedOut = false;
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          transcript += chunk;
          pending += chunk;
          const lines = pending.split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) if (line.trim()) options.onLine?.(line);
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          if (stderr.length < 20_000) stderr += chunk;
        });
        let killer: NodeJS.Timeout | undefined;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          killer = setTimeout(() => child.kill("SIGKILL"), 10_000);
        }, options.timeoutMs);
        child.on("error", (err) => {
          clearTimeout(timer);
          clearTimeout(killer);
          reject(err);
        });
        child.on("close", (exitCode) => {
          clearTimeout(timer);
          clearTimeout(killer);
          if (pending.trim()) options.onLine?.(pending);
          resolve({ transcript, exitCode, timedOut, stderr, wallMs: Date.now() - started });
        });
        child.stdin.end(options.prompt);
      }),
  };
}
