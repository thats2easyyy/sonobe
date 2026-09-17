/**
 * Data & Network patches wired together in real runtime documents: network data flowing into a
 * text layer, JSON editing chains, JSON Array's 0-based ports, base64 round trips, and a WebSocket
 * echo between Connection, Send, and Receive.
 */

import type { PlatformServices } from "@sonobe/engine";
import { buildDoc, createMockRegistry, createTestRuntime, runFrames, type DocInput } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { definitions } from "./index.ts";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function runtime(input: DocInput, platform?: PlatformServices) {
  const registry = createMockRegistry(definitions);
  const doc = buildDoc(input, registry);
  return createTestRuntime(doc, registry, platform ? { platform } : {});
}

const errors = (rt: ReturnType<typeof runtime>) => rt.issues().filter((i) => i.severity === "error");

describe("data patches in a runtime", () => {
  it("loads JSON from the network into a text layer", async () => {
    const calls: string[] = [];
    const platform: PlatformServices = {
      fetch: async (url) => {
        calls.push(url);
        return { ok: true, status: 200, text: async () => JSON.stringify({ items: [{ title: "One" }, { title: "Two" }, { title: "Three" }] }) };
      },
    };
    const rt = runtime(
      {
        layers: [{ id: "label", type: "text", name: "Label", props: { text: { link: "titles_text.text" } } }],
        patches: {
          start: { type: "whenPrototypeStarts" },
          load: { type: "networkRequest", inputs: { request: { link: "start.started" }, url: "https://api.test/items" } },
          titles: { type: "valueAtPath", inputs: { object: { link: "load.result" }, path: "items.*.title" } },
          count: { type: "arrayCount", inputs: { array: { link: "titles.value" } } },
          titles_text: { type: "jsonToText", inputs: { json: { link: "titles.value" }, pretty: false } },
        },
      },
      platform,
    );
    runFrames(rt, 1);
    expect(rt.getValue("load.loading")).toBe(true);
    expect(rt.getValue("count.count")).toBe(0);
    await flush();
    runFrames(rt, 1);
    expect(rt.getValue("load.status")).toBe(200);
    expect(rt.getValue("count.count")).toBe(3);
    expect(rt.getValue("@label.text")).toBe('["One","Two","Three"]');
    runFrames(rt, 3);
    expect(calls).toEqual(["https://api.test/items"]);
    expect(errors(rt)).toEqual([]);
  });

  it("parses, edits, and reads JSON on the same frame", () => {
    const rt = runtime({
      layers: [
        { id: "name_label", type: "text", name: "Name", props: { text: { link: "name.value" } } },
        { id: "json_label", type: "text", name: "JSON", props: { text: { link: "edited_text.text" } } },
      ],
      patches: {
        parse: { type: "textToJson", inputs: { text: '[{"name":"Ada"},{"name":"Grace"}]' } },
        pick: { type: "valueAtIndex", inputs: { array: { link: "parse.json" }, index: 1 } },
        edit: { type: "setValueForKey", typeParam: "text", inputs: { object: { link: "pick.value" }, key: "role", value: "Admiral" } },
        name: { type: "valueForKey", typeParam: "text", inputs: { object: { link: "edit.output" }, key: "name" } },
        edited_text: { type: "jsonToText", inputs: { json: { link: "edit.output" }, pretty: false } },
        find: { type: "arrayIndexOf", typeParam: "json", inputs: { array: { link: "parse.json" }, item: { json: { name: "Grace" } } } },
      },
    });
    runFrames(rt, 1);
    expect(rt.getValue("@name_label.text")).toBe("Grace");
    expect(rt.getValue("@json_label.text")).toBe('{"name":"Grace","role":"Admiral"}');
    expect(rt.getValue("find.index")).toBe(1);
    expect(errors(rt)).toEqual([]);
  });

  it("uses Array Index Of's muted outputs in a document", () => {
    const rt = runtime({
      patches: {
        find: { type: "arrayIndexOf", typeParam: "index", muted: true, inputs: { array: { json: [0, 1] }, item: 1 } },
        parse: { type: "textToJson", muted: true, inputs: { text: "{" } },
      },
    });
    runFrames(rt, 1);
    expect(rt.getValue("find.index")).toBe(-1);
    expect(rt.getValue("find.contains")).toBe(false);
    expect(rt.getValue("parse.errorMessage")).toBe("");
  });

  it("fills JSON Array items counted from 0", () => {
    const rt = runtime({
      layers: [{ id: "label", type: "text", name: "Label", props: { text: { link: "list_text.text" } } }],
      patches: {
        list: { type: "jsonArray", typeParam: "text", inputCount: 3, inputs: { item0: "a", item1: "b", item2: "c" } },
        list_text: { type: "jsonToText", inputs: { json: { link: "list.array" }, pretty: false } },
      },
    });
    runFrames(rt, 1);
    expect(rt.getValue("@label.text")).toBe('["a","b","c"]');
    expect(rt.issues().filter((i) => i.code === "unknown_port")).toEqual([]);
  });

  it("round-trips JSON through Base64 Encode and Decode", () => {
    const rt = runtime({
      layers: [{ id: "label", type: "text", name: "Label", props: { text: { link: "total.value" } } }],
      patches: {
        encode: { type: "base64Encode", typeParam: "json", inputs: { value: { json: { total: 42, tags: ["a"] } }, urlSafe: true } },
        decode: { type: "base64Decode", typeParam: "json", inputs: { base64: { link: "encode.base64" } } },
        total: { type: "valueForKey", typeParam: "number", inputs: { object: { link: "decode.output" }, key: "total" } },
      },
    });
    runFrames(rt, 1);
    expect(rt.getValue("encode.base64")).toBe(Buffer.from('{"total":42,"tags":["a"]}').toString("base64url"));
    expect(rt.getValue("total.value")).toBe(42);
    expect(rt.getValue("@label.text")).toBe("42");
  });

  it("echoes a JSON message between WebSocket Connection, Send, and Receive", async () => {
    const created: string[] = [];
    const sent: string[] = [];
    const platform = {
      webSocket: (url: string) => {
        created.push(url);
        const socket = {
          bufferedAmount: 0,
          onopen: null as (() => void) | null,
          onmessage: null as ((text: string) => void) | null,
          onclose: null as ((code: number) => void) | null,
          onerror: null as (() => void) | null,
          send(text: string) {
            sent.push(text);
            queueMicrotask(() => socket.onmessage?.(text));
          },
          close() {},
        };
        queueMicrotask(() => socket.onopen?.());
        return socket;
      },
    } as unknown as PlatformServices;
    const rt = runtime(
      {
        layers: [{ id: "label", type: "text", name: "Label", props: { text: { link: "greeting.value" } } }],
        patches: {
          conn: { type: "webSocketConnection", inputs: { connect: true, url: "https://echo.test/socket" } },
          send: { type: "webSocketSend", typeParam: "json", inputs: { connection: { link: "conn.connection" }, send: { link: "conn.connected" }, message: { json: { hello: "world" } } } },
          receive: { type: "webSocketReceive", typeParam: "json", inputs: { connection: { link: "conn.connection" } } },
          greeting: { type: "valueForKey", typeParam: "text", inputs: { object: { link: "receive.message" }, key: "hello" } },
        },
      },
      platform,
    );
    runFrames(rt, 1);
    expect(created).toEqual(["wss://echo.test/socket"]);
    expect(rt.getValue("conn.connecting")).toBe(true);
    await flush();
    runFrames(rt, 1);
    expect(rt.getValue("conn.connected")).toBe(true);
    expect(sent).toEqual(['{"hello":"world"}']);
    await flush();
    runFrames(rt, 1);
    expect(rt.getValue("receive.received")).toBe(true);
    expect(rt.getValue("@label.text")).toBe("world");
    runFrames(rt, 1);
    expect(rt.getValue("receive.received")).toBe(false);
    expect(rt.getValue("@label.text")).toBe("world");

    rt.restart();
    runFrames(rt, 1);
    expect(created).toHaveLength(2);
    expect(errors(rt)).toEqual([]);
  });
});
