import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { MAX_BUFFERED_BYTES, webSocketSend } from "./webSocketSend.ts";
import { connectionRecords, createConnectionRecord, type ConnectionPhase } from "./webSocketShared.ts";

const handle = { kind: "webSocket", key: "main/conn" };
const PULSE = { pulses: ["send"] } as const;

function setup(options: { phase?: ConnectionPhase; typeParam?: string; inputs?: Record<string, unknown>; send?: (text: string) => void; bufferedAmount?: number } = {}) {
  const sent: string[] = [];
  const socket = {
    bufferedAmount: options.bufferedAmount ?? 0,
    send:
      options.send ??
      ((text: string) => {
        sent.push(text);
      }),
    close() {},
  };
  const h = createPatchHarness(webSocketSend, { typeParam: options.typeParam, inputs: { connection: handle, ...options.inputs } });
  const record = createConnectionRecord();
  record.phase = options.phase ?? "open";
  record.socket = socket;
  connectionRecords(h.services).set("main/conn", record);
  return { h, record, sent };
}

describe("webSocketSend", () => {
  it("sends Message on each pulse and pulses Sent", () => {
    const { h, record, sent } = setup({ inputs: { message: "hi" } });
    expect(h.step().pulses.size).toBe(0);
    expect(sent).toEqual([]);
    expect([...h.step(PULSE).pulses]).toEqual(["sent"]);
    h.step(PULSE);
    expect(sent).toEqual(["hi", "hi"]);
    expect(record.sendOk).toBe(true);
    expect(record.sendError).toBeNull();
  });

  it("sends once for a held true boolean", () => {
    const { h, sent } = setup({ inputs: { message: "x", send: true } });
    h.run(3);
    expect(sent).toEqual(["x"]);
  });

  it("sends compact JSON for the JSON type", () => {
    const { h, sent } = setup({ typeParam: "json", inputs: { message: { a: [1, 2], n: null } } });
    h.step(PULSE);
    expect(sent).toEqual(['{"a":[1,2],"n":null}']);
    const fresh = setup({ typeParam: "json" });
    fresh.h.step(PULSE);
    expect(fresh.sent).toEqual(["{}"]);
  });

  it("records an error instead of sending while the connection isn't open", () => {
    const { h, record, sent } = setup({ phase: "connecting", inputs: { message: "hi" } });
    expect(h.step(PULSE).pulses.size).toBe(0);
    expect(sent).toEqual([]);
    expect(record.sendError).toBe("Couldn't send: the WebSocket isn't connected yet.");
  });

  it("warns once when Connection isn't a WebSocket handle", () => {
    const h = createPatchHarness(webSocketSend, { inputs: { connection: null, message: "hi" } });
    h.step(PULSE);
    h.step(PULSE);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
  });

  it("refuses to send while the socket's buffer is full, and reports socket errors", () => {
    const full = setup({ bufferedAmount: MAX_BUFFERED_BYTES + 1, inputs: { message: "hi" } });
    full.h.step(PULSE);
    expect(full.sent).toEqual([]);
    expect(full.record.sendError).toBe("Couldn't send: messages are going out faster than the connection can carry them.");
    const broken = setup({
      send: () => {
        throw new Error("boom");
      },
    });
    expect(broken.h.step(PULSE).pulses.size).toBe(0);
    expect(broken.record.sendError).toBe("Couldn't send: Error: boom");
  });

  it("sends each looped message separately, in index order", () => {
    const { h, sent } = setup({ inputs: { message: loopOf(["a", "b", "c"]) } });
    expect(h.step(PULSE).pulseItems.sent).toEqual([true, true, true]);
    expect(sent).toEqual(["a", "b", "c"]);
  });
});
