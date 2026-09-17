import type { FetchResponse, PlatformServices } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import type { PatchHarnessOptions } from "../infra/index.ts";
import { containsFile, networkRequest, parseStreamRecords, streamFormatOf } from "./networkRequest.ts";

type Fetch = NonNullable<PlatformServices["fetch"]>;
type Init = Parameters<Fetch>[1];

interface Reply {
  status?: number;
  text?: string;
  headers?: Record<string, string>;
  reject?: unknown;
}

const URL_ = "https://api.test/items";
const PULSE = { pulses: ["request"] } as const;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The request options without the host plumbing (abort signal, chunk callback). */
function plain(init: Init) {
  const { signal: _signal, onChunk: _onChunk, ...rest } = init ?? {};
  return rest;
}

function server(reply: (url: string, init: Init) => Reply | Promise<Reply> = () => ({ text: "{}" })) {
  const calls: { url: string; init: Init }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    const r = await reply(url, init);
    if (r.reject !== undefined) throw r.reject;
    const status = r.status ?? 200;
    const response: FetchResponse = { ok: status >= 200 && status < 300, status, text: async () => r.text ?? "" };
    if (r.headers) response.headers = r.headers;
    return response;
  };
  return { calls, fetch };
}

function request(inputs: Record<string, unknown>, options: { typeParam?: string; fetch?: Fetch; services?: PatchHarnessOptions["services"] } = {}) {
  return createPatchHarness(networkRequest, { inputs, typeParam: options.typeParam, services: { platform: options.fetch ? { fetch: options.fetch } : {}, ...options.services } });
}

async function load(text: string, typeParam?: string, inputs: Record<string, unknown> = {}, headers?: Record<string, string>) {
  const { calls, fetch } = server(() => (headers ? { text, headers } : { text }));
  const h = request({ url: "https://files.test/a.png", ...inputs }, { fetch, typeParam });
  h.step(PULSE);
  await flush();
  return { frame: h.step(), calls };
}

/** A host that streams: `push` delivers chunks through onChunk, `end` resolves the whole body. */
function streamingServer(headers: Record<string, string>, status = 200) {
  const inits: Init[] = [];
  let body = "";
  let finish: ((text: string) => void) | undefined;
  const fetch: Fetch = async (_url, init) => {
    inits.push(init);
    return { ok: status >= 200 && status < 300, status, headers, text: () => new Promise<string>((resolve) => (finish = resolve)) };
  };
  return {
    fetch,
    inits,
    push(chunk: string) {
      body += chunk;
      inits.at(-1)?.onChunk?.(chunk);
    },
    end() {
      finish?.(body);
    },
  };
}

