import type { PlatformServices } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { FORM_BOUNDARY, containsFile, networkRequest, parseStreamRecords } from "./networkRequest.ts";

type Fetch = NonNullable<PlatformServices["fetch"]>;
type Init = Parameters<Fetch>[1];

interface Reply {
  status?: number;
  text?: string;
  reject?: unknown;
}

const URL_ = "https://api.test/items";
const PULSE = { pulses: ["request"] } as const;
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function server(reply: (url: string, init: Init) => Reply | Promise<Reply> = () => ({ text: "{}" })) {
  const calls: { url: string; init: Init }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    const r = await reply(url, init);
    if (r.reject !== undefined) throw r.reject;
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => r.text ?? "" };
  };
  return { calls, fetch };
}

function request(inputs: Record<string, unknown>, options: { typeParam?: string; fetch?: Fetch } = {}) {
  return createPatchHarness(networkRequest, { inputs, typeParam: options.typeParam, services: { platform: options.fetch ? { fetch: options.fetch } : {} } });
}

async function load(text: string, typeParam?: string, inputs: Record<string, unknown> = {}) {
  const { calls, fetch } = server(() => ({ text }));
  const h = request({ url: "https://files.test/a.png", ...inputs }, { fetch, typeParam });
  h.step(PULSE);
  await flush();
  return { frame: h.step(), calls };
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
    expect(calls).toEqual([{ url: URL_, init: { method: "GET", headers: {} } }]);
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
    expect(calls[1]!.init).toEqual({ method: "POST", headers: { "Content-Type": "application/json" }, body: '{"name":"Ada"}' });
    h.step({ ...PULSE, inputs: { method: "delete" } });
    expect(calls[2]!.init?.method).toBe("DELETE");
  });

  it("sends a text Body as-is when Headers sets Content-Type", () => {
    const { calls, fetch } = server();
    request({ url: URL_, method: "put", headers: { "content-type": "text/plain", "X-Count": 2, Skip: null }, body: "hello" }, { fetch }).step(PULSE);
    expect(calls[0]!.init).toEqual({ method: "PUT", headers: { "content-type": "text/plain", "X-Count": "2" }, body: "hello" });
  });

  it("packs an object as form data and drops a Content-Type header with one warning", () => {
    const { calls, fetch } = server();
    const h = request(
      { url: URL_, method: "post", contentType: "multipartFormData", headers: { "Content-Type": "application/json" }, body: { name: "Ada", meta: { a: 1 } } },
      { fetch },
    );
    h.step(PULSE);
    const init = calls[0]!.init!;
    expect(init.headers).toEqual({ "Content-Type": `multipart/form-data; boundary=${FORM_BOUNDARY}` });
    expect(init.body).toBe(
      `--${FORM_BOUNDARY}\r\nContent-Disposition: form-data; name="name"\r\n\r\nAda\r\n` +
        `--${FORM_BOUNDARY}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n{"a":1}\r\n--${FORM_BOUNDARY}--\r\n`,
    );
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("refuses form data it can't build", () => {
    const { calls, fetch } = server();
    expect(request({ url: URL_, method: "post", contentType: "multipartFormData", body: [1] }, { fetch }).step(PULSE).outputs.errorMessage).toBe(
      "Form data needs a JSON object whose keys become form fields.",
    );
    expect(request({ url: URL_, method: "post", body: { photo: { assetId: "cat" } } }, { fetch }).step(PULSE).outputs.errorMessage).toBe("This viewer can't upload files yet.");
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
    expect((await load("PNG", "image")).frame.outputs.result).toEqual({ url: "https://files.test/a.png" });
    expect((await load("", "video")).frame.outputs.errorMessage).toBe("The server sent an empty response.");
    const withHeaders = await load("x", "sound", { headers: { Authorization: "t" } });
    expect(withHeaders.calls).toEqual([]);
    expect(withHeaders.frame.outputs.errorMessage).toBe("This viewer can't download media with headers or a body yet.");
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

  it("replaces a request that's still loading and pulses Finished only for the newest", async () => {
    const resolvers: ((r: Reply) => void)[] = [];
    const { calls, fetch } = server(() => new Promise<Reply>((resolve) => resolvers.push(resolve)));
    const h = request({ url: URL_ }, { fetch });
    h.step(PULSE);
    expect(h.step({ ...PULSE, inputs: { url: "https://api.test/2" } }).outputs.loading).toBe(true);
    expect(calls).toHaveLength(2);
    resolvers[1]!({ text: "[2]" });
    resolvers[0]!({ text: "[1]" });
    await flush();
    const frames = [h.step(), h.step(), h.step()];
    expect(frames[0]!.outputs).toMatchObject({ result: [2], loading: false });
    expect(frames.filter((f) => f.pulses.has("finished"))).toHaveLength(1);
    expect(frames[2]!.outputs.result).toEqual([2]);
  });

  it("times out after 60 prototype seconds unless Disable Timeout is on", () => {
    const { fetch } = server(() => new Promise<Reply>(() => {}));
    const h = request({ url: URL_ }, { fetch });
    h.step(PULSE);
    expect(h.step({ dt: 30 }).outputs.loading).toBe(true);
    const f = h.step({ dt: 30 });
    expect(f.outputs).toMatchObject({ loading: false, error: true, errorMessage: "The request timed out after 60 seconds.", status: 0, errorDetails: null });
    expect(f.pulses.has("finished")).toBe(true);

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
});
