#!/usr/bin/env node
/**
 * A fake of Claude's agent adapter (@agentclientprotocol/claude-agent-acp) for Sonobe's tests. CI
 * points SONOBE_CLAUDE_AGENT at this file instead of the real adapter, so no test ever needs a Claude
 * account or an API key. Plain Node ESM, since Electron runs it as Node too.
 *
 * It speaks ACP on stdio like the adapter (the SDK's AgentSideConnection), and "thinks" by keyword:
 * the prompt's last text block is the person's message, and the first rule it matches (case-
 * insensitive) picks a scripted reply that streams text and calls Sonobe's tools over the http MCP
 * server named in session/new, the way Claude Code does: tool_call, tool_call_update with the input,
 * session/request_permission for a tool not in the session's allowedTools, then tools/call with
 * _meta "claudecode/toolUseId", then tool_call_update with the result.
 *
 *   FAKE_CLAUDE_AUTH=none, "signedout"  session/prompt fails with auth_required (-32000)
 *   "crash"                             says "About to crash.", writes to stderr, exits with code 7
 *   "sessionend"                        its Claude Code dies: the prompt fails with the adapter's "process exited
 *                                       unexpectedly", and later ones with "Session not found"; the fake runs on
 *   "limit" / "ratelimit"               says the CLI's usage-limit / 429 text, then fails the prompt with it
 *   "plainerror"                        fails the prompt with a plain Error, as the adapter does when its Claude Code
 *                                       fails otherwise: the SDK sends -32603 "Internal error" with the text in data.details
 *   "hang"                              says "Working on it…", then waits for session/cancel
 *   "bare"                              calls get_outline by its short name, as Claude sometimes does: it runs only
 *                                       when the session's toolAliases map it (else "No such tool available")
 *   "save" / "open"                     save_document {} / open_document { ref: "/tmp/fake.sonobe" }
 *   "replace <id>"                      the design flow, replacing layer <id>
 *   "wire", "interactive"               get_outline, then add_patches: press feedback on the first “Pay” layer
 *   a <canvas_context> block, "design"  the design flow: get_outline, preview_design ×3, import_design { preview: true }
 *   anything else, "echo"               "Echo: <message>" in three chunks
 *
 * Permission modes, like the adapter's (which reads the person's own Claude Code settings for the
 * first one): FAKE_CLAUDE_MODE picks the mode a session starts in (default "default"), clamped to
 * "default" when bypassPermissions isn't allowed. session/set_mode and the "mode" config option change
 * it (FAKE_CLAUDE_MODE_LOCKED=1: they fail). "default" asks before a tool outside allowedTools;
 * "acceptEdits", "auto" and "bypassPermissions" run it without asking (the worst case); "plan" refuses
 * every tool the MCP server doesn't mark read-only.
 *
 * Also: `--version` prints 0.0.0-fake; `--cli auth login …` prints "fake claude login"; `--cli auth status
 * --json` prints the CLI's JSON (exit 1 when signed out, as the CLI does). FAKE_CLAUDE_LOG=<file> appends
 * a JSON line for tests to read per message it gets (header values redacted), `--cli` run ("cli"),
 * mode change ("mode"), tool run without asking ("unasked") or refused in plan mode ("plan_refused"),
 * and MCP result. FAKE_CLAUDE_NO_CLOSE=1 leaves session/close out of its capabilities.
 */

import { appendFileSync, writeSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, RequestError } from "@agentclientprotocol/sdk";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const VERSION = "0.0.0-fake";
const signedOut = process.env.FAKE_CLAUDE_AUTH === "none";

function log(kind, data) {
  if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ kind, ...data })}\n`);
}

/** stdout at once: a pipe is asynchronous, and these exit right after. */
const print = (text) => writeSync(1, `${text}\n`);

const args = process.argv.slice(2);
if (args.includes("--cli")) {
  // The adapter hands everything after --cli to its Claude Code.
  const cli = args.filter((arg) => arg !== "--cli");
  log("cli", { args: cli });
  if (cli[0] === "auth" && cli[1] === "login") {
    print("fake claude login");
    process.exit(0);
  }
  if (cli[0] === "auth" && cli[1] === "status" && cli.includes("--json")) {
    // `claude auth status --json`, the shape the adapter's fromCliStatus reads.
    const account = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "fake@example.com", subscriptionType: "max" };
    print(JSON.stringify(signedOut ? { loggedIn: false, authMethod: "none", apiProvider: "firstParty" } : account));
    process.exit(signedOut ? 1 : 0);
  }
  console.error(`fake claude: ${cli.join(" ")} isn't faked`);
  process.exit(2);
}
if (args.includes("--version")) {
  print(VERSION);
  process.exit(0);
}

