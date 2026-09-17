import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IPC } from "./ipc.ts";
import {
  RpcError,
  createRendererRpcHub,
  createRpcClient,
  createRpcFailure,
  createRpcServer,
  isRpcFailure,
  serializeError,
  type RpcIpcEvent,
  type RpcRequestMessage,
  type RpcResponseMessage,
  type RpcTarget,
} from "./rpc.ts";

/** Client and server wired back to back, with async hops like real IPC. */
function pair(opts: { timeoutMs?: number } = {}) {
  let client: ReturnType<typeof createRpcClient>;
  const server = createRpcServer({ send: (response) => queueMicrotask(() => client.handleResponse(response)) });
  client = createRpcClient({ send: (request) => queueMicrotask(() => void server.dispatch(request)), ...(opts.timeoutMs !== undefined ? { defaultTimeoutMs: opts.timeoutMs } : {}) });
  return { client, server };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("rpc client/server", () => {
  it("round-trips results, including async handlers", async () => {
    const { client, server } = pair();
    server.handle("math.add", (p) => {
      const { a, b } = p as { a: number; b: number };
      return a + b;
    });
    server.handle("doc.info", async () => ({ name: "Main", revision: 3 }));
    await expect(client.invoke("math.add", { a: 2, b: 3 })).resolves.toBe(5);
    await expect(client.invoke("doc.info")).resolves.toEqual({ name: "Main", revision: 3 });
    expect(client.pendingCount).toBe(0);
  });

  it("correlates concurrent calls by id", async () => {
    const { client, server } = pair();
    server.handle("wait", async (p) => {
      const ms = p as number;
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    const results = await Promise.all([client.invoke("wait", 30), client.invoke("wait", 5), client.invoke("wait", 15)]);
    expect(results).toEqual([30, 5, 15]);
  });

  it("propagates handler errors with code and data", async () => {
    const { client, server } = pair();
    server.handle("apply", () => {
      throw Object.assign(new Error("Unknown port popAnimation.nubmer"), { code: "unknown_port", data: { suggestions: ["number"] } });
    });
    server.handle("plain", () => {
      throw { code: "not_found", message: "No layer card_9" };
    });
    const err = await client.invoke("apply").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(err).toMatchObject({ message: "Unknown port popAnimation.nubmer", code: "unknown_port", data: { suggestions: ["number"] } });
    await expect(client.invoke("plain")).rejects.toMatchObject({ code: "not_found", message: "No layer card_9" });
  });

  it("turns failure results into error responses", async () => {
    const { client, server } = pair();
    server.handle("layers.get", () => createRpcFailure("not_found", "No layer card_9", { id: "card_9" }));
    await expect(client.invoke("layers.get")).rejects.toMatchObject({ code: "not_found", message: "No layer card_9", data: { id: "card_9" } });
    expect(isRpcFailure({ code: "x", message: "y" })).toBe(false);
  });

  it("answers unknown methods with no_handler instead of timing out", async () => {
    const { client } = pair({ timeoutMs: 50 });
    await expect(client.invoke("nope")).rejects.toMatchObject({ code: "no_handler" });
  });

  it("times out when the renderer never answers", async () => {
    vi.useFakeTimers();
    const client = createRpcClient({ send: () => undefined, defaultTimeoutMs: 1000 });
    const promise = client.invoke("slow");
    const assertion = expect(promise).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    expect(client.pendingCount).toBe(0);
    // A late response is ignored.
    expect(client.handleResponse({ id: 1, ok: true, result: 1 })).toBe(false);
  });

  it("honors per-call timeouts and abort signals", async () => {
    vi.useFakeTimers();
    const client = createRpcClient({ send: () => undefined, defaultTimeoutMs: 0 });
    const quick = client.invoke("x", undefined, { timeoutMs: 10 });
    const quickAssertion = expect(quick).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(11);
    await quickAssertion;

    const controller = new AbortController();
    const aborted = client.invoke("y", undefined, { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: "aborted" });
  });

  it("rejects pending and future calls on dispose", async () => {
    const client = createRpcClient({ send: () => undefined });
    const pending = client.invoke("x");
    client.dispose("renderer_gone", "gone");
    await expect(pending).rejects.toMatchObject({ code: "renderer_gone" });
    await expect(client.invoke("y")).rejects.toMatchObject({ code: "renderer_gone" });
  });

  it("reports send failures", async () => {
    const client = createRpcClient({
      send: () => {
        throw new Error("object could not be cloned");
      },
    });
    await expect(client.invoke("x", { fn: () => 1 })).rejects.toMatchObject({ code: "send_failed" });
  });

  it("unregisters only the handler it registered", async () => {
    const methods: string[][] = [];
    const server = createRpcServer({ send: () => undefined, onMethodsChanged: (m) => methods.push(m) });
    const first = server.handle("a", () => 1);
    server.handle("a", () => 2);
    first();
    expect(server.methods()).toEqual(["a"]);
    expect(methods.at(-1)).toEqual(["a"]);
  });

  it("serializes unusual throwables", () => {
    expect(serializeError("boom")).toEqual({ message: "boom", code: "handler_error" });
    expect(serializeError(new TypeError("bad"))).toMatchObject({ message: "bad", name: "TypeError", code: "handler_error" });
  });
});

class FakeWebContents extends EventEmitter implements RpcTarget {
  readonly id: number;
  destroyed = false;
  readonly sent: { channel: string; payload: unknown }[] = [];

  constructor(id: number) {
    super();
    this.id = id;
  }

  send(channel: string, payload: unknown) {
    this.sent.push({ channel, payload });
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

describe("createRendererRpcHub", () => {
  it("routes requests to a webContents and resolves from ipc responses", async () => {
    const ipc = new EventEmitter();
    const hub = createRendererRpcHub(ipc as never);
    const wc = new FakeWebContents(7);
    const promise = hub.invoke(wc, "document.save", { reason: "close" });
    expect(wc.sent[0]).toEqual({ channel: IPC.rpcRequest, payload: { id: 1, method: "document.save", params: { reason: "close" } } });
    const request = wc.sent[0]!.payload as RpcRequestMessage;
    ipc.emit(IPC.rpcResponse, { sender: wc } satisfies RpcIpcEvent, { id: request.id, ok: true, result: true } satisfies RpcResponseMessage);
    await expect(promise).resolves.toBe(true);
    hub.dispose();
  });

  it("ignores responses from other windows and untrusted senders", async () => {
    vi.useFakeTimers();
    const ipc = new EventEmitter();
    let trusted = false;
    const hub = createRendererRpcHub(ipc as never, { defaultTimeoutMs: 100, isTrustedSender: () => trusted });
    const a = new FakeWebContents(1);
    const b = new FakeWebContents(2);
    const promise = hub.invoke(a, "x");
    const assertion = expect(promise).rejects.toMatchObject({ code: "timeout" });
    ipc.emit(IPC.rpcResponse, { sender: a }, { id: 1, ok: true, result: "spoofed" });
    trusted = true;
    ipc.emit(IPC.rpcResponse, { sender: b }, { id: 1, ok: true, result: "wrong window" });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    hub.dispose();
  });

  it("tracks registered methods per window", () => {
    const ipc = new EventEmitter();
    const hub = createRendererRpcHub(ipc as never);
    const wc = new FakeWebContents(3);
    expect(hub.hasMethod(wc, "document.save")).toBeUndefined();
    ipc.emit(IPC.rpcMethods, { sender: wc }, ["document.save", 42]);
    expect(hub.hasMethod(wc, "document.save")).toBe(true);
    expect(hub.hasMethod(wc, "other")).toBe(false);
    hub.dispose();
  });

  it("rejects pending calls when the window is destroyed", async () => {
    const ipc = new EventEmitter();
    const hub = createRendererRpcHub(ipc as never);
    const wc = new FakeWebContents(4);
    const promise = hub.invoke(wc, "screenshot");
    wc.destroy();
    await expect(promise).rejects.toMatchObject({ code: "renderer_gone" });
    await expect(hub.invoke(wc, "again")).rejects.toMatchObject({ code: "renderer_gone" });
    hub.dispose();
  });

  it("removes its ipc listeners on dispose", () => {
    const ipc = new EventEmitter();
    const hub = createRendererRpcHub(ipc as never);
    expect(ipc.listenerCount(IPC.rpcResponse)).toBe(1);
    hub.dispose();
    expect(ipc.listenerCount(IPC.rpcResponse)).toBe(0);
    expect(ipc.listenerCount(IPC.rpcMethods)).toBe(0);
  });
});
