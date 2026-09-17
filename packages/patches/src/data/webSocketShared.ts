/**
 * The shared WebSocket plumbing: the structural platform socket (PlatformServices has no
 * WebSocket member yet, CONVENTIONS.md §19.7), per-runtime connection records that Connection
 * fills and Send and Receive read, and the connection handle that travels on `any` ports.
 */

import type { RuntimeServices } from "@sonobe/engine";
import { isPlainObject } from "../infra/index.ts";

/** A socket as a host provides it through `platform.webSocket`. */
export interface PlatformWebSocket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  readonly bufferedAmount?: number;
  onopen?: (() => void) | null;
  onmessage?: ((text: string) => void) | null;
  onclose?: ((code: number, reason?: string) => void) | null;
  onerror?: ((message?: string) => void) | null;
}

export type PlatformWebSocketFactory = (url: string, options: { protocols: string[]; headers: Record<string, string> }) => PlatformWebSocket;

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
  const factory = (services.platform as { webSocket?: unknown }).webSocket;
  return typeof factory === "function" ? (factory as PlatformWebSocketFactory) : undefined;
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