/** The adapter's model option (0.79.0): aliases, not the model ids Sonobe's catalog uses. */
const MODELS = [
  { value: "default", name: "Default (recommended)", description: "Opus (1M context)" },
  { value: "opus[1m]", name: "Opus 5", description: "Opus 5 with 1M context" },
  { value: "sonnet", name: "Sonnet 5", description: "Sonnet 5" },
  { value: "sonnet[1m]", name: "Sonnet 5 (1M context)", description: "Sonnet 5 for long sessions" },
  { value: "haiku", name: "Haiku 4.5", description: "Haiku 4.5" },
];
/** The adapter's permission modes; bypassPermissions only when the session allows it. */
const MODES = [
  { id: "default", name: "Manual", description: "Always ask before making changes" },
  { id: "acceptEdits", name: "Accept edits", description: "Automatically accept all file edits" },
  { id: "plan", name: "Plan", description: "Create a plan before making changes" },
  { id: "auto", name: "Auto", description: "Claude handles permission decisions" },
  { id: "bypassPermissions", name: "Bypass permissions", description: "Accepts all permissions" },
];
/** The modes that ask before a tool outside allowedTools. */
const ASKING_MODES = new Set(["default", "plan"]);
const USAGE = { inputTokens: 1200, outputTokens: 300, cachedReadTokens: 20000, cachedWriteTokens: 0, totalTokens: 21500 };
const DECLINED_TEXT = "The user doesn't want to proceed with this tool use.";
const PLAN_TEXT = "Claude Code is in plan mode, so it didn't run a tool that makes changes.";
/** What the adapter rejects a prompt with when its Claude Code dies (acp-agent.js, 0.79.0). */
const SESSION_DIED = "The Claude Agent process exited unexpectedly. Please start a new session.";
/** What the adapter throws when its Claude Code fails to run (a plain Error, so the SDK sends its text as data.details). */
const PLAIN_ERROR = "Claude Code process exited with code 1";
/** The CLI's texts for a plan's usage limit and a transient 429. */
const USAGE_LIMIT_TEXT = "You've hit your limit · resets 3pm";
const RATE_LIMIT_TEXT = "API Error: 429 rate_limit_error";

/** session/new's params as logged: every MCP header value replaced, so the bearer token never lands in a file. */
function redacted(params) {
  const mcpServers = (params.mcpServers ?? []).map((s) => ({ ...s, ...(s.headers ? { headers: s.headers.map((h) => ({ name: h.name, value: "<redacted>" })) } : {}) }));
  return { ...params, mcpServers };
}

// A small checkout page in three parts: head, theme and header; the order; the pay button. The top
// 62 points (the status bar) stay empty.
const CHECKOUT_PAGE = [
  `<!doctype html>
<html><head><meta name="viewport" content="width=402"><title>Checkout</title>
<style>
  body { margin: 0; width: 402px; background: #F5F5F7; color: #111118; font-family: -apple-system, system-ui, sans-serif; }
  main { box-sizing: border-box; min-height: 874px; padding: 62px 20px 34px; display: flex; flex-direction: column; gap: 16px; }
  h1 { margin: 0; font-size: 34px; line-height: 41px; font-weight: 700; }
  .card { background: #FFFFFF; border-radius: 16px; padding: 4px 16px; }
  .row { display: flex; justify-content: space-between; padding: 12px 0; font-size: 17px; }
  .row + .row { border-top: 1px solid #E5E5EA; }
  .promo { color: #0A84FF; }
  .total { padding: 0 4px; font-size: 20px; font-weight: 600; }
  .pay { margin-top: auto; height: 52px; border: 0; border-radius: 14px; background: #000000; color: #FFFFFF; font: 600 19px -apple-system, system-ui, sans-serif; }
</style></head>
<body><main data-name="Checkout">
  <header data-name="Header"><h1>Checkout</h1></header>
`,
  `  <section class="card" data-name="Order">
    <div class="row"><span>Linen shirt</span><span>$48.00</span></div>
    <div class="row"><span>Shipping</span><span>Free</span></div>
    <div class="row promo" data-name="Promo Code"><span>Promo code</span><span>Add</span></div>
  </section>
  <div class="row total" data-name="Total"><span>Total</span><span>$48.00</span></div>
`,
  `  <button class="pay" data-name="Pay Button">Pay with Apple Pay</button>
</main></body></html>
`,
];

