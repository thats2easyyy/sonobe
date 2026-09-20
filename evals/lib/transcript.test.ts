import { describe, expect, it } from "vitest";
import {
  errorOf,
  parseStreamJson,
  summarizeSession,
  toolErrors,
  toolName,
  type ToolCall,
} from "./transcript.ts";

const init = {
  type: "system",
  subtype: "init",
  model: "claude-haiku-4-5",
  claude_code_version: "2.1.278",
  mcp_servers: [{ name: "sonobe", status: "connected" }],
};
const use = (
  id: string,
  name: string,
  input: unknown = {},
  message = `msg_${id}`,
  usage = {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 20,
  },
) => ({
  type: "assistant",
  message: {
    id: message,
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
    usage,
  },
});
const result = (id: string, content: unknown, isError = false) => ({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }],
  },
});
const teaching = (code: string, message: string) =>
  JSON.stringify({
    text: `Error ${code}: ${message}\nNothing changed.`,
    ok: false,
    changed: "none",
    error: { code, message, suggestions: [] },
  });
const done = {
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 7,
  duration_ms: 42_000,
  total_cost_usd: 0.12,
  result: "The heart pops and turns red.",
  usage: {
    input_tokens: 30,
    output_tokens: 900,
    cache_read_input_tokens: 50_000,
    cache_creation_input_tokens: 4000,
  },
};

