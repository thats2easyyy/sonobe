/**
 * Updates: finding out about a new version and, where this build can, installing it.
 *
 *   install  check, download in the background, then offer Restart to Update. A build signed with a
 *            certificate, in a place where it can be replaced. The update also applies on a normal quit.
 *   notify   check only, then point to the release page. An ad-hoc build, or an install build somewhere
 *            it can't be replaced (a disk image, outside an Applications folder).
 *   off      a checkout, an automated run, SONOBE_UPDATES=off, or a build with no update feed.
 *
 * Nothing here imports Electron or electron-updater: main passes in what it knows about the build and a
 * driver (updater-driver.ts, loaded on the first check), so the modes, the schedule, the state machine
 * and the wording are unit tested with a fake. Nothing runs before start(), which main calls once the
 * first window is on screen.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { DesktopEnv } from "./env.ts";
import { atomicWriteFileSync } from "./fs-utils.ts";
import type { UpdateProblem, UpdateStatus } from "./host-api.d.ts";

export type UpdateMode = UpdateStatus["mode"];

/** The first check comes this long after start(), so launch is over before anything is loaded or asked. */
export const FIRST_CHECK_MS = 5000;
/** Then one every four hours while Sonobe runs. */
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

type Log = (level: "info" | "warn" | "error", message: string) => void;

// --- Where the app runs from ---------------------------------------------------------------------

export type InstallLocation =
  | { ok: true }
  | { ok: false; kind: "translocated" | "read-only" | "not-in-applications" | "needs-admin" | "not-appimage"; /** For people: why an update can't replace this copy. */ reason: string; /** Moving to Applications fixes it. */ canMove: boolean };

export interface InstallLocationInput {
  platform: string;
  /** process.execPath. */
  exePath: string;
  /** app.isInApplicationsFolder() (macOS). */
  inApplications(): boolean;
  /** fs.accessSync(path, W_OK): throws with a `code` when this user can't write there. */
  access(target: string): void;
  /** APPIMAGE, which the AppImage runtime sets (Linux). */
  appImage: string | undefined;
}

/** Whether an update can replace the app where it is. Asked only of a build that installs updates. */
export function installLocation(input: InstallLocationInput): InstallLocation {
  if (input.platform === "darwin") {
    // Gatekeeper runs an app that was never moved out of its download folder from a random read-only path.
    if (input.exePath.includes("/AppTranslocation/")) {
      return { ok: false, kind: "translocated", reason: "macOS is running Sonobe from a temporary copy, so it can't update itself. Move it to your Applications folder.", canMove: true };
    }
    const bundle = input.exePath.replace(/\/Contents\/MacOS\/[^/]+$/, "");
    const denied = (target: string): string | null => {
      try {
        input.access(target);
        return null;
      } catch (err) {
        return String((err as { code?: unknown }).code ?? "EACCES");
      }
    };
    const blocked = [denied(bundle), denied(path.dirname(bundle))];
    if (blocked.includes("EROFS")) {
      return { ok: false, kind: "read-only", reason: "Sonobe is running from its disk image or another read-only place, so it can't update itself. Move it to your Applications folder.", canMove: true };
    }
    if (!input.inApplications()) {
      return { ok: false, kind: "not-in-applications", reason: "Sonobe updates itself only from an Applications folder. Move it there.", canMove: true };
    }
    // Squirrel would ask for an administrator's password in the middle of a background download.
    if (blocked.some((code) => code !== null)) {
      return { ok: false, kind: "needs-admin", reason: "Replacing this copy of Sonobe takes an administrator, so it can't update itself. Download the new version instead.", canMove: false };
    }
    return { ok: true };
  }
  if (input.platform === "linux" && !input.appImage) {
    return { ok: false, kind: "not-appimage", reason: "Only the AppImage of Sonobe updates itself. Download the new version instead.", canMove: false };
  }
  return { ok: true };
}

// --- The mode ------------------------------------------------------------------------------------

export interface UpdateModeInput {
  env: Pick<DesktopEnv, "updates" | "testHooks" | "updateFeed">;
  /** app.isPackaged. */
  packaged: boolean;
  /** Resources/app-update.yml exists: the build knows where releases are (a `--dir` build has none). */
  feedConfig(): boolean;
  /** `sonobe.updates` in the packaged package.json (BuildInfo in scripts/signing.ts). */
  recorded(): unknown;
  location(): InstallLocation;
}

