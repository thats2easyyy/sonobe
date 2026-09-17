import type { PlatformServices } from "@sonobe/engine";
import { runPatch } from "@sonobe/engine/testing";
import { describe, expect, it } from "vitest";
import { createPatchHarness, loopOf } from "../infra/index.ts";
import { ENCODE_BYTES_PER_FRAME, base64Encode } from "./base64Encode.ts";

const b64 = (text: string) => Buffer.from(text).toString("base64");
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const encode = (inputs: Record<string, unknown>, typeParam?: string) => createPatchHarness(base64Encode, { inputs, typeParam }).step().outputs;

describe("base64Encode", () => {
  it("encodes UTF-8 text on frame 0", () => {
    const f = createPatchHarness(base64Encode, { inputs: { value: "héllo ✓" } }).step();
    expect(f.outputs).toEqual({ base64: b64("héllo ✓"), loading: false, error: false, errorMessage: "" });
    expect(f.requestedNextFrame).toBe(false);
    expect(encode({ value: "" }).base64).toBe("");
  });

  it("encodes compact JSON for the JSON type", () => {
    expect(encode({ value: { a: 1, b: "x" } }, "json").base64).toBe(b64('{"a":1,"b":"x"}'));
    expect(encode({}, "json").base64).toBe(b64("{}"));
    expect(encode({ value: "hi" }, "json").base64).toBe(b64('"hi"'));
  });

  it("uses the URL-safe alphabet without padding when URL Safe is on", () => {
    expect(encode({ value: "??>", urlSafe: true }).base64).toBe("Pz8-");
    expect(encode({ value: "a", urlSafe: true }).base64).toBe("YQ");
  });

  it("encodes again when Value or URL Safe changes", () => {
    const h = createPatchHarness(base64Encode, { inputs: { value: "a" } });
    expect(h.step().outputs.base64).toBe("YQ==");
    expect(h.step({ inputs: { value: "b" } }).outputs.base64).toBe("Yg==");
    expect(h.step({ inputs: { urlSafe: true } }).outputs.base64).toBe("Yg");
  });

  it("keeps separate work per loop index", () => {
    expect(encode({ value: loopOf(["a", "b"]) }).base64).toEqual(loopOf(["YQ==", "Yg=="]));
  });

  it("reuses a base64 data URL's payload and decodes percent-encoded data URLs", () => {
    expect(encode({ value: { url: "data:image/png;base64,iVBO Rw0K" } }, "image")).toEqual({ base64: "iVBORw0K", loading: false, error: false, errorMessage: "" });
    expect(encode({ value: { url: "data:audio/mpeg;base64,+/8=" }, urlSafe: true }, "sound").base64).toBe("-_8");
    expect(encode({ value: { url: "data:image/svg+xml,%3Csvg%2F%3E" } }, "image").base64).toBe(b64("<svg/>"));
  });

  it("explains media it can't read", () => {
    expect(encode({}, "image")).toEqual({ base64: "", loading: false, error: false, errorMessage: "" });
    expect(encode({ value: { assetId: "cat" } }, "image")).toMatchObject({ error: true, errorMessage: "The image asset is missing." });
    expect(encode({ value: { url: "https://sounds.test/a.mp3" } }, "sound")).toMatchObject({ error: true, errorMessage: "This viewer can't read media data yet." });
    expect(encode({ value: { url: "data:image/png;base64,***" } }, "image")).toMatchObject({ error: true, errorMessage: "Couldn't read the image data." });
  });

  it("reads other media through the platform's byte reader on a later frame", async () => {
    let finish!: (bytes: Uint8Array) => void;
    const platform = { readBytes: () => new Promise<Uint8Array>((resolve) => (finish = resolve)) } as unknown as PlatformServices;
    const h = createPatchHarness(base64Encode, { typeParam: "sound", inputs: { value: { assetId: "ding" } }, services: { resolveAssetUrl: (id) => `asset://${id}`, platform } });
    const f0 = h.step();
    expect(f0.outputs).toMatchObject({ base64: "", loading: true });
    expect(f0.requestedNextFrame).toBe(true);
    finish(Uint8Array.from([0x49, 0x44, 0x33]));
    await flush();
    expect(h.step().outputs).toEqual({ base64: "SUQz", loading: false, error: false, errorMessage: "" });

    const failing = { readBytes: () => Promise.reject(new Error("nope")) } as unknown as PlatformServices;
    const broken = createPatchHarness(base64Encode, { typeParam: "sound", inputs: { value: { url: "blob:x" } }, services: { platform: failing } });
    broken.step();
    await flush();
    expect(broken.step().outputs).toMatchObject({ loading: false, error: true, errorMessage: "Couldn't read the sound data." });
  });

  it("spreads large inputs over several frames without showing partial output", () => {
    const text = "a".repeat(ENCODE_BYTES_PER_FRAME + 500_000);
    const h = createPatchHarness(base64Encode, { inputs: { value: text } });
    expect(h.step().outputs).toMatchObject({ base64: "", loading: true });
    const f1 = h.step();
    expect(f1.outputs.base64).toBe(b64(text));
    expect(f1.outputs.loading).toBe(false);
  });

  it("lets the newest value win, or finishes values in order with Queue on", () => {
    const big = "a".repeat(ENCODE_BYTES_PER_FRAME + 3);
    const replace = createPatchHarness(base64Encode, { inputs: { value: big } });
    replace.step();
    expect(replace.step({ inputs: { value: "b" } }).outputs).toMatchObject({ base64: "Yg==", loading: false });

    const queued = createPatchHarness(base64Encode, { inputs: { value: big, queue: true } });
    queued.step();
    const f1 = queued.step({ inputs: { value: "b" } });
    expect(f1.outputs.base64).toBe(b64(big));
    expect(f1.requestedNextFrame).toBe(true);
    const f2 = queued.step();
    expect(f2.outputs).toMatchObject({ base64: b64(big), loading: true });
    expect(queued.step().outputs).toMatchObject({ base64: "Yg==", loading: false });
  });

  it("does no work while muted", () => {
    const run = runPatch(base64Encode, [{ value: "hi" }], { muted: true });
    expect(run.frames[0]!.outputs).toEqual({ base64: "", loading: false, error: false, errorMessage: "" });
  });
});
