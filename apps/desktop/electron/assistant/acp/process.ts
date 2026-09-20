/**
 * Claude's agent adapter as a child process, and Sonobe's side of its ACP connection: the SDK's
 * ClientSideConnection over the child's stdio (newline-delimited JSON-RPC). The app runs one, and the
 * engine (./engine.ts) opens an ACP session on it per window's chat. Sonobe offers the adapter no
 * file system and no terminal, so Claude works through Sonobe's MCP tools only. Electron-free: a JS
 * entry runs with Electron's own Node through ELECTRON_RUN_AS_NODE (./locate.ts).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError, type Client, type InitializeResponse, type RequestPermissionResponse, type SessionNotification } from "@agentclientprotocol/sdk";
import { wellKnownBinDirs } from "./locate.ts";
import { AgentExitedError, AgentStartError, type AcpAgentProcess, type AgentAuthStatus, type AgentExit, type ClaudeAgentSpec, type CreateAcpAgentProcess, type PermissionHandler } from "./types.ts";

/**
 * Left out of the adapter's environment: a stray API key or token would pay instead of the person's
 * subscription, Claude Code's own variables would make it think it runs inside Claude Code, and
 * ELECTRON_RUN_AS_NODE is set again only for a JS entry.
 */
const REMOVED_ENV = new Set(["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT", "CLAUDE_PROJECT_DIR", "ELECTRON_RUN_AS_NODE"]);

const DEFAULT_INITIALIZE_TIMEOUT_MS = 20_000;
const KILL_AFTER_MS = 3_000;
/** How long an exited process's last stderr has to arrive. */
const STDERR_DRAIN_MS = 500;
const STDERR_TAIL_CHARS = 2_000;
/** A longer stderr line is left out of the tail (it's never the useful one). */
const MAX_STDERR_LINE = 16_384;
/** stderr lines that could hold a secret (an Anthropic key or OAuth token, a bearer token): never kept, so never logged. */
const SECRET_LINE = /sk-ant-|\bBearer\s+\S{16,}/i;
const REDACTED_LINE = "[redacted: the line held a key or token]";
const LONG_LINE = "[left out: a line over 16 KB]";
/**
 * A frame of Node's native stack trace (" 7: 0x102f8a5d8 v8::internal::…"). Dozens follow a fatal
 * error such as running out of heap, and would push the line that says so out of the tail, so each
 * run of them is kept as one line.
 */
const NATIVE_FRAME = /^\s*\d+: 0x[0-9a-f]+ /i;
const NATIVE_FRAMES = "[left out: Node's native stack trace]";

const AUTH_STATUS_METHOD = "_auth/status_update";
const AUTH_KINDS: ReadonlySet<string> = new Set<AgentAuthStatus["kind"]>(["account", "api_key", "gateway", "external", "none"]);
const CANCELLED: RequestPermissionResponse = { outcome: { outcome: "cancelled" } };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** The agent's plain errors reach Sonobe as -32603 "Internal error" with the text in data.details. */
export const detailsOf = (err: unknown) => (err instanceof RequestError && isRecord(err.data) && typeof err.data.details === "string" ? err.data.details : null);
/** An error's message with the agent's details, for the log. */
export const messageOf = (err: unknown) => {
  const details = detailsOf(err);
  return err instanceof Error ? `${err.message}${details ? `: ${details}` : ""}` : String(err);
};

/**
 * The adapter's environment: `base` without REMOVED_ENV, plus the spec's own variables, with the
 * well-known bin folders appended to PATH (an app opened from the Finder gets a bare one). Everything
 * else stays, CLAUDE_CONFIG_DIR, CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CODE_USE_* and ANTHROPIC_BASE_URL included.
 */
export function agentEnvironment(base: Record<string, string | undefined>, spec: ClaudeAgentSpec): Record<string, string> {
  const windows = process.platform === "win32";
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined && !REMOVED_ENV.has(windows ? key.toUpperCase() : key)) env[key] = value;
  Object.assign(env, spec.env);
  const pathKey = (windows && Object.keys(env).find((key) => key.toUpperCase() === "PATH")) || "PATH";
  const delimiter = windows ? ";" : ":";
  const dirs = (env[pathKey] ?? "").split(delimiter).filter(Boolean);
  for (const dir of wellKnownBinDirs({ platform: process.platform, home: base.HOME || os.homedir(), env: base })) if (!dirs.includes(dir)) dirs.push(dir);
  env[pathKey] = dirs.join(delimiter);
  return env;
}

