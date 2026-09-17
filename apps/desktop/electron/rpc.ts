/**
 * Request/response bridge so the main process can call handlers registered in a renderer.
 *
 * The protocol is transport-agnostic (tests drive it with plain functions); {@link createRendererRpcHub}
 * wires it to Electron IPC. The preload uses {@link createRpcServer} on the renderer side.
 */

import { IPC } from "./ipc.ts";

export interface RpcRequestMessage {
  id: number;
  method: string;
  params?: unknown;
}

export interface SerializedRpcError {
  message: string;
  code?: string;
  name?: string;
  data?: unknown;
}

export type RpcResponseMessage = { id: number; ok: true; result?: unknown } | { id: number; ok: false; error: SerializedRpcError };

/** Error codes raised by the bridge itself. Handler errors keep their own `code` or use "handler_error". */
export type RpcBridgeErrorCode = "timeout" | "no_handler" | "disposed" | "renderer_gone" | "aborted" | "send_failed" | "invalid_method";

export class RpcError extends Error {
  readonly code: string;
  readonly data: unknown;

  constructor(message: string, code: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

export function isRpcRequest(value: unknown): value is RpcRequestMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "number" && typeof v.method === "string";
}

export function isRpcResponse(value: unknown): value is RpcResponseMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "number" || typeof v.ok !== "boolean") return false;
  return v.ok || (!!v.error && typeof v.error === "object" && typeof (v.error as Record<string, unknown>).message === "string");
}

/** Turn anything thrown by a handler into a cloneable error payload. */
export function serializeError(err: unknown): SerializedRpcError {
  if (err instanceof Error) {
    const e = err as Error & { code?: unknown; data?: unknown };
    return {
      message: e.message || e.name,
      name: e.name,
      code: typeof e.code === "string" ? e.code : "handler_error",
      ...(e.data !== undefined ? { data: toCloneable(e.data) } : {}),
    };
  }
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    return {
      message: typeof o.message === "string" ? o.message : "Handler failed",
      code: typeof o.code === "string" ? o.code : "handler_error",
      data: toCloneable(o),
    };
  }
  return { message: typeof err === "string" ? err : String(err), code: "handler_error" };
}

function toCloneable(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as unknown;
    } catch {
      return undefined;
    }
  }
}

export interface RpcInvokeOptions {
  /** Overrides the client's default timeout. 0 disables the timeout. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RpcClient {
  invoke<T = unknown>(method: string, params?: unknown, opts?: RpcInvokeOptions): Promise<T>;
  /** Feed a response message; returns true when it matched a pending request. */
  handleResponse(message: unknown): boolean;
  /** Record the renderer's registered methods (informational; unknown until first report). */
  setMethods(methods: readonly string[]): void;
  /** Whether the renderer reported a handler for `method`; undefined before any report. */
  hasMethod(method: string): boolean | undefined;
  readonly pendingCount: number;
  /** Reject every pending request. Later invokes fail with the same code. */
  dispose(code?: RpcBridgeErrorCode, message?: string): void;
}

export interface RpcClientOptions {
  send(message: RpcRequestMessage): void;
  /** Default 15 s. */
  defaultTimeoutMs?: number;
}

interface Pending {
  resolve(value: unknown): void;
  reject(err: RpcError): void;
  cleanup(): void;
}

