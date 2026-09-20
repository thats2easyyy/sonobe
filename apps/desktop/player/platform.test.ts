import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@sonobe/engine";
import { runFrames, sequence, tap } from "@sonobe/engine/testing";
import { createPatchRegistry, getSpec } from "@sonobe/patches";
import { createMuteStore } from "@sonobe/renderer";
import { describe, expect, it, vi } from "vitest";
import { playerPlatform, readNativeHost, type PlayerWindow } from "./platform.ts";
import { hapticCheckDocument } from "./testing.ts";

const IOS_TYPES = ["vibrate", "selection", "impactLight", "impactMedium", "impactHeavy", "notificationSuccess", "notificationWarning", "notificationError"];

function androidWindow() {
  const calls: unknown[] = [];
  const navigator = {
    vibrate(this: unknown, pattern: number | number[]) {
      if (this !== navigator) throw new TypeError("Illegal invocation");
      calls.push(pattern);
      return true;
    },
  };
  return { win: { navigator } satisfies PlayerWindow, calls };
}

function nativeWindow(announcement: unknown = { version: 1, platform: "ios", haptics: IOS_TYPES, vibrate: true }) {
  const posted: unknown[] = [];
  const win: PlayerWindow = { sonobeNative: announcement, webkit: { messageHandlers: { sonobe: { postMessage: (message) => posted.push(message) } } } };
  return { win, posted };
}

