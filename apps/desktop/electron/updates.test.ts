import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELEASES_URL } from "./commands.ts";
import type { UpdateStatus } from "./host-api.d.ts";
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_MS,
  compareVersions,
  createUpdateController,
  createUpdateSettings,
  explainUpdateError,
  installLocation,
  manualCheckDialog,
  updateMode,
  type InstallLocation,
  type InstallLocationInput,
  type UpdateDriver,
  type UpdateModeInput,
  type UpdateModeResult,
  type UpdateSettingsData,
} from "./updates.ts";

const require = createRequire(import.meta.url);
const packageJson = (name: string) => JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")) as { version: string; dependencies?: Record<string, string> };

const temp = mkdtempSync(path.join(tmpdir(), "sonobe-updates-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe("electron-updater", () => {
  it("is the release that pairs with the installed electron-builder", () => {
    // Both read and write the update feed with builder-util-runtime, and electron-updater pins the exact
    // version its electron-builder release shipped with. A bump of one without the other fails here.
    const updater = packageJson("electron-updater");
    expect(updater.dependencies?.["builder-util-runtime"]).toBe(packageJson("builder-util-runtime").version);
    const desktop = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    expect(desktop.dependencies["electron-updater"]).toBe(updater.version);
  });

  it("is asked about the repository the release page is in", () => {
    const yml = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
    const [, owner, repo] = /^  owner: (\S+)\n  repo: (\S+)$/m.exec(yml)!;
    expect(RELEASES_URL).toBe(`https://github.com/${owner}/${repo}/releases`);
  });
});

