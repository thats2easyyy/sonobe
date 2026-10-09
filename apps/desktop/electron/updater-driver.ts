/**
 * The updater behind updates.ts: electron-updater, and on macOS Electron's own autoUpdater (Squirrel),
 * which does the installing. loadUpdaterDriver is the only place that loads electron-updater, and main
 * reaches this file with a dynamic import when the first check starts, so launch never evaluates it.
 * createElectronUpdaterDriver takes both updaters as arguments, so its rules are unit tested with fakes.
 * Nothing here imports Electron.
 */

import type { UpdateDriver, UpdateMode } from "./updates.ts";

type Listener = (...args: never[]) => void;

/** What the driver uses of electron-updater's `autoUpdater`. */
export interface AppUpdaterLike {
  logger: unknown;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  requestHeaders: Record<string, string | string[] | number | undefined> | null;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  checkForUpdates(): Promise<{ isUpdateAvailable: boolean; updateInfo: { version: string } } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  removeListener(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
}

/** What the driver uses of Electron's `autoUpdater`, which reports what Squirrel did with a download. */
export interface NativeUpdaterLike {
  on(event: "update-downloaded" | "update-not-available" | "error", listener: Listener): unknown;
  removeListener(event: "update-downloaded" | "update-not-available" | "error", listener: Listener): unknown;
}

export interface UpdaterDriverOptions {
  updater: AppUpdaterLike;
  native: NativeUpdaterLike;
  /** install: an update that was downloaded also goes in when Sonobe quits. */
  mode: UpdateMode;
  /** SONOBE_UPDATE_FEED: a generic feed instead of the one in Resources/app-update.yml (rehearsals). */
  feed: URL | null;
  platform: string;
  log(level: "info" | "warn" | "error", message: string): void;
  /** The updater reported an error as an event (it also rejects the call that failed). */
  onError?(err: Error): void;
  /** Longest wait for macOS to verify and stage a download. */
  stageTimeoutMs?: number;
}

/**
 * What electron-updater sends as `x-user-staging-id` instead of the random id it keeps in
 * <userData>/.updaterId: nothing that tells one copy of Sonobe from another leaves the machine. A staged
 * rollout would still work, since the percentage is compared with the stored id here, not on the server.
 */
export const STAGING_ID_HEADER = { "x-user-staging-id": "none" };

/** Squirrel gives a download 20 minutes to unpack and verify; a little past that, something is stuck. */
const STAGE_TIMEOUT_MS = 25 * 60 * 1000;

export function createElectronUpdaterDriver(options: UpdaterDriverOptions): UpdateDriver {
  const { updater, native, log } = options;
  const mac = options.platform === "darwin";
  const say = (level: "info" | "warn" | "error") => (message: unknown) => log(level, `updater: ${message instanceof Error ? message.message : String(message)}`);

  updater.logger = { info: say("info"), warn: say("warn"), error: say("error") };
  // Sonobe decides when to download (never in notify mode), so the updater doesn't on its own.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = options.mode === "install";
  updater.requestHeaders = { ...STAGING_ID_HEADER };
  if (options.feed) updater.setFeedURL({ provider: "generic", url: options.feed.href });
  // Every failure also rejects the call that made it, which is where it's handled. This listener stays for
  // good: an error event nobody listens to is thrown.
  updater.on("error", (err) => {
    log("warn", `updater: ${err instanceof Error ? err.message : String(err)}`);
    options.onError?.(err);
  });

  /**
   * electron-updater says "downloaded" once it has the zip, but macOS still has to fetch it from the
   * updater's local server, check its signature against this app's and unpack it. Only Electron's own
   * update-downloaded says an install will work, so that's what `ready` waits for.
   */
  const staged = () => {
    let stop: () => void = () => undefined;
    const done = new Promise<void>((resolve, reject) => {
      const onStaged = () => resolve();
      const onError = (err: unknown) => reject(err instanceof Error ? err : new Error(String(err)));
      const onNothing = () => reject(new Error("macOS found nothing it could install in the download."));
      const timer = setTimeout(() => reject(new Error(`macOS didn't finish checking the download within ${Math.round((options.stageTimeoutMs ?? STAGE_TIMEOUT_MS) / 60_000)} minutes.`)), options.stageTimeoutMs ?? STAGE_TIMEOUT_MS);
      timer.unref?.();
      native.on("update-downloaded", onStaged as Listener);
      native.on("error", onError as Listener);
      native.on("update-not-available", onNothing as Listener);
      stop = () => {
        clearTimeout(timer);
        native.removeListener("update-downloaded", onStaged as Listener);
        native.removeListener("error", onError as Listener);
        native.removeListener("update-not-available", onNothing as Listener);
      };
    });
    // A failed download stops the wait before anything settles it; nothing may reject unheard after that.
    done.catch(() => undefined);
    return { done, stop: () => stop() };
  };

  return {
    async check() {
      const result = await updater.checkForUpdates();
      // electron-updater answers null from a build it considers a checkout. updateMode never sends one here.
      if (!result) throw new Error("The updater isn't active in this build.");
      return result.isUpdateAvailable ? { version: result.updateInfo.version } : null;
    },
    async download(onProgress) {
      const progress = (info: { percent: number }) => onProgress(info.percent / 100);
      const staging = mac ? staged() : null;
      updater.on("download-progress", progress);
      try {
        await Promise.all([updater.downloadUpdate(), staging?.done]);
      } finally {
        staging?.stop();
        updater.removeListener("download-progress", progress);
      }
    },
    install() {
      // macOS: Squirrel swaps the app and opens the new one. Elsewhere: run the installer silently and
      // open the app afterwards (the default would show the assisted installer's pages).
      if (mac) updater.quitAndInstall();
      else updater.quitAndInstall(true, true);
    },
  };
}

/** The real thing: electron-updater's updater for this platform, loaded here and now, over Electron's own (which main passes in). */
export async function loadUpdaterDriver(options: Omit<UpdaterDriverOptions, "updater">): Promise<UpdateDriver> {
  const { autoUpdater } = await import("electron-updater");
  return createElectronUpdaterDriver({ ...options, updater: autoUpdater as unknown as AppUpdaterLike });
}