describe("networkRequest", () => {
  it("starts idle and sends nothing until Request pulses", () => {
    const { calls, fetch } = server();
    const f = request({ url: URL_ }, { fetch }).run(3);
    expect(f.outputs).toEqual({ result: null, loading: false, error: false, errorMessage: "", status: 0, errorDetails: null });
    expect(f.pulses.size).toBe(0);
    expect(calls).toEqual([]);
    expect(request({ url: URL_ }, { typeParam: "text" }).step().outputs.result).toBe("");
  });

  it("reports problems found before sending on the same frame", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ url: "  " }, "Add a URL to request."],
      [{ url: "not a url" }, "This URL isn't valid. Check for typos."],
      [{ url: "ftp://files.test/a" }, "Network Request only loads http:// and https:// URLs."],
      [{ url: URL_, urlParameters: [1] }, "URL Parameters must be a JSON object."],
      [{ url: URL_, headers: "token" }, "Headers must be a JSON object."],
      [{ url: URL_, headers: { "bad name": "x" } }, 'The header name "bad name" isn\'t valid.'],
    ];
    for (const [inputs, message] of cases) {
      const { calls, fetch } = server();
      const f = request(inputs, { fetch }).step(PULSE);
      expect(f.outputs, message).toMatchObject({ error: true, errorMessage: message, status: 0, errorDetails: null, loading: false });
      expect(f.pulses.has("finished"), message).toBe(true);
      expect(calls, message).toEqual([]);
    }
    expect(request({ url: URL_ }).step(PULSE).outputs.errorMessage).toBe("This viewer can't make network requests.");
  });

  it("loads JSON and pulses Finished on the frame the response is applied", async () => {
    const { calls, fetch } = server(() => ({ text: '{"items":[1,2]}' }));
    const h = request({ url: ` ${URL_} ` }, { fetch });
    const f0 = h.step(PULSE);
    expect(f0.outputs.loading).toBe(true);
    expect(f0.requestedNextFrame).toBe(true);
    expect(f0.pulses.has("finished")).toBe(false);
    expect(calls.map((c) => [c.url, plain(c.init)])).toEqual([[URL_, { method: "GET", headers: {} }]]);
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]!.init?.onChunk).toBeUndefined();
    await flush();
    const f1 = h.step();
    expect(f1.outputs).toEqual({ result: { items: [1, 2] }, loading: false, error: false, errorMessage: "", status: 200, errorDetails: null });
    expect(f1.pulses.has("finished")).toBe(true);
    expect(h.step().pulses.has("finished")).toBe(false);
  });

  it("adds URL parameters after the existing query", () => {
    const { calls, fetch } = server();
    const params = { q: "red shoes", tags: ["a", null, "b"], skip: null, filter: { min: 1 }, n: 3 };
    request({ url: "https://api.test/search?page=2", urlParameters: params }, { fetch }).step(PULSE);
    expect([...new URL(calls[0]!.url).searchParams]).toEqual([
      ["page", "2"],
      ["q", "red shoes"],
      ["tags", "a"],
      ["tags", "b"],
      ["filter", '{"min":1}'],
      ["n", "3"],
    ]);
  });

  it("ignores Body for GET and sends JSON for other methods", () => {
    const { calls, fetch } = server();
    const h = request({ url: URL_, body: { name: "Ada" } }, { fetch });
    h.step(PULSE);
    expect(calls[0]!.init?.body).toBeUndefined();
    h.step({ ...PULSE, inputs: { method: "post" } });
    expect(plain(calls[1]!.init)).toEqual({ method: "POST", headers: { "Content-Type": "application/json" }, body: '{"name":"Ada"}' });
    h.step({ ...PULSE, inputs: { method: "delete" } });
    expect(calls[2]!.init?.method).toBe("DELETE");
  });

  it("sends a text Body as-is when Headers sets Content-Type", () => {
    const { calls, fetch } = server();
    request({ url: URL_, method: "put", headers: { "content-type": "text/plain", "X-Count": 2, Skip: null }, body: "hello" }, { fetch }).step(PULSE);
    expect(plain(calls[0]!.init)).toEqual({ method: "PUT", headers: { "content-type": "text/plain", "X-Count": "2" }, body: "hello" });
  });

  it("sends an object as form fields for the platform to encode, dropping a Content-Type header with one warning", () => {
    const { calls, fetch } = server();
    const h = request(
      { url: URL_, method: "post", contentType: "multipartFormData", headers: { "Content-Type": "application/json" }, body: { name: "Ada", meta: { a: 1 }, 'say "hi"': 2 } },
      { fetch },
    );
    h.step(PULSE);
    expect(plain(calls[0]!.init)).toEqual({
      method: "POST",
      headers: {},
      body: {
        form: [
          { name: "name", value: "Ada" },
          { name: "meta", value: '{"a":1}' },
          { name: "say %22hi%22", value: "2" },
        ],
      },
    });
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("uploads images and sounds as file parts named after the asset", () => {
    const { calls, fetch } = server();
    const mediaInfo = () => ({ status: "ready" as const, width: 10, height: 10, duration: 0, name: "cat.png" });
    const h = request({ url: URL_, method: "post", body: { photo: { assetId: "cat" }, still: { url: "data:image/jpeg;base64,/9j=" }, caption: "Hi", nested: { link: { url: "https://cats.test/a.png" } } } }, { fetch, services: { mediaInfo } });
    h.step(PULSE);
    expect(plain(calls[0]!.init)).toEqual({
      method: "POST",
      headers: {},
      body: {
        form: [
          { name: "photo", value: { assetId: "cat", filename: "cat.png" } },
          { name: "still", value: { url: "data:image/jpeg;base64,/9j=", filename: "file", mime: "image/jpeg" } },
          { name: "caption", value: "Hi" },
          { name: "nested", value: '{"link":{"url":"https://cats.test/a.png"}}' },
        ],
      },
    });
  });

  it("refuses form data it can't build", () => {
    const { calls, fetch } = server();
    expect(request({ url: URL_, method: "post", contentType: "multipartFormData", body: [1] }, { fetch }).step(PULSE).outputs.errorMessage).toBe(
      "Form data needs a JSON object whose keys become form fields.",
    );
    expect(calls).toEqual([]);
    expect(containsFile({ list: [{ url: "data:image/png;base64,AA==" }] })).toBe(true);
    expect(containsFile({ link: { url: "https://cats.test/a.png" } })).toBe(false);
  });

  it("keeps the last good Result when a later request fails", async () => {
    let reply: Reply = { text: '{"v":1}' };
    const { fetch } = server(() => reply);
    const h = request({ url: URL_ }, { fetch });
    h.step(PULSE);
    await flush();
    h.step();
    reply = { status: 404, text: '{"error":"nope"}' };
    h.step(PULSE);
    await flush();
    expect(h.step().outputs).toEqual({
      result: { v: 1 },
      loading: false,
      error: true,
      errorMessage: "The request failed with status 404.",
      status: 404,
      errorDetails: { status: 404, body: { error: "nope" } },
    });
    reply = { status: 500, text: "x".repeat(20_000) };
    h.step(PULSE);
    await flush();
    expect((h.step().outputs.errorDetails as { body: string }).body).toHaveLength(10_000);
    reply = { text: '{"v":2}' };
    h.step(PULSE);
    await flush();
    expect(h.step().outputs).toMatchObject({ result: { v: 2 }, error: false, errorMessage: "", status: 200, errorDetails: null });
  });

  it("explains servers it couldn't reach", async () => {
    const { fetch } = server(() => ({ reject: new Error("offline") }));
    const h = request({ url: URL_ }, { fetch });
    h.step(PULSE);
    await flush();
    const f = h.step();
    expect(f.outputs).toMatchObject({ error: true, status: 0, errorDetails: { message: "Error: offline" } });
    expect(f.outputs.errorMessage).toBe("Couldn't reach the server. Check the URL and your connection, and that the server allows requests from prototypes (CORS).");
    expect(f.pulses.has("finished")).toBe(true);
  });

  it("converts the response for the patch's type", async () => {
    expect((await load("{nope")).frame.outputs).toMatchObject({
      result: null,
      error: true,
      errorMessage: "The response isn't valid JSON. Switch this patch to Text to see what came back.",
      status: 200,
      errorDetails: { status: 200, body: "{nope" },
    });
    expect((await load("  ")).frame.outputs).toMatchObject({ result: null, error: false });
    expect((await load("plain text", "text")).frame.outputs.result).toBe("plain text");
    expect((await load("PNG", "image", {}, { "content-type": "image/png" })).frame.outputs.result).toEqual({ url: "https://files.test/a.png" });
    expect((await load("", "video")).frame.outputs.errorMessage).toBe("The server sent an empty response.");
    expect((await load("<html>", "image", {}, { "content-type": "text/html; charset=utf-8" })).frame.outputs.errorMessage).toBe("The server sent text/html, not an image.");
    expect((await load("{}", "sound", {}, { "content-type": "application/json" })).frame.outputs.errorMessage).toBe("The server sent application/json, not a sound.");
    const withHeaders = await load("x", "sound", { headers: { Authorization: "t" } });
    expect(withHeaders.calls).toEqual([]);
    expect(withHeaders.frame.outputs.errorMessage).toBe("This viewer can't download media with headers or a body yet.");
  });

  it("splits records by the response's Content-Type, with or without Stream", async () => {
    expect((await load('{"a":1}\n{"a":2}\n', undefined, {}, { "content-type": "application/x-ndjson" })).frame.outputs.result).toEqual([{ a: 1 }, { a: 2 }]);
    expect((await load('event: tick\ndata: {"n":1}\n\ndata: [DONE]\n\n', undefined, {}, { "content-type": "text/event-stream" })).frame.outputs.result).toEqual([{ n: 1 }]);
    expect((await load('{"a":1}\n', undefined, {}, { "content-type": "application/json" })).frame.outputs.result).toEqual({ a: 1 });
    expect(streamFormatOf("multipart/mixed; boundary=-")).toBe("multipart");
    expect(streamFormatOf("application/json")).toBeUndefined();
  });

  it("parses streamed records once the response ends", async () => {
    expect((await load('data: {"a":1}\n\ndata: {"a":\ndata: 2}\n\ndata: [DONE]\n\n', undefined, { stream: true })).frame.outputs.result).toEqual([{ a: 1 }, { a: 2 }]);
    expect((await load('{"a":1}\n\n{"a":2}\n', undefined, { stream: true })).frame.outputs.result).toEqual([{ a: 1 }, { a: 2 }]);
    expect((await load('{"a":1}\nnope\n', undefined, { stream: true })).frame.outputs.errorMessage).toBe("Line 2 of the stream isn't valid JSON.");
    expect(parseStreamRecords('\r\n---\r\nContent-Type: application/json\r\n\r\n{"data":1}\r\n---\r\nContent-Type: application/json\r\n\r\n{"data":2,"hasNext":false}\r\n-----\r\n')).toEqual({
      ok: true,
      records: [{ data: 1 }, { data: 2, hasNext: false }],
    });
  });

  it("leaves out a trailing record that hasn't finished arriving", () => {
    expect(parseStreamRecords('{"a":1}\n{"a"', { partial: true })).toEqual({ ok: true, records: [{ a: 1 }] });
    expect(parseStreamRecords('data: {"a":1}\n\ndata: {"a":2}\n', { format: "sse", partial: true })).toEqual({ ok: true, records: [{ a: 1 }] });
    expect(parseStreamRecords('---\n\n{"data":1}\n---\n\n{"da', { format: "multipart", partial: true })).toEqual({ ok: true, records: [{ data: 1 }] });
  });

  it("updates Result each frame new streamed data arrives, and finishes with the whole body", async () => {
    const host = streamingServer({ "content-type": "application/x-ndjson" });
    const h = request({ url: URL_, stream: true }, { fetch: host.fetch });
    h.step(PULSE);
    expect(typeof host.inits[0]!.onChunk).toBe("function");
    await flush();
    host.push('{"a":1}\n{"a"');
    expect(h.step().outputs).toMatchObject({ result: [{ a: 1 }], loading: true, error: false });
    host.push(":2}\n");
    const second = h.step();
    expect(second.outputs.result).toEqual([{ a: 1 }, { a: 2 }]);
    expect(second.pulses.has("finished")).toBe(false);
    host.push('{"a":3}\n');
    host.end();
    await flush();
    const done = h.step();
    expect(done.outputs).toMatchObject({ result: [{ a: 1 }, { a: 2 }, { a: 3 }], loading: false, error: false, status: 200 });
    expect(done.pulses.has("finished")).toBe(true);

    const text = streamingServer({ "content-type": "text/plain" });
    const t = request({ url: URL_, stream: true }, { fetch: text.fetch, typeParam: "text" });
    t.step(PULSE);
    await flush();
    text.push("Hel");
    expect(t.step().outputs.result).toBe("Hel");
    text.push("lo");
    expect(t.step().outputs.result).toBe("Hello");
  });

  it("stops a stream at the first complete record that isn't JSON", async () => {
    const host = streamingServer({ "content-type": "application/x-ndjson" });
    const h = request({ url: URL_, stream: true }, { fetch: host.fetch });
    h.step(PULSE);
    await flush();
    host.push('{"a":1}\noops\n');
    const f = h.step();
    expect(f.outputs).toMatchObject({ result: null, loading: false, error: true, errorMessage: "Line 2 of the stream isn't valid JSON.", status: 200 });
    expect(f.pulses.has("finished")).toBe(true);
    expect(host.inits[0]!.signal!.aborted).toBe(true);
    host.end();
    await flush();
    expect(h.step().pulses.has("finished")).toBe(false);
  });

  it("aborts a request that's still loading when a newer one starts, and pulses Finished only for the newest", async () => {
    const resolvers: ((r: Reply) => void)[] = [];
    const { calls, fetch } = server(() => new Promise<Reply>((resolve) => resolvers.push(resolve)));
    const h = request({ url: URL_ }, { fetch });
    h.step(PULSE);
    expect(h.step({ ...PULSE, inputs: { url: "https://api.test/2" } }).outputs.loading).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.init!.signal!.aborted).toBe(true);
    expect(calls[1]!.init!.signal!.aborted).toBe(false);
    resolvers[1]!({ text: "[2]" });
    resolvers[0]!({ text: "[1]" });
    await flush();
    const frames = [h.step(), h.step(), h.step()];
    expect(frames[0]!.outputs).toMatchObject({ result: [2], loading: false });
    expect(frames.filter((f) => f.pulses.has("finished"))).toHaveLength(1);
    expect(frames[2]!.outputs.result).toEqual([2]);
  });

  it("times out after 60 prototype seconds unless Disable Timeout is on", () => {
    const { calls, fetch } = server(() => new Promise<Reply>(() => {}));
    const h = request({ url: URL_ }, { fetch });
    h.step(PULSE);
    expect(h.step({ dt: 30 }).outputs.loading).toBe(true);
    const f = h.step({ dt: 30 });
    expect(f.outputs).toMatchObject({ loading: false, error: true, errorMessage: "The request timed out after 60 seconds.", status: 0, errorDetails: null });
    expect(f.pulses.has("finished")).toBe(true);
    expect(calls[0]!.init!.signal!.aborted).toBe(true);

    const patient = request({ url: URL_, disableTimeout: true }, { fetch });
    patient.step(PULSE);
    patient.step({ dt: 61 });
    expect(patient.step({ dt: 61 }).outputs.loading).toBe(true);
  });

  it("sends one request per loop index, in index order", async () => {
    const { calls, fetch } = server((url) => ({ text: JSON.stringify(url) }));
    const h = request({ url: loopOf(["https://a.test/1", "https://a.test/2"]) }, { fetch });
    h.step(PULSE);
    expect(calls.map((c) => c.url)).toEqual(["https://a.test/1", "https://a.test/2"]);
    await flush();
    const f = h.step();
    expect(f.outputs.result).toEqual(loopOf(["https://a.test/1", "https://a.test/2"]));
    expect(f.pulseItems.finished).toEqual([true, true]);
  });

  it("sends nothing and outputs idle values while muted", () => {
    const { calls, fetch } = server();
    const run = runPatch(networkRequest, [{ request: true, url: URL_ }, {}], { muted: true, services: { platform: { fetch } } });
    expect(calls).toEqual([]);
    expect(run.frames[1]!.outputs).toEqual({ result: null, loading: false, finished: false, error: false, errorMessage: "", status: 0, errorDetails: null });
    expect(run.frames.flatMap((f) => f.pulses)).toEqual([]);
  });

  it("aborts an in-flight request on dispose", () => {
    const { calls, fetch } = server(() => new Promise<Reply>(() => {}));
    const h = request({ url: URL_ }, { fetch });
    h.step(PULSE);
    h.dispose();
    expect(calls[0]!.init!.signal!.aborted).toBe(true);
  });
});