/** The first layer in get_outline's text whose name contains `word`, and its component. */
function findLayer(outline, word) {
  let component;
  for (const line of outline.split("\n")) {
    const inComponent = /^component (\S+)/.exec(line);
    if (inComponent) component = inComponent[1];
    const layer = /^\s*layer (\S+) \S+ "([^"]*)"/.exec(line);
    if (layer && layer[2].includes(word)) return { id: layer[1], name: layer[2], component };
  }
  return null;
}

/** The JSON line of a <canvas_context> block ({} when it has none), or null without a block. */
function canvasContext(block) {
  if (!block) return null;
  for (const line of block.split("\n").slice(1)) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") return value;
    } catch {
      // Not the JSON line.
    }
  }
  return {};
}

class Declined extends Error {}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

/** `promise`, or a rejection once `signal` aborts. */
const unlessAborted = (promise, signal) =>
  Promise.race([promise, new Promise((_resolve, reject) => (signal.aborted ? reject(signal.reason) : signal.addEventListener("abort", () => reject(signal.reason), { once: true })))]);

const sessions = new Map();
let sessionCount = 0;
let messageCount = 0;
let toolCount = 0;

/** Like the adapter's: an unknown session is a plain Error, which the SDK sends as -32603 with data.details. */
function sessionOf(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found");
  return session;
}

const modeOption = (session) => ({ id: "mode", name: "Mode", description: "Session permission mode", category: "mode", type: "select", currentValue: session.mode, options: session.modes.map((m) => ({ value: m.id, name: m.name, description: m.description })) });
const modelOption = (session) => ({ id: "model", name: "Model", description: "AI model to use", category: "model", type: "select", currentValue: session.model, options: MODELS });
const configOptions = (session) => [modeOption(session), modelOption(session)];

/** A value of the model option, or the one a model id names by its family (claude-opus-5 → opus[1m]), like the adapter's resolveModelPreference. */
function resolveModel(value) {
  const exact = MODELS.find((m) => m.value === value);
  if (exact) return exact;
  const family = /\b(opus|sonnet|haiku)\b/.exec(value.toLowerCase())?.[1];
  const candidates = MODELS.filter((m) => family && m.value.startsWith(family));
  const long = /\[1m\]$/i.test(value);
  return candidates.find((m) => m.value.endsWith("[1m]") === long) ?? candidates[0] ?? null;
}

function setMode(session, mode, via) {
  if (!session.modes.some((m) => m.id === mode)) throw new Error(via === "set_mode" ? `Mode ${mode} is not available in this session` : `Invalid value for config option mode: ${mode}`);
  if (process.env.FAKE_CLAUDE_MODE_LOCKED === "1") throw new Error("Invalid Mode");
  log("mode", { sessionId: session.id, from: session.mode, to: mode, via });
  session.mode = mode;
}

/** The session's MCP client, connected on first use to the http server session/new named. */
function mcpClient(session) {
  session.mcp ??= (async () => {
    const server = session.params.mcpServers?.find((s) => s.type === "http");
    if (!server) throw new Error("session/new named no http MCP server.");
    const client = new Client({ name: "claude-code", version: VERSION });
    const headers = Object.fromEntries((server.headers ?? []).map((h) => [h.name, h.value]));
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
    return client;
  })().catch((err) => {
    session.mcp = null;
    throw err;
  });
  return session.mcp;
}

/** Whether the session's MCP server marks `name` read-only (readOnlyHint), the only tools plan mode runs. A server it can't list marks none. */
async function readOnly(session, name, signal) {
  session.readOnly ??= mcpClient(session)
    .then((client) => client.listTools())
    .then(({ tools }) => new Set(tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name)))
    .catch(() => new Set());
  return (await unlessAborted(session.readOnly, signal)).has(name);
}

