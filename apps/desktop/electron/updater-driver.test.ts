import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { STAGING_ID_HEADER, createElectronUpdaterDriver, type AppUpdaterLike, type NativeUpdaterLike, type UpdaterDriverOptions } from "./updater-driver.ts";

/** electron-updater's autoUpdater, as far as the driver uses it. */
class FakeUpdater extends EventEmitter {
  logger: unknown = null;
  autoDownload = true;
  autoInstallOnAppQuit = true;
  requestHeaders: Record<string, string> | null = null;
  feed: unknown = null;
  found: { isUpdateAvailable: boolean; updateInfo: { version: string } } | null = { isUpdateAvailable: true, updateInfo: { version: "0.3.0" } };
  installs: unknown[][] = [];
  finishDownload!: () => void;
  failDownload!: (err: Error) => void;
  setFeedURL(options: unknown) {
    this.feed = options;
  }
  checkForUpdates() {
    return Promise.resolve(this.found);
  }
  downloadUpdate() {
    return new Promise<void>((resolve, reject) => {
      this.finishDownload = resolve;
      this.failDownload = reject;
    });
  }
  quitAndInstall(...args: unknown[]) {
    this.installs.push(args);
  }
}

function driver(over: Partial<UpdaterDriverOptions> = {}) {
  const updater = new FakeUpdater();
  const native = new EventEmitter();
  const logged: string[] = [];
  const made = createElectronUpdaterDriver({
    updater: updater as unknown as AppUpdaterLike,
    native: native as unknown as NativeUpdaterLike,
    mode: "install",
    feed: null,
    platform: "darwin",
    log: (level, message) => logged.push(`${level}: ${message}`),
    ...over,
  });
  /** What a download() has done so far: "pending", "ready", or the error's message. */
  const download = () => {
    const state = { now: "pending", progress: [] as number[] };
    void made.download((fraction) => state.progress.push(fraction)).then(
      () => (state.now = "ready"),
      (err: Error) => (state.now = err.message),
    );
    return state;
  };
  const listeners = () => ["update-downloaded", "update-not-available", "error"].map((event) => native.listenerCount(event));
  return { driver: made, updater, native, logged, download, listeners };
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe("electron-updater driver", () => {
  it("leaves downloading to Sonobe, installs on quit only in install mode, and sends no per-install id", () => {
    const install = driver();
    expect(install.updater).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: true, requestHeaders: { "x-user-staging-id": "none" }, feed: null });
    expect(driver({ mode: "notify" }).updater.autoInstallOnAppQuit).toBe(false);
    expect(STAGING_ID_HEADER["x-user-staging-id"]).not.toMatch(/[0-9a-f]{8}-/);
    // The updater's own logger would write to the console unprefixed.
    (install.updater.logger as { info(message: string): void }).info("Checking for update");
    expect(install.logged).toEqual(["info: updater: Checking for update"]);
  });

  it("reads a rehearsal's feed instead of the one the build carries", () => {
    expect(driver({ feed: new URL("http://127.0.0.1:5250/") }).updater.feed).toEqual({ provider: "generic", url: "http://127.0.0.1:5250/" });
  });

  it("answers a check with the newer version, or nothing", async () => {
    const d = driver();
    expect(await d.driver.check()).toEqual({ version: "0.3.0" });
    d.updater.found = { isUpdateAvailable: false, updateInfo: { version: "0.2.0" } };
    expect(await d.driver.check()).toBeNull();
    d.updater.found = null;
    await expect(d.driver.check()).rejects.toThrow("isn't active");
  });

  it("isn't ready when electron-updater has the zip, only once macOS has staged it", async () => {
    const d = driver();
    const state = d.download();
    d.updater.emit("download-progress", { percent: 40 });
    d.updater.emit("download-progress", { percent: 100 });
    d.updater.emit("update-downloaded", { version: "0.3.0" });
    d.updater.finishDownload();
    await settle();
    expect(state).toEqual({ now: "pending", progress: [0.4, 1] });
    d.native.emit("update-downloaded");
    await settle();
    expect(state.now).toBe("ready");
    // Nothing is left listening, on either updater.
    expect(d.listeners()).toEqual([0, 0, 0]);
    expect(d.updater.listenerCount("download-progress")).toBe(0);
  });

  it("fails when macOS refuses the download, even after electron-updater called it downloaded", async () => {
    const d = driver();
    const state = d.download();
    d.updater.finishDownload();
    await settle();
    d.native.emit("error", new Error("Code signature at URL file:///x/Sonobe.app/ did not pass validation"));
    await settle();
    expect(state.now).toContain("did not pass validation");
    expect(d.listeners()).toEqual([0, 0, 0]);
  });

  it("fails rather than wait forever when macOS finds nothing to install, or never answers", async () => {
    const nothing = driver();
    const first = nothing.download();
    nothing.updater.finishDownload();
    nothing.native.emit("update-not-available");
    await settle();
    expect(first.now).toBe("macOS found nothing it could install in the download.");

    vi.useFakeTimers();
    try {
      const stuck = driver({ stageTimeoutMs: 60_000 });
      const second = stuck.download();
      stuck.updater.finishDownload();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(second.now).toBe("macOS didn't finish checking the download within 1 minutes.");
      expect(stuck.listeners()).toEqual([0, 0, 0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting for macOS when the download itself fails", async () => {
    const d = driver();
    const state = d.download();
    d.updater.failDownload(new Error("sha512 checksum mismatch"));
    await settle();
    expect(state.now).toBe("sha512 checksum mismatch");
    expect(d.listeners()).toEqual([0, 0, 0]);
  });

  it("is ready as soon as the installer is downloaded on Windows and Linux", async () => {
    const d = driver({ platform: "win32" });
    const state = d.download();
    expect(d.listeners()).toEqual([0, 0, 0]);
    d.updater.finishDownload();
    await settle();
    expect(state.now).toBe("ready");
  });

  it("installs through Squirrel on macOS, and silently with a relaunch elsewhere", () => {
    const mac = driver();
    mac.driver.install();
    expect(mac.updater.installs).toEqual([[]]);
    const windows = driver({ platform: "win32" });
    windows.driver.install();
    expect(windows.updater.installs).toEqual([[true, true]]);
  });

  it("logs an error event and passes it on, instead of letting it be thrown", () => {
    const seen: Error[] = [];
    const d = driver({ onError: (err) => seen.push(err) });
    expect(() => d.updater.emit("error", new Error("net::ERR_INTERNET_DISCONNECTED"))).not.toThrow();
    expect(d.logged).toEqual(["warn: updater: net::ERR_INTERNET_DISCONNECTED"]);
    expect(seen).toHaveLength(1);
  });

  it("is the only file that loads electron-updater, and loads it on demand", () => {
    const source = readFileSync(new URL("./updater-driver.ts", import.meta.url), "utf8");
    expect(source).toContain('import("electron-updater")');
    expect(source).not.toMatch(/^import .* from "electron(-updater)?";$/m);
    const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(main).not.toMatch(/from "electron-updater"|from "\.\/updater-driver\.ts"/);
  });
});