describe("summarizeSession", () => {
  const events = [
    init,
    use("t1", "mcp__sonobe__get_guide", { topic: "start-here" }),
    result("t1", JSON.stringify({ text: "# Start here" })),
    use("t2", "mcp__sonobe__apply_ops", { ops: [] }),
    result("t2", teaching("unknown_ref", 'No item has ref "$tap".'), true),
    use("t3", "mcp__sonobe__describe_patch_types", { types: ["wobble"] }),
    result(
      "t3",
      [{ type: "text", text: 'Error unknown_patch_type: There\'s no patch type "wobble".' }],
      true,
    ),
    use("t4", "mcp__sonobe__apply_ops", { ops: [] }),
    result("t4", JSON.stringify({ text: "Applied 4 ops", ok: true })),
    // A subagent's calls don't count as the session's own.
    { ...use("s1", "mcp__sonobe__undo"), parent_tool_use_id: "t9" },
    {
      type: "assistant",
      message: {
        id: "msg_end",
        role: "assistant",
        content: [{ type: "text", text: "The heart pops and turns red." }],
      },
    },
    done,
  ];
  const stats = summarizeSession(events);

  it("counts turns, tokens and tools from the result", () => {
    expect(stats.outcome).toBe("completed");
    expect(stats.turns).toBe(7);
    expect(stats.tokens).toEqual({
      input: 30,
      output: 900,
      cacheRead: 50_000,
      cacheWrite: 4000,
      total: 54_930,
    });
    expect(stats.costUsd).toBe(0.12);
    expect(stats.model).toBe("claude-haiku-4-5");
    expect(stats.clientVersion).toBe("2.1.278");
    expect(stats.tools).toEqual({ get_guide: 1, apply_ops: 2, describe_patch_types: 1 });
    expect(stats.answer).toBe("The heart pops and turns red.");
    expect(stats.problem).toBeUndefined();
  });

  it("records every error code and whether Claude recovered after it", () => {
    expect(stats.errors).toEqual([
      {
        call: 1,
        tool: "apply_ops",
        code: "unknown_ref",
        message: 'No item has ref "$tap".',
        retried: true,
        recovered: true,
      },
      {
        call: 2,
        tool: "describe_patch_types",
        code: "unknown_patch_type",
        message: 'There\'s no patch type "wobble".',
        retried: false,
        recovered: false,
      },
    ]);
  });

  it("adds up tokens from the messages when a session was cut off", () => {
    const cut = summarizeSession(
      [
        init,
        use("t1", "mcp__sonobe__get_outline", {}, "msg_a"),
        // The same message again (it streams as several events): counted once.
        use("t2", "mcp__sonobe__get_layers", {}, "msg_a"),
        use("t3", "mcp__sonobe__apply_ops", {}, "msg_b"),
      ],
      { timedOut: true },
    );
    expect(cut.outcome).toBe("timeout");
    expect(cut.turns).toBe(2);
    expect(cut.tokens.total).toBe(270);
    expect(cut.toolCalls.map((c) => c.ok)).toEqual([undefined, undefined, undefined]);
  });

  it("tells how a session ended", () => {
    expect(summarizeSession([init, { ...done, subtype: "error_max_turns" }]).outcome).toBe(
      "max_turns",
    );
    expect(summarizeSession([init, { ...done, subtype: "error_max_budget_usd" }]).outcome).toBe(
      "budget",
    );
    expect(
      summarizeSession([init, { ...done, subtype: "error_during_execution", is_error: true }])
        .outcome,
    ).toBe("error");
    expect(summarizeSession([init]).outcome).toBe("no_result");
  });

  it("says when the Sonobe server never connected, or Claude never used it", () => {
    const failed = summarizeSession([
      { ...init, mcp_servers: [{ name: "sonobe", status: "failed" }] },
      done,
    ]);
    expect(failed.problem).toMatch(/didn't connect \(status failed\)/);
    expect(summarizeSession([init, done]).problem).toBe("Claude never called a Sonobe tool.");
  });
});

describe("errorOf", () => {
  it("reads Sonobe's teaching errors, protocol errors and plain text", () => {
    expect(errorOf(teaching("stale_revision", "The document changed."))).toEqual({
      code: "stale_revision",
      message: "The document changed.",
    });
    expect(errorOf("Error invalid_op (op 3, @card.scale): That op has no field colour.")).toEqual({
      code: "invalid_op",
      message: "That op has no field colour.",
    });
    expect(
      errorOf("MCP error -32602: Input validation error: Invalid arguments for tool apply_ops"),
    ).toEqual({
      code: "invalid_params",
      message: "Input validation error: Invalid arguments for tool apply_ops",
    });
    expect(
      errorOf(
        "Claude requested permissions to use mcp__sonobe__undo, but you haven't granted it yet.",
      ).code,
    ).toBe("permission_denied");
    expect(
      errorOf(
        "<tool_use_error>InputValidationError: mcp__sonobe__add_patches was called with input that could not be parsed as JSON.</tool_use_error>",
      ),
    ).toEqual({
      code: "client_invalid_input",
      message: "mcp__sonobe__add_patches was called with input that could not be parsed as JSON.",
    });
    expect(errorOf("Something odd happened\nmore")).toEqual({
      code: "unknown",
      message: "Something odd happened",
    });
  });
});

describe("toolErrors", () => {
  it("looks only at the next call to the same tool", () => {
    const calls: ToolCall[] = [
      {
        index: 0,
        id: "a",
        tool: "connect",
        sonobe: true,
        input: {},
        ok: false,
        code: "type_mismatch",
        message: "",
      },
      { index: 1, id: "b", tool: "get_outline", sonobe: true, input: {}, ok: true },
      {
        index: 2,
        id: "c",
        tool: "connect",
        sonobe: true,
        input: {},
        ok: false,
        code: "type_mismatch",
        message: "",
      },
      { index: 3, id: "d", tool: "connect", sonobe: true, input: {}, ok: true },
    ];
    expect(toolErrors(calls).map((e) => [e.call, e.retried, e.recovered])).toEqual([
      [0, true, false],
      [2, true, true],
    ]);
  });
});

describe("parseStreamJson and toolName", () => {
  it("skips lines that aren't whole JSON events", () => {
    expect(parseStreamJson(`{"type":"system"}\nnot json\n{"type":"assi`)).toEqual([
      { type: "system" },
    ]);
  });

  it("drops the Sonobe prefix", () => {
    expect(toolName("mcp__sonobe__sim_trace")).toEqual({ tool: "sim_trace", sonobe: true });
    expect(toolName("Bash")).toEqual({ tool: "Bash", sonobe: false });
  });
});
