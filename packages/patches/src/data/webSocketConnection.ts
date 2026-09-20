/** WebSocket Connection: keeps a WebSocket open while Connect is on and relays its messages. */

import type { PatchContext } from "@sonobe/engine";
import { MAX_LOOP_LENGTH, definePatch, isPlainObject, toBool, toText, warnOnce } from "../infra/index.ts";
import { errorText } from "./shared.ts";
import {
  connectionRecords,
  createConnectionRecord,
  stableStringify,
  webSocketFactory,
  type ConnectionHandle,
  type ConnectionPhase,
  type ConnectionRecord,
  type PlatformWebSocket,
} from "./webSocketShared.ts";

/** Most messages kept for one frame; older ones are dropped. */
export const MAX_FRAME_MESSAGES = MAX_LOOP_LENGTH;

type SocketEvent = { kind: "open" } | { kind: "message"; text: string } | { kind: "close"; code: number; reason: string } | { kind: "error"; message: string };

interface Target {
  url: string;
  headersKey: string;
}

export interface WebSocketConnectionState {
  socket: PlatformWebSocket | null;
  phase: ConnectionPhase;
  target: Target | null;
  error: boolean;
  errorMessage: string;
  events: SocketEvent[];
  /** Callbacks from sockets opened before the current one are ignored. */
  generation: number;
  previousConnect: boolean;
  key: string;
  handle: ConnectionHandle | null;
}

function closeSocket(s: WebSocketConnectionState): void {
  const socket = s.socket;
  s.generation++;
  s.events = [];
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close(1000, "closed by prototype");
    } catch {
      // The socket is gone either way.
    }
  }
  s.socket = null;
  s.phase = "idle";
}

function endWithError(s: WebSocketConnectionState, message: string): void {
  s.phase = "ended";
  s.error = true;
  s.errorMessage = message;
}

function openSocket(ctx: PatchContext, s: WebSocketConnectionState, target: Target, headerInput: unknown): void {
  s.error = false;
  s.errorMessage = "";
  s.target = target;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(target.url)?.[1]?.toLowerCase();
  let url = target.url;
  if (scheme === "http" || scheme === "https") url = (scheme === "http" ? "ws" : "wss") + url.slice(scheme.length);
  else if (scheme !== "ws" && scheme !== "wss") return endWithError(s, "WebSocket URLs start with wss:// or ws://.");
  if (!isPlainObject(headerInput)) return endWithError(s, "Headers must be a JSON object.");

  const headers: Record<string, string> = {};
  let protocols: string[] = [];
  for (const [name, value] of Object.entries(headerInput)) {
    if (value === null || value === undefined) continue;
    const text = typeof value === "object" ? (JSON.stringify(value) ?? "") : String(value);
    if (name.toLowerCase() === "sec-websocket-protocol") {
      protocols = text
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
    } else headers[name] = text;
  }
  const factory = webSocketFactory(ctx.services);
  if (!factory) return endWithError(s, "This viewer can't open WebSockets.");
  // Every host opens sockets with the browser's WebSocket (the desktop app's viewer too), which sends no custom headers.
  if (Object.keys(headers).length > 0) {
    warnOnce(ctx, "browserHeaders", "Sonobe can't send WebSocket headers yet, because browsers don't let pages set them; only Sec-WebSocket-Protocol reaches the server. Put a token in the URL instead.");
  }

  let socket: PlatformWebSocket;
  try {
    socket = factory(url, { protocols, headers });
  } catch (e) {
    return endWithError(s, errorText(e));
  }
  const generation = ++s.generation;
  const push = (event: SocketEvent) => {
    if (generation === s.generation) s.events.push(event);
  };
  socket.onopen = () => push({ kind: "open" });
  socket.onmessage = (text) => push({ kind: "message", text: String(text) });
  socket.onclose = (code, reason) => push({ kind: "close", code: Number(code), reason: reason ? String(reason) : "" });
  socket.onerror = (message) => push({ kind: "error", message: message ? String(message) : "" });
  s.socket = socket;
  s.phase = "connecting";
}