export interface UpdateModeResult {
  mode: UpdateMode;
  /** For people: why the mode is less than install, or null. */
  reason: string | null;
  /** Moving the app to Applications would let it install updates. */
  canMove: boolean;
}

/**
 * What this build does about updates. The checks that need no file come first, so a checkout and every
 * automated run answer "off" without reading anything.
 */
export function updateMode(input: UpdateModeInput): UpdateModeResult {
  const off = (reason: string): UpdateModeResult => ({ mode: "off", reason, canMove: false });
  if (!input.env.updates) return off("Update checks are switched off (SONOBE_UPDATES).");
  if (!input.packaged) return off("Sonobe run from a checkout doesn't check for updates. Pull the repository instead.");
  // An automated run never asks the release feed. A rehearsal names a feed of its own, and keeps the test cipher.
  if (input.env.testHooks && !input.env.updateFeed) return off("This is an automated run of Sonobe, which doesn't check for updates.");
  if (!input.env.updateFeed && !input.feedConfig()) return off("This build of Sonobe has no update feed, so it doesn't check for updates.");
  if (input.recorded() !== "install") {
    return { mode: "notify", reason: "This copy of Sonobe was built locally, so it can't replace itself. Download the new version instead.", canMove: false };
  }
  const location = input.location();
  return location.ok ? { mode: "install", reason: null, canMove: false } : { mode: "notify", reason: location.reason, canMove: location.canMove };
}

// --- The preference file -------------------------------------------------------------------------

/** <userData>/updates.json. */
export interface UpdateSettingsData {
  /** "Check for updates automatically" (Settings). On unless the person turned it off. */
  autoCheck: boolean;
  /** The version that last ran with this user data, to say "Sonobe was updated" once. */
  lastRunVersion: string | null;
  /** The version before that one. */
  previousVersion: string | null;
  /** The move to Applications has been offered; it isn't offered twice. */
  moveOffered: boolean;
}

export interface UpdateSettings {
  get(): UpdateSettingsData;
  /** Applies the well-formed fields of `patch` and saves when something changed. */
  update(patch: Partial<UpdateSettingsData>): UpdateSettingsData;
}

const DEFAULT_SETTINGS: UpdateSettingsData = { autoCheck: true, lastRunVersion: null, previousVersion: null, moveOffered: false };

const VERSION = /^\d+\.\d+\.\d+/;

function sanitizeSettings(raw: unknown, base: UpdateSettingsData): UpdateSettingsData {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const version = (value: unknown, fallback: string | null) => (value === null ? null : typeof value === "string" && VERSION.test(value) ? value : fallback);
  return {
    autoCheck: typeof o.autoCheck === "boolean" ? o.autoCheck : base.autoCheck,
    lastRunVersion: version(o.lastRunVersion, base.lastRunVersion),
    previousVersion: version(o.previousVersion, base.previousVersion),
    moveOffered: typeof o.moveOffered === "boolean" ? o.moveOffered : base.moveOffered,
  };
}

/** The file is read on the first get(), never at startup: a build that's off never reads it. */
export function createUpdateSettings(options: { /** Without one, the settings last until Sonobe quits. */ file?: string; log?: Log }): UpdateSettings {
  let stored: UpdateSettingsData | null = null;
  const get = (): UpdateSettingsData => {
    if (stored) return stored;
    stored = DEFAULT_SETTINGS;
    try {
      if (options.file) stored = sanitizeSettings(JSON.parse(readFileSync(options.file, "utf8")), DEFAULT_SETTINGS);
    } catch {
      // Missing or malformed: the defaults, with automatic checks on.
    }
    return stored;
  };
  return {
    get,
    update(patch) {
      const before = get();
      const next = sanitizeSettings(patch, before);
      if (JSON.stringify(next) === JSON.stringify(before)) return before;
      stored = next;
      try {
        if (options.file) atomicWriteFileSync(options.file, `${JSON.stringify(next, null, 2)}\n`);
      } catch (err) {
        // It still applies until Sonobe quits.
        options.log?.("warn", `Couldn't save the update settings: ${err instanceof Error ? err.message : String(err)}`);
      }
      return next;
    },
  };
}