export function createRpcClient(opts: RpcClientOptions): RpcClient {
  const defaultTimeoutMs = opts.defaultTimeoutMs ?? 15_000;
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let methods: Set<string> | null = null;
  let disposed: { code: RpcBridgeErrorCode; message: string } | null = null;

  return {
    invoke<T>(method: string, params?: unknown, invokeOpts: RpcInvokeOptions = {}): Promise<T> {
      if (disposed) return Promise.reject(new RpcError(disposed.message, disposed.code));
      if (!method) return Promise.reject(new RpcError("Method name is required", "invalid_method"));
      if (invokeOpts.signal?.aborted) return Promise.reject(new RpcError(`Call to ${method} was aborted`, "aborted"));

      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        const timeoutMs = invokeOpts.timeoutMs ?? defaultTimeoutMs;
        const timer = timeoutMs > 0 ? setTimeout(() => settleError(new RpcError(`Renderer didn't answer ${method} within ${timeoutMs} ms`, "timeout")), timeoutMs) : null;
        const onAbort = () => settleError(new RpcError(`Call to ${method} was aborted`, "aborted"));
        invokeOpts.signal?.addEventListener("abort", onAbort, { once: true });

        const entry: Pending = {
          resolve: (value) => resolve(value as T),
          reject,
          cleanup: () => {
            if (timer) clearTimeout(timer);
            invokeOpts.signal?.removeEventListener("abort", onAbort);
            pending.delete(id);
          },
        };
        function settleError(err: RpcError) {
          if (!pending.has(id)) return;
          entry.cleanup();
          reject(err);
        }
        pending.set(id, entry);

        try {
          opts.send(params === undefined ? { id, method } : { id, method, params });
        } catch (err) {
          settleError(new RpcError(`Couldn't send ${method}: ${err instanceof Error ? err.message : String(err)}`, "send_failed"));
        }
      });
    },

    handleResponse(message: unknown): boolean {
      if (!isRpcResponse(message)) return false;
      const entry = pending.get(message.id);
      if (!entry) return false;
      entry.cleanup();
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new RpcError(message.error.message, message.error.code ?? "handler_error", message.error.data));
      return true;
    },

    setMethods(list: readonly string[]) {
      methods = new Set(list);
    },

    hasMethod(method: string) {
      return methods ? methods.has(method) : undefined;
    },

    get pendingCount() {
      return pending.size;
    },

    dispose(code: RpcBridgeErrorCode = "disposed", message = "RPC bridge was closed") {
      disposed = { code, message };
      for (const entry of [...pending.values()]) {
        entry.cleanup();
        entry.reject(new RpcError(message, code));
      }
    },
  };
}

export type RpcHandlerFn = (params: unknown) => unknown;

export interface RpcServer {
  /** Register a handler; returns an unregister function. */
  handle(method: string, fn: RpcHandlerFn): () => void;
  methods(): string[];
  /** Handle one incoming request and send its response. */
  dispatch(message: unknown): Promise<void>;
}

export interface RpcServerOptions {
  send(response: RpcResponseMessage): void;
  onMethodsChanged?(methods: string[]): void;
}

const FAILURE_TAG = "__sonobeRpcFailure";

/** A handler result that the server turns into an error response (survives context bridges). */
export interface RpcFailure {
  [FAILURE_TAG]: true;
  code: string;
  message: string;
  data?: unknown;
}

/** Build a failure result: `return rpc.fail("not_found", "No layer card_9")`. */
export function createRpcFailure(code: string, message: string, data?: unknown): RpcFailure {
  return { [FAILURE_TAG]: true, code: String(code), message: String(message), ...(data !== undefined ? { data } : {}) };
}

export function isRpcFailure(value: unknown): value is RpcFailure {
  return !!value && typeof value === "object" && (value as Record<string, unknown>)[FAILURE_TAG] === true;
}

export function createRpcServer(opts: RpcServerOptions): RpcServer {
  const handlers = new Map<string, RpcHandlerFn>();
  const notify = () => opts.onMethodsChanged?.([...handlers.keys()].sort());

  return {
    handle(method, fn) {
      if (typeof method !== "string" || !method) throw new TypeError("rpc.handle: method must be a non-empty string");
      if (typeof fn !== "function") throw new TypeError("rpc.handle: handler must be a function");
      handlers.set(method, fn);
      notify();
      return () => {
        if (handlers.get(method) === fn) {
          handlers.delete(method);
          notify();
        }
      };
    },

    methods: () => [...handlers.keys()].sort(),

    async dispatch(message) {
      if (!isRpcRequest(message)) return;
      const handler = handlers.get(message.method);
      if (!handler) {
        opts.send({ id: message.id, ok: false, error: { message: `No handler registered for "${message.method}"`, code: "no_handler" } });
        return;
      }
      let response: RpcResponseMessage;
      try {
        const result = await handler(message.params);
        response = isRpcFailure(result)
          ? { id: message.id, ok: false, error: { message: result.message, code: result.code, ...(result.data !== undefined ? { data: result.data } : {}) } }
          : { id: message.id, ok: true, result };
      } catch (err) {
        response = { id: message.id, ok: false, error: serializeError(err) };
      }
      try {
        opts.send(response);
      } catch (err) {
        opts.send({ id: message.id, ok: false, error: { message: `Result of ${message.method} couldn't be sent: ${err instanceof Error ? err.message : String(err)}`, code: "unserializable_result" } });
      }
    },
  };
}