describe("installLocation", () => {
  const exePath = "/Applications/Sonobe.app/Contents/MacOS/Sonobe";
  const mac = (over: Partial<InstallLocationInput> = {}): InstallLocation => installLocation({ platform: "darwin", exePath, inApplications: () => true, access: () => undefined, appImage: undefined, ...over });
  const refuses = (code: string, at?: string) => (target: string) => {
    if (at === undefined || target === at) throw Object.assign(new Error(code), { code });
  };

  it("lets an app in Applications that this user can replace update itself", () => {
    const asked: string[] = [];
    expect(mac({ access: (target) => void asked.push(target) })).toEqual({ ok: true });
    // The bundle and the folder it's in: an update swaps one for another inside that folder.
    expect(asked).toEqual(["/Applications/Sonobe.app", "/Applications"]);
  });

  it("says why an app in the wrong place can't, and whether moving it helps", () => {
    const translocated = mac({ exePath: "/private/var/folders/x/T/AppTranslocation/1A2B/d/Sonobe.app/Contents/MacOS/Sonobe" });
    expect(translocated).toMatchObject({ ok: false, reason: expect.stringContaining("temporary copy"), canMove: true });
    const onDiskImage = mac({ exePath: "/Volumes/Sonobe 0.2.0/Sonobe.app/Contents/MacOS/Sonobe", inApplications: () => false, access: refuses("EROFS") });
    expect(onDiskImage).toMatchObject({ ok: false, reason: expect.stringContaining("disk image"), canMove: true });
    const elsewhere = mac({ exePath: "/Users/me/Downloads/Sonobe.app/Contents/MacOS/Sonobe", inApplications: () => false });
    expect(elsewhere).toMatchObject({ ok: false, reason: expect.stringContaining("only from an Applications folder"), canMove: true });
    // An administrator installed it: an update would stop to ask for their password.
    const adminOnly = mac({ access: refuses("EACCES", "/Applications") });
    expect(adminOnly).toMatchObject({ ok: false, reason: expect.stringContaining("takes an administrator"), canMove: false });
    for (const verdict of [translocated, onDiskImage, elsewhere, adminOnly]) expect(!verdict.ok && verdict.reason).toMatch(/can't update itself[.,] |only from an Applications folder[.] /);
  });

  it("updates an AppImage on Linux and nothing else there, and doesn't look on Windows", () => {
    const linux = { platform: "linux", exePath: "/opt/Sonobe/sonobe", inApplications: () => false, access: refuses("EACCES") };
    expect(installLocation({ ...linux, appImage: "/home/me/Sonobe.AppImage" })).toEqual({ ok: true });
    expect(installLocation({ ...linux, appImage: undefined })).toMatchObject({ ok: false, reason: expect.stringContaining("Only the AppImage"), canMove: false });
    expect(installLocation({ ...linux, platform: "win32", appImage: undefined })).toEqual({ ok: true });
  });
});

describe("updateMode", () => {
  const reads: string[] = [];
  const input = (over: Partial<Omit<UpdateModeInput, "env">> & { env?: Partial<UpdateModeInput["env"]>; recordedValue?: unknown; locationValue?: InstallLocation; hasFeedConfig?: boolean } = {}): UpdateModeInput => ({
    packaged: over.packaged ?? true,
    env: { updates: true, testHooks: false, updateFeed: null, ...over.env },
    feedConfig: () => (reads.push("app-update.yml"), over.hasFeedConfig ?? true),
    recorded: () => (reads.push("package.json"), "recordedValue" in over ? over.recordedValue : "install"),
    location: () => (reads.push("location"), over.locationValue ?? { ok: true }),
  });
  const feed = new URL("http://127.0.0.1:5250/");
  beforeEach(() => reads.splice(0));

  it("is off wherever nobody should be asking, and reads nothing to find that out", () => {
    // SONOBE_UPDATES=off beats everything, a rehearsal feed included.
    expect(updateMode(input({ env: { updates: false, updateFeed: feed } }))).toMatchObject({ mode: "off", reason: expect.stringContaining("SONOBE_UPDATES") });
    expect(updateMode(input({ packaged: false, env: { updateFeed: feed } }))).toMatchObject({ mode: "off", reason: expect.stringContaining("checkout") });
    expect(updateMode(input({ env: { testHooks: true } }))).toMatchObject({ mode: "off", reason: expect.stringContaining("automated run") });
    expect(reads).toEqual([]);
  });

  it("is off in a build without an update feed, such as a --dir build", () => {
    expect(updateMode(input({ hasFeedConfig: false }))).toMatchObject({ mode: "off", reason: expect.stringContaining("no update feed") });
    expect(reads).toEqual(["app-update.yml"]);
  });

  it("runs under SONOBE_TEST when a rehearsal names its own feed, with or without app-update.yml", () => {
    expect(updateMode(input({ env: { testHooks: true, updateFeed: feed }, hasFeedConfig: false }))).toEqual({ mode: "install", reason: null, canMove: false });
    expect(reads).toEqual(["package.json", "location"]);
  });

  it("installs in a build signed with a certificate, and only tells in an ad-hoc one or one with nothing recorded", () => {
    expect(updateMode(input())).toEqual({ mode: "install", reason: null, canMove: false });
    for (const recordedValue of ["notify", undefined, 7]) {
      expect(updateMode(input({ recordedValue })), String(recordedValue)).toEqual({ mode: "notify", reason: expect.stringContaining("built locally"), canMove: false });
    }
    // An ad-hoc build never asks where it is: no place would let it replace itself.
    expect(reads.filter((read) => read === "location")).toHaveLength(1);
  });

  it("only tells in an install build that can't be replaced where it is, and passes on why", () => {
    const locationValue: InstallLocation = { ok: false, reason: "Sonobe updates itself only from an Applications folder. Move it there.", canMove: true };
    expect(updateMode(input({ locationValue }))).toEqual({ mode: "notify", reason: locationValue.reason, canMove: true });
  });
});

describe("update settings", () => {
  const file = (name: string) => path.join(temp, name);

  it("starts with automatic checks on, and reads its file only when first asked", () => {
    writeFileSync(file("lazy.json"), "{}");
    const settings = createUpdateSettings({ file: file("lazy.json") });
    writeFileSync(file("lazy.json"), JSON.stringify({ autoCheck: false }));
    expect(settings.get()).toEqual({ autoCheck: false, lastRunVersion: null, moveOffered: false });
    expect(createUpdateSettings({ file: file("missing.json") }).get().autoCheck).toBe(true);
  });

  it("keeps the well-formed fields of a damaged file and the defaults for the rest", () => {
    writeFileSync(file("odd.json"), JSON.stringify({ autoCheck: "no", lastRunVersion: "0.2.0", moveOffered: true, extra: 1 }));
    expect(createUpdateSettings({ file: file("odd.json") }).get()).toEqual({ autoCheck: true, lastRunVersion: "0.2.0", moveOffered: true });
    writeFileSync(file("odd.json"), JSON.stringify({ autoCheck: false, lastRunVersion: ["0.2.0"], moveOffered: "yes" }));
    expect(createUpdateSettings({ file: file("odd.json") }).get()).toEqual({ autoCheck: false, lastRunVersion: null, moveOffered: false });
    writeFileSync(file("broken.json"), "{ not json");
    expect(createUpdateSettings({ file: file("broken.json") }).get()).toEqual({ autoCheck: true, lastRunVersion: null, moveOffered: false });
  });

  it("saves a change in one atomic write, and nothing when nothing changed", () => {
    const settings = createUpdateSettings({ file: file("save.json") });
    expect(settings.update({ autoCheck: true })).toMatchObject({ autoCheck: true });
    expect(readdirSync(temp)).not.toContain("save.json");
    settings.update({ autoCheck: false, lastRunVersion: "0.2.0" });
    expect(JSON.parse(readFileSync(file("save.json"), "utf8"))).toEqual({ autoCheck: false, lastRunVersion: "0.2.0", moveOffered: false });
    expect(readdirSync(temp).filter((name) => name.includes(".sonobe-tmp-"))).toEqual([]);
    expect(createUpdateSettings({ file: file("save.json") }).get().autoCheck).toBe(false);
  });

  it("compares versions by their three numbers", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.1.1")).toBeLessThan(0);
  });
});

