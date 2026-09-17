import { describe, expect, it } from "vitest";
import { createPatchHarness } from "../infra/index.ts";
import { bluetoothLePatch, decodeBytes, encodeWriteValue, normalizeUuid } from "./bluetoothLe.ts";
import type { BleLink } from "./platform.ts";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeBle(options: { canRead?: boolean; canNotify?: boolean; readValue?: number[] } = {}) {
  const log: string[] = [];
  let valueCallback: ((bytes: Uint8Array) => void) | undefined;
  let disconnectCallback: (() => void) | undefined;
  const pendingConnects: { resolve: (link: BleLink) => void; reject: (error: unknown) => void; options: unknown }[] = [];
  const link: BleLink = {
    name: "Heart Strap",
    canRead: options.canRead ?? true,
    canNotify: options.canNotify ?? true,
    read: async () => {
      log.push("read");
      return new Uint8Array(options.readValue ?? [87]);
    },
    write: async (bytes) => {
      log.push(`write ${Array.from(bytes).join(",")}`);
    },
    setNotifications: async (on) => {
      log.push(`notify ${on}`);
    },
    onValue: (cb) => {
      valueCallback = cb;
    },
    onDisconnect: (cb) => {
      disconnectCallback = cb;
    },
    disconnect: () => log.push("disconnect"),
  };
  const bluetooth = {
    available: true,
    connect: (opts: unknown) => new Promise<BleLink>((resolve, reject) => pendingConnects.push({ resolve, reject, options: opts })),
  };
  return { log, link, bluetooth, pendingConnects, emit: (bytes: number[]) => valueCallback?.(new Uint8Array(bytes)), drop: () => disconnectCallback?.() };
}

async function connected(extra: Parameters<typeof fakeBle>[0] = {}) {
  const ble = fakeBle(extra);
  const h = createPatchHarness(bluetoothLePatch, { services: { platform: { bluetooth: ble.bluetooth } as never } });
  h.step({ pulses: ["connect"] });
  ble.pendingConnects[0]!.resolve(ble.link);
  await flush();
  h.step();
  await flush();
  return { ...ble, h };
}

