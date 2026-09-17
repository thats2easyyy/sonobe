import type { PlatformServices } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { MAX_FRAME_MESSAGES, webSocketConnection } from "./webSocketConnection.ts";
import { connectionRecords, type PlatformWebSocket } from "./webSocketShared.ts";

interface SocketOptions {
  protocols: string[];
  headers: Record<string, string>;
}

class FakeSocket implements PlatformWebSocket {
  readonly url: string;
  readonly options: SocketOptions;
  readonly sent: string[] = [];
  closed: [number | undefined, string | undefined] | null = null;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((text: string) => void) | null = null;
  onclose: ((code: number, reason?: string) => void) | null = null;
  onerror: ((message?: string) => void) | null = null;

  constructor(url: string, options: SocketOptions) {
    this.url = url;
    this.options = options;
  }

  send(text: string): void {
    this.sent.push(text);
  }

  close(code?: number, reason?: string): void {
    this.closed = [code, reason];
  }
}

const KEY = "main/patch_1";

function sockets() {
  const list: FakeSocket[] = [];
  const platform = {
    webSocket: (url: string, options: SocketOptions) => {
      const socket = new FakeSocket(url, options);
      list.push(socket);
      return socket;
    },
  } as unknown as PlatformServices;
  return { list, platform };
}

function openConnection(inputs: Record<string, unknown> = {}) {
  const { list, platform } = sockets();
  const h = createPatchHarness(webSocketConnection, { inputs: { connect: true, url: "wss://chat.test", ...inputs }, services: { platform } });
  h.step();
  list[0]?.onopen?.();
  h.step();
  return { h, list };
}