/** The adapter's `_auth/status_update` params as Sonobe keeps them, or null when they aren't what the adapter sends. */
export function parseAuthStatus(params: unknown): AgentAuthStatus | null {
  const raw = isRecord(params) ? params.authStatus : undefined;
  if (!isRecord(raw) || typeof raw.kind !== "string" || !AUTH_KINDS.has(raw.kind) || typeof raw.label !== "string") return null;
  const account = isRecord(raw.account) ? raw.account : {};
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  return { kind: raw.kind as AgentAuthStatus["kind"], label: raw.label, email: text(account.email), plan: text(account.plan), detail: text(raw.detail) };
}

/** The last lines of the adapter's stderr, at most STDERR_TAIL_CHARS, with secret-shaped lines redacted and native stack traces left out. */
function stderrTail() {
  let kept = "";
  let partial = "";
  let skipping = false;
  /** The last line kept was a native stack frame's. */
  let inFrames = false;
  /** The end of `text`, at most STDERR_TAIL_CHARS, from the start of a line. */
  const last = (text: string) => {
    if (text.length <= STDERR_TAIL_CHARS) return text;
    const cut = text.slice(-STDERR_TAIL_CHARS);
    const start = cut.indexOf("\n");
    return start >= 0 && start < cut.length - 1 ? cut.slice(start + 1) : cut;
  };
  const keep = (line: string) => {
    const frame = NATIVE_FRAME.test(line);
    if (frame && inFrames) return;
    inFrames = frame;
    kept = last(`${kept}${frame ? NATIVE_FRAMES : SECRET_LINE.test(line) ? REDACTED_LINE : line.replace(/\r$/, "")}\n`);
  };
  return {
    write(chunk: string) {
      let text = partial + chunk;
      partial = "";
      for (let end = text.indexOf("\n"); end >= 0; end = text.indexOf("\n")) {
        keep(skipping ? LONG_LINE : text.slice(0, end));
        skipping = false;
        text = text.slice(end + 1);
      }
      if (skipping) return;
      if (text.length > MAX_STDERR_LINE) skipping = true;
      else partial = text;
    },
    text(): string {
      const frame = !skipping && NATIVE_FRAME.test(partial);
      const unfinished = skipping ? LONG_LINE : frame ? (inFrames ? "" : NATIVE_FRAMES) : partial && SECRET_LINE.test(partial) ? REDACTED_LINE : partial;
      return last(`${kept}${unfinished}`.trimEnd());
    },
  };
}

const seconds = (ms: number) => `${Number((ms / 1000).toFixed(1))} seconds`;

