/**
 * The adapter's process over the fake agent (apps/desktop/tests/fake-claude-agent.mjs), run with this
 * test's own Node the way the app runs the real adapter with Electron's. No Claude account, no network.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError, type RequestPermissionRequest, type SessionNotification } from "@agentclientprotocol/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { locateClaudeAgent, wellKnownBinDirs } from "./locate.ts";
import { agentEnvironment, createAcpAgentProcess, parseAuthStatus } from "./process.ts";
import { AgentExitedError, AgentStartError, CLAUDE_AGENT_ENV, type AcpAgentProcess, type AcpAgentProcessOptions, type ClaudeAgentSpec } from "./types.ts";

const FAKE = fileURLToPath(new URL("../../../tests/fake-claude-agent.mjs", import.meta.url));

let dir: string;
let logFile: string;
let logs: string[];
let running: AcpAgentProcess[];

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sonobe-acp-"));
  logFile = path.join(dir, "fake.log.jsonl");
  logs = [];
  running = [];
});

afterEach(async () => {
  await Promise.all(running.map((agent) => agent.dispose()));
  await rm(dir, { recursive: true, force: true });
});

function fakeSpec(): ClaudeAgentSpec {
  const found = locateClaudeAgent({ env: { [CLAUDE_AGENT_ENV]: FAKE }, execPath: process.execPath });
  if (!found.ok) throw new Error(`The fake agent isn't at ${FAKE}.`);
  return found.spec;
}

/** A process of `spec` (the fake by default), logging into `logs`, disposed after the test. */
function start(env: Record<string, string> = {}, over: Partial<AcpAgentProcessOptions> = {}): AcpAgentProcess {
  const agent = createAcpAgentProcess({
    spec: fakeSpec(),
    cwd: path.join(dir, "cwd"),
    baseEnv: { ...process.env, FAKE_CLAUDE_LOG: logFile, ...env },
    clientVersion: "0.1.0-test",
    log: (level, message) => logs.push(`${level}: ${message}`),
    ...over,
  });
  running.push(agent);
  return agent;
}