/** One reply (a prompt turn) of one session. */
function turn(conn, session, signal) {
  let messageId = null;
  const update = (u) => conn.sessionUpdate({ sessionId: session.id, update: u });

  /** Text of the current model response (a tool call ends a response; the next text starts another). */
  const say = async (text) => {
    messageId ??= `msg_fake_${++messageCount}`;
    await update({ sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } });
    await sleep(10, signal);
  };

  /**
   * A tool call as Claude Code makes it. Resolves with the MCP result and its text; throws Declined when the person says no.
   * `bare`: Claude named the tool without its mcp__sonobe__ prefix, as it sometimes does after reading the guide: like Claude
   * Code, the call runs only when the session's toolAliases map that name, else it fails with "No such tool available".
   */
  const tool = async (name, input, { bare = false } = {}) => {
    messageId = null;
    const toolCallId = `toolu_fake_${++toolCount}`;
    const emitted = bare ? name : `mcp__sonobe__${name}`;
    const full = `mcp__sonobe__${name}`;
    const meta = { claudeCode: { toolName: emitted } };
    await update({ sessionUpdate: "tool_call", toolCallId, name: emitted, title: emitted, kind: "other", status: "pending", rawInput: {}, _meta: meta });
    await sleep(10, signal);
    await update({ sessionUpdate: "tool_call_update", toolCallId, rawInput: input, _meta: meta });
    if (bare && session.params._meta?.claudeCode?.options?.toolAliases?.[name] !== full) {
      const text = `\`\`\`\n<tool_use_error>Error: No such tool available: ${name}</tool_use_error>\n\`\`\``;
      log("no_such_tool", { sessionId: session.id, toolCallId, tool: name });
      await update({ sessionUpdate: "tool_call_update", toolCallId, status: "failed", content: [{ type: "content", content: { type: "text", text } }], _meta: meta });
      return { isError: true, content: [{ type: "text", text }], text };
    }
    if (session.mode === "plan" && !(await readOnly(session, name, signal))) {
      log("plan_refused", { sessionId: session.id, toolCallId, tool: name });
      await update({ sessionUpdate: "tool_call_update", toolCallId, status: "failed", content: [{ type: "content", content: { type: "text", text: PLAN_TEXT } }] });
      await say("I'm in plan mode, so I didn't change anything.");
      throw new Declined();
    }
    if (!session.allowed.has(full) && !ASKING_MODES.has(session.mode)) {
      // Claude Code runs it without a question in these modes.
      log("unasked", { sessionId: session.id, toolCallId, tool: name, mode: session.mode });
    } else if (!session.allowed.has(full)) {
      const options = [
        { optionId: "allow-once", name: "Yes", kind: "allow_once" },
        { optionId: "allow-with-updates", name: `Yes, and don't ask again for ${name.replace(/^\w/, (c) => c.toUpperCase())} commands`, kind: "allow_always" },
        { optionId: "reject", name: "No", kind: "reject_once" },
      ];
      const toolCall = { toolCallId, name: full, title: full, kind: "other", status: "pending", rawInput: input, _meta: { claudeCode: { toolName: full, mcpServer: { name: "sonobe", source: "dynamic" } } } };
      const answer = await unlessAborted(conn.requestPermission({ sessionId: session.id, toolCall, options }), signal);
      const chosen = answer.outcome.outcome === "selected" ? options.find((o) => o.optionId === answer.outcome.optionId) : undefined;
      log("permission", { sessionId: session.id, toolCallId, tool: name, outcome: answer.outcome, optionKind: chosen?.kind ?? null });
      if (!chosen || chosen.kind.startsWith("reject")) {
        await update({ sessionUpdate: "tool_call_update", toolCallId, status: "failed", content: [{ type: "content", content: { type: "text", text: DECLINED_TEXT } }] });
        await say("Okay, I won't.");
        throw new Declined();
      }
      if (chosen.kind === "allow_always") session.allowed.add(full);
    }
    let result;
    try {
      const client = await unlessAborted(mcpClient(session), signal);
      // Like Claude Code: a progress token, and progress keeps a long call alive.
      result = await client.callTool({ name, arguments: input, _meta: { "claudecode/toolUseId": toolCallId } }, { signal, timeout: 1_800_000, onprogress: () => undefined, resetTimeoutOnProgress: true });
    } catch (err) {
      if (signal.aborted) throw err;
      // Claude Code hands a failed call to Claude as an error result.
      result = { isError: true, content: [{ type: "text", text: `MCP error: ${err instanceof Error ? err.message : String(err)}` }] };
    }
    const texts = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text);
    log("mcp_result", { sessionId: session.id, toolCallId, tool: name, isError: result.isError === true, text: (texts[0] ?? "").split("\n")[0] });
    await update({ sessionUpdate: "tool_call_update", toolCallId, status: result.isError ? "failed" : "completed", content: [{ type: "content", content: { type: "text", text: texts[0] ?? "" } }], rawOutput: result.content, _meta: meta });
    return { ...result, text: texts.join("\n") };
  };

  /** Claude Code died under the adapter: it forgets the session, closes its MCP connection, and keeps running. */
  const end = async () => {
    sessions.delete(session.id);
    await (await session.mcp?.catch(() => null))?.close();
  };

  return { say, tool, end, signal };
}