function drain(ctx: PatchContext, s: WebSocketConnectionState, record: ConnectionRecord): void {
  const events = s.events;
  s.events = [];
  for (const event of events) {
    switch (event.kind) {
      case "open":
        s.phase = "open";
        s.error = false;
        s.errorMessage = "";
        break;
      case "message":
        record.messages.push({ text: event.text });
        break;
      case "close":
        if (s.phase === "idle") break;
        s.phase = "ended";
        s.socket = null;
        if (event.code === 1000 || event.code === 1001) {
          s.error = false;
          s.errorMessage = "The server closed the connection.";
        } else {
          s.error = true;
          s.errorMessage = `The connection was lost (code ${event.code}).${event.reason ? ` ${event.reason}` : ""}`;
        }
        break;
      case "error":
        s.error = true;
        s.errorMessage = event.message || "Couldn't connect. Check the URL and that the server is running.";
        break;
    }
  }
  if (record.messages.length > MAX_FRAME_MESSAGES) {
    record.messages.splice(0, record.messages.length - MAX_FRAME_MESSAGES);
    warnOnce(ctx, "backlog", "More than 10,000 WebSocket messages arrived in one frame; the oldest were dropped.");
  }
}

export const webSocketConnection = definePatch<WebSocketConnectionState>("webSocketConnection", {
  mutedBehavior: "evaluate",
  state: () => ({
    socket: null,
    phase: "idle",
    target: null,
    error: false,
    errorMessage: "",
    events: [],
    generation: 0,
    previousConnect: false,
    key: "",
    handle: null,
  }),
  evaluate(ctx) {
    const s = ctx.state;
    const key = `${ctx.componentPath}/${ctx.id}`;
    if (!s.handle || s.key !== key) {
      s.key = key;
      s.handle = Object.freeze({ kind: "webSocket" as const, key });
    }
    const records = connectionRecords(ctx.services);
    let record = records.get(key);
    if (!record) records.set(key, (record = createConnectionRecord()));

    if (ctx.muted) {
      closeSocket(s);
      s.previousConnect = false;
      record.socket = null;
      record.phase = "idle";
      record.messages = [];
      ctx.output("connection", null);
      ctx.output("connected", false);
      ctx.output("connecting", false);
      ctx.output("error", false);
      ctx.output("errorMessage", "");
      return;
    }

    const connectItems = ctx.inputItems("connect");
    const urlItems = ctx.inputItems("url");
    const headerItems = ctx.inputItems("headers");
    if (connectItems.length > 1 || urlItems.length > 1 || headerItems.length > 1) {
      warnOnce(ctx, "loop", "WebSocket Connection can't be looped; using the first item.");
    }
    const connect = toBool(connectItems[0] ?? false);
    const url = toText(urlItems[0] ?? "").trim();
    const headers = headerItems.length > 0 ? headerItems[0] : {};

    record.messages = [];
    record.frame = ctx.frame;
    drain(ctx, s, record);
    if (record.sendError !== null) {
      s.error = true;
      s.errorMessage = record.sendError;
      record.sendError = null;
    } else if (record.sendOk && s.phase === "open" && s.error) {
      s.error = false;
      s.errorMessage = "";
    }
    record.sendOk = false;

    const rose = connect && !s.previousConnect;
    s.previousConnect = connect;
    const next: Target = { url, headersKey: stableStringify(headers) };
    if (!connect || url === "") closeSocket(s);
    else if (s.phase === "idle" || rose || !s.target || s.target.url !== next.url || s.target.headersKey !== next.headersKey) {
      closeSocket(s);
      openSocket(ctx, s, next, headers);
    }
    record.socket = s.socket;
    record.phase = s.phase;

    ctx.output("connection", s.handle as never);
    ctx.output("connected", s.phase === "open");
    ctx.output("connecting", s.phase === "connecting");
    ctx.output("error", s.error);
    ctx.output("errorMessage", s.errorMessage);
    if (s.phase === "connecting" || s.phase === "open") ctx.requestNextFrame();
  },
  dispose(state, services) {
    closeSocket(state);
    if (state.key) connectionRecords(services).delete(state.key);
  },
});