/** Compares two versions by their three numbers: negative when `a` is older than `b`. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

// --- Errors, in words for people ------------------------------------------------------------------

export type UpdatePhase = "check" | "download" | "install";

const RELEASE_PAGE = "Download the new version from the release page instead.";

/** What an updater error means to the person and what they can do. `phase` is what Sonobe was doing. */
export function explainUpdateError(err: unknown, phase: UpdatePhase): UpdateProblem {
  const code = String((err as { code?: unknown } | null)?.code ?? "");
  const text = `${code} ${err instanceof Error ? err.message : String(err)}`;
  if (/read-only volume/i.test(text)) {
    return { kind: "location", message: "Sonobe can't update itself where it is now: it's on a read-only disk.", hint: "Move Sonobe to your Applications folder, then choose Check for Updates again." };
  }
  if (/did not pass validation|code signature|codesign|not signed|designated requirement/i.test(text)) {
    return { kind: "rejected", message: "macOS wouldn't install the update: its signature doesn't match this copy of Sonobe.", hint: "Download the new version from the release page and replace Sonobe in your Applications folder." };
  }
  if (/sha512|checksum|ERR_CHECKSUM_MISMATCH|size mismatch/i.test(text)) {
    return { kind: "damaged", message: "The update didn't download in one piece.", hint: "Choose Check for Updates to download it again, or download the new version from the release page." };
  }
  if (/net::ERR_|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket hang up/i.test(text)) {
    return {
      kind: "network",
      message: phase === "check" ? "Sonobe couldn't reach the release feed to check for updates." : "The update stopped downloading: the connection dropped.",
      hint: "Check your internet connection, then choose Check for Updates again.",
    };
  }
  if (phase === "check" && /ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|ERR_UPDATER_LATEST_VERSION_NOT_FOUND|ERR_UPDATER_NO_PUBLISHED_VERSIONS|No published versions|\b404\b/i.test(text)) {
    return { kind: "no-release", message: "There's no published release of Sonobe to update to yet.", hint: "Nothing to do for now. The first release will show up on Sonobe's release page, and here." };
  }
  const said = (err instanceof Error ? err.message : String(err)).split("\n")[0]!.slice(0, 200);
  const message = phase === "check" ? "Sonobe couldn't check for updates." : phase === "download" ? "Sonobe couldn't download the update." : "Sonobe couldn't restart to install the update.";
  const hint = phase === "install" ? "Quit Sonobe and open it again: the update installs when Sonobe quits. Or download the new version from the release page." : RELEASE_PAGE;
  return { kind: "other", message, hint: `${hint} (The updater said: ${said})` };
}

/** A native dialog that answers Check for Updates… when no window is open to show the editor's notice. */
export interface UpdateDialog {
  message: string;
  detail: string;
  /** The first is the default; the last dismisses. */
  buttons: string[];
  /** What the first button does, when it does something. */
  action: "restart" | "openRelease" | null;
}

export function manualCheckDialog(status: UpdateStatus): UpdateDialog {
  const latest = status.version ? `Sonobe ${status.version}` : "A new version of Sonobe";
  if (status.mode === "off") return { message: "This copy of Sonobe doesn't check for updates.", detail: status.reason ?? "", buttons: ["OK"], action: null };
  switch (status.state) {
    case "ready":
      return { message: `${latest} is ready to install.`, detail: "Sonobe restarts to finish, and opens what you had open again.", buttons: ["Restart to Update", "Later"], action: "restart" };
    case "available":
      return { message: `${latest} is available.`, detail: status.reason ?? "Download it from the release page.", buttons: ["Download", "Later"], action: "openRelease" };
    case "downloading":
      return { message: `${latest} is downloading.`, detail: "Sonobe says so when it's ready to install.", buttons: ["OK"], action: null };
    case "failed": {
      const error = status.error ?? explainUpdateError(new Error("unknown"), "check");
      const offerPage = error.kind !== "network" && error.kind !== "no-release";
      return { message: error.message, detail: error.hint, buttons: offerPage ? ["Open Release Page", "OK"] : ["OK"], action: offerPage ? "openRelease" : null };
    }
    case "checking":
      return { message: "Sonobe is checking for updates.", detail: "It says so when there's a new version.", buttons: ["OK"], action: null };
    default:
      return { message: "Sonobe is up to date.", detail: `Version ${status.current} is the newest.`, buttons: ["OK"], action: null };
  }
}