describe("webSocketConnection", () => {
  it("stays idle until Connect is on with a URL", () => {
    const { list, platform } = sockets();
    const h = createPatchHarness(webSocketConnection, { services: { platform } });
    expect(h.step().outputs).toEqual({ connection: { kind: "webSocket", key: KEY }, connected: false, connecting: false, error: false, errorMessage: "" });
    h.step({ inputs: { connect: true } });
    expect(list).toEqual([]);
    expect(h.output("error")).toBe(false);
  });

  it("opens on frame 0 when Connect starts on, and reports Connected after the open event", () => {
    const { list, platform } = sockets();
    const h = createPatchHarness(webSocketConnection, { inputs: { connect: true, url: " https://chat.test/room " }, services: { platform } });
    const f0 = h.step();
    expect(list[0]!.url).toBe("wss://chat.test/room");
    expect(f0.outputs).toMatchObject({ connecting: true, connected: false });
    expect(f0.requestedNextFrame).toBe(true);
    list[0]!.onopen!();
    expect(h.step().outputs).toMatchObject({ connecting: false, connected: true, error: false });
    expect(connectionRecords(h.services).get(KEY)).toMatchObject({ phase: "open", socket: list[0] });
  });

  it("moves this frame's messages into the connection record, in arrival order", () => {
    const { h, list } = openConnection();
    list[0]!.onmessage!("a");
    list[0]!.onmessage!("b");
    const f = h.step();
    const record = connectionRecords(h.services).get(KEY)!;
    expect(record.messages.map((m) => m.text)).toEqual(["a", "b"]);
    expect(record.frame).toBe(f.frame);
    h.step();
    expect(record.messages).toEqual([]);
  });

  it("reports closes and doesn't reconnect by itself", () => {
    const { h, list } = openConnection();
    list[0]!.onclose!(1000);
    expect(h.step().outputs).toMatchObject({ connected: false, connecting: false, error: false, errorMessage: "The server closed the connection." });
    h.run(3);
    expect(list).toHaveLength(1);
    h.step({ inputs: { connect: false } });
    expect(h.output("errorMessage")).toBe("The server closed the connection.");
    expect(h.step({ inputs: { connect: true } }).outputs).toMatchObject({ connecting: true, errorMessage: "" });
    expect(list).toHaveLength(2);
    list[1]!.onclose!(1006, "went away");
    expect(h.step().outputs).toMatchObject({ connected: false, error: true, errorMessage: "The connection was lost (code 1006). went away" });
  });

  it("reports connection errors", () => {
    const { h, list } = openConnection();
    list[0]!.onerror!();
    expect(h.step().outputs).toMatchObject({ error: true, errorMessage: "Couldn't connect. Check the URL and that the server is running." });
  });

  it("reconnects when the URL or Headers change and ignores the old socket", () => {
    const { h, list } = openConnection();
    h.step({ inputs: { url: "wss://other.test" } });
    expect(list[0]!.closed).toEqual([1000, "closed by prototype"]);
    expect(list[0]!.onmessage).toBeNull();
    expect(list[1]!.url).toBe("wss://other.test");
    h.step({ inputs: { headers: { Authorization: "t" } } });
    expect(list).toHaveLength(3);
    h.step({ inputs: { headers: { Authorization: "t" } } });
    expect(list).toHaveLength(3);
  });

  it("explains bad URLs, bad headers, and hosts without WebSockets, without retrying every frame", () => {
    const { list, platform } = sockets();
    const bad = createPatchHarness(webSocketConnection, { inputs: { connect: true, url: "ftp://x.test" }, services: { platform } });
    expect(bad.step().outputs).toMatchObject({ connecting: false, error: true, errorMessage: "WebSocket URLs start with wss:// or ws://." });
    bad.step();
    const headers = createPatchHarness(webSocketConnection, { inputs: { connect: true, url: "wss://a.test", headers: [1] }, services: { platform } });
    expect(headers.step().outputs.errorMessage).toBe("Headers must be a JSON object.");
    expect(list).toEqual([]);
    const noHost = createPatchHarness(webSocketConnection, { inputs: { connect: true, url: "wss://a.test" } });
    expect(noHost.step().outputs.errorMessage).toBe("This viewer can't open WebSockets.");
  });

  it("passes Sec-WebSocket-Protocol as protocols and warns once that browsers ignore other headers", () => {
    const { list, platform } = sockets();
    const h = createPatchHarness(webSocketConnection, {
      inputs: { connect: true, url: "wss://a.test", headers: { "Sec-WebSocket-Protocol": "chat, v2", Authorization: "Bearer t", Skip: null } },
      services: { platform },
    });
    h.run(2);
    expect(list[0]!.options).toEqual({ protocols: ["chat", "v2"], headers: { Authorization: "Bearer t" } });
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("shows send errors and clears them after a successful send", () => {
    const { h } = openConnection();
    const record = connectionRecords(h.services).get(KEY)!;
    record.sendError = "Couldn't send: boom";
    expect(h.step().outputs).toMatchObject({ error: true, errorMessage: "Couldn't send: boom" });
    expect(h.step().outputs.error).toBe(true);
    record.sendOk = true;
    expect(h.step().outputs).toMatchObject({ error: false, errorMessage: "" });
  });

  it("uses the first item of looped inputs with one warning", () => {
    const { list, platform } = sockets();
    const h = createPatchHarness(webSocketConnection, { inputs: { connect: loopOf([true, false]), url: loopOf(["wss://a.test", "wss://b.test"]) }, services: { platform } });
    h.run(2);
    expect(list.map((s) => s.url)).toEqual(["wss://a.test"]);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("drops the oldest messages past 10,000 in one frame", () => {
    const { h, list } = openConnection();
    for (let i = 0; i <= MAX_FRAME_MESSAGES; i++) list[0]!.onmessage!(String(i));
    h.step();
    const record = connectionRecords(h.services).get(KEY)!;
    expect(record.messages).toHaveLength(MAX_FRAME_MESSAGES);
    expect(record.messages[0]!.text).toBe("1");
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("closes the socket and forgets the record on dispose", () => {
    const { h, list } = openConnection();
    h.dispose();
    expect(list[0]!.closed).toEqual([1000, "closed by prototype"]);
    expect(connectionRecords(h.services).has(KEY)).toBe(false);
  });

  it("opens nothing and outputs idle values while muted", () => {
    const { list, platform } = sockets();
    const run = runPatch(webSocketConnection, [{ connect: true, url: "wss://a.test" }, {}], { muted: true, services: { platform } });
    expect(list).toEqual([]);
    expect(run.frames[1]!.outputs).toEqual({ connection: null, connected: false, connecting: false, error: false, errorMessage: "" });
  });
});