/** The subset of Electron's WebContents the hub needs. */
export interface RpcTarget {
  readonly id: number;
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  once(event: "destroyed", listener: () => void): unknown;
}

export interface RpcIpcEvent {
  readonly sender: RpcTarget;
}

/** The subset of Electron's ipcMain the hub needs. */
export interface RpcIpcMainLike {
  on(channel: string, listener: (event: RpcIpcEvent, payload: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: RpcIpcEvent, payload: unknown) => void): unknown;
}

export interface RendererRpcHub {
  invoke<T = unknown>(target: RpcTarget, method: string, params?: unknown, opts?: RpcInvokeOptions): Promise<T>;
  hasMethod(target: RpcTarget, method: string): boolean | undefined;
  dispose(): void;
}

export interface RendererRpcHubOptions {
  defaultTimeoutMs?: number;
  /** Reject messages from untrusted senders (e.g. frames outside the app). */
  isTrustedSender?(event: RpcIpcEvent): boolean;
}

/** Main-process side of the bridge: one client per renderer WebContents. */
export function createRendererRpcHub(ipcMain: RpcIpcMainLike, opts: RendererRpcHubOptions = {}): RendererRpcHub {
  const clients = new Map<number, RpcClient>();

  const clientFor = (target: RpcTarget): RpcClient => {
    let client = clients.get(target.id);
    if (client) return client;
    client = createRpcClient({
      send: (message) => {
        if (target.isDestroyed()) throw new Error("renderer is gone");
        target.send(IPC.rpcRequest, message);
      },
      ...(opts.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: opts.defaultTimeoutMs } : {}),
    });
    clients.set(target.id, client);
    target.once("destroyed", () => {
      clients.get(target.id)?.dispose("renderer_gone", "The editor window closed before answering");
      clients.delete(target.id);
    });
    return client;
  };

  const trusted = (event: RpcIpcEvent) => (opts.isTrustedSender ? opts.isTrustedSender(event) : true);

  const onResponse = (event: RpcIpcEvent, payload: unknown) => {
    if (!trusted(event)) return;
    clients.get(event.sender.id)?.handleResponse(payload);
  };
  const onMethods = (event: RpcIpcEvent, payload: unknown) => {
    if (!trusted(event) || !Array.isArray(payload)) return;
    clientFor(event.sender).setMethods(payload.filter((m): m is string => typeof m === "string"));
  };

  ipcMain.on(IPC.rpcResponse, onResponse);
  ipcMain.on(IPC.rpcMethods, onMethods);

  return {
    invoke<T>(target: RpcTarget, method: string, params?: unknown, invokeOpts?: RpcInvokeOptions) {
      if (target.isDestroyed()) return Promise.reject(new RpcError("The editor window is closed", "renderer_gone"));
      return clientFor(target).invoke<T>(method, params, invokeOpts);
    },
    hasMethod(target, method) {
      return clients.get(target.id)?.hasMethod(method);
    },
    dispose() {
      ipcMain.removeListener(IPC.rpcResponse, onResponse);
      ipcMain.removeListener(IPC.rpcMethods, onMethods);
      for (const client of clients.values()) client.dispose();
      clients.clear();
    },
  };
}
