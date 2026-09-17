/**
 * The shared WebSocket plumbing: the host's socket factory (`platform.webSocket`), per-runtime
 * connection records that Connection fills and Send and Receive read, and the connection handle
 * that travels on "connection" ports.
 */

import type { PlatformServices, PlatformWebSocket, RuntimeServices } from "@sonobe/engine";
import { isPlainObject } from "../infra/index.ts";

export type { PlatformWebSocket } from "@sonobe/engine";

/** The host's socket factory: `platform.webSocket(url, { protocols, headers })`. */
export type PlatformWebSocketFactory = NonNullable<PlatformServices["webSocket"]>;

export type ConnectionPhase = "idle" | "connecting" | "open" | "ended";

export interface WebSocketMessage {
  text: string;
  /** Filled the first time a JSON receiver reads the message. */
  parsed?: { ok: boolean; value: unknown };
}

export interface ConnectionRecord {
  socket: PlatformWebSocket | null;
  phase: ConnectionPhase;
  /** The frame Connection last evaluated; messages belong to that frame. */
  frame: number;
  messages: WebSocketMessage[];
  sendError: string | null;
  sendOk: boolean;
}

/** The opaque value on a Connection output: which connection record to use. */
export interface ConnectionHandle {
  readonly kind: "webSocket";
  readonly key: string;
}

const records = new WeakMap<RuntimeServices, Map<string, ConnectionRecord>>();

/** Connection records for one runtime, keyed by "<componentPath>/<patchId>". */
export function connectionRecords(services: RuntimeServices): Map<string, ConnectionRecord> {
  let map = records.get(services);
  if (!map) records.set(services, (map = new Map()));
  return map;
}

export function createConnectionRecord(): ConnectionRecord {
  return { socket: null, phase: "idle", frame: -1, messages: [], sendError: null, sendOk: false };
}

export function isConnectionHandle(value: unknown): value is ConnectionHandle {
  return isPlainObject(value) && value.kind === "webSocket" && typeof value.key === "string";
}

/** The record behind a handle, or undefined when `handle` isn't a live WebSocket handle. */
export function lookupRecord(services: RuntimeServices, handle: unknown): ConnectionRecord | undefined {
  return isConnectionHandle(handle) ? records.get(services)?.get(handle.key) : undefined;
}

/** The host's socket factory, when it has one. */
export function webSocketFactory(services: RuntimeServices): PlatformWebSocketFactory | undefined {
  const factory = services.platform.webSocket;
  return typeof factory === "function" ? factory : undefined;
}

/** JSON text with object keys sorted, for comparing header sets. */
export function stableStringify(value: unknown): string {
  const seen = new Set<unknown>();
  const walk = (v: unknown): unknown => {
    if (typeof v !== "object" || v === null) return v;
    if (seen.has(v)) return null;
    seen.add(v);
    const out = Array.isArray(v) ? v.map(walk) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk((v as Record<string, unknown>)[k])]));
    seen.delete(v);
    return out;
  };
  return JSON.stringify(walk(value)) ?? "null";
}