describe("playerPlatform", () => {
  it("has no haptics or vibration in a browser without them, but the editor viewer's other services", async () => {
    for (const win of [{}, { navigator: {} }]) {
      const platform = playerPlatform(win);
      expect(platform.haptic).toBeUndefined();
      expect(platform.vibrate).toBeUndefined();
      expect(typeof platform.openUrl).toBe("function");
      expect(typeof platform.speak).toBe("function");
      platform.dispose();
    }
    // Network Request and JSON File fetch through the browser's fetch, and links open in a new tab.
    const fetch = vi.fn(async () => new Response("hello", { status: 200 }));
    const open = vi.fn();
    const platform = playerPlatform({ open } as never, { fetch: fetch as never, mute: createMuteStore() });
    const res = await platform.fetch!("https://api.example.com/greeting");
    expect(await res.text()).toBe("hello");
    expect(fetch).toHaveBeenCalledWith("https://api.example.com/greeting", expect.objectContaining({ method: "GET" }));
    expect(platform.openUrl!("https://sonobe.dev/")).toBe(true);
    expect(open).toHaveBeenCalledWith("https://sonobe.dev/", "_blank", "noopener,noreferrer");
    platform.dispose();
  });

  it("forwards Vibrate to navigator.vibrate on Android and never throws", () => {
    const { win, calls } = androidWindow();
    const platform = playerPlatform(win);
    expect(platform.haptic).toBeUndefined();
    platform.vibrate!([15, 80, 25]);
    platform.vibrate!(0);
    expect(calls).toEqual([[15, 80, 25], 0]);

    const blocked = playerPlatform({
      navigator: {
        vibrate: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(() => blocked.vibrate!(20)).not.toThrow();
  });

  it("routes Haptic and Vibrate to a native host", () => {
    const { win, posted } = nativeWindow();
    const platform = playerPlatform(win);
    expect(platform.haptic!.supports("impactMedium")).toBe(true);
    expect(platform.haptic!.supports("customPattern")).toBe(false);
    expect(platform.haptic!.supports("alignment")).toBe(false);
    platform.haptic!.play("impactMedium");
    platform.haptic!.play("customPattern", { Pattern: [] });
    platform.vibrate!([400]);
    expect(posted).toEqual([
      { kind: "haptic", type: "impactMedium" },
      { kind: "haptic", type: "customPattern", pattern: { Pattern: [] } },
      { kind: "vibrate", pattern: [400] },
    ]);
  });

  it("prefers the native host's vibration over navigator.vibrate, and keeps the browser's when the host has none", () => {
    const android = androidWindow();
    const native = nativeWindow();
    playerPlatform({ ...android.win, ...native.win }).vibrate!(50);
    expect(native.posted).toEqual([{ kind: "vibrate", pattern: 50 }]);
    expect(android.calls).toEqual([]);

    const hapticsOnly = nativeWindow({ version: 1, platform: "ios", haptics: ["selection"] });
    playerPlatform({ ...android.win, ...hapticsOnly.win }).vibrate!(50);
    expect(android.calls).toEqual([50]);
    expect(hapticsOnly.posted).toEqual([]);
  });

  it("ignores a malformed announcement or a missing message handler", () => {
    for (const announcement of [null, "ios", [], { haptics: IOS_TYPES }, { version: "1", haptics: IOS_TYPES }, { version: 0, haptics: IOS_TYPES }, { version: 1, haptics: "impactLight" }]) {
      expect(readNativeHost(nativeWindow(announcement).win), JSON.stringify(announcement)).toBeNull();
      expect(playerPlatform(nativeWindow(announcement).win).haptic).toBeUndefined();
    }
    expect(playerPlatform({ sonobeNative: { version: 1, haptics: IOS_TYPES } }).haptic).toBeUndefined();
    expect(playerPlatform({ sonobeNative: { version: 1, haptics: IOS_TYPES }, webkit: { messageHandlers: {} } }).haptic).toBeUndefined();
    expect(readNativeHost(nativeWindow({ version: 1, haptics: ["selection", 3, null] }).win)?.info).toEqual({ version: 1, platform: "native", haptics: ["selection"], vibrate: false, actions: [], menuTipSeen: false });
  });

  it("reads the menu's actions and tip from bridge version 2", () => {
    const v2 = readNativeHost(nativeWindow({ version: 2, platform: "ios", haptics: IOS_TYPES, vibrate: true, actions: ["openAnother", 7], menuTipSeen: true }).win)!;
    expect(v2.info).toMatchObject({ version: 2, actions: ["openAnother"], menuTipSeen: true });
    // Version 1 hosts take no actions, whatever they announce.
    expect(readNativeHost(nativeWindow({ version: 1, haptics: IOS_TYPES, actions: ["openAnother"] }).win)!.info.actions).toEqual([]);
    const { win, posted } = nativeWindow({ version: 2, haptics: [], actions: ["openAnother"] });
    readNativeHost(win)!.post({ kind: "openAnother" });
    expect(posted).toEqual([{ kind: "openAnother" }]);
  });

  it("survives a host that throws while closing", () => {
    const platform = playerPlatform({
      sonobeNative: { version: 1, haptics: IOS_TYPES, vibrate: true },
      webkit: {
        messageHandlers: {
          sonobe: {
            postMessage: () => {
              throw new Error("gone");
            },
          },
        },
      },
    });
    expect(() => platform.haptic!.play("selection")).not.toThrow();
    expect(() => platform.vibrate!(0)).not.toThrow();
  });
});

describe("the player's platform in the runtime", () => {
  const registry = createPatchRegistry();

  const run = (platform: ReturnType<typeof playerPlatform>) => {
    const logs: string[] = [];
    const runtime = createRuntime(hapticCheckDocument(), { registry, platform, onLog: (_level, args) => logs.push(args.join(" ")) });
    runFrames(runtime, 2);
    const available = { haptic: runtime.getValue("tick.available"), vibrate: runtime.getValue("buzz.available") };
    runFrames(runtime, 4, sequence(tap(200, 400)));
    const taps = runtime.getValue("taps.count");
    runtime.dispose();
    return { available, taps, logs };
  };

  it("plays Haptic and Vibrate through the native bridge", () => {
    const { win, posted } = nativeWindow();
    const result = run(playerPlatform(win));
    expect(result.available).toEqual({ haptic: true, vibrate: true });
    expect(result.taps).toBe(1);
    expect(posted).toEqual(
      expect.arrayContaining([
        { kind: "haptic", type: "notificationSuccess" },
        { kind: "haptic", type: "impactMedium" },
        { kind: "vibrate", pattern: 50 },
      ]),
    );
    expect(result.logs.filter((line) => /no haptics|can't vibrate/.test(line))).toEqual([]);
  });

  it("plays Haptic's vibration plans on Android", () => {
    const { win, calls } = androidWindow();
    const result = run(playerPlatform(win));
    expect(result.available).toEqual({ haptic: true, vibrate: true });
    expect(calls).toEqual(expect.arrayContaining([[15, 80, 25], [20], 50]));
  });

  it("logs instead where there's neither", () => {
    const result = run(playerPlatform({}));
    expect(result.available).toEqual({ haptic: false, vibrate: false });
    expect(result.logs).toEqual(expect.arrayContaining([expect.stringContaining("Haptic: notificationSuccess (no haptics on this device)")]));
  });
});

describe("Sonobe Viewer's announcement", () => {
  it("names only Haptic types the catalog declares", () => {
    const swift = readFileSync(fileURLToPath(new URL("../../ios/SonobeViewer/Haptics.swift", import.meta.url)), "utf8");
    const list = swift.match(/static let feedbackTypes(?:: \[String\])? = \[([^\]]*)\]/);
    expect(list, "Haptics.feedbackTypes in Haptics.swift").not.toBeNull();
    const announced = [...list![1]!.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
    const declared = getSpec("haptic")!.inputs.find((input) => input.key === "type")!.enumOptions!.map((option) => option.key);
    expect(announced.length).toBeGreaterThan(5);
    for (const type of announced) expect(declared, type).toContain(type);
  });
});
