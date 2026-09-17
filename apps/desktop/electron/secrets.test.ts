import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSecretStore, createTestCipher, MAX_SECRET_BYTES, SecretStoreError, type SecretCipher } from "./secrets.ts";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sonobe-secrets-"));
  file = path.join(dir, "nested", "secrets.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SecretStoreError) return err.code;
    throw err;
  }
  throw new Error("Expected a SecretStoreError");
}

describe("secret store", () => {
  it("stores encrypted values in a 0600 file and reads them back", async () => {
    const store = createSecretStore({ file, cipher: createTestCipher(), platform: "darwin" });
    expect(store.status()).toEqual({ available: true, backend: "keychain", reason: null });
    expect(await store.get("anthropic.apiKey")).toBeNull();
    await store.set("anthropic.apiKey", "sk-ant-test-123");
    expect(await store.get("anthropic.apiKey")).toBe("sk-ant-test-123");

    const onDisk = await readFile(file, "utf8");
    expect(onDisk).not.toContain("sk-ant-test-123");
    expect(JSON.parse(onDisk)).toMatchObject({ version: 1, secrets: { "anthropic.apiKey": expect.any(String) } });
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);

    const reopened = createSecretStore({ file, cipher: createTestCipher(), platform: "darwin" });
    expect(await reopened.get("anthropic.apiKey")).toBe("sk-ant-test-123");
    expect(await reopened.delete("anthropic.apiKey")).toBe(true);
    expect(await reopened.delete("anthropic.apiKey")).toBe(false);
    expect(await reopened.get("anthropic.apiKey")).toBeNull();
  });

  it("keeps concurrent writes", async () => {
    const store = createSecretStore({ file, cipher: createTestCipher() });
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.set(`key_${i}`, `value ${i}`)));
    const reopened = createSecretStore({ file, cipher: createTestCipher() });
    for (let i = 0; i < 12; i++) expect(await reopened.get(`key_${i}`)).toBe(`value ${i}`);
  });

  it("validates names and values", async () => {
    const store = createSecretStore({ file, cipher: createTestCipher() });
    expect(() => store.get("../escape")).toThrow(SecretStoreError);
    expect(() => store.get("")).toThrow(SecretStoreError);
    expect(() => store.delete(42)).toThrow(SecretStoreError);
    expect(await codeOf(store.set("ok", 7))).toBe("invalid_value");
    expect(await codeOf(store.set("ok", "x".repeat(MAX_SECRET_BYTES + 1)))).toBe("too_large");
  });

  it("refuses to store secrets without a real keychain", async () => {
    const unavailable: SecretCipher = { ...createTestCipher(), isEncryptionAvailable: () => false };
    const off = createSecretStore({ file, cipher: unavailable, platform: "darwin" });
    expect(off.status()).toMatchObject({ available: false, reason: expect.stringContaining("keychain") });
    expect(await codeOf(off.set("key", "value"))).toBe("unavailable");

    const plainText: SecretCipher = { ...createTestCipher(), getSelectedStorageBackend: () => "basic_text" };
    const linux = createSecretStore({ file, cipher: plainText, platform: "linux" });
    expect(linux.status()).toMatchObject({ available: false, backend: "basic_text", reason: expect.stringContaining("keyring") });
    expect(await codeOf(linux.set("key", "value"))).toBe("unavailable");
  });

  it("treats undecryptable or malformed entries as missing", async () => {
    const store = createSecretStore({ file, cipher: createTestCipher() });
    await store.set("good", "kept");
    const raw = JSON.parse(await readFile(file, "utf8")) as { secrets: Record<string, string> };
    raw.secrets.broken = Buffer.from("garbage").toString("base64");
    raw.secrets["bad name!"] = "ignored";
    await writeFile(file, JSON.stringify(raw));
    const warnings: string[] = [];
    const reopened = createSecretStore({ file, cipher: createTestCipher(), log: (_level, message) => warnings.push(message) });
    expect(await reopened.get("broken")).toBeNull();
    expect(await reopened.get("good")).toBe("kept");
    expect(warnings.join("\n")).toContain("broken");

    await writeFile(file, "{not json");
    const corrupt = createSecretStore({ file, cipher: createTestCipher(), log: (_level, message) => warnings.push(message) });
    expect(await corrupt.get("good")).toBeNull();
    await corrupt.set("fresh", "start over");
    expect(await corrupt.get("fresh")).toBe("start over");
  });
});
