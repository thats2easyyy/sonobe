/**
 * Reading a Claude Code session from its stream-json transcript (claude -p --output-format
 * stream-json --verbose): turns, tokens, every tool call with its result, the teaching errors and
 * whether Claude recovered after each one, and the final reply.
 */

/** How the session ended. */
export type Outcome = "completed" | "max_turns" | "budget" | "error" | "timeout" | "no_result";

export interface ToolCall {
  /** 0-based, in the order Claude made the calls. */
  index: number;
  id: string;
  /** Sonobe tools without their "mcp__sonobe__" prefix ("apply_ops"); other tools as named. */
  tool: string;
  sonobe: boolean;
  input: unknown;
  /** undefined when the session ended before the result came back. */
  ok?: boolean;
  code?: string;
  message?: string;
}

export interface ToolError {
  /** The failed call's index. */
  call: number;
  tool: string;
  code: string;
  message: string;
  /** Claude called the same tool again later. */
  retried: boolean;
  /** The next call to the same tool succeeded. */
  recovered: boolean;
}

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface SessionStats {
  outcome: Outcome;
  turns: number;
  tokens: Tokens;
  /** Claude Code's own estimate at list prices. */
  costUsd?: number;
  /** Claude Code's own session time. */
  durationMs?: number;
  model?: string;
  clientVersion?: string;
  toolCalls: ToolCall[];
  /** Calls per tool. */
  tools: Record<string, number>;
  errors: ToolError[];
  answer: string;
  /** Something that stopped the session from testing Sonobe at all (the server didn't connect, an API error). */
  problem?: string;
}

const SONOBE_PREFIX = "mcp__sonobe__";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse a stream-json transcript: one JSON event per line; other lines are skipped. */
export function parseStreamJson(text: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed) as unknown;
      if (isRecord(event)) events.push(event);
    } catch {
      // A line cut off by a timeout.
    }
  }
  return events;
}

/** "mcp__sonobe__apply_ops" → "apply_ops". */
export function toolName(raw: string): { tool: string; sonobe: boolean } {
  if (raw.startsWith(SONOBE_PREFIX)) return { tool: raw.slice(SONOBE_PREFIX.length), sonobe: true };
  return { tool: raw, sonobe: false };
}

/** The text of a tool_result's content (a string, or text blocks). */
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((b) => (isRecord(b) && b.type === "text" && typeof b.text === "string" ? b.text : ""))
      .filter(Boolean)
      .join("\n");
  return "";
}

const MCP_CODES: Record<string, string> = {
  "-32602": "invalid_params",
  "-32601": "unknown_method",
  "-32603": "internal_error",
  "-32001": "request_timeout",
};

const firstLine = (text: string) =>
  (text.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 240);

/**
 * The error code and message of a failed tool result. Sonobe's teaching errors carry
 * `{ error: { code, message } }` in structuredContent (which Claude Code shows as JSON) and start
 * their text with "Error <code>: …"; protocol errors look like "MCP error -32602: …".
 */
export function errorOf(text: string): { code: string; message: string } {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed) as unknown;
      if (isRecord(json)) {
        const error = json.error;
        if (isRecord(error) && typeof error.code === "string")
          return { code: error.code, message: firstLine(String(error.message ?? "")) };
        if (typeof json.text === "string" && !json.text.trim().startsWith("{"))
          return errorOf(json.text);
      }
    } catch {
      // Not JSON after all.
    }
  }
  const sonobe = /^Error ([a-z][a-z0-9_]*)(?: \([^)]*\))?: (.*)$/m.exec(trimmed);
  if (sonobe) return { code: sonobe[1]!, message: sonobe[2]!.trim().slice(0, 240) };
  const mcp = /MCP error (-?\d+):\s*(.*)/.exec(trimmed);
  if (mcp)
    return {
      code: MCP_CODES[mcp[1]!] ?? `mcp_error_${mcp[1]!.replace("-", "")}`,
      message: firstLine(mcp[2]!),
    };
  // Claude Code refused the call itself, before it reached Sonobe (arguments that aren't JSON...).
  const client = /<tool_use_error>\s*(?:(InputValidationError):\s*)?([^<]*)/.exec(trimmed);
  if (client)
    return {
      code: client[1] ? "client_invalid_input" : "client_error",
      message: firstLine(client[2]!),
    };
  if (/haven't granted|permission/i.test(trimmed))
    return { code: "permission_denied", message: firstLine(trimmed) };
  if (/no such tool/i.test(trimmed)) return { code: "unknown_tool", message: firstLine(trimmed) };
  return { code: "unknown", message: firstLine(trimmed) };
}

