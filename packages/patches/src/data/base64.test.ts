import { describe, expect, it } from "vitest";
import { concatBytes, decodeBase64, encodeBase64, normalizeBase64, percentDecodeBytes, sniffImageMime, sniffSoundMime, toUrlSafe, utf8Decode, utf8Encode } from "./base64.ts";

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));

describe("base64 codec", () => {
  it("matches the RFC 4648 test vectors", () => {
    const vectors: [string, string][] = [
      ["", ""],
      ["f", "Zg=="],
      ["fo", "Zm8="],
      ["foo", "Zm9v"],
      ["foob", "Zm9vYg=="],
      ["fooba", "Zm9vYmE="],
      ["foobar", "Zm9vYmFy"],
    ];
    for (const [text, b64] of vectors) {
      expect(encodeBase64(utf8Encode(text))).toBe(b64);
      expect(utf8Decode(decodeBase64(b64))).toBe(text);
    }
  });

  it("round-trips arbitrary bytes the same way Node does", () => {
    const data = Uint8Array.from({ length: 100_003 }, (_, i) => (i * 37 + 11) & 255);
    const b64 = encodeBase64(data);
    expect(b64).toBe(Buffer.from(data).toString("base64"));
    expect(decodeBase64(b64)).toEqual(data);
  });

  it("normalizes pasted base64", () => {
    const invalid = { ok: false, message: "This isn't valid base64 text." };
    expect(normalizeBase64(" data:image/PNG;base64,iVBO\nRw0K ")).toEqual({ ok: true, b64: "iVBORw0K", mime: "image/png" });
    expect(normalizeBase64("data:text/plain;charset=utf-8;base64,aGk=")).toEqual({ ok: true, b64: "aGk=", mime: "text/plain" });
    expect(normalizeBase64("SGVsbG8")).toEqual({ ok: true, b64: "SGVsbG8=", mime: null });
    expect(normalizeBase64("-_8")).toEqual({ ok: true, b64: "+/8=", mime: null });
    expect(normalizeBase64("abcde")).toEqual(invalid);
    expect(normalizeBase64("a*b=")).toEqual(invalid);
    expect(normalizeBase64("data:text/plain,hello")).toEqual({ ok: false, message: "This is a data URL, but it isn't base64." });
    expect(toUrlSafe("+/8=")).toBe("-_8");
  });

  it("percent-decodes data URL payloads into bytes", () => {
    expect(utf8Decode(percentDecodeBytes("%3Csvg%20a%3D%22b%22%3Eé%E2%9C%93%zz"))).toBe('<svg a="b">é✓%zz');
    expect(concatBytes([bytes(1), bytes(2, 3)])).toEqual(bytes(1, 2, 3));
  });

  it("recognizes image formats from their first bytes", () => {
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageMime(ascii("GIF89a"))).toBe("image/gif");
    expect(sniffImageMime(concatBytes([ascii("RIFF"), bytes(0, 0, 0, 0), ascii("WEBP")]))).toBe("image/webp");
    expect(sniffImageMime(ascii("BM6"))).toBe("image/bmp");
    expect(sniffImageMime(concatBytes([bytes(0, 0, 0, 0x1c), ascii("ftypavif")]))).toBe("image/avif");
    const svg = utf8Encode('﻿ <?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: x -->\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(sniffImageMime(svg)).toBe("image/svg+xml");
    expect(sniffImageMime(ascii("hello"))).toBeNull();
  });

  it("recognizes sound formats from their first bytes", () => {
    expect(sniffSoundMime(ascii("ID3"))).toBe("audio/mpeg");
    expect(sniffSoundMime(bytes(0xff, 0xfb))).toBe("audio/mpeg");
    expect(sniffSoundMime(bytes(0xff, 0xf1))).toBe("audio/aac");
    expect(sniffSoundMime(concatBytes([ascii("RIFF"), bytes(0, 0, 0, 0), ascii("WAVE")]))).toBe("audio/wav");
    expect(sniffSoundMime(ascii("OggS"))).toBe("audio/ogg");
    expect(sniffSoundMime(ascii("fLaC"))).toBe("audio/flac");
    expect(sniffSoundMime(concatBytes([bytes(0, 0, 0, 0x20), ascii("ftypM4A ")]))).toBe("audio/mp4");
    expect(sniffSoundMime(ascii("nope"))).toBeNull();
  });
});