/** The design flow: draw the checkout on the canvas part by part, then import the draft. */
async function design(t, context, replace) {
  await t.say("I'll design a checkout screen that matches your prototype.");
  await t.tool("get_outline", { detail: "styles" });
  const component = context?.component?.id;
  const target = replace ?? context?.target?.id;
  const [head, ...sections] = CHECKOUT_PAGE;
  await t.tool("preview_design", { name: "Checkout", ...(component ? { component } : {}), ...(target ? { replace: target } : {}), html: head });
  for (const section of sections) {
    await sleep(150, t.signal);
    await t.tool("preview_design", { append: section });
  }
  const imported = await t.tool("import_design", { preview: true });
  if (imported.isError) await t.say(`I didn't add it: ${imported.text.split("\n")[0]}`);
  else await t.say("Added a checkout screen with Apple Pay and a promo code. Try “Make it interactive” next.");
}

/** Press feedback on the first layer named like “Pay”: Interaction → Pop Animation → Transition → its scale. */
async function wire(t) {
  const outline = await t.tool("get_outline", { detail: "compact" });
  const pay = findLayer(outline.text, "Pay");
  if (!pay) return t.say("I couldn't find a “Pay” layer to wire. Design the checkout first.");
  const wired = await t.tool("add_patches", {
    ...(pay.component ? { component: pay.component } : {}),
    patches: [
      { ref: "press", type: "interaction", name: "Pay Pressed", inputs: { layer: { layer: pay.id } } },
      { ref: "spring", type: "popAnimation", typeParam: "number", name: "Pay Press Spring", inputs: { number: { link: "$press.down" }, bounciness: 5, speed: 20 } },
      { ref: "shrink", type: "transition", typeParam: "number", name: "Pay Press Scale", inputs: { progress: { link: "$spring.output" }, start: 1, end: 0.96 } },
    ],
    connections: [{ from: "$shrink.output", to: `@${pay.id}.scale` }],
    label: "Wire a tap on Pay",
  });
  await t.say(wired.isError ? `I couldn't wire it: ${wired.text.split("\n")[0]}` : "Wired a tap on “Pay”.");
}