/** Start the adapter and send initialize at once (`ready`). See AcpAgentProcess in ./types.ts. */
export const createAcpAgentProcess: CreateAcpAgentProcess = (options) => {
  const { spec } = options;
  const log = options.log ?? (() => undefined);
  const timeoutMs = options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS;
  const sessionListeners = new Map<string, Set<(notification: SessionNotification) => void>>();
  const permissionHandlers = new Map<string, PermissionHandler>();
  const authListeners = new Set<(status: AgentAuthStatus) => void>();
  // Aborts when the process is gone, so a permission question stops waiting for the person.
  const lifetime = new AbortController();
  const stderr = stderrTail();
  let authStatus: AgentAuthStatus | null = null;
  let exit: AgentExit | null = null;
  let exiting = false;
  /** Sonobe stopped it (dispose, or no answer to initialize), so its exit is expected. */
  let stopping = false;
  let spawnError: NodeJS.ErrnoException | null = null;
  let canCloseSessions = false;

  let settleExit: (exit: AgentExit) => void = () => undefined;
  const exited = new Promise<AgentExit>((resolve) => (settleExit = resolve));
  // Rejects every request still waiting when the process goes.
  const gone = exited.then((info) => Promise.reject(new AgentExitedError(info)));
  gone.catch(() => undefined);

  const finish = (code: number | null, signal: string | null) => {
    if (exit) return;
    exit = { code, signal, stderrTail: stderr.text() };
    lifetime.abort();
    const how = code !== null ? `code ${code}` : signal ?? "no exit code";
    if (spawnError) log("error", `Claude's agent adapter didn't start (${spawnError.code ?? spawnError.message}).`);
    else if (stopping || code === 0) log("info", `Claude's agent adapter exited (${how}).`);
    else log("warn", `Claude's agent adapter exited (${how}).${exit.stderrTail ? ` Its last output:\n${exit.stderrTail}` : ""}`);
    settleExit(exit);
  };

  log("info", `Starting Claude's agent adapter: ${spec.displayPath}${spec.version ? ` (${spec.version})` : ""}.`);
  let child: ChildProcess | null = null;
  try {
    mkdirSync(options.cwd, { recursive: true, mode: 0o700 });
    child = spawn(spec.command, spec.args, { cwd: options.cwd, env: agentEnvironment(options.baseEnv ?? process.env, spec), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  } catch (err) {
    spawnError = err instanceof Error ? err : new Error(String(err));
    finish(null, null);
  }

  let connection: ClientSideConnection | null = null;
  if (child) {
    const proc = child;
    let spawned = false;
    proc.once("spawn", () => (spawned = true));
    proc.on("error", (err) => {
      if (spawned) return log("warn", `Claude's agent adapter: ${err.message}`);
      spawnError = err;
      finish(null, null);
    });
    proc.once("exit", (code, signal) => {
      exiting = true;
      // Its last words may still be in the pipe.
      const drained = new Promise<void>((resolve) => {
        if (!proc.stderr || proc.stderr.readableEnded) return resolve();
        proc.stderr.once("end", () => resolve());
        proc.stderr.once("close", () => resolve());
        setTimeout(resolve, STDERR_DRAIN_MS);
      });
      void drained.then(() => finish(code, signal));
    });
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => stderr.write(chunk));
    // A write after the process is gone fails with EPIPE; the exit reports it.
    proc.stdin?.on("error", () => undefined);

    /** Tell each listener; one that throws doesn't stop the rest. */
    const tell = <T>(listeners: Iterable<(value: T) => void> | undefined, value: T) => {
      for (const listener of [...(listeners ?? [])]) {
        try {
          listener(value);
        } catch (err) {
          log("error", `A listener for Claude's agent adapter failed: ${messageOf(err)}`);
        }
      }
    };
    const client: Client = {
      sessionUpdate(notification) {
        tell(sessionListeners.get(notification.sessionId), notification);
      },
      async requestPermission(request) {
        const handler = permissionHandlers.get(request.sessionId);
        if (!handler || lifetime.signal.aborted) return CANCELLED;
        try {
          return await handler(request, lifetime.signal);
        } catch (err) {
          log("warn", `Answering Claude's permission question failed, so it's cancelled: ${messageOf(err)}`);
          return CANCELLED;
        }
      },
      extNotification(method, params) {
        if (method !== AUTH_STATUS_METHOD) return;
        const status = parseAuthStatus(params);
        if (!status) return log("warn", `Claude's agent adapter sent an ${AUTH_STATUS_METHOD} Sonobe can't read, so it's ignored.`);
        authStatus = status;
        tell(authListeners, status);
      },
      // Not offered in initialize's clientCapabilities, so the adapter shouldn't ask.
      readTextFile() {
        throw RequestError.methodNotFound("fs/read_text_file");
      },
      writeTextFile() {
        throw RequestError.methodNotFound("fs/write_text_file");
      },
      createTerminal() {
        throw RequestError.methodNotFound("terminal/create");
      },
    };
    connection = new ClientSideConnection(() => client, ndJsonStream(Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>));
  }

  /** Close stdin, then SIGTERM, then SIGKILL after KILL_AFTER_MS. */
  const terminate = () => {
    if (!child || exit || exiting) return;
    stopping = true;
    const proc = child;
    proc.stdin?.end();
    proc.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (!exit && !exiting) proc.kill("SIGKILL");
    }, KILL_AFTER_MS);
    void exited.then(() => clearTimeout(timer));
  };

  /** One request, rejected with AgentExitedError when the process goes first. The agent's own refusals stay RequestErrors. */
  async function send<T>(request: (conn: ClientSideConnection) => Promise<T>): Promise<T> {
    if (exit || !connection) throw new AgentExitedError(exit ?? { code: null, signal: null, stderrTail: "" });
    try {
      return await Promise.race([request(connection), gone]);
    } catch (err) {
      if (err instanceof RequestError || err instanceof AgentExitedError) throw err;
      if (!connection.signal.aborted) throw err;
      // The connection closed under the request (the adapter's stdout ended): it's on its way out.
      const timer = setTimeout(terminate, KILL_AFTER_MS);
      const info = await exited;
      clearTimeout(timer);
      throw new AgentExitedError(info);
    }
  }

  const ready: Promise<InitializeResponse> = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new AgentStartError(`it didn't answer within ${seconds(timeoutMs)}`)), timeoutMs);
    });
    try {
      const init = await Promise.race([
        send((conn) =>
          conn.initialize({
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
            clientInfo: { name: "sonobe", title: "Sonobe", version: options.clientVersion },
          }),
        ),
        timeout,
      ]);
      canCloseSessions = Boolean(init.agentCapabilities?.sessionCapabilities?.close);
      const agent = init.agentInfo ? `${init.agentInfo.name} ${init.agentInfo.version}` : "an unnamed agent";
      log("info", `Claude's agent adapter is ready: ${agent}, ACP ${init.protocolVersion}.`);
      return init;
    } catch (err) {
      if (spawnError) throw new AgentStartError(`Sonobe couldn't run ${spec.displayPath} (${spawnError.code ?? spawnError.message})`, exit);
      if (err instanceof AgentStartError) {
        log("error", `Claude's agent adapter didn't start: ${err.message}.`);
        terminate();
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  })();
  ready.catch(() => undefined);

  /** A request once initialize has answered. */
  const request = async <T>(call: (conn: ClientSideConnection) => Promise<T>): Promise<T> => {
    await ready;
    return send(call);
  };

  return {
    spec,
    ready,
    exited,
    get authStatus() {
      return authStatus;
    },
    get alive() {
      return !exit && !exiting;
    },
    onAuthStatus(listener) {
      authListeners.add(listener);
      return () => void authListeners.delete(listener);
    },
    newSession: (params) => request((conn) => conn.newSession(params)),
    prompt: (params) => request((conn) => conn.prompt(params)),
    setSessionConfigOption: (params) => request((conn) => conn.setSessionConfigOption(params)),
    async cancel(sessionId) {
      try {
        await request((conn) => conn.cancel({ sessionId }));
      } catch (err) {
        if (!(err instanceof AgentExitedError || err instanceof AgentStartError)) log("warn", `Claude's agent adapter didn't take the cancel: ${messageOf(err)}`);
      }
    },
    async closeSession(sessionId) {
      permissionHandlers.delete(sessionId);
      sessionListeners.delete(sessionId);
      if (!canCloseSessions || exit || exiting) return;
      try {
        await request((conn) => conn.closeSession({ sessionId }));
      } catch (err) {
        // "Session not found": the adapter ended it already (its Claude Code died), so it's closed.
        if (!(err instanceof AgentExitedError) && detailsOf(err) !== "Session not found") log("warn", `Claude's agent adapter didn't close its session: ${messageOf(err)}`);
      }
    },
    onSessionUpdate(sessionId, listener) {
      const listeners = sessionListeners.get(sessionId) ?? new Set();
      listeners.add(listener);
      sessionListeners.set(sessionId, listeners);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && sessionListeners.get(sessionId) === listeners) sessionListeners.delete(sessionId);
      };
    },
    setPermissionHandler(sessionId, handler) {
      if (handler) permissionHandlers.set(sessionId, handler);
      else permissionHandlers.delete(sessionId);
    },
    async dispose() {
      terminate();
      await exited;
    },
  } satisfies AcpAgentProcess;
};