// --- The state machine ---------------------------------------------------------------------------

/** What the controller needs from an updater. electron-updater's is in updater-driver.ts; tests pass a fake. */
export interface UpdateDriver {
  /** Asks the feed. The newest version when it's newer than this app, else null. */
  check(): Promise<{ version: string } | null>;
  /** Downloads what the last check found, reporting 0 to 1, and resolves once it can really be installed. */
  download(onProgress: (fraction: number) => void): Promise<void>;
  /** Quits and installs what download() fetched. Called with no window left open. */
  install(): void;
}

export interface UpdateControllerOptions {
  /** This app's version. */
  current: string;
  /** What this build does about updates (updateMode). Asked often, so main remembers the answer. */
  mode(): UpdateModeResult;
  settings: UpdateSettings;
  /** The updater, loaded when the first check starts and never before. */
  driver(): Promise<UpdateDriver>;
  /** Sonobe's releases page (commands.ts RELEASES_URL). */
  releasesUrl: string;
  now?: () => number;
  /** Called with each new status, and only when something changed. */
  onChange?(status: UpdateStatus): void;
  log?: Log;
  firstCheckMs?: number;
  intervalMs?: number;
}

export interface UpdateController {
  status(): UpdateStatus;
  /**
   * Checks now. `manual`: the person asked, so the answer is announced even when nothing is new. Resolves
   * with the check's answer; in install mode the download carries on after it. A check joins one already
   * in flight, and changes nothing while an update is downloading or ready.
   */
  check(options?: { manual?: boolean }): Promise<UpdateStatus>;
  setAutoCheck(enabled: boolean): UpdateStatus;
  /** Call once the first window is on screen: the first check comes a few seconds later, then one every few hours. */
  start(): void;
  stop(): void;
  /** Quits and installs the update that's ready. Main closes every window first. */
  install(): Promise<void>;
  /** Restart to Update began or was cancelled. */
  setRestarting(restarting: boolean): UpdateStatus;
  /** The restart didn't happen: say so, with what to do. */
  fail(err: unknown, phase: UpdatePhase): UpdateStatus;
}

