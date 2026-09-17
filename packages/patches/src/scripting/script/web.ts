/**
 * Web platform extras for scripts: base64, UTF-8 TextEncoder and TextDecoder, AbortController, and
 * console formatting that never runs getters.
 */

import { ACTIVE, InternalAbort, activeRealm, callValue, isObjectLike, registerIntrinsics } from "../sandbox/realm.ts";

/** Charge a web extra that allocates in proportion to its input (outside script code this does nothing). */
function charge(bytes: number): void {
  ACTIVE.realm?.chargeMemory(bytes);
  ACTIVE.realm?.chargeWork(bytes >>> 2);
}

// ---------------------------------------------------------------------------
// Base64
// ---------------------------------------------------------------------------

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

function namedError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

/** Base64 of raw bytes (RFC 4648, with padding). */
export function encodeBase64Bytes(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2]! + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? "=" : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? "=" : ALPHABET[c & 63]!;
  }
  return out;
}

/** Bytes from base64 text; null when the text isn't valid base64. */
export function decodeBase64Bytes(text: string): Uint8Array | null {
  const clean = text.replace(/[\t\n\f\r ]+/g, "");
  if (clean.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  const body = clean.replace(/=+$/, "");
  if (clean.length % 4 === 0 && clean.length - body.length > 2) return null;
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const ch of body) {
    value = (value << 6) | LOOKUP.get(ch)!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, index);
}

export function btoaImpl(input: unknown): string {
  const text = String(input);
  charge(text.length * 4);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 255) throw namedError("InvalidCharacterError", "btoa only encodes Latin-1 text. Use TextEncoder to turn other text into bytes first.");
    bytes[i] = code;
  }
  return encodeBase64Bytes(bytes);
}

