import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { DECODE_CHARS_PER_FRAME, base64Decode } from "./base64Decode.ts";

const b64 = (data: string | number[]) => Buffer.from(typeof data === "string" ? data : Uint8Array.from(data)).toString("base64");
const decode = (inputs: Record<string, unknown>, typeParam?: string) => createPatchHarness(base64Decode, { inputs, typeParam }).step().outputs;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];

describe("base64Decode", () => {
  it("decodes standard, URL-safe, unpadded, wrapped, and data URL base64 on frame 0", () => {
    const text = "héllo ✓ ~?";
    const encoded = b64(text);
    for (const input of [encoded, `${encoded.slice(0, 4)}\n${encoded.slice(4)}`, encoded.replace(/=+$/, ""), `data:text/plain;base64,${encoded}`, Buffer.from(text).toString("base64url")]) {
      expect(decode({ base64: input }), input).toEqual({ output: text, loading: false, error: false, errorMessage: "" });
    }
  });

  it("replaces invalid UTF-8 with U+FFFD", () => {
    expect(decode({ base64: b64([0xff, 0x61]) }).output).toBe("�a");
  });

  it("parses JSON for the JSON type", () => {
    expect(decode({ base64: b64('{"a":[1]}') }, "json").output).toEqual({ a: [1] });
    expect(decode({ base64: b64("{nope") }, "json")).toEqual({
      output: null,
      loading: false,
      error: true,
      errorMessage: "The decoded text isn't valid JSON. Switch this patch to Text to see what's inside.",
    });
  });

  it("reports invalid base64 and clears the previous output", () => {
    const h = createPatchHarness(base64Decode, { inputs: { base64: "aGk=" } });
    expect(h.step().outputs.output).toBe("hi");
    expect(h.step({ inputs: { base64: "a*b" } }).outputs).toEqual({ output: "", loading: false, error: true, errorMessage: "This isn't valid base64 text." });
    expect(decode({ base64: "data:text/plain,hi" }).errorMessage).toBe("This is a data URL, but it isn't base64.");
  });

  it("outputs the zero value without an error for empty text", () => {
    expect(decode({})).toEqual({ output: "", loading: false, error: false, errorMessage: "" });
    expect(decode({ base64: "  " }, "json")).toEqual({ output: null, loading: false, error: false, errorMessage: "" });
  });

  it("turns images into data URLs, detecting the format", () => {
    const png = b64(PNG);
    expect(decode({ base64: png }, "image")).toEqual({ output: { url: `data:image/png;base64,${png}` }, loading: false, error: false, errorMessage: "" });
    expect(decode({ base64: `data:image/jpeg;base64,${png}` }, "image").output).toEqual({ url: `data:image/jpeg;base64,${png}` });
    const svg = b64('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(decode({ base64: svg }, "image").output).toEqual({ url: `data:image/svg+xml;base64,${svg}` });
    expect(decode({ base64: b64("hello") }, "image")).toEqual({
      output: null,
      loading: false,
      error: true,
      errorMessage: "The decoded data isn't an image (PNG, JPEG, GIF, WebP, AVIF, BMP, or SVG).",
    });
  });

  it("turns sounds into data URLs, detecting the format", () => {
    const mp3 = b64([0x49, 0x44, 0x33, 3, 0]);
    expect(decode({ base64: `data:text/plain;base64,${mp3}` }, "sound").output).toEqual({ url: `data:audio/mpeg;base64,${mp3}` });
    const wav = b64([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVE")]);
    expect(decode({ base64: wav }, "sound").output).toEqual({ url: `data:audio/wav;base64,${wav}` });
    expect(decode({ base64: b64("hello") }, "sound").errorMessage).toBe("The decoded data isn't a sound (MP3, AAC, WAV, OGG, FLAC, or M4A).");
  });

  it("spreads very large text over several frames", () => {
    const text = "a".repeat(1_600_000);
    const encoded = b64(text);
    expect(encoded.length).toBeGreaterThan(DECODE_CHARS_PER_FRAME);
    const h = createPatchHarness(base64Decode, { inputs: { base64: encoded } });
    const f0 = h.step();
    expect(f0.outputs).toMatchObject({ output: "", loading: true });
    expect(f0.requestedNextFrame).toBe(true);
    const f1 = h.step();
    expect(f1.outputs.loading).toBe(false);
    expect(f1.outputs.output).toBe(text);
  });

  it("lets the newest value win, or finishes values in order with Queue on", () => {
    const big = b64("a".repeat(1_600_000));
    const replace = createPatchHarness(base64Decode, { inputs: { base64: big } });
    replace.step();
    expect(replace.step({ inputs: { base64: "aGk=" } }).outputs).toMatchObject({ output: "hi", loading: false });

    const queued = createPatchHarness(base64Decode, { inputs: { base64: big, queue: true } });
    queued.step();
    expect((queued.step({ inputs: { base64: "aGk=" } }).outputs.output as string).length).toBe(1_600_000);
    expect(queued.step().outputs.loading).toBe(true);
    expect(queued.step().outputs).toMatchObject({ output: "hi", loading: false });
  });

  it("decodes per loop index", () => {
    expect(decode({ base64: loopOf(["aGk=", "*"]) }).error).toEqual(loopOf([false, true]));
  });

  it("does no work while muted", () => {
    const run = runPatch(base64Decode, [{ base64: "aGk=" }], { muted: true, typeParam: "json" });
    expect(run.frames[0]!.outputs).toEqual({ output: null, loading: false, error: false, errorMessage: "" });
  });
});
