/**
 * Bluetooth LE: connects to one characteristic through the host's Bluetooth service, reads and
 * writes it (encoded with Format), and delivers notifications. GATT operations run one at a time;
 * callbacks only store results, which the next evaluate applies.
 */

import type { BluetoothLink, PatchContext } from "@sonobe/engine";
import { definePatch, toBool, toText, warnOnce } from "../infra/index.ts";
import { describeError } from "./shared.ts";

const BASE_UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb";
const MAX_WRITE_BYTES = 512;

/** A UUID input as Web Bluetooth expects it: short codes expanded, full UUIDs lowercased, names snake_cased. */
export function normalizeUuid(value: string): string {
  const t = value.trim().toLowerCase();
  const hex = t.startsWith("0x") ? t.slice(2) : t;
  if (/^[0-9a-f]{4}$/.test(hex)) return `0000${hex}${BASE_UUID_SUFFIX}`;
  if (/^[0-9a-f]{8}$/.test(hex)) return `${hex}${BASE_UUID_SUFFIX}`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(t)) return t;
  return t.replace(/\s+/g, "_");
}

const hexPairs = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");

const NUMERIC: Readonly<Record<string, { size: number; min: number; max: number; float?: boolean }>> = {
  uint8: { size: 1, min: 0, max: 255 },
  int8: { size: 1, min: -128, max: 127 },
  uint16: { size: 2, min: 0, max: 65_535 },
  int16: { size: 2, min: -32_768, max: 32_767 },
  uint32: { size: 4, min: 0, max: 4_294_967_295 },
  int32: { size: 4, min: -2_147_483_648, max: 2_147_483_647 },
  float32: { size: 4, min: -3.4028234663852886e38, max: 3.4028234663852886e38, float: true },
};

/** Decode characteristic bytes with a format: `{ value, text, short }` where `short` means too few bytes. */
export function decodeBytes(bytes: Uint8Array, format: string): { value: number; text: string; short: boolean } {
  if (format === "text") {
    const text = new TextDecoder("utf-8").decode(bytes);
    const n = Number(text);
    return { value: Number.isFinite(n) ? n : 0, text, short: false };
  }
  if (format === "hex") return { value: bytes[0] ?? 0, text: hexPairs(bytes), short: false };
  const spec = NUMERIC[format] ?? NUMERIC.uint8!;
  if (bytes.length < spec.size) return { value: 0, text: hexPairs(bytes), short: true };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let value: number;
  switch (format) {
    case "int8":
      value = view.getInt8(0);
      break;
    case "uint16":
      value = view.getUint16(0, true);
      break;
    case "int16":
      value = view.getInt16(0, true);
      break;
    case "uint32":
      value = view.getUint32(0, true);
      break;
    case "int32":
      value = view.getInt32(0, true);
      break;
    case "float32":
      value = view.getFloat32(0, true);
      break;
    default:
      value = view.getUint8(0);
  }
  return { value: Number.isFinite(value) ? value : 0, text: hexPairs(bytes), short: false };
}