export function createUpdateController(options: UpdateControllerOptions): UpdateController {
  const { current, settings } = options;
  const now = options.now ?? (() => Date.now());
  const log: Log = options.log ?? (() => undefined);

  let state: UpdateStatus["state"] = "idle";
  let version: string | null = null;
  let progress: number | null = null;
  let error: UpdateProblem | null = null;
  let manual = false;
  let checkedAt: number | null = null;
  let restarting = false;
  /** Set on first use: the version this user data last ran, when it was older than this one. */
  let updatedFrom: string | null | undefined;
  /** Whether this launch offers the move to Applications: decided once, so the offer outlives being recorded. */
  let offerMove: boolean | undefined;
  let checking: Promise<UpdateStatus> | null = null;
  let published = "";
  let started = false;
  let firstTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;

  const status = (): UpdateStatus => {
    const { mode, reason, canMove } = options.mode();
    // Off: nothing is read, and nothing more is said.
    if (mode === "off") {
      return { mode, reason, state: "idle", current, version: null, releaseUrl: `${options.releasesUrl}/latest`, notesUrl: null, progress: null, error: null, manual: false, checkedAt: null, autoCheck: true, updatedFrom: null, offerMove: false, canMove: false, restarting: false };
    }
    const saved = settings.get();
    if (updatedFrom === undefined) updatedFrom = saved.lastRunVersion && compareVersions(current, saved.lastRunVersion) > 0 ? saved.lastRunVersion : null;
    offerMove ??= canMove && !saved.moveOffered;
    return {
      mode,
      reason,
      state,
      current,
      version,
      releaseUrl: version ? `${options.releasesUrl}/tag/v${version}` : `${options.releasesUrl}/latest`,
      notesUrl: updatedFrom ? `${options.releasesUrl}/tag/v${current}` : null,
      progress,
      error,
      manual,
      checkedAt,
      autoCheck: saved.autoCheck,
      updatedFrom,
      offerMove: offerMove && canMove,
      canMove,
      restarting,
    };
  };

  const publish = (): UpdateStatus => {
    const next = status();
    const key = JSON.stringify(next);
    if (key !== published) {
      published = key;
      options.onChange?.(next);
    }
    return next;
  };

  const failed = (err: unknown, phase: UpdatePhase): UpdateStatus => {
    state = "failed";
    progress = null;
    error = explainUpdateError(err, phase);
    log("warn", `Update ${phase} failed: ${err instanceof Error ? err.message : String(err)}`);
    return publish();
  };

  const download = async (driver: UpdateDriver): Promise<void> => {
    try {
      await driver.download((fraction) => {
        const next = Math.min(1, Math.max(0, fraction));
        // A notice for every chunk would flood the windows: one per percent is plenty.
        if (state !== "downloading" || Math.floor(next * 100) === Math.floor((progress ?? 0) * 100)) return;
        progress = next;
        publish();
      });
    } catch (err) {
      failed(err, "download");
      return;
    }
    state = "ready";
    progress = null;
    publish();
  };

  const run = async (mode: UpdateMode, quiet: boolean): Promise<UpdateStatus> => {
    let driver: UpdateDriver;
    let found: { version: string } | null;
    try {
      driver = await options.driver();
      found = await driver.check();
    } catch (err) {
      if (!quiet) return failed(err, "check");
      // The notice that's up still stands: a check that fails behind it says nothing.
      log("info", `A background update check failed: ${err instanceof Error ? err.message : String(err)}`);
      return status();
    }
    checkedAt = now();
    error = null;
    version = found?.version ?? null;
    if (!found) state = "upToDate";
    else if (mode !== "install") state = "available";
    else {
      state = "downloading";
      progress = 0;
      void download(driver);
    }
    return publish();
  };

  const check = ({ manual: asked = false }: { manual?: boolean } = {}): Promise<UpdateStatus> => {
    const { mode } = options.mode();
    if (mode === "off") return Promise.resolve(status());
    if (asked && !manual) {
      manual = true;
      publish();
    }
    if (checking) return checking;
    // Downloading or ready: there is nothing newer to say until the app restarts.
    if (state === "downloading" || state === "ready") return Promise.resolve(status());
    // A scheduled check behind an "available" notice leaves it up, and only speaks if the version changes.
    const quiet = !asked && state === "available";
    manual = asked;
    if (!quiet) {
      state = "checking";
      error = null;
      progress = null;
      publish();
    }
    checking = run(mode, quiet).finally(() => {
      checking = null;
    });
    return checking;
  };

  return {
    status,
    check,
    setAutoCheck(enabled) {
      if (options.mode().mode !== "off") settings.update({ autoCheck: enabled === true });
      return publish();
    },
    start() {
      if (started) return;
      started = true;
      if (options.mode().mode === "off") return;
      const first = status();
      const saved = settings.get();
      // Recorded now, after the status read them: "Sonobe was updated" and the offer to move are said once.
      settings.update({
        ...(saved.lastRunVersion !== current ? { lastRunVersion: current, previousVersion: saved.lastRunVersion } : {}),
        ...(first.offerMove ? { moveOffered: true } : {}),
      });
      const scheduled = () => {
        if (settings.get().autoCheck) void check();
      };
      firstTimer = setTimeout(scheduled, options.firstCheckMs ?? FIRST_CHECK_MS);
      intervalTimer = setInterval(scheduled, options.intervalMs ?? CHECK_INTERVAL_MS);
      // Neither keeps a quitting app alive.
      firstTimer.unref?.();
      intervalTimer.unref?.();
    },
    stop() {
      if (firstTimer) clearTimeout(firstTimer);
      if (intervalTimer) clearInterval(intervalTimer);
      firstTimer = intervalTimer = null;
    },
    async install() {
      (await options.driver()).install();
    },
    setRestarting(next) {
      restarting = next;
      return publish();
    },
    fail: failed,
  };
}