describe("explainUpdateError", () => {
  const coded = (code: string, message: string) => Object.assign(new Error(message), { code });

  it("says what happened and what to do, for each kind of failure", () => {
    const cases: [unknown, "check" | "download" | "install", string][] = [
      [new Error("net::ERR_INTERNET_DISCONNECTED"), "check", "network"],
      [coded("ENOTFOUND", "getaddrinfo ENOTFOUND github.com"), "check", "network"],
      [new Error("connect ECONNREFUSED 127.0.0.1:5250"), "download", "network"],
      [coded("ERR_UPDATER_CHANNEL_FILE_NOT_FOUND", "Cannot find latest-mac.yml in the latest release artifacts: HttpError: 404"), "check", "no-release"],
      // Only pre-releases or drafts exist: GitHub answers 404 for the latest release.
      [coded("ERR_UPDATER_LATEST_VERSION_NOT_FOUND", "Unable to find latest version on GitHub (https://github.com/thats2easyyy/sonobe/releases/latest), please ensure a production release exists: HttpError: 404 \n\"method: GET url: https://github.com/thats2easyyy/sonobe/releases/latest\""), "check", "no-release"],
      [new Error("No published versions on GitHub"), "check", "no-release"],
      [coded("ERR_CHECKSUM_MISMATCH", "sha512 checksum mismatch, expected abc, got def"), "download", "damaged"],
      [new Error("Code signature at URL file:///Users/me/Library/Caches/dev.sonobe.app.ShipIt/update.abc/Sonobe.app/ did not pass validation: code failed to satisfy specified code requirement(s)"), "download", "rejected"],
      [new Error("Cannot update while running on a read-only volume. The application is on a read-only volume."), "download", "location"],
      [new Error("ENOSPC: no space left on device"), "download", "other"],
    ];
    for (const [err, phase, kind] of cases) {
      const problem = explainUpdateError(err, phase);
      expect(problem.kind, String(err)).toBe(kind);
      expect(problem.phase).toBe(phase);
      expect(problem.message).toMatch(/^\S.+[.]$/);
      expect(problem.hint.length).toBeGreaterThan(20);
    }
  });

  it("points to the release page when macOS refuses the update or nothing else is known", () => {
    expect(explainUpdateError(new Error("did not pass validation"), "download").hint).toContain("from the release page");
    const unknown = explainUpdateError(new Error("ENOSPC: no space left on device\n    at write"), "download");
    expect(unknown).toMatchObject({ message: "Sonobe couldn't download the update.", hint: "Download the new version from the release page instead. (The updater said: ENOSPC: no space left on device)" });
    // After a failed restart the update is still staged: quitting installs it.
    expect(explainUpdateError(new Error("still running"), "install")).toMatchObject({ kind: "other", message: "Sonobe couldn't restart to install the update.", hint: expect.stringContaining("installs when Sonobe quits") });
  });

  it("calls a missing download a failed download, not a missing release", () => {
    expect(explainUpdateError(new Error("HttpError: 404 Not Found"), "download").kind).toBe("other");
  });

  it("calls a check the feed didn't answer a failed check, with nothing to download", () => {
    // What electron-updater throws for a 503, a rate limit, a refusal, and a proxy's or captive portal's page in place of the feed.
    const failures = [
      coded("HTTP_ERROR_503", '503 Service Unavailable\n"method: GET url: https://github.com/thats2easyyy/sonobe/releases.atom"\nHeaders: {}'),
      coded("HTTP_ERROR_429", "429 Too Many Requests"),
      coded("HTTP_ERROR_403", "403 Forbidden"),
      coded("ERR_UPDATER_LATEST_VERSION_NOT_FOUND", "Unable to find latest version on GitHub (https://github.com/thats2easyyy/sonobe/releases/latest), please ensure a production release exists: HttpError: 502 Bad Gateway"),
      coded("ERR_UPDATER_INVALID_RELEASE_FEED", "Cannot parse releases feed: Error: Unable to find latest version,\nXML:\n<html>Sign in to the guest network</html>"),
    ];
    for (const err of failures) {
      const problem = explainUpdateError(err, "check");
      expect(problem, err.message).toMatchObject({ kind: "other", phase: "check", message: "Sonobe couldn't check for updates." });
      expect(problem.hint).toMatch(/^Try again later, or look at the release page for the newest version[.] \(The updater said: /);
      expect(problem.hint).not.toMatch(/Download the new version/);
    }
  });

  it("judges a failed check by its first line, not by the release notes the feed quotes after it", () => {
    // ERR_UPDATER_INVALID_RELEASE_FEED carries the whole releases.atom, and release notes talk about anything.
    const notes = "<feed><entry><content>Fixed the sha512 checksum of the zip, the code signature of the helper, a 404 on the docs page and ECONNRESET in the relay.</content></entry></feed>";
    expect(explainUpdateError(coded("ERR_UPDATER_INVALID_RELEASE_FEED", `Cannot parse releases feed: TypeError: tag is not a string,\nXML:\n${notes}`), "check")).toMatchObject({ kind: "other", phase: "check" });
    // A download's error is read whole: macOS says what it refused on a later line.
    expect(explainUpdateError(new Error("The update couldn't be staged.\nCode signature at URL file:///x/Sonobe.app/ did not pass validation"), "download").kind).toBe("rejected");
    // Whatever a check's error says, nothing was downloaded that could be damaged, refused or in the wrong place.
    for (const text of ["sha512 checksum mismatch", "Code signature did not pass validation", "running on a read-only volume"]) expect(explainUpdateError(new Error(text), "check").kind, text).toBe("other");
  });
});

/** A driver whose answers the test settles by hand. */
function fakeDriver() {
  const calls: string[] = [];
  let answerCheck!: (found: { version: string } | null) => void;
  let failCheck!: (err: unknown) => void;
  let finishDownload!: () => void;
  let failDownload!: (err: unknown) => void;
  let progress: (fraction: number) => void = () => undefined;
  const driver: UpdateDriver = {
    check: () => {
      calls.push("check");
      return new Promise((resolve, reject) => {
        answerCheck = resolve;
        failCheck = reject;
      });
    },
    download: (onProgress) => {
      calls.push("download");
      progress = onProgress;
      return new Promise((resolve, reject) => {
        finishDownload = resolve;
        failDownload = reject;
      });
    },
    install: () => void calls.push("install"),
  };
  return { driver, calls, answerCheck: (found: { version: string } | null) => answerCheck(found), failCheck: (err: unknown) => failCheck(err), finishDownload: () => finishDownload(), failDownload: (err: unknown) => failDownload(err), progress: (fraction: number) => progress(fraction) };
}

function controller(over: { mode?: UpdateModeResult; saved?: Partial<UpdateSettingsData>; file?: string } = {}) {
  const fake = fakeDriver();
  const seen: UpdateStatus[] = [];
  let loads = 0;
  let mode: UpdateModeResult = over.mode ?? { mode: "install", reason: null, canMove: false };
  const settings = createUpdateSettings(over.file ? { file: over.file } : {});
  if (over.saved) settings.update(over.saved);
  const updates = createUpdateController({
    current: "0.2.0",
    mode: () => mode,
    settings,
    driver: async () => {
      loads++;
      return fake.driver;
    },
    releasesUrl: RELEASES_URL,
    onChange: (status) => seen.push(status),
  });
  const states = () => seen.map((status) => status.state);
  return { ...fake, updates, settings, seen, states, loads: () => loads, setMode: (next: UpdateModeResult) => (mode = next) };
}

/** Lets the promises a check chains through settle. */
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("update controller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does nothing before start(), then checks 5 s later and every 4 h", async () => {
    const c = controller();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(c.loads()).toBe(0);
    expect(c.calls).toEqual([]);
    c.updates.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS - 1);
    // Not even the updater is loaded until the first check.
    expect(c.loads()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(c.calls).toEqual(["check"]);
    c.answerCheck(null);
    await settle();
    expect(c.updates.status()).toMatchObject({ state: "upToDate", manual: false, asks: 0 });
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(c.calls).toEqual(["check", "check"]);
  });

  it("never checks, loads or reads anything in mode off", async () => {
    const file = path.join(temp, "off.json");
    const c = controller({ mode: { mode: "off", reason: "Sonobe run from a checkout doesn't check for updates.", canMove: false }, file });
    c.updates.start();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(await c.updates.check({ manual: true })).toMatchObject({ mode: "off", state: "idle", asks: 0, updatedFrom: null });
    c.updates.setAutoCheck(false);
    expect(c.loads()).toBe(0);
    expect(readdirSync(temp)).not.toContain("off.json");
    expect(c.seen.every((status) => status.mode === "off" && status.state === "idle")).toBe(true);
  });

  it("stops the schedule when automatic checks are switched off, and still checks when asked", async () => {
    const c = controller();
    c.updates.start();
    expect(c.updates.setAutoCheck(false)).toMatchObject({ autoCheck: false, mode: "install" });
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
    expect(c.calls).toEqual([]);
    const asked = c.updates.check({ manual: true });
    await settle();
    expect(c.calls).toEqual(["check"]);
    c.answerCheck(null);
    expect(await asked).toMatchObject({ state: "upToDate", manual: true });
    // Back on, the next tick checks again.
    c.updates.setAutoCheck(true);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(c.calls).toEqual(["check", "check"]);
  });

  it("in notify mode says a version is available and never downloads it", async () => {
    const reason = "This copy of Sonobe was built locally, so it can't replace itself. Download the new version instead.";
    const c = controller({ mode: { mode: "notify", reason, canMove: false } });
    const checked = c.updates.check();
    await settle();
    c.answerCheck({ version: "0.3.0" });
    expect(await checked).toMatchObject({ mode: "notify", reason, state: "available", version: "0.3.0", releaseUrl: `${RELEASES_URL}/tag/v0.3.0`, progress: null });
    expect(c.calls).toEqual(["check"]);
    expect(c.states()).toEqual(["checking", "available"]);
  });

  it("in install mode downloads what it found, reports progress, and is ready only when the download says so", async () => {
    const c = controller();
    const checked = c.updates.check();
    await settle();
    c.answerCheck({ version: "0.3.0" });
    // The check has its answer as soon as the feed does; the download carries on.
    expect(await checked).toMatchObject({ state: "downloading", version: "0.3.0", progress: 0 });
    expect(c.calls).toEqual(["check", "download"]);
    for (const fraction of [0.25, 0.251, 0.5, 2]) c.progress(fraction);
    expect(c.seen.filter((status) => status.state === "downloading").map((status) => status.progress)).toEqual([0, 0.25, 0.5, 1]);
    expect(c.updates.status().state).toBe("downloading");
    c.finishDownload();
    await settle();
    expect(c.updates.status()).toMatchObject({ state: "ready", version: "0.3.0", progress: null, error: null });
    expect(c.states().filter((state, i, all) => state !== all[i - 1])).toEqual(["checking", "downloading", "ready"]);
  });

  it("joins a check that's already in flight, and remembers that the person asked", async () => {
    const c = controller();
    const scheduled = c.updates.check();
    const asked = c.updates.check({ manual: true });
    await settle();
    expect(c.calls).toEqual(["check"]);
    c.answerCheck(null);
    expect(await asked).toEqual(await scheduled);
    expect(await asked).toMatchObject({ state: "upToDate", manual: true, asks: 1 });
    // The ask was published while the check was still running, so "Checking for updates…" answers at once.
    expect(c.seen.map((status) => [status.state, status.manual])).toEqual([["checking", false], ["checking", true], ["upToDate", true]]);
  });

  it("stays ready through later checks, scheduled or asked for", async () => {
    const c = controller();
    c.updates.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_MS);
    c.answerCheck({ version: "0.3.0" });
    await settle();
    c.finishDownload();
    await settle();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(await c.updates.check({ manual: true })).toMatchObject({ state: "ready", version: "0.3.0", manual: true });
    expect(c.calls).toEqual(["check", "download"]);
  });

  it("answers every Check for Updates…, also while an update is downloading or ready", async () => {
    const c = controller();
    const first = c.updates.check({ manual: true });
    await settle();
    c.answerCheck({ version: "0.3.0" });
    expect(await first).toMatchObject({ state: "downloading", manual: true, asks: 1 });
    // Nothing changes but the count, and each ask is still published: the windows answer with where things stand.
    let count = c.seen.length;
    expect(await c.updates.check({ manual: true })).toMatchObject({ state: "downloading", asks: 2 });
    expect(await c.updates.check({ manual: true })).toMatchObject({ state: "downloading", asks: 3 });
    expect(c.seen.slice(count).map((status) => [status.state, status.asks])).toEqual([["downloading", 2], ["downloading", 3]]);
    c.finishDownload();
    await settle();
    count = c.seen.length;
    expect(await c.updates.check({ manual: true })).toMatchObject({ state: "ready", asks: 4 });
    expect(await c.updates.check({ manual: true })).toMatchObject({ state: "ready", asks: 5 });
    expect(c.seen.slice(count).map((status) => [status.state, status.asks])).toEqual([["ready", 4], ["ready", 5]]);
    // A scheduled check in between asks nobody and publishes nothing.
    await c.updates.check();
    expect(c.seen).toHaveLength(count + 2);
    expect(c.calls).toEqual(["check", "download"]);
  });

  it("leaves an available notice up through a scheduled check, and speaks again only for a newer version", async () => {
    const c = controller({ mode: { mode: "notify", reason: null, canMove: false } });
    const first = c.updates.check();
    await settle();
    c.answerCheck({ version: "0.3.0" });
    await first;
    const failing = c.updates.check();
    await settle();
    c.failCheck(new Error("net::ERR_INTERNET_DISCONNECTED"));
    expect(await failing).toMatchObject({ state: "available", version: "0.3.0", error: null });
    const newer = c.updates.check();
    await settle();
    c.answerCheck({ version: "0.4.0" });
    expect(await newer).toMatchObject({ state: "available", version: "0.4.0" });
    expect(c.states()).toEqual(["checking", "available", "available"]);
  });

  it("reports a failed check or download once, with words for people", async () => {
    const c = controller();
    const offline = c.updates.check({ manual: true });
    await settle();
    c.failCheck(new Error("net::ERR_INTERNET_DISCONNECTED"));
    expect(await offline).toMatchObject({ state: "failed", manual: true, error: { kind: "network", phase: "check", hint: expect.stringContaining("internet connection") } });
    const count = c.seen.length;
    // The updater also emits the error as an event; reporting it again changes nothing.
    c.updates.fail(new Error("net::ERR_INTERNET_DISCONNECTED"), "check");
    expect(c.seen).toHaveLength(count);

    const again = c.updates.check();
    await settle();
    c.answerCheck({ version: "0.3.0" });
    await again;
    c.failDownload(new Error("Code signature at URL file:///x/Sonobe.app/ did not pass validation"));
    await settle();
    expect(c.updates.status()).toMatchObject({ state: "failed", version: "0.3.0", progress: null, error: { kind: "rejected", phase: "download", hint: expect.stringContaining("release page") } });
    expect(c.states()).not.toContain("ready");
  });

  it("says once that Sonobe was updated, on the first launch of a newer version", async () => {
    const file = path.join(temp, "updated.json");
    writeFileSync(file, JSON.stringify({ lastRunVersion: "0.1.0" }));
    const first = controller({ file });
    expect(first.updates.status()).toMatchObject({ updatedFrom: "0.1.0", notesUrl: `${RELEASES_URL}/tag/v0.2.0` });
    first.updates.start();
    // Still said in this launch until a window has heard it, and recorded so the next launch doesn't.
    expect(first.updates.status().updatedFrom).toBe("0.1.0");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ autoCheck: true, lastRunVersion: "0.2.0", moveOffered: false });
    // A window was told: one that opens later in the same launch isn't.
    const before = first.seen.length;
    first.updates.updatedSaid();
    expect(first.updates.status()).toMatchObject({ updatedFrom: null, notesUrl: null });
    expect(first.seen).toHaveLength(before);
    const second = controller({ file });
    second.updates.start();
    expect(second.updates.status()).toMatchObject({ updatedFrom: null, notesUrl: null });
    // A first launch ever, and an older build opened over newer data, say nothing.
    expect(controller().updates.status().updatedFrom).toBeNull();
    expect(controller({ saved: { lastRunVersion: "0.3.0" } }).updates.status().updatedFrom).toBeNull();
  });

  it("offers the move to Applications in one launch only", () => {
    const file = path.join(temp, "move.json");
    const mode: UpdateModeResult = { mode: "notify", reason: "Sonobe updates itself only from an Applications folder. Move it there.", canMove: true };
    const first = controller({ mode, file });
    first.updates.start();
    expect(first.updates.status()).toMatchObject({ offerMove: true, canMove: true });
    expect(controller({ mode, file }).updates.status()).toMatchObject({ offerMove: false, canMove: true });
    expect(controller().updates.status()).toMatchObject({ offerMove: false, canMove: false });
  });

  it("marks a restart while the windows close, so a cancelled one can be told from one never started", async () => {
    const c = controller();
    const checked = c.updates.check();
    await settle();
    c.answerCheck({ version: "0.3.0" });
    await checked;
    c.finishDownload();
    await settle();
    expect(c.updates.setRestarting(true)).toMatchObject({ state: "ready", restarting: true });
    expect(c.updates.setRestarting(false)).toMatchObject({ state: "ready", restarting: false });
    expect(c.seen.slice(-3).map((status) => status.restarting)).toEqual([false, true, false]);
    await c.updates.install();
    expect(c.calls.at(-1)).toBe("install");
    // The app is still here after install(): say so, and how the update still gets in.
    expect(c.updates.fail(new Error("Sonobe is still running 30 s after the restart was asked for."), "install")).toMatchObject({ state: "failed", error: { kind: "other" } });
  });
});