/** What the fake logged, one object per line. */
async function fakeLog(): Promise<{ kind: string; [key: string]: unknown }[]> {
  if (!existsSync(logFile)) return [];
  return (await readFile(logFile, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function waitFor(check: () => boolean | Promise<boolean>, what: string, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const session = (agent: AcpAgentProcess) => agent.newSession({ cwd: dir, mcpServers: [] });

/** The session's updates as they arrive. */
function updatesOf(agent: AcpAgentProcess, sessionId: string): SessionNotification["update"][] {
  const updates: SessionNotification["update"][] = [];
  agent.onSessionUpdate(sessionId, (n) => updates.push(n.update));
  return updates;
}

const textOf = (updates: SessionNotification["update"][]) =>
  updates.map((u) => (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text" ? u.content.text : "")).join("");

// Each test starts a Node process of its own.
describe("the adapter's process", { timeout: 15_000 }, () => {
  it("initializes at once and keeps the login the adapter pushes", async () => {
    const agent = start();
    const pushed = new Promise((resolve) => agent.onAuthStatus(resolve));
    const init = await agent.ready;
    expect(init.agentInfo).toMatchObject({ name: "fake-claude-agent", version: "0.0.0-fake" });
    expect(await pushed).toEqual({ kind: "account", label: "Claude Max", email: "fake@example.com", plan: "max", detail: null });
    expect(agent.authStatus?.kind).toBe("account");
    expect(agent.alive).toBe(true);
    // Sonobe offers no file system and no terminal, and names itself.
    const [initialize] = await fakeLog();
    expect(initialize).toMatchObject({
      kind: "initialize",
      params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "sonobe", title: "Sonobe", version: "0.1.0-test" } },
    });
    expect(logs[0]).toBe(`info: Starting Claude's agent adapter: ${fakeSpec().displayPath}.`);
    expect(logs).toContain("info: Claude's agent adapter is ready: fake-claude-agent 0.0.0-fake, ACP 1.");
  });

  it("passes a signed-out adapter's refusal on as its RequestError (-32000)", async () => {
    const agent = start({ FAKE_CLAUDE_AUTH: "none" });
    const pushed = new Promise((resolve) => agent.onAuthStatus(resolve));
    await agent.ready;
    expect(await pushed).toEqual({ kind: "none", label: "Not logged in", email: null, plan: null, detail: null });
    const { sessionId } = await session(agent);
    const refused = await agent.prompt({ sessionId, prompt: [{ type: "text", text: "hi" }] }).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(RequestError);
    expect((refused as RequestError).code).toBe(-32000);
  });

  it("opens sessions, streams each one's updates to its own listeners, and resolves the prompt with usage", async () => {
    const agent = start();
    const a = await session(agent);
    const b = await session(agent);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.configOptions?.find((o) => o.category === "model")).toMatchObject({ id: "model", currentValue: "default" });
    const [ofA, ofB] = [updatesOf(agent, a.sessionId), updatesOf(agent, b.sessionId)];
    const stopped: SessionNotification["update"][] = [];
    agent.onSessionUpdate(a.sessionId, (n) => stopped.push(n.update))();

    const result = await agent.prompt({ sessionId: a.sessionId, prompt: [{ type: "text", text: "echo alpha" }] });
    expect(result).toEqual({ stopReason: "end_turn", usage: { inputTokens: 1200, outputTokens: 300, cachedReadTokens: 20000, cachedWriteTokens: 0, totalTokens: 21500 } });
    expect(textOf(ofA)).toBe("Echo: echo alpha");
    expect(ofA.filter((u) => u.sessionUpdate === "agent_message_chunk")).toHaveLength(3);
    expect(new Set(ofA.map((u) => (u as { messageId?: string }).messageId)).size).toBe(1);
    await agent.prompt({ sessionId: b.sessionId, prompt: [{ type: "text", text: "echo beta" }] });
    expect(textOf(ofB)).toBe("Echo: echo beta");
    expect(textOf(ofA)).toBe("Echo: echo alpha");
    // Unsubscribed at once.
    expect(stopped).toEqual([]);
  });

  it("cancels a running prompt, which resolves cancelled", async () => {
    const agent = start();
    const { sessionId } = await session(agent);
    const updates = updatesOf(agent, sessionId);
    const prompt = agent.prompt({ sessionId, prompt: [{ type: "text", text: "hang for a while" }] });
    await waitFor(() => textOf(updates) === "Working on it…", "the first chunk");
    await agent.cancel(sessionId);
    expect(await prompt).toEqual({ stopReason: "cancelled" });
    expect((await fakeLog()).some((l) => l.kind === "session/cancel")).toBe(true);
  });

  it("asks the session's permission handler, and passes its answer back", async () => {
    const agent = start();
    const { sessionId } = await session(agent);
    const asked: RequestPermissionRequest[] = [];
    let signal: AbortSignal | null = null;
    agent.setPermissionHandler(sessionId, async (request, s) => {
      asked.push(request);
      signal = s;
      return { outcome: { outcome: "selected", optionId: "allow-once" } };
    });
    const updates = updatesOf(agent, sessionId);
    expect((await agent.prompt({ sessionId, prompt: [{ type: "text", text: "save it" }] })).stopReason).toBe("end_turn");
    expect(asked).toHaveLength(1);
    expect(asked[0]!.toolCall).toMatchObject({ name: "mcp__sonobe__save_document", rawInput: {} });
    expect(asked[0]!.options.map((o) => [o.optionId, o.kind])).toEqual([["allow-once", "allow_once"], ["allow-with-updates", "allow_always"], ["reject", "reject_once"]]);
    expect(signal!.aborted).toBe(false);
    expect((await fakeLog()).find((l) => l.kind === "permission")).toMatchObject({ tool: "save_document", outcome: { outcome: "selected", optionId: "allow-once" }, optionKind: "allow_once" });
    // Allowed, so the fake went on to the MCP call (this session has no MCP server, so it failed).
    expect(updates.some((u) => u.sessionUpdate === "tool_call_update" && u.status === "failed" && JSON.stringify(u.content).includes("MCP error"))).toBe(true);
  });

  it("answers cancelled without a handler, or when the handler fails", async () => {
    const agent = start();
    const { sessionId } = await session(agent);
    const updates = updatesOf(agent, sessionId);
    await agent.prompt({ sessionId, prompt: [{ type: "text", text: "save it" }] });
    expect(textOf(updates)).toBe("Okay, I won't.");
    expect(updates.find((u) => u.sessionUpdate === "tool_call_update" && u.status === "failed")).toMatchObject({ content: [{ type: "content", content: { type: "text", text: "The user doesn't want to proceed with this tool use." } }] });

    agent.setPermissionHandler(sessionId, async () => Promise.reject(new Error("The window closed.")));
    await agent.prompt({ sessionId, prompt: [{ type: "text", text: "open the other one" }] });
    agent.setPermissionHandler(sessionId, async () => ({ outcome: { outcome: "selected", optionId: "allow-once" } }));
    agent.setPermissionHandler(sessionId, null);
    await agent.prompt({ sessionId, prompt: [{ type: "text", text: "save it" }] });
    expect((await fakeLog()).filter((l) => l.kind === "permission").map((l) => [l.tool, (l.outcome as { outcome: string }).outcome])).toEqual([
      ["save_document", "cancelled"],
      ["open_document", "cancelled"],
      ["save_document", "cancelled"],
    ]);
    expect(logs).toContain("warn: Answering Claude's permission question failed, so it's cancelled: The window closed.");
  });

  it("sets a session's model, which the adapter offers by alias, and the agent's refusal stays a RequestError", async () => {
    const agent = start();
    const created = await agent.newSession({ cwd: dir, mcpServers: [], _meta: { claudeCode: { options: { model: "claude-sonnet-5" } } } });
    const { sessionId } = created;
    // Like the adapter (0.79.0): aliases, and "default" whatever options.model asked for.
    const offered = created.configOptions?.find((o) => o.id === "model");
    expect(offered).toMatchObject({ category: "model", type: "select", currentValue: "default" });
    expect((offered as { options: { value: string }[] }).options.map((o) => o.value)).toEqual(["default", "opus[1m]", "sonnet", "sonnet[1m]", "haiku"]);
    const modelAfter = async (value: string) => (await agent.setSessionConfigOption({ sessionId, configId: "model", value })).configOptions.find((o) => o.id === "model")?.currentValue;
    // A model id resolves to its family's alias, as the adapter's resolveModelPreference does.
    expect(await modelAfter("claude-opus-5")).toBe("opus[1m]");
    expect(await modelAfter("claude-haiku-4-5-20251001")).toBe("haiku");
    expect(await modelAfter("claude-sonnet-5")).toBe("sonnet");
    expect(await modelAfter("sonnet[1m]")).toBe("sonnet[1m]");
    const refused = await agent.setSessionConfigOption({ sessionId, configId: "model", value: "gpt-5" }).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(RequestError);
    expect(refused).toMatchObject({ code: -32603, data: { details: "Invalid value for config option model: gpt-5" } });
  });

  it("starts a session in the mode FAKE_CLAUDE_MODE names, as the adapter takes the person's own default, and changes it through the mode option", async () => {
    const agent = start({ FAKE_CLAUDE_MODE: "auto" });
    const created = await session(agent);
    expect(created.modes).toMatchObject({ currentModeId: "auto" });
    expect(created.modes!.availableModes.map((m) => m.id)).toEqual(["default", "acceptEdits", "plan", "auto", "bypassPermissions"]);
    expect(created.configOptions?.find((o) => o.id === "mode")).toMatchObject({ category: "mode", type: "select", currentValue: "auto" });
    const updates = updatesOf(agent, created.sessionId);

    // In auto, Claude Code runs a tool outside allowedTools without asking.
    let asked = 0;
    agent.setPermissionHandler(created.sessionId, async () => (asked++, { outcome: { outcome: "selected", optionId: "allow-once" } }));
    await agent.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "save it" }] });
    expect(asked).toBe(0);
    expect((await fakeLog()).find((l) => l.kind === "unasked")).toMatchObject({ tool: "save_document", mode: "auto" });

    const set = await agent.setSessionConfigOption({ sessionId: created.sessionId, configId: "mode", value: "default" });
    expect(set.configOptions.find((o) => o.id === "mode")?.currentValue).toBe("default");
    expect(updates).toContainEqual({ sessionUpdate: "current_mode_update", currentModeId: "default" });
    expect((await fakeLog()).filter((l) => l.kind === "mode")).toEqual([{ kind: "mode", sessionId: created.sessionId, from: "auto", to: "default", via: "config_option" }]);
    await agent.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "save it" }] });
    expect(asked).toBe(1);
    await expect(agent.setSessionConfigOption({ sessionId: created.sessionId, configId: "mode", value: "yolo" })).rejects.toMatchObject({ data: { details: "Invalid value for config option mode: yolo" } });
  });

  it("clamps bypassPermissions to default, and offers it no more, when the session doesn't allow skipping permissions", async () => {
    const agent = start({ FAKE_CLAUDE_MODE: "bypassPermissions" });
    const allowed = await session(agent);
    expect(allowed.modes?.currentModeId).toBe("bypassPermissions");
    const clamped = await agent.newSession({ cwd: dir, mcpServers: [], _meta: { claudeCode: { options: { allowDangerouslySkipPermissions: false } } } });
    expect(clamped.modes?.currentModeId).toBe("default");
    expect(clamped.modes!.availableModes.map((m) => m.id)).not.toContain("bypassPermissions");
    await expect(agent.setSessionConfigOption({ sessionId: clamped.sessionId, configId: "mode", value: "bypassPermissions" })).rejects.toBeInstanceOf(RequestError);
  });

  it("refuses a tool that makes changes in plan mode, without asking", async () => {
    const agent = start({ FAKE_CLAUDE_MODE: "plan" });
    const { sessionId } = await session(agent);
    const updates = updatesOf(agent, sessionId);
    let asked = 0;
    agent.setPermissionHandler(sessionId, async () => (asked++, { outcome: { outcome: "selected", optionId: "allow-once" } }));
    expect((await agent.prompt({ sessionId, prompt: [{ type: "text", text: "save it" }] })).stopReason).toBe("end_turn");
    expect(asked).toBe(0);
    expect(updates.find((u) => u.sessionUpdate === "tool_call_update" && u.status === "failed")).toMatchObject({ content: [{ type: "content", content: { type: "text", text: "Claude Code is in plan mode, so it didn't run a tool that makes changes." } }] });
    expect(textOf(updates)).toBe("I'm in plan mode, so I didn't change anything.");
  });

  it("with sessionend, fails the prompt as the adapter does when its Claude Code dies, and forgets the session while it keeps running", async () => {
    const agent = start();
    const { sessionId } = await session(agent);
    const updates = updatesOf(agent, sessionId);
    const failed = await agent.prompt({ sessionId, prompt: [{ type: "text", text: "sessionend" }] }).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(RequestError);
    expect(failed).toMatchObject({ code: -32603, message: "Internal error: The Claude Agent process exited unexpectedly. Please start a new session." });
    expect(textOf(updates)).toBe("About to end the session.");
    // The adapter evicted it: a later prompt gets the SDK's plain "Session not found".
    const gone = await agent.prompt({ sessionId, prompt: [{ type: "text", text: "echo hi" }] }).catch((err: unknown) => err);
    expect(gone).toBeInstanceOf(RequestError);
    expect(gone).toMatchObject({ code: -32603, message: "Internal error", data: { details: "Session not found" } });
    expect(agent.alive).toBe(true);
    const fresh = await session(agent);
    expect((await agent.prompt({ sessionId: fresh.sessionId, prompt: [{ type: "text", text: "echo hi" }] })).stopReason).toBe("end_turn");
  });

  it("with limit and ratelimit, says the CLI's text and fails the prompt with it, the way the adapter does for a client that isn't AIR", async () => {
    const agent = start();
    const { sessionId } = await session(agent);
    const updates = updatesOf(agent, sessionId);
    const limited = await agent.prompt({ sessionId, prompt: [{ type: "text", text: "limit" }] }).catch((err: unknown) => err);
    expect(limited).toBeInstanceOf(RequestError);
    expect(limited).toMatchObject({ code: -32603, message: "Internal error: You've hit your limit · resets 3pm", data: { errorKind: "rate_limit" } });
    expect(textOf(updates)).toBe("You've hit your limit · resets 3pm");
    const throttled = await agent.prompt({ sessionId, prompt: [{ type: "text", text: "ratelimit" }] }).catch((err: unknown) => err);
    expect(throttled).toMatchObject({ code: -32603, message: "Internal error: API Error: 429 rate_limit_error", data: { errorKind: "rate_limit" } });
    // The session is still there.
    expect((await agent.prompt({ sessionId, prompt: [{ type: "text", text: "echo" }] })).stopReason).toBe("end_turn");
  });

  it("closes a session only when the adapter offers session/close", async () => {
    const offering = start();
    const { sessionId } = await session(offering);
    await offering.closeSession(sessionId);
    expect((await fakeLog()).filter((l) => l.kind === "session/close")).toHaveLength(1);
    await expect(offering.prompt({ sessionId, prompt: [{ type: "text", text: "echo" }] })).rejects.toMatchObject({ code: -32603, data: { details: "Session not found" } });
    // Closing one the adapter no longer has (it ended it, say) is what Sonobe wanted: nothing to warn about.
    await offering.closeSession(sessionId);
    expect((await fakeLog()).filter((l) => l.kind === "session/close")).toHaveLength(2);
    expect(logs.filter((l) => l.startsWith("warn:"))).toEqual([]);
    await offering.dispose();

    await rm(logFile);
    const plain = start({ FAKE_CLAUDE_NO_CLOSE: "1" });
    const kept = await session(plain);
    await plain.closeSession(kept.sessionId);
    expect((await fakeLog()).some((l) => l.kind === "session/close")).toBe(false);
    expect((await plain.prompt({ sessionId: kept.sessionId, prompt: [{ type: "text", text: "echo" }] })).stopReason).toBe("end_turn");
  });

  it("rejects what's pending when the adapter exits mid-prompt, with its exit code and last stderr", async () => {
    const agent = start();
    const { sessionId } = await session(agent);
    const updates = updatesOf(agent, sessionId);
    const failed = await agent.prompt({ sessionId, prompt: [{ type: "text", text: "crash now" }] }).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(AgentExitedError);
    expect((failed as AgentExitedError).exit).toMatchObject({ code: 7, signal: null });
    expect((failed as AgentExitedError).exit.stderrTail).toContain("fake crash: something broke");
    expect((failed as AgentExitedError).message).toBe("Claude's agent adapter exited with code 7.");
    expect(textOf(updates)).toBe("About to crash.");
    expect(await agent.exited).toMatchObject({ code: 7 });
    expect(agent.alive).toBe(false);
    // Gone for good: what's asked now fails at once, and cancel and close never throw.
    await expect(agent.newSession({ cwd: dir, mcpServers: [] })).rejects.toBeInstanceOf(AgentExitedError);
    await agent.cancel(sessionId);
    await agent.closeSession(sessionId);
    expect(logs.some((l) => l.startsWith("warn: Claude's agent adapter exited (code 7). Its last output:\n") && l.includes("fake crash: something broke"))).toBe(true);
  });

  it("aborts a permission question's signal when the process goes", async () => {
    const agent = start();
    const { sessionId } = await session(agent);
    let waiting: AbortSignal | null = null;
    agent.setPermissionHandler(sessionId, (_request, signal) => {
      waiting = signal;
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ outcome: { outcome: "cancelled" } })));
    });
    const prompt = agent.prompt({ sessionId, prompt: [{ type: "text", text: "save it" }] }).catch((err: unknown) => err);
    await waitFor(() => waiting !== null, "the permission question");
    await agent.dispose();
    expect(waiting!.aborted).toBe(true);
    expect(await prompt).toBeInstanceOf(AgentExitedError);
  });

  it("fails to start when the adapter never answers initialize, and stops it", async () => {
    const agent = start({}, { spec: { ...fakeSpec(), args: ["-e", "setInterval(() => {}, 1000)"] }, initializeTimeoutMs: 300 });
    const failed = await agent.ready.catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(AgentStartError);
    expect((failed as AgentStartError).message).toBe("it didn't answer within 0.3 seconds");
    expect((await agent.exited).signal).toBe("SIGTERM");
    await expect(agent.newSession({ cwd: dir, mcpServers: [] })).rejects.toBe(failed);
    expect(logs).toContain("error: Claude's agent adapter didn't start: it didn't answer within 0.3 seconds.");
  });

  it("fails to start when the command can't run", async () => {
    const missing = path.join(dir, "gone", "claude-agent-acp");
    const agent = start({}, { spec: { command: missing, args: [], env: {}, displayPath: "~/gone/claude-agent-acp", version: null, source: "path" } });
    const failed = await agent.ready.catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(AgentStartError);
    expect((failed as AgentStartError).message).toBe("Sonobe couldn't run ~/gone/claude-agent-acp (ENOENT)");
    expect(await agent.exited).toEqual({ code: null, signal: null, stderrTail: "" });
    expect(agent.alive).toBe(false);
    await agent.dispose();
  });

  it("disposes: closes stdin and stops the process", async () => {
    const agent = start();
    await agent.ready;
    await agent.dispose();
    expect(agent.alive).toBe(false);
    await expect(agent.exited).resolves.toMatchObject({ stderrTail: "" });
    expect(logs.at(-1)).toMatch(/^info: Claude's agent adapter exited \((code 0|SIGTERM)\)\.$/);
  });

  it("kills a process that ignores SIGTERM after 3 seconds", async () => {
    const stubborn = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)";
    const agent = start({}, { spec: { ...fakeSpec(), args: ["-e", stubborn] }, initializeTimeoutMs: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const started = Date.now();
    await agent.dispose();
    expect((await agent.exited).signal).toBe("SIGKILL");
    expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
  }, 10_000);

  it("keeps the last 2,000 characters of stderr, whole lines, and never a key or token", async () => {
    const lines = [...Array.from({ length: 60 }, (_, i) => `line ${i} ${"-".repeat(40)}`), "using ANTHROPIC_API_KEY=sk-ant-api03-secret-value", "Authorization: Bearer 0123456789abcdef0123", "last words"];
    const script = `require("node:fs").writeSync(2, ${JSON.stringify(lines.join("\n"))}); process.exit(3)`;
    const agent = start({}, { spec: { ...fakeSpec(), args: ["-e", script] } });
    const failed = await agent.ready.catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(AgentExitedError);
    const tail = (failed as AgentExitedError).exit.stderrTail;
    expect(tail.length).toBeLessThanOrEqual(2000);
    expect(tail).toMatch(/^line \d+ -+\n/);
    expect(tail.endsWith("[redacted: the line held a key or token]\n[redacted: the line held a key or token]\nlast words")).toBe(true);
    expect(`${tail}\n${logs.join("\n")}`).not.toMatch(/sk-ant-|0123456789abcdef/);
    expect(logs.some((l) => l.startsWith("warn: Claude's agent adapter exited (code 3).") && l.endsWith("last words"))).toBe(true);
  });

  it("keeps V8's reason for running out of memory in the tail, with the native stack trace folded into one line", async () => {
    const fatal = "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory";
    // Node's own stderr for it: a few GCs, the reason, then ~6,000 characters of native frames.
    const frames = Array.from({ length: 43 }, (_, i) => `${String(i + 1).padStart(2)}: 0x${(0x1028ff10c + i * 0x1000).toString(16)} v8::internal::Heap::CollectGarbage(v8::internal::AllocationSpace, v8::internal::GarbageCollectionReason, v8::GCCallbackFlags) [/Applications/Sonobe.app/Contents/Frameworks/Electron Framework]`);
    const stderr = ["", "<--- Last few GCs --->", "", "[5083:0xb2bc00000]       35 ms: Mark-Compact 15.6 (32.5) -> 15.6 (32.3) MB, pooled: 0 MB, 9.67 / 0.00 ms  (average mu = 0.353, current mu = 0.029) allocation failure; scavenge might not succeed", "", fatal, "----- Native stack trace -----", "", ...frames, ""].join("\n");
    expect(stderr.length).toBeGreaterThan(4000);
    const script = `require("node:fs").writeSync(2, ${JSON.stringify(stderr)}); process.exit(134)`;
    const agent = start({}, { spec: { ...fakeSpec(), args: ["-e", script] } });
    const failed = await agent.ready.catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(AgentExitedError);
    const tail = (failed as AgentExitedError).exit.stderrTail;
    expect(tail.endsWith(`${fatal}\n----- Native stack trace -----\n\n[left out: Node's native stack trace]`)).toBe(true);
    expect(logs.some((l) => l.startsWith("warn: Claude's agent adapter exited (code 134).") && l.includes(fatal))).toBe(true);
  });
});