describe("normalizeUuid", () => {
  it("expands short codes, keeps full UUIDs, and snake-cases names", () => {
    expect(normalizeUuid("180F")).toBe("0000180f-0000-1000-8000-00805f9b34fb");
    expect(normalizeUuid("0x2A19")).toBe("00002a19-0000-1000-8000-00805f9b34fb");
    expect(normalizeUuid("DEADBEEF")).toBe("deadbeef-0000-1000-8000-00805f9b34fb");
    expect(normalizeUuid(" 6E400001-B5A3-F393-E0A9-E50E24DCCA9E ")).toBe("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
    expect(normalizeUuid("Heart Rate")).toBe("heart_rate");
  });
});

describe("decodeBytes and encodeWriteValue", () => {
  it("decodes little-endian numbers, text, and hex", () => {
    expect(decodeBytes(new Uint8Array([0x0a, 0xff]), "uint16")).toEqual({ value: 0xff0a, text: "0A FF", short: false });
    expect(decodeBytes(new Uint8Array([0xff]), "int8").value).toBe(-1);
    expect(decodeBytes(new Uint8Array([0x00, 0x00, 0x80, 0x3f]), "float32").value).toBe(1);
    expect(decodeBytes(new Uint8Array([0x01]), "uint32")).toMatchObject({ value: 0, short: true });
    expect(decodeBytes(new TextEncoder().encode("42"), "text")).toEqual({ value: 42, text: "42", short: false });
    expect(decodeBytes(new TextEncoder().encode("on"), "text").value).toBe(0);
    expect(decodeBytes(new Uint8Array([0x0a, 0xff]), "hex")).toEqual({ value: 10, text: "0A FF", short: false });
  });

  it("encodes Write Value and explains failures", () => {
    expect(encodeWriteValue("300", "uint8")).toEqual({ bytes: new Uint8Array([255]) });
    expect(encodeWriteValue("-2.6", "int16")).toEqual({ bytes: new Uint8Array([0xfd, 0xff]) });
    expect(encodeWriteValue("hi", "text")).toEqual({ bytes: new Uint8Array([104, 105]) });
    expect(encodeWriteValue("0x0A:ff 01", "hex")).toEqual({ bytes: new Uint8Array([10, 255, 1]) });
    expect(encodeWriteValue("abc", "uint8")).toEqual({ error: "Write Value isn't a number." });
    expect(encodeWriteValue("", "uint8")).toEqual({ error: "Write Value isn't a number." });
    expect(encodeWriteValue("0A F", "hex")).toEqual({ error: "Write Value isn't valid hex bytes." });
    expect(encodeWriteValue("x".repeat(513), "text")).toMatchObject({ error: expect.stringContaining("512") });
  });
});

describe("bluetoothLe", () => {
  it("is unavailable without Bluetooth and says so on Connect", () => {
    const h = createPatchHarness(bluetoothLePatch);
    expect(h.step().outputs).toMatchObject({ available: false, connected: false, error: false });
    const f = h.step({ pulses: ["connect"] });
    expect(f.outputs).toMatchObject({ error: true, errorMessage: "Bluetooth LE isn't available in this browser.", loading: false });
    expect(h.logs.map((l) => l.message)).toContain("Bluetooth LE: connect (no Bluetooth here)");
  });

  it("connects, reads the initial value, and receives notifications (newest wins)", async () => {
    const ble = fakeBle();
    const h = createPatchHarness(bluetoothLePatch, { services: { platform: { bluetooth: ble.bluetooth } as never } });
    const start = h.step({ pulses: ["connect"] });
    expect(start.outputs).toMatchObject({ loading: true, connected: false, available: true });
    expect(ble.pendingConnects[0]!.options).toEqual({ service: "battery_service", characteristic: "battery_level" });
    h.step({ pulses: ["connect"] });
    expect(ble.pendingConnects).toHaveLength(1);
    ble.pendingConnects[0]!.resolve(ble.link);
    await flush();
    const up = h.step();
    expect(up.outputs).toMatchObject({ connected: true, loading: false, deviceName: "Heart Strap", errorMessage: "" });
    await flush();
    const first = h.step();
    expect(first.pulses.has("received")).toBe(true);
    expect(first.outputs.value).toBe(87);
    expect(ble.log).toEqual(["read", "notify true"]);
    ble.emit([90]);
    ble.emit([91]);
    const note = h.step();
    expect(note.outputs.value).toBe(91);
    expect(note.pulses.has("received")).toBe(true);
    expect(h.step().pulses.has("received")).toBe(false);
  });

  it("queues Write before Read in the same frame and reports writes before connecting", async () => {
    const { h, log } = await connected({ canNotify: false });
    const notConnected = createPatchHarness(bluetoothLePatch, { services: { platform: { bluetooth: fakeBle().bluetooth } as never } });
    expect(notConnected.step({ pulses: ["write"] }).outputs.errorMessage).toBe("Connect before writing.");
    log.length = 0;
    h.step({ pulses: ["read", "write"], inputs: { writeValue: "7" } });
    await flush();
    expect(log).toEqual(["write 7", "read"]);
    h.step({ pulses: ["write"], inputs: { writeValue: "nope" } });
    expect(h.output("errorMessage")).toBe("Write Value isn't a number.");
    expect(h.output("error")).toBe(true);
  });

  it("turns notifications off and on while connected", async () => {
    const { h, log } = await connected({ canRead: false });
    log.length = 0;
    h.step({ inputs: { notifications: false } });
    await flush();
    h.step({ inputs: { notifications: true } });
    await flush();
    expect(log).toEqual(["notify false", "notify true"]);
  });

  it("Disconnect beats Connect, keeps the last value, and a dropped device reports an error", async () => {
    const { h, log, drop } = await connected();
    h.step();
    const off = h.step({ pulses: ["disconnect", "connect"] });
    expect(off.outputs).toMatchObject({ connected: false, loading: false, deviceName: "", value: 87 });
    expect(log).toContain("disconnect");

    const again = await connected();
    drop.call(null);
    again.drop();
    expect(again.h.step().outputs).toMatchObject({ connected: false, error: true, errorMessage: "The device disconnected." });
  });

  it("drops a connection that finishes after Disconnect, and reports chooser errors", async () => {
    const ble = fakeBle();
    const h = createPatchHarness(bluetoothLePatch, { services: { platform: { bluetooth: ble.bluetooth } as never } });
    h.step({ pulses: ["connect"] });
    h.step({ pulses: ["disconnect"] });
    ble.pendingConnects[0]!.resolve(ble.link);
    await flush();
    expect(h.step().outputs.connected).toBe(false);
    expect(ble.log).toEqual(["disconnect"]);

    h.step({ pulses: ["connect"] });
    ble.pendingConnects[1]!.reject(new Error("No device was chosen."));
    await flush();
    expect(h.step().outputs).toMatchObject({ loading: false, error: true, errorMessage: "No device was chosen." });
  });

  it("fails on empty UUIDs, warns once about retargeting while connected, and disconnects on dispose", async () => {
    const ble = fakeBle();
    const h = createPatchHarness(bluetoothLePatch, { services: { platform: { bluetooth: ble.bluetooth } as never }, inputs: { serviceUuid: "  " } });
    expect(h.step({ pulses: ["connect"] }).outputs.errorMessage).toBe("Service UUID is empty.");
    h.set({ serviceUuid: "180F", characteristicUuid: "" });
    expect(h.step({ pulses: ["connect"] }).outputs.errorMessage).toBe("Characteristic UUID is empty.");

    const c = await connected();
    c.h.run(3, { inputs: { serviceUuid: "heart_rate" } });
    expect(c.h.logs.filter((l) => l.level === "warn")).toHaveLength(1);
    c.h.dispose();
    expect(c.log).toContain("disconnect");
  });

  it("disconnects and outputs zeros while muted", async () => {
    const { h, log } = await connected();
    h.node.muted = true;
    const f = h.step();
    expect(f.outputs).toMatchObject({ connected: false, value: 0, available: false, text: "" });
    expect(log).toContain("disconnect");
  });
});
