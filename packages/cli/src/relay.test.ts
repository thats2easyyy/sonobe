import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRelay } from "./relay.ts";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "sonobe-relay-"));
  await writeFile(path.join(home, "mcp.json"), JSON.stringify({ port: 1, url: "http://127.0.0.1:1/mcp", token: "t" }));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

type AppHandler = (message: Record<string, unknown>, signal: AbortSignal) => Promise<Response>;

/** The relay over a fake app: /health answers, /mcp POSTs go to `app`. */
function relay(app: AppHandler) {
  const stdin = new PassThrough();
  const lines: Record<string, unknown>[] = [];
  let buffer = "";
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    if (String(input).endsWith("/health")) return Response.json({ ok: true, version: "9.9.9" });
    return app(JSON.parse(String(init?.body)) as Record<string, unknown>, init!.signal!);
  }) as typeof fetch;
  const done = runRelay({
    home,
    stdin,
    stdout: {
      write: (s: string) => {
        buffer += s;
        let at: number;
        while ((at = buffer.indexOf("\n")) >= 0) {
          lines.push(JSON.parse(buffer.slice(0, at)) as Record<string, unknown>);
          buffer = buffer.slice(at + 1);
        }
      },
    },
    stderr: { write: () => undefined },
    fetch: fetchImpl,
  });
  const send = (message: Record<string, unknown>) => stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  return { stdin, lines, done, send };
}

const call = (id: number, name = "import_design") => ({ id, method: "tools/call", params: { name, arguments: {}, _meta: { progressToken: `p${id}` } } });

/** A response that never comes, rejecting like fetch when its signal aborts; `aborted` records that. */
function hanging(record: { aborted: boolean }): AppHandler {
  return (_message, signal) =>
    new Promise<Response>((_, reject) =>
      signal.addEventListener("abort", () => {
        record.aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      }),
    );
}

async function until(condition: () => boolean, ms = 2_000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
}

describe("sonobe mcp relay: long calls", () => {
  it("forwards SSE progress events in order, before the result", async () => {
    const r = relay(async (message) => {
      const events = [
        { jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: "p1", progress: 1, message: "Loading the page" } },
        { jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: "p1", progress: 2, message: "Downloading images: 1 of 1" } },
        { jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "Imported" }] } },
      ];
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const event of events) {
            controller.enqueue(new TextEncoder().encode(`: keep-alive\n\ndata: ${JSON.stringify(event)}\n\n`));
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          controller.close();
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    });
    r.send(call(1));
    await until(() => r.lines.length === 3);
    r.stdin.end();
    await r.done;
    expect(r.lines.map((l) => (l.params as { message?: string } | undefined)?.message ?? l.id)).toEqual(["Loading the page", "Downloading images: 1 of 1", 1]);
  });

  it("turns a notifications/cancelled on stdin into an aborted request", async () => {
    const record = { aborted: false };
    const r = relay(hanging(record));
    r.send(call(3));
    await new Promise((resolve) => setTimeout(resolve, 20));
    r.send({ method: "notifications/cancelled", params: { requestId: 3, reason: "the person pressed Esc" } });
    await until(() => record.aborted);
    expect(record.aborted).toBe(true);
    r.stdin.end();
    await r.done;
    // The client cancelled it, so no answer follows.
    expect(r.lines).toEqual([]);
  });

  it("ends the calls still running when stdin closes, instead of waiting for them", async () => {
    const record = { aborted: false };
    const r = relay(hanging(record));
    r.send(call(4));
    await new Promise((resolve) => setTimeout(resolve, 20));
    r.stdin.end();
    expect(await r.done).toBe(0);
    expect(record.aborted).toBe(true);
  });

  it("says the app didn't answer in time instead of calling it a lost connection", async () => {
    const r = relay(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } });
    });
    r.send(call(5));
    await until(() => r.lines.length === 1);
    r.stdin.end();
    await r.done;
    const error = r.lines[0]!.error as { message: string };
    expect(r.lines[0]!.id).toBe(5);
    expect(error.message).toContain("didn't answer tools/call import_design within 5 minutes");
    expect(error.message).not.toContain("Lost connection");
  });
});
