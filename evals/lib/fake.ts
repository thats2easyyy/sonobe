/**
 * The fake client: plays a case's reference solution over MCP against the same `sonobe mcp
 * --headless` server Claude would get, and writes a transcript shaped like Claude Code's
 * stream-json. It tests the runner, the cases and the checks without Claude.
 */

import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { exampleSolutionOps, type EvalCase } from "./cases.ts";
import type { AgentClient, AgentRunOptions, AgentRunResult } from "./client.ts";

export interface SolutionCall {
  /** A Sonobe tool name, like "apply_ops". */
  tool: string;
  args?: Record<string, unknown>;
}

export interface Solution {
  calls: SolutionCall[];
  /** The final reply. */
  answer?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Validate a parsed solution.json. */
export function parseSolution(json: unknown, source = "solution.json"): Solution {
  if (!isRecord(json) || !Array.isArray(json.calls))
    throw new Error(
      `${source} must be { "calls": [{ "tool": "apply_ops", "args": { ... } }], "answer": "..." }.`,
    );
  const calls = json.calls.map((c, i): SolutionCall => {
    if (!isRecord(c) || typeof c.tool !== "string")
      throw new Error(`${source}: calls[${i}] needs a tool name.`);
    if (c.args !== undefined && !isRecord(c.args))
      throw new Error(`${source}: calls[${i}].args must be an object.`);
    return { tool: c.tool, ...(c.args ? { args: c.args } : {}) };
  });
  if (json.answer !== undefined && typeof json.answer !== "string")
    throw new Error(`${source}: answer must be text.`);
  return { calls, ...(typeof json.answer === "string" ? { answer: json.answer } : {}) };
}

/** A case's reference solution: its solution.json, or for an example without its patches, the recipe's patches. */
export function solutionFor(evalCase: EvalCase): Solution | undefined {
  if (evalCase.solution)
    return parseSolution(
      JSON.parse(readFileSync(evalCase.solution, "utf8")),
      `evals/cases/${evalCase.id}/solution.json`,
    );
  const { start } = evalCase;
  if (start.kind === "example" && !start.patches && !start.ops.length)
    return {
      calls: [
        {
          tool: "apply_ops",
          args: { ops: exampleSolutionOps(start.example), label: "rebuilt the example" },
        },
      ],
    };
  return undefined;
}

/** Replace {{url}} in every string of a JSON value. */
export function fillVars<T>(value: T, vars: { url?: string }): T {
  if (typeof value === "string")
    return (vars.url === undefined ? value : value.replaceAll("{{url}}", vars.url)) as T;
  if (Array.isArray(value)) return value.map((v) => fillVars(v, vars)) as T;
  if (isRecord(value))
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillVars(v, vars)])) as T;
  return value;
}

/** What a tool call returns, as far as the fake client cares. */
export interface ToolResultLike {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}

export type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolResultLike>;

/** The text Claude Code shows for a tool result: structuredContent as JSON when there is one. */
function shownContent(result: ToolResultLike): string {
  if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent);
  const content = Array.isArray(result.content) ? result.content : [];
  return content.map((c) => (isRecord(c) && typeof c.text === "string" ? c.text : "")).join("\n");
}

/**
 * Make a solution's calls, in order, and emit the events Claude Code's stream-json would show for
 * them: the init, each tool_use and tool_result, the reply, and the result.
 */
export async function playSolution(
  callTool: CallTool,
  solution: Solution | undefined,
  vars: { url?: string },
  emit: (event: Record<string, unknown>) => void,
): Promise<void> {
  const started = Date.now();
  emit({
    type: "system",
    subtype: "init",
    model: "fake",
    tools: [],
    mcp_servers: [{ name: "sonobe", status: "connected" }],
  });
  const calls = fillVars(solution?.calls ?? [], vars);
  for (const [i, call] of calls.entries()) {
    const id = `fake_${i}`;
    emit({
      type: "assistant",
      message: {
        id: `msg_${i}`,
        role: "assistant",
        content: [
          { type: "tool_use", id, name: `mcp__sonobe__${call.tool}`, input: call.args ?? {} },
        ],
      },
    });
    const result = await callTool(call.tool, call.args ?? {});
    emit({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            content: shownContent(result),
            is_error: result.isError === true,
          },
        ],
      },
    });
  }
  const answer = solution?.answer ?? (solution ? "Done." : "This case has no reference solution.");
  emit({
    type: "assistant",
    message: { id: "msg_final", role: "assistant", content: [{ type: "text", text: answer }] },
  });
  emit({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: calls.length + 1,
    result: answer,
    duration_ms: Date.now() - started,
    total_cost_usd: 0,
    usage: {},
  });
}

export function createFakeClient(): AgentClient {
  return {
    name: "fake",
    version: async () => undefined,
    async run(options: AgentRunOptions): Promise<AgentRunResult> {
      const started = Date.now();
      const lines: string[] = [];
      const emit = (event: Record<string, unknown>) => {
        const line = JSON.stringify(event);
        lines.push(line);
        options.onLine?.(line);
      };
      const config = JSON.parse(readFileSync(options.mcpConfigPath, "utf8")) as {
        mcpServers: Record<string, { command: string; args: string[] }>;
      };
      const server = config.mcpServers.sonobe!;
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
        cwd: options.cwd,
        stderr: "pipe",
      });
      let stderr = "";
      transport.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      const client = new Client({ name: "sonobe-evals-fake", version: "1.0.0" });
      let exitCode = 0;
      try {
        await client.connect(transport);
        const callTool: CallTool = async (name, args) =>
          (await client.callTool({ name, arguments: args }, undefined, {
            timeout: options.timeoutMs,
          })) as ToolResultLike;
        await playSolution(callTool, solutionFor(options.evalCase), options.vars, emit);
      } catch (err) {
        exitCode = 1;
        stderr += `${err instanceof Error ? err.message : String(err)}\n`;
      } finally {
        await client.close().catch(() => {});
      }
      return {
        transcript: `${lines.join("\n")}\n`,
        exitCode,
        timedOut: false,
        stderr,
        wallMs: Date.now() - started,
      };
    },
  };
}