describe("manualCheckDialog", () => {
  const base = controller().updates.status();
  const dialog = (over: Partial<UpdateStatus>) => manualCheckDialog({ ...base, ...over });

  it("answers Check for Updates when no window is open, for every state", () => {
    expect(dialog({ state: "upToDate" })).toEqual({ message: "Sonobe is up to date.", detail: "Version 0.2.0 is the newest.", buttons: ["OK"], action: null });
    expect(dialog({ state: "ready", version: "0.3.0" })).toMatchObject({ message: "Sonobe 0.3.0 is ready to install.", buttons: ["Restart to Update", "Later"], action: "restart" });
    expect(dialog({ mode: "notify", state: "available", version: "0.3.0", reason: "This copy of Sonobe was built locally." })).toMatchObject({ message: "Sonobe 0.3.0 is available.", detail: "This copy of Sonobe was built locally.", buttons: ["Download", "Later"], action: "openRelease" });
    expect(dialog({ state: "downloading", version: "0.3.0" })).toMatchObject({ message: "Sonobe 0.3.0 is downloading.", action: null });
    expect(dialog({ state: "checking" }).buttons).toEqual(["OK"]);
    expect(dialog({ mode: "off", reason: "Update checks are switched off (SONOBE_UPDATES)." })).toMatchObject({ message: "This copy of Sonobe doesn't check for updates.", detail: "Update checks are switched off (SONOBE_UPDATES)." });
  });

  it("gives a failure's message and hint, with the release page when that helps", () => {
    const offline = dialog({ state: "failed", error: explainUpdateError(new Error("net::ERR_INTERNET_DISCONNECTED"), "check") });
    expect(offline).toMatchObject({ message: "Sonobe couldn't reach the release feed to check for updates.", buttons: ["OK"], action: null });
    const refused = dialog({ state: "failed", version: "0.3.0", error: explainUpdateError(new Error("did not pass validation"), "download") });
    expect(refused).toMatchObject({ buttons: ["Open Release Page", "OK"], action: "openRelease" });
    expect(refused.detail).toContain("release page");
  });
});