describe("the fake agent, directly", { timeout: 15_000 }, () => {
  const run = (args: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, [FAKE, ...args], { encoding: "utf8", env: { ...process.env, FAKE_CLAUDE_LOG: logFile, ...env } });

  it("changes the mode with session/set_mode, which process.ts doesn't send, and refuses every change under FAKE_CLAUDE_MODE_LOCKED", async () => {
    const child = spawn(process.execPath, [FAKE], { env: { ...process.env, FAKE_CLAUDE_LOG: logFile, FAKE_CLAUDE_MODE: "acceptEdits" }, stdio: ["pipe", "pipe", "inherit"] });
    const updates: SessionNotification["update"][] = [];
    const client = { sessionUpdate: async (n: SessionNotification) => void updates.push(n.update), requestPermission: async () => ({ outcome: { outcome: "cancelled" as const } }) };
    const conn = new ClientSideConnection(() => client, ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>));
    try {
      await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
      const { sessionId, modes } = await conn.newSession({ cwd: dir, mcpServers: [] });
      expect(modes?.currentModeId).toBe("acceptEdits");
      await conn.setSessionMode({ sessionId, modeId: "default" });
      expect(updates.find((u) => u.sessionUpdate === "config_option_update")).toMatchObject({ configOptions: expect.arrayContaining([expect.objectContaining({ id: "mode", currentValue: "default" })]) });
      expect((await fakeLog()).find((l) => l.kind === "mode")).toMatchObject({ from: "acceptEdits", to: "default", via: "set_mode" });
      await expect(conn.setSessionMode({ sessionId, modeId: "yolo" })).rejects.toMatchObject({ data: { details: "Mode yolo is not available in this session" } });
    } finally {
      child.stdin.end();
      await new Promise((resolve) => child.once("exit", resolve));
    }

    const locked = start({ FAKE_CLAUDE_MODE: "auto", FAKE_CLAUDE_MODE_LOCKED: "1" });
    const { sessionId } = await session(locked);
    await expect(locked.setSessionConfigOption({ sessionId, configId: "mode", value: "default" })).rejects.toMatchObject({ data: { details: "Invalid Mode" } });
  });

  it("answers auth status --json with the CLI's JSON, and exits 1 signed out while still printing it", async () => {
    const signedIn = run(["--cli", "auth", "status", "--json"]);
    expect(signedIn.status).toBe(0);
    expect(JSON.parse(signedIn.stdout)).toEqual({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "fake@example.com", subscriptionType: "max" });
    const signedOut = run(["--cli", "auth", "status", "--json"], { FAKE_CLAUDE_AUTH: "none" });
    expect(signedOut.status).toBe(1);
    expect(JSON.parse(signedOut.stdout)).toEqual({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" });
    expect((await fakeLog()).filter((l) => l.kind === "cli")).toEqual([
      { kind: "cli", args: ["auth", "status", "--json"] },
      { kind: "cli", args: ["auth", "status", "--json"] },
    ]);
  });

  it("prints its version and the login, and says what it doesn't fake", () => {
    expect(run(["--version"])).toMatchObject({ status: 0, stdout: "0.0.0-fake\n" });
    expect(run(["--cli", "auth", "login", "--claudeai"])).toMatchObject({ status: 0, stdout: "fake claude login\n" });
    expect(run(["--cli", "doctor"])).toMatchObject({ status: 2, stderr: "fake claude: doctor isn't faked\n" });
  });
});

describe("agentEnvironment", () => {
  const JS: ClaudeAgentSpec = { command: "/Applications/Sonobe.app/Contents/MacOS/Sonobe", args: ["/opt/homebrew/lib/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js"], env: { ELECTRON_RUN_AS_NODE: "1" }, displayPath: "/opt/homebrew/bin/claude-agent-acp", version: "0.79.0", source: "path" };
  const DIRECT: ClaudeAgentSpec = { ...JS, command: "/usr/local/bin/claude-agent-acp", args: [], env: {} };
  const base = {
    HOME: "/Users/me",
    PATH: "/usr/bin:/bin:/opt/homebrew/bin",
    ANTHROPIC_API_KEY: "sk-ant-stray",
    ANTHROPIC_AUTH_TOKEN: "token",
    CLAUDECODE: "1",
    CLAUDE_CODE_ENTRYPOINT: "cli",
    CLAUDE_CODE_SSE_PORT: "5000",
    CLAUDE_PROJECT_DIR: "/Users/me/code",
    ELECTRON_RUN_AS_NODE: "1",
    CLAUDE_CONFIG_DIR: "/Users/me/.claude-work",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth",
    CLAUDE_CODE_USE_BEDROCK: "1",
    ANTHROPIC_BASE_URL: "https://gateway.example.com",
    LANG: "en_US.UTF-8",
    UNSET: undefined,
  };

  it.skipIf(process.platform === "win32")("drops a stray key and Claude Code's own variables, keeps the rest, and adds the spec's and the bin folders", () => {
    const env = agentEnvironment(base, JS);
    const wellKnown = wellKnownBinDirs({ platform: process.platform, home: "/Users/me", env: base }).filter((d) => d !== "/opt/homebrew/bin");
    expect(env).toEqual({
      HOME: "/Users/me",
      PATH: ["/usr/bin", "/bin", "/opt/homebrew/bin", ...wellKnown].join(":"),
      CLAUDE_CONFIG_DIR: "/Users/me/.claude-work",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth",
      CLAUDE_CODE_USE_BEDROCK: "1",
      ANTHROPIC_BASE_URL: "https://gateway.example.com",
      LANG: "en_US.UTF-8",
      ELECTRON_RUN_AS_NODE: "1",
    });
    expect(agentEnvironment(base, DIRECT)).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(agentEnvironment({ HOME: "/Users/me" }, DIRECT).PATH).toBe(wellKnownBinDirs({ platform: process.platform, home: "/Users/me", env: {} }).join(":"));
  });

  it.skipIf(process.platform === "win32")("puts the Node version managers' folders on PATH too, when they're there", async () => {
    const home = path.join(dir, "home");
    const mise = path.join(home, ".local", "share", "mise", "installs", "node", "22.12.0", "bin");
    await mkdir(mise, { recursive: true });
    await mkdir(path.join(home, ".asdf", "shims"), { recursive: true });
    expect(agentEnvironment({ HOME: home, PATH: "/usr/bin" }, DIRECT).PATH.split(":").slice(-2)).toEqual([mise, path.join(home, ".asdf", "shims")]);
  });
});

describe("parseAuthStatus", () => {
  it("reads the adapter's pushes and ignores anything else", () => {
    expect(parseAuthStatus({ authStatus: { kind: "api_key", label: "Anthropic API key", detail: "ANTHROPIC_API_KEY" } })).toEqual({ kind: "api_key", label: "Anthropic API key", email: null, plan: null, detail: "ANTHROPIC_API_KEY" });
    expect(parseAuthStatus({ authStatus: { kind: "account", label: "Claude Pro", account: { plan: "pro", email: "me@example.com", organization: "Me" } } })).toEqual({ kind: "account", label: "Claude Pro", email: "me@example.com", plan: "pro", detail: null });
    for (const malformed of [null, {}, { authStatus: null }, { authStatus: { kind: "account" } }, { authStatus: { kind: "robot", label: "?" } }, { authStatus: { kind: 3, label: "x" } }, { authStatus: [] }]) expect(parseAuthStatus(malformed)).toBeNull();
  });
});