async function reply(t, message, context) {
  const has = (pattern) => pattern.test(message);
  if (has(/\bcrash\b/i)) {
    await t.say("About to crash.");
    // Let the chunk out first: stdout to a pipe is asynchronous.
    await new Promise((resolve) => process.stdout.write("", resolve));
    writeSync(2, "fake crash: something broke\n");
    process.exit(7);
  }
  if (has(/\bsessionend\b/i)) {
    await t.say("About to end the session.");
    await t.end();
    throw RequestError.internalError(undefined, SESSION_DIED);
  }
  if (has(/\bplainerror\b/i)) {
    await t.say("Working on it…");
    throw new Error(PLAIN_ERROR);
  }
  // A client that isn't AIR gets the CLI's own text streamed, then the prompt fails with it ("Internal error: <text>").
  const limit = has(/\blimit\b/i) ? USAGE_LIMIT_TEXT : has(/\bratelimit\b/i) ? RATE_LIMIT_TEXT : null;
  if (limit) {
    await t.say(limit);
    throw RequestError.internalError({ errorKind: "rate_limit" }, limit);
  }
  if (has(/\bhang\b/i)) {
    await t.say("Working on it…");
    return new Promise((_resolve, reject) => t.signal.addEventListener("abort", () => reject(t.signal.reason), { once: true }));
  }
  if (has(/\bbare\b/i)) {
    const read = await t.tool("get_outline", { detail: "compact" }, { bare: true });
    return t.say(read.isError ? "That tool wasn't there." : "Read the outline by its short name.");
  }
  if (has(/\bsave\b/i)) {
    const saved = await t.tool("save_document", {});
    return t.say(saved.isError ? `It didn't save: ${saved.text.split("\n")[0]}` : "Saved it.");
  }
  if (has(/\bopen\b/i)) {
    const opened = await t.tool("open_document", { ref: "/tmp/fake.sonobe" });
    return t.say(opened.isError ? `It didn't open: ${opened.text.split("\n")[0]}` : "Opened it.");
  }
  const replace = /\breplace\s+([^\s"'“”.,]+)/i.exec(message);
  if (replace) return design(t, context, replace[1]);
  if (has(/\bwire\b|\binteractive\b/i)) return wire(t);
  if (context || has(/\bdesign/i)) return design(t, context, undefined);
  const echo = `Echo: ${message}`;
  const third = Math.ceil(echo.length / 3);
  for (let i = 0; i < echo.length; i += third) await t.say(echo.slice(i, i + third));
}

const agent = (conn) => ({
  async initialize(params) {
    log("initialize", { params });
    setTimeout(() => {
      const authStatus = signedOut ? { kind: "none", label: "Not logged in" } : { kind: "account", label: "Claude Max", account: { plan: "max", email: "fake@example.com" } };
      void conn.extNotification("_auth/status_update", { authStatus });
    }, 20);
    return {
      protocolVersion: 1,
      agentCapabilities: {
        mcpCapabilities: { http: true, sse: false },
        promptCapabilities: { image: false, embeddedContext: false },
        sessionCapabilities: process.env.FAKE_CLAUDE_NO_CLOSE === "1" ? {} : { close: {} },
      },
      agentInfo: { name: "fake-claude-agent", title: "Fake Claude Agent", version: VERSION },
      authMethods: [],
    };
  },
  async newSession(params) {
    log("session/new", { params: redacted(params) });
    const options = params._meta?.claudeCode?.options ?? {};
    const modes = MODES.filter((m) => m.id !== "bypassPermissions" || options.allowDangerouslySkipPermissions !== false);
    const requested = process.env.FAKE_CLAUDE_MODE ?? "default";
    // The model option reads "default" whatever options.model asked for, as the adapter's does.
    const session = { id: `fake-${++sessionCount}`, params, allowed: new Set(options.allowedTools ?? []), model: "default", modes, mode: modes.some((m) => m.id === requested) ? requested : "default", mcp: null, readOnly: null, running: null };
    sessions.set(session.id, session);
    return { sessionId: session.id, modes: { currentModeId: session.mode, availableModes: modes }, configOptions: configOptions(session) };
  },
  async setSessionMode(params) {
    log("session/set_mode", { params });
    const session = sessionOf(params.sessionId);
    setMode(session, params.modeId, "set_mode");
    await conn.sessionUpdate({ sessionId: session.id, update: { sessionUpdate: "config_option_update", configOptions: configOptions(session) } });
    return {};
  },
  async setSessionConfigOption(params) {
    log("session/set_config_option", { params });
    const session = sessionOf(params.sessionId);
    if (params.configId === "mode") {
      setMode(session, params.value, "config_option");
      await conn.sessionUpdate({ sessionId: session.id, update: { sessionUpdate: "current_mode_update", currentModeId: session.mode } });
    } else if (params.configId === "model") {
      const model = typeof params.value === "string" ? resolveModel(params.value) : null;
      if (!model) throw new Error(`Invalid value for config option model: ${params.value}`);
      session.model = model.value;
    } else throw new Error(`Unknown config option: ${params.configId}`);
    return { configOptions: configOptions(session) };
  },
  async closeSession(params) {
    log("session/close", { params });
    const session = sessionOf(params.sessionId);
    sessions.delete(params.sessionId);
    session.running?.abort();
    await (await session.mcp?.catch(() => null))?.close();
    return {};
  },
  async authenticate() {
    return {};
  },
  async cancel(params) {
    log("session/cancel", { params });
    sessions.get(params.sessionId)?.running?.abort(new Error("Cancelled"));
  },
  async prompt(params) {
    const texts = params.prompt.filter((b) => b.type === "text").map((b) => b.text);
    const message = texts.at(-1) ?? "";
    log("session/prompt", { sessionId: params.sessionId, text: texts.join("\n\n"), message });
    const session = sessionOf(params.sessionId);
    if (signedOut || /signedout/i.test(message)) throw RequestError.authRequired();
    const context = canvasContext(texts.slice(0, -1).find((text) => text.startsWith("<canvas_context>")));
    const running = new AbortController();
    session.running = running;
    try {
      await reply(turn(conn, session, running.signal), message, context);
      return { stopReason: "end_turn", usage: USAGE };
    } catch (err) {
      if (running.signal.aborted) return { stopReason: "cancelled" };
      if (err instanceof Declined) return { stopReason: "end_turn", usage: USAGE };
      throw err;
    } finally {
      if (session.running === running) session.running = null;
    }
  },
});

const connection = new AgentSideConnection(agent, ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
// Like the adapter: gone once the client closes stdin.
void connection.closed.then(() => process.exit(0));
