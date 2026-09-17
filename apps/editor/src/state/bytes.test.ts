import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, sha256Hex, sha256HexSync } from "./bytes.ts";

const text = (s: string) => new TextEncoder().encode(s);

describe("bytes", () => {
  it("hashes with SHA-256", async () => {
    expect(sha256HexSync(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256HexSync(text("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const long = text("a".repeat(1000));
    expect(await sha256Hex(long)).toBe(sha256HexSync(long));
    expect(await sha256Hex(long.buffer)).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  });

  it("round-trips base64, including large buffers", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(bytesToBase64(text("hi"))).toBe("aGk=");
    expect(base64ToBytes("aGk")).toEqual(text("hi"));
    expect(base64ToBytes("not base64!!")).toBeNull();
  });
});
