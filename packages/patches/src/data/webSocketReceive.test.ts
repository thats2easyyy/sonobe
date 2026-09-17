import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { webSocketReceive } from "./webSocketReceive.ts";
import { connectionRecords, createConnectionRecord } from "./webSocketShared.ts";

const handle = { kind: "webSocket", key: "main/conn" };

function setup(typeParam?: string) {
  const h = createPatchHarness(webSocketReceive, { typeParam, inputs: { connection: handle } });
  const record = createConnectionRecord();
  connectionRecords(h.services).set("main/conn", record);
  const deliver = (...texts: string[]) => {
    record.frame = h.frame;
    record.messages = texts.map((text) => ({ text }));
  };
  return { h, record, deliver };
}

describe("webSocketReceive", () => {
  it("starts with the zero value, an empty loop, and no pulse", () => {
    const f = setup().h.step();
    expect(f.outputs).toEqual({ message: "", messages: loopOf([]) });
    expect(f.pulses.size).toBe(0);
    expect(f.requestedNextFrame).toBe(true);
    expect(setup("json").h.step().outputs.message).toBeNull();
  });

  it("receives every message as raw text and holds the latest", () => {
    const { h, deliver } = setup();
    deliver("a", '{"x":1}');
    const f = h.step();
    expect(f.outputs).toEqual({ message: '{"x":1}', messages: loopOf(["a", '{"x":1}']) });
    expect([...f.pulses]).toEqual(["received"]);
    const quiet = h.step();
    expect(quiet.outputs).toEqual({ message: '{"x":1}', messages: loopOf([]) });
    expect(quiet.pulses.size).toBe(0);
    deliver("same");
    h.step();
    deliver("same");
    expect(h.step().pulses.has("received")).toBe(true);
  });

  it("receives only messages that parse as JSON, parsing each message once", () => {
    const { h, record, deliver } = setup("json");
    deliver("nope", "null", "42", '{"a":1}');
    const f = h.step();
    expect(f.outputs).toEqual({ message: { a: 1 }, messages: loopOf([null, 42, { a: 1 }]) });
    expect(record.messages[0]!.parsed).toEqual({ ok: false, value: null });
    expect(record.messages[2]!.parsed).toEqual({ ok: true, value: 42 });
    deliver("still not json");
    expect(h.step().pulses.size).toBe(0);
  });

  it("delivers nothing when the Connection didn't evaluate this frame", () => {
    const { h, record } = setup();
    record.frame = h.frame - 1;
    record.messages = [{ text: "late" }];
    expect(h.step().outputs.messages).toEqual(loopOf([]));
  });

  it("warns once when Connection isn't a WebSocket handle", () => {
    const h = createPatchHarness(webSocketReceive, { inputs: { connection: { foo: 1 } } });
    h.run(2);
    expect(h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    const unwired = createPatchHarness(webSocketReceive);
    unwired.run(2);
    expect(unwired.logs).toEqual([]);
  });

  it("outputs the zero value and an empty loop while muted", () => {
    const run = runPatch(webSocketReceive, [{ connection: handle }], { muted: true, typeParam: "json" });
    expect(run.frames[0]!.outputs).toEqual({ message: null, messages: loopOf([]), received: false });
  });
});