/** Every failed call, and whether the next call to the same tool succeeded. */
export function toolErrors(calls: readonly ToolCall[]): ToolError[] {
  return calls
    .filter((c) => c.ok === false)
    .map((c) => {
      const next = calls.find((n) => n.index > c.index && n.tool === c.tool && n.ok !== undefined);
      return {
        call: c.index,
        tool: c.tool,
        code: c.code ?? "unknown",
        message: c.message ?? "",
        retried: next !== undefined,
        recovered: next?.ok === true,
      };
    });
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function tokensOf(usage: unknown): Tokens {
  const u = isRecord(usage) ? usage : {};
  const tokens = {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
    total: 0,
  };
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return tokens;
}

const OUTCOMES: Record<string, Outcome> = {
  success: "completed",
  error_max_turns: "max_turns",
  error_max_budget_usd: "budget",
};

/** Sum up a session. `timedOut`: the runner stopped it at its time budget. */
export function summarizeSession(
  events: readonly Record<string, unknown>[],
  options: { timedOut?: boolean } = {},
): SessionStats {
  const calls: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  /** The last usage seen for each assistant message (a message streams as several events). */
  const usageByMessage = new Map<string, unknown>();
  let lastText = "";
  let result: Record<string, unknown> | undefined;
  let init: Record<string, unknown> | undefined;

  for (const event of events) {
    if (event.type === "system" && event.subtype === "init") init = event;
    if (event.type === "result") result = event;
    const message = isRecord(event.message) ? event.message : undefined;
    if (!message || !Array.isArray(message.content)) continue;
    // Subagent events carry a parent tool id; only the main session counts.
    if (event.parent_tool_use_id) continue;
    if (event.type === "assistant") {
      if (typeof message.id === "string") usageByMessage.set(message.id, message.usage);
      for (const block of message.content) {
        if (!isRecord(block)) continue;
        if (block.type === "text" && typeof block.text === "string" && block.text.trim())
          lastText = block.text;
        if (
          block.type === "tool_use" &&
          typeof block.id === "string" &&
          typeof block.name === "string"
        ) {
          const call: ToolCall = {
            index: calls.length,
            id: block.id,
            ...toolName(block.name),
            input: block.input,
          };
          calls.push(call);
          byId.set(block.id, call);
        }
      }
    }
    if (event.type === "user") {
      for (const block of message.content) {
        if (
          !isRecord(block) ||
          block.type !== "tool_result" ||
          typeof block.tool_use_id !== "string"
        )
          continue;
        const call = byId.get(block.tool_use_id);
        if (!call) continue;
        call.ok = block.is_error !== true;
        if (!call.ok) Object.assign(call, errorOf(resultText(block.content)));
      }
    }
  }

  let tokens: Tokens;
  if (result && isRecord(result.usage)) tokens = tokensOf(result.usage);
  else {
    tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    for (const usage of usageByMessage.values()) {
      const t = tokensOf(usage);
      tokens.input += t.input;
      tokens.output += t.output;
      tokens.cacheRead += t.cacheRead;
      tokens.cacheWrite += t.cacheWrite;
      tokens.total += t.total;
    }
  }

  let outcome: Outcome;
  if (options.timedOut) outcome = "timeout";
  else if (!result) outcome = "no_result";
  else if (result.subtype === "success" && result.is_error === true) outcome = "error";
  else outcome = OUTCOMES[String(result.subtype)] ?? "error";

  const tools: Record<string, number> = {};
  for (const c of calls) tools[c.tool] = (tools[c.tool] ?? 0) + 1;

  const stats: SessionStats = {
    outcome,
    turns: result && typeof result.num_turns === "number" ? result.num_turns : usageByMessage.size,
    tokens,
    toolCalls: calls,
    tools,
    errors: toolErrors(calls),
    answer: result && typeof result.result === "string" ? result.result : lastText,
  };
  if (result && typeof result.total_cost_usd === "number") stats.costUsd = result.total_cost_usd;
  if (result && typeof result.duration_ms === "number") stats.durationMs = result.duration_ms;
  const model = init?.model;
  if (typeof model === "string") stats.model = model;
  const version = init?.claude_code_version;
  if (typeof version === "string") stats.clientVersion = version;

  const servers = Array.isArray(init?.mcp_servers) ? (init.mcp_servers as unknown[]) : [];
  const sonobe = servers.find((s) => isRecord(s) && s.name === "sonobe");
  if (init && (!isRecord(sonobe) || sonobe.status !== "connected"))
    stats.problem = `The Sonobe MCP server didn't connect (${isRecord(sonobe) ? `status ${String(sonobe.status)}` : "not listed"}).`;
  else if (outcome === "error" && result)
    stats.problem = `Claude Code stopped with an error: ${firstLine(String(result.result ?? result.subtype ?? ""))}`;
  if (!calls.some((c) => c.sonobe) && !stats.problem && outcome !== "timeout")
    stats.problem = "Claude never called a Sonobe tool.";
  return stats;
}