export function atobImpl(input: unknown): string {
  const text = String(input);
  charge(text.length * 3);
  const bytes = decodeBase64Bytes(text);
  if (!bytes) throw namedError("InvalidCharacterError", "atob got text that isn't valid base64.");
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8");

export function encodeUtf8Base64(text: string): string {
  return encodeBase64Bytes(utf8Encoder.encode(text));
}

export function decodeUtf8Base64(text: string): string | null {
  const bytes = decodeBase64Bytes(text);
  return bytes ? utf8Decoder.decode(bytes) : null;
}

// ---------------------------------------------------------------------------
// TextEncoder and TextDecoder
// ---------------------------------------------------------------------------

export class ScriptTextEncoder {
  get encoding(): string {
    return "utf-8";
  }

  encode(input: unknown = ""): Uint8Array {
    const text = String(input);
    charge(text.length * 3);
    return utf8Encoder.encode(text);
  }

  encodeInto(source: unknown, destination: unknown): { read: number; written: number } {
    if (!(destination instanceof Uint8Array)) throw new TypeError("encodeInto writes into a Uint8Array.");
    return utf8Encoder.encodeInto(String(source), destination);
  }
}

export class ScriptTextDecoder {
  #decoder: TextDecoder;
  #fatal: boolean;
  #ignoreBOM: boolean;

  constructor(label: unknown = "utf-8", options?: unknown) {
    const normalized = String(label).trim().toLowerCase();
    if (normalized !== "utf-8" && normalized !== "utf8" && normalized !== "unicode-1-1-utf-8") {
      throw new RangeError(`The "${String(label)}" encoding isn't supported. Scripts decode UTF-8 only.`);
    }
    const opts = isObjectLike(options) ? (options as { fatal?: unknown; ignoreBOM?: unknown }) : {};
    this.#fatal = opts.fatal === true;
    this.#ignoreBOM = opts.ignoreBOM === true;
    this.#decoder = new TextDecoder("utf-8", { fatal: this.#fatal, ignoreBOM: this.#ignoreBOM });
  }

  get encoding(): string {
    return "utf-8";
  }

  get fatal(): boolean {
    return this.#fatal;
  }

  get ignoreBOM(): boolean {
    return this.#ignoreBOM;
  }

  decode(input?: unknown, options?: unknown): string {
    if (input === undefined) return "";
    if (!(input instanceof ArrayBuffer) && !ArrayBuffer.isView(input)) throw new TypeError("decode takes an ArrayBuffer or a typed array.");
    const stream = isObjectLike(options) && (options as { stream?: unknown }).stream === true;
    return this.#decoder.decode(input as BufferSource, { stream });
  }
}

Object.defineProperty(ScriptTextEncoder, "name", { value: "TextEncoder" });
Object.defineProperty(ScriptTextDecoder, "name", { value: "TextDecoder" });

// ---------------------------------------------------------------------------
// AbortController
// ---------------------------------------------------------------------------

interface SignalSlots {
  aborted: boolean;
  reason: unknown;
  listeners: unknown[];
  internal: (() => void)[];
  onabort: unknown;
}

const SIGNALS = new WeakMap<object, SignalSlots>();

function slots(signal: unknown): SignalSlots {
  const s = isObjectLike(signal) ? SIGNALS.get(signal) : undefined;
  if (!s) throw new TypeError("Illegal invocation");
  return s;
}

/** An Error named AbortError. */
export function makeAbortError(message = "This operation was aborted"): Error {
  return namedError("AbortError", message);
}

function createSignal(): ScriptAbortSignal {
  const signal = Object.create(ScriptAbortSignal.prototype) as ScriptAbortSignal;
  SIGNALS.set(signal, { aborted: false, reason: undefined, listeners: [], internal: [], onabort: null });
  return signal;
}

function abortSignal(signal: ScriptAbortSignal, reason: unknown): void {
  const s = slots(signal);
  if (s.aborted) return;
  s.aborted = true;
  s.reason = reason === undefined ? makeAbortError() : reason;
  for (const listener of s.internal) listener();
  const event = { type: "abort", target: signal };
  const handlers = [s.onabort, ...s.listeners].filter((h) => typeof h === "function");
  for (const handler of handlers) {
    try {
      callValue(handler, signal, [event]);
    } catch (err) {
      if (err instanceof InternalAbort) throw err;
      activeRealm().hooks.unhandledRejection(err);
    }
  }
}

export class ScriptAbortSignal {
  constructor() {
    throw new TypeError("Illegal constructor. Create an AbortController and use its signal.");
  }

  get aborted(): boolean {
    return slots(this).aborted;
  }

  get reason(): unknown {
    return slots(this).reason;
  }

  get onabort(): unknown {
    return slots(this).onabort;
  }

  set onabort(handler: unknown) {
    slots(this).onabort = handler;
  }

  addEventListener(type: unknown, listener: unknown): void {
    const s = slots(this);
    if (type === "abort" && typeof listener === "function" && !s.listeners.includes(listener)) s.listeners.push(listener);
  }

  removeEventListener(type: unknown, listener: unknown): void {
    const s = slots(this);
    if (type === "abort") s.listeners = s.listeners.filter((l) => l !== listener);
  }

  throwIfAborted(): void {
    const s = slots(this);
    if (s.aborted) throw s.reason;
  }

  static abort(reason?: unknown): ScriptAbortSignal {
    const signal = createSignal();
    abortSignal(signal, reason);
    return signal;
  }
}

export class ScriptAbortController {
  #signal: ScriptAbortSignal = createSignal();

  get signal(): ScriptAbortSignal {
    return this.#signal;
  }

  abort(reason?: unknown): void {
    abortSignal(this.#signal, reason);
  }
}

Object.defineProperty(ScriptAbortSignal, "name", { value: "AbortSignal" });
Object.defineProperty(ScriptAbortController, "name", { value: "AbortController" });

/** Watch a script AbortSignal from host code. Null when `signal` isn't one. */
export function watchAbort(signal: unknown, listener: () => void): { aborted: boolean; reason: () => unknown } | null {
  const s = isObjectLike(signal) ? SIGNALS.get(signal) : undefined;
  if (!s) return null;
  if (!s.aborted) s.internal.push(listener);
  return { aborted: s.aborted, reason: () => s.reason };
}

registerIntrinsics(ScriptTextEncoder, ScriptTextDecoder, ScriptAbortSignal, ScriptAbortController);

// ---------------------------------------------------------------------------
// Console formatting
// ---------------------------------------------------------------------------

const MAX_ITEMS = 50;

function dataValue(obj: object, key: PropertyKey): { ok: true; value: unknown } | { ok: false; label: string } {
  const d = Reflect.getOwnPropertyDescriptor(obj, key);
  if (!d) return { ok: true, value: undefined };
  if ("value" in d) return { ok: true, value: d.value };
  return { ok: false, label: d.get && d.set ? "[Getter/Setter]" : d.get ? "[Getter]" : "[Setter]" };
}

/** Format a script value for a log line. Strings print raw at the top level; getters never run. */
export function formatLogValue(value: unknown, depth = 0, seen: object[] = []): string {
  if (typeof value === "string") return depth === 0 ? value : JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return value.toString();
  if (value === null || value === undefined || typeof value === "boolean") return String(value);
  if (typeof value === "function") return `[Function${value.name ? `: ${value.name}` : " (anonymous)"}]`;
  const obj = value as object;
  if (seen.includes(obj)) return "[Circular]";
  if (obj instanceof Error) {
    const name = dataValue(obj, "name");
    const message = dataValue(obj, "message");
    const n = name.ok && typeof name.value === "string" ? name.value : obj.name;
    const m = message.ok && typeof message.value === "string" ? message.value : "";
    return m ? `${n}: ${m}` : n;
  }
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? "Invalid Date" : obj.toISOString();
  if (obj instanceof RegExp) return String(obj);
  if (depth > 3) return Array.isArray(obj) ? "[Array]" : "[Object]";
  seen.push(obj);
  try {
    if (Array.isArray(obj)) {
      const items: string[] = [];
      for (let i = 0; i < Math.min(obj.length, MAX_ITEMS); i++) {
        const item = dataValue(obj, i);
        items.push(item.ok ? formatLogValue(item.value, depth + 1, seen) : item.label);
      }
      if (obj.length > MAX_ITEMS) items.push(`… ${obj.length - MAX_ITEMS} more`);
      return items.length ? `[ ${items.join(", ")} ]` : "[]";
    }
    if (obj instanceof Map) {
      const items = [...Map.prototype.entries.call(obj)].slice(0, MAX_ITEMS).map(([k, v]) => `${formatLogValue(k, depth + 1, seen)} => ${formatLogValue(v, depth + 1, seen)}`);
      return `Map(${obj.size}) { ${items.join(", ")} }`;
    }
    if (obj instanceof Set) {
      const items = [...Set.prototype.values.call(obj)].slice(0, MAX_ITEMS).map((v) => formatLogValue(v, depth + 1, seen));
      return `Set(${obj.size}) { ${items.join(", ")} }`;
    }
    if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
      const view = obj as unknown as ArrayLike<number | bigint>;
      const items = Array.from({ length: Math.min(view.length, MAX_ITEMS) }, (_, i) => formatLogValue(view[i], depth + 1, seen));
      return `${obj.constructor.name}(${view.length}) [ ${items.join(", ")} ]`;
    }
    const entries: string[] = [];
    for (const key of Reflect.ownKeys(obj)) {
      const d = Reflect.getOwnPropertyDescriptor(obj, key);
      if (!d?.enumerable) continue;
      if (entries.length >= MAX_ITEMS) {
        entries.push("…");
        break;
      }
      const label = typeof key === "symbol" ? `[${key.toString()}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
      const item = dataValue(obj, key);
      entries.push(`${label}: ${item.ok ? formatLogValue(item.value, depth + 1, seen) : item.label}`);
    }
    return entries.length ? `{ ${entries.join(", ")} }` : "{}";
  } finally {
    seen.pop();
  }
}
