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

describe("rpc client and a page that starts, reloads or crashes", () => {
  function client(opts: { pageWaitMs?: number; timeoutMs?: number } = {}) {
    const sent: RpcRequestMessage[] = [];
    const c = createRpcClient({ send: (request) => sent.push(request), defaultTimeoutMs: opts.timeoutMs ?? 15_000, ...(opts.pageWaitMs !== undefined ? { pageWaitMs: opts.pageWaitMs } : {}) });
    return { client: c, sent, answer: (id: number, result: unknown) => c.handleResponse({ id, ok: true, result }) };
  }

  it("holds a call until the starting page registers its method", async () => {
    vi.useFakeTimers();
    const { client: c, sent, answer } = client();
    c.pageStarting();
    const info = c.invoke("document.info");
    // The preload reports in first, then the editor registers its handlers.
    c.setMethods([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toEqual([]);
    c.setMethods(["document.info"]);
    expect(sent).toEqual([{ id: 1, method: "document.info" }]);
    answer(1, { name: "Main" });
    await expect(info).resolves.toEqual({ name: "Main" });
  });

  it("sends anyway when the page's wait runs out, and doesn't wait on a page that's up", async () => {
    vi.useFakeTimers();
    const { client: c, sent } = client({ pageWaitMs: 1000 });
    c.setMethods(["document.info"]);
    void c.invoke("viewer.bounds").catch(() => undefined);
    await vi.advanceTimersByTimeAsync(999);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent.map((m) => m.method)).toEqual(["viewer.bounds"]);
    // Long after the page started, a method it never registered goes out at once (and gets no_handler).
    void c.invoke("graph.geometry").catch(() => undefined);
    expect(sent.map((m) => m.method)).toEqual(["viewer.bounds", "graph.geometry"]);
  });

  it("times out a held call with the call's own limit, saying it wasn't sent", async () => {
    vi.useFakeTimers();
    const { client: c, sent } = client({ timeoutMs: 1500 });
    c.pageStarting();
    const flush = c.invoke("drafts.flush");
    const assertion = expect(flush).rejects.toMatchObject({ code: "timeout", message: "The editor didn't finish loading within 1500 ms, so drafts.flush wasn't sent" });
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
    expect(sent).toEqual([]);
    expect(c.pendingCount).toBe(0);
  });

  it("fails what the page hadn't answered when it goes, forgets its methods, and waits for the next page", async () => {
    vi.useFakeTimers();
    const { client: c, sent, answer } = client();
    c.setMethods(["document.apply", "document.info"]);
    await vi.advanceTimersByTimeAsync(20_000);
    const apply = c.invoke("document.apply", { ops: [] });
    expect(sent).toHaveLength(1);
    c.pageGone("crashed");
    await expect(apply).rejects.toMatchObject({ code: "page_gone", message: "The editor crashed before it answered document.apply", data: { reason: "crashed" } });
    expect(c.hasMethod("document.info")).toBeUndefined();

    const info = c.invoke("document.info");
    expect(sent).toHaveLength(1);
    // The crashed editor loads again: a held call keeps waiting through the reload.
    await vi.advanceTimersByTimeAsync(3000);
    c.pageGone("reloaded");
    await vi.advanceTimersByTimeAsync(9000);
    expect(sent).toHaveLength(1);
    c.setMethods(["document.info"]);
    expect(sent.at(-1)).toEqual({ id: 2, method: "document.info" });
    answer(2, { name: "Untitled" });
    await expect(info).resolves.toEqual({ name: "Untitled" });
    // A late answer from the page that went away matches nothing.
    expect(answer(1, {})).toBe(false);
  });

  it("rejects held calls on dispose", async () => {
    const { client: c } = client();
    c.pageStarting();
    const held = c.invoke("document.info");
    c.dispose("renderer_gone", "gone");
    await expect(held).rejects.toMatchObject({ code: "renderer_gone" });
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
    ipc.emit(IPC.rpcMethods, { sender: wc }, ["document.save"]);
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
    trusted = true;
    ipc.emit(IPC.rpcMethods, { sender: a }, ["x"]);
    trusted = false;
    const promise = hub.invoke(a, "x");
    expect(a.sent).toHaveLength(1);
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

  it("fails a crashed page's calls at once and holds new ones until the reloaded editor registers them", async () => {
    vi.useFakeTimers();
    const ipc = new EventEmitter();
    const hub = createRendererRpcHub(ipc as never);
    const wc = new FakeWebContents(5);
    ipc.emit(IPC.rpcMethods, { sender: wc }, ["document.apply", "document.info"]);
    const apply = hub.invoke(wc, "document.apply", { ops: [] });
    expect(wc.sent).toHaveLength(1);
    wc.emit("render-process-gone", {}, { reason: "killed" });
    await expect(apply).rejects.toMatchObject({ code: "page_gone", data: { reason: "crashed" } });
    // Until the new page reports, the old page's methods aren't there.
    expect(hub.hasMethod(wc, "document.info")).toBeUndefined();

    const info = hub.invoke(wc, "document.info");
    wc.emit("did-navigate", {}, "file:///index.html");
    ipc.emit(IPC.rpcMethods, { sender: wc }, []);
    await vi.advanceTimersByTimeAsync(2500);
    expect(wc.sent).toHaveLength(1);
    expect(hub.hasMethod(wc, "document.info")).toBe(false);
    ipc.emit(IPC.rpcMethods, { sender: wc }, ["document.info"]);
    expect(wc.sent).toHaveLength(2);
    const request = wc.sent[1]!.payload as RpcRequestMessage;
    expect(request.method).toBe("document.info");
    ipc.emit(IPC.rpcResponse, { sender: wc }, { id: request.id, ok: true, result: { name: "Untitled" } });
    await expect(info).resolves.toEqual({ name: "Untitled" });
    hub.dispose();
  });

  it("fails calls a reload cut off as reloaded, and leaves a window that closes cleanly to 'destroyed'", async () => {
    const ipc = new EventEmitter();
    const hub = createRendererRpcHub(ipc as never);
    const wc = new FakeWebContents(6);
    ipc.emit(IPC.rpcMethods, { sender: wc }, ["document.save"]);
    const save = hub.invoke(wc, "document.save");
    wc.emit("render-process-gone", {}, { reason: "clean-exit" });
    expect(hub.hasMethod(wc, "document.save")).toBe(true);
    wc.emit("did-navigate", {}, "file:///index.html");
    await expect(save).rejects.toMatchObject({ code: "page_gone", message: "The editor reloaded before it answered document.save", data: { reason: "reloaded" } });
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
