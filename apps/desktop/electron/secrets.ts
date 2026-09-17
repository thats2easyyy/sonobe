/**
 * Secrets for the editor, such as the optional in-app assistant's API key. Values are encrypted with
 * the operating system's keychain through Electron's safeStorage and kept, encrypted, in
 * userData/secrets.json (0600). Electron-free: main.ts passes safeStorage as the cipher.
 */

import { readFile } from "node:fs/promises";
import { atomicWriteFile } from "./fs-utils.ts";

/** The subset of Electron's safeStorage the store needs. */
export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux only: which key store backs the encryption ("basic_text" means a hardcoded key). */
  getSelectedStorageBackend?(): string;
}

/** Whether secrets can be stored on this computer, and why not when they can't. */
export interface SecretsStatus {
  available: boolean;
  /** "keychain" (macOS), "dpapi" (Windows), the Linux backend name, or "test". */
  backend: string | null;
  reason: string | null;
}

export interface SecretStore {
  status(): SecretsStatus;
  /** The stored value, or null when it isn't set (or can't be decrypted any more). */
  get(name: unknown): Promise<string | null>;
  set(name: unknown, value: unknown): Promise<void>;
  /** Resolves true when something was removed. */
  delete(name: unknown): Promise<boolean>;
}

export interface SecretStoreOptions {
  /** Path of secrets.json. */
  file: string;
  cipher: SecretCipher;
  /** process.platform by default. */
  platform?: string;
  log?(level: "info" | "warn" | "error", message: string): void;
}

export const SECRET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const MAX_SECRET_BYTES = 16 * 1024;

interface SecretsFile {
  version: 1;
  /** name → base64 ciphertext */
  secrets: Record<string, string>;
}

export class SecretStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SecretStoreError";
    this.code = code;
  }
}

function checkName(name: unknown): string {
  if (typeof name !== "string" || !SECRET_NAME_PATTERN.test(name)) {
    throw new SecretStoreError("invalid_name", "Secret names are 1–64 letters, numbers, dots, dashes or underscores, starting with a letter or number.");
  }
  return name;
}

function backendName(cipher: SecretCipher, platform: string): string | null {
  if (platform === "darwin") return "keychain";
  if (platform === "win32") return "dpapi";
  try {
    return cipher.getSelectedStorageBackend?.() ?? null;
  } catch {
    return null;
  }
}

export function createSecretStore(options: SecretStoreOptions): SecretStore {
  const platform = options.platform ?? process.platform;
  const log = options.log ?? (() => undefined);
  let cache: Record<string, string> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  /** Run file operations one at a time so concurrent sets don't lose writes. */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };

  const load = async (): Promise<Record<string, string>> => {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(await readFile(options.file, "utf8")) as Partial<SecretsFile>;
      const entries = parsed && typeof parsed.secrets === "object" && parsed.secrets !== null ? parsed.secrets : {};
      cache = Object.fromEntries(Object.entries(entries).filter((e): e is [string, string] => SECRET_NAME_PATTERN.test(e[0]) && typeof e[1] === "string"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") log("warn", `Couldn't read ${options.file}; starting with no stored secrets (${err instanceof Error ? err.message : String(err)})`);
      cache = {};
    }
    return cache;
  };

  const save = async (secrets: Record<string, string>) => {
    const sorted = Object.fromEntries(Object.entries(secrets).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    await atomicWriteFile(options.file, `${JSON.stringify({ version: 1, secrets: sorted } satisfies SecretsFile, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 });
    cache = sorted;
  };

  const status = (): SecretsStatus => {
    const backend = backendName(options.cipher, platform);
    let available = false;
    try {
      available = options.cipher.isEncryptionAvailable();
    } catch {
      available = false;
    }
    if (!available) return { available: false, backend, reason: "This computer's keychain isn't available, so Sonobe can't store secrets safely." };
    if (backend === "basic_text") {
      return { available: false, backend, reason: "No system keyring (such as GNOME Keyring or KWallet) was found, so Sonobe won't store secrets on this computer." };
    }
    return { available: true, backend, reason: null };
  };

  const requireAvailable = () => {
    const s = status();
    if (!s.available) throw new SecretStoreError("unavailable", s.reason ?? "Secure storage isn't available.");
  };

  return {
    status,

    get(name) {
      const key = checkName(name);
      return serial(async () => {
        const encrypted = (await load())[key];
        if (encrypted === undefined) return null;
        if (!status().available) return null;
        try {
          return options.cipher.decryptString(Buffer.from(encrypted, "base64"));
        } catch (err) {
          log("warn", `Couldn't decrypt the secret "${key}" (the keychain entry may have changed): ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      });
    },

    set(name, value) {
      const key = checkName(name);
      if (typeof value !== "string") return Promise.reject(new SecretStoreError("invalid_value", "A secret's value must be text."));
      if (Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES) return Promise.reject(new SecretStoreError("too_large", `A secret can be at most ${MAX_SECRET_BYTES / 1024} KB.`));
      return serial(async () => {
        requireAvailable();
        const encrypted = options.cipher.encryptString(value).toString("base64");
        await save({ ...(await load()), [key]: encrypted });
      });
    },

    delete(name) {
      const key = checkName(name);
      return serial(async () => {
        const current = await load();
        if (!Object.hasOwn(current, key)) return false;
        const next = { ...current };
        delete next[key];
        await save(next);
        return true;
      });
    },
  };
}

/**
 * A reversible, NOT secure cipher for automated tests (SONOBE_TEST=1), so smoke runs never touch the
 * person's keychain or show a keychain prompt.
 */
export function createTestCipher(): SecretCipher & { readonly insecure: true } {
  const marker = "sonobe-test-cipher:";
  return {
    insecure: true,
    isEncryptionAvailable: () => true,
    encryptString: (plainText) => Buffer.from(marker + Buffer.from(plainText, "utf8").toString("base64"), "utf8"),
    decryptString: (encrypted) => {
      const text = encrypted.toString("utf8");
      if (!text.startsWith(marker)) throw new Error("Not encrypted with the test cipher");
      return Buffer.from(text.slice(marker.length), "base64").toString("utf8");
    },
    getSelectedStorageBackend: () => "test",
  };
}