/** Encode Write Value with a format, or the readable reason it can't be. */
export function encodeWriteValue(value: string, format: string): { bytes: Uint8Array } | { error: string } {
  let bytes: Uint8Array;
  if (format === "text") {
    bytes = new TextEncoder().encode(value);
  } else if (format === "hex") {
    const digits = value.replace(/0x/gi, "").replace(/[\s:]/g, "");
    if (digits.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(digits)) return { error: "Write Value isn't valid hex bytes." };
    bytes = new Uint8Array(digits.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  } else {
    const spec = NUMERIC[format] ?? NUMERIC.uint8!;
    const trimmed = value.trim();
    const n = trimmed === "" ? Number.NaN : Number(trimmed);
    if (!Number.isFinite(n)) return { error: "Write Value isn't a number." };
    bytes = new Uint8Array(spec.size);
    const view = new DataView(bytes.buffer);
    const v = Math.min(spec.max, Math.max(spec.min, spec.float ? n : Math.round(n)));
    switch (format) {
      case "int8":
        view.setInt8(0, v);
        break;
      case "uint16":
        view.setUint16(0, v, true);
        break;
      case "int16":
        view.setInt16(0, v, true);
        break;
      case "uint32":
        view.setUint32(0, v, true);
        break;
      case "int32":
        view.setInt32(0, v, true);
        break;
      case "float32":
        view.setFloat32(0, v, true);
        break;
      default:
        view.setUint8(0, v);
    }
  }
  if (bytes.length > MAX_WRITE_BYTES) return { error: `Write Value is longer than ${MAX_WRITE_BYTES} bytes.` };
  return { bytes };
}

interface BleState {
  gen: number;
  link: BluetoothLink | null;
  connectError: string | null;
  dropped: boolean;
  incoming: Uint8Array | null;
  ops: Promise<void>;
  opError: string | null;
  connected: boolean;
  loading: boolean;
  value: number;
  text: string;
  deviceName: string;
  errorMessage: string;
  error: boolean;
  notifying: boolean | null;
  /** Service, characteristic, and name prefix the current connection was made with. */
  target: string;
}

function resetLink(s: BleState): void {
  s.link = null;
  s.connected = false;
  s.loading = false;
  s.notifying = null;
  s.deviceName = "";
}

function fail(s: BleState, message: string): void {
  s.errorMessage = message;
  s.error = true;
}

/** Chain a GATT operation so operations run one at a time; failures land in `opError`. */
function queue(s: BleState, op: (link: BluetoothLink) => Promise<unknown> | unknown): void {
  const gen = s.gen;
  s.ops = s.ops
    .then(async () => {
      if (s.gen !== gen || !s.link) return;
      await op(s.link);
    })
    .then(undefined, (error: unknown) => {
      if (s.gen === gen) s.opError = describeError(error);
    });
}

function storeValue(s: BleState): (bytes: Uint8Array) => void {
  const gen = s.gen;
  return (bytes) => {
    if (s.gen === gen && bytes instanceof Uint8Array) s.incoming = bytes;
  };
}

function disconnect(s: BleState): void {
  s.gen++;
  const link = s.link;
  resetLink(s);
  try {
    link?.disconnect();
  } catch {
    // Already gone.
  }
}

function outputAll(ctx: PatchContext, s: BleState, available: boolean): void {
  ctx.output("value", s.value);
  ctx.output("text", s.text);
  ctx.output("connected", s.connected);
  ctx.output("deviceName", s.deviceName);
  ctx.output("errorMessage", s.errorMessage);
  ctx.output("loading", s.loading);
  ctx.output("available", available);
  ctx.output("error", s.error);
}

export const bluetoothLePatch = definePatch<BleState>("bluetoothLe", {
  mutedBehavior: "evaluate",
  state: () => ({
    gen: 0,
    link: null,
    connectError: null,
    dropped: false,
    incoming: null,
    ops: Promise.resolve(),
    opError: null,
    connected: false,
    loading: false,
    value: 0,
    text: "",
    deviceName: "",
    errorMessage: "",
    error: false,
    notifying: null,
    target: "",
  }),
  evaluate(ctx) {
    const s = ctx.state;
    if (ctx.muted) {
      if (s.link || s.loading) disconnect(s);
      ctx.output("value", 0);
      ctx.output("text", "");
      for (const key of ["connected", "loading", "available", "error"]) ctx.output(key, false);
      ctx.output("deviceName", "");
      ctx.output("errorMessage", "");
      return;
    }
    const ble = ctx.services.platform.bluetooth;
    const available = ble?.available === true;
    const format = toText(ctx.input("format"));

    // 1. Apply results stored by callbacks.
    if (s.link && !s.connected) {
      s.connected = true;
      s.loading = false;
      s.deviceName = typeof s.link.name === "string" ? s.link.name : "";
      s.error = false;
      s.errorMessage = "";
      if (s.link.canRead) {
        const store = storeValue(s);
        queue(s, (link) => link.read().then(store));
      }
    }
    if (s.connectError !== null) {
      s.loading = false;
      fail(s, s.connectError);
      s.connectError = null;
    }
    if (s.dropped) {
      resetLink(s);
      fail(s, "The device disconnected.");
      s.dropped = false;
    }
    if (s.opError !== null) {
      fail(s, s.opError);
      s.opError = null;
    }

    // 2. Commands: Disconnect beats Connect; Write runs before Read.
    const service = toText(ctx.input("serviceUuid"));
    const characteristic = toText(ctx.input("characteristicUuid"));
    const namePrefix = toText(ctx.input("namePrefix"));
    const target = `${normalizeUuid(service)}|${normalizeUuid(characteristic)}|${namePrefix}`;
    if (ctx.pulsed("disconnect")) {
      disconnect(s);
    } else if (ctx.pulsed("connect") && !s.connected && !s.loading) {
      if (!ble || !available) {
        fail(s, "Bluetooth LE isn't available in this browser.");
        ctx.services.log("log", "Bluetooth LE: connect (no Bluetooth here)");
      } else if (service.trim() === "") {
        fail(s, "Service UUID is empty.");
      } else if (characteristic.trim() === "") {
        fail(s, "Characteristic UUID is empty.");
      } else {
        const gen = ++s.gen;
        s.loading = true;
        s.error = false;
        s.errorMessage = "";
        s.target = target;
        const options: { service: string; characteristic: string; namePrefix?: string } = { service: normalizeUuid(service), characteristic: normalizeUuid(characteristic) };
        if (namePrefix !== "") options.namePrefix = namePrefix;
        let pending: Promise<BluetoothLink>;
        try {
          pending = Promise.resolve(ble.connect(options));
        } catch (error) {
          pending = Promise.reject(error);
        }
        pending.then(
          (link) => {
            if (s.gen !== gen) {
              link?.disconnect?.();
              return;
            }
            link.onValue((bytes) => {
              if (s.gen === gen && bytes instanceof Uint8Array) s.incoming = bytes;
            });
            link.onDisconnect(() => {
              if (s.gen === gen) s.dropped = true;
            });
            s.link = link;
          },
          (error: unknown) => {
            if (s.gen === gen) s.connectError = describeError(error);
          },
        );
      }
    }
    if (ctx.pulsed("write")) {
      if (!s.connected) fail(s, "Connect before writing.");
      else {
        const encoded = encodeWriteValue(toText(ctx.input("writeValue")), format);
        if ("error" in encoded) fail(s, encoded.error);
        else queue(s, (link) => link.write(encoded.bytes));
      }
    }
    if (ctx.pulsed("read")) {
      if (!s.connected) fail(s, "Connect before reading.");
      else {
        const store = storeValue(s);
        queue(s, (link) => link.read().then(store));
      }
    }
    if (s.connected && s.link) {
      const wantNotify = toBool(ctx.input("notifications")) && s.link.canNotify === true;
      if (s.notifying !== wantNotify) {
        const wasOn = s.notifying === true;
        s.notifying = wantNotify;
        if (wantNotify || wasOn) queue(s, (link) => link.setNotifications(wantNotify));
      }
      if (target !== s.target) {
        warnOnce(ctx, "retarget", "Bluetooth LE: the new Service UUID, Characteristic UUID, or Name Prefix applies on the next Connect.");
      }
    }

    // 3. Deliver the newest value.
    if (s.incoming) {
      const decoded = decodeBytes(s.incoming, format);
      if (decoded.short) warnOnce(ctx, "shortValue", `Bluetooth LE: the value has too few bytes for ${format}, so Value reads 0.`);
      s.value = decoded.value;
      s.text = decoded.text;
      s.incoming = null;
      ctx.pulse("received");
    }
    if (s.loading || s.connected) ctx.requestNextFrame();
    outputAll(ctx, s, available);
  },
  dispose(state) {
    if (state) disconnect(state);
  },
});
