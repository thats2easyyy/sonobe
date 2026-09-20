#!/usr/bin/env node
/**
 * Sonobe Viewer's tests on an iOS Simulator. Needs macOS with Xcode; runs by hand, outside CI.
 *
 * Serves the Haptic Check prototype with the real web player and LAN preview server
 * (apps/desktop/player/testing.ts), runs the unit and UI tests with `xcodebuild test` and no signing,
 * then reads the app's log to check what the UI test's three taps played in the app: one Notification
 * Success at start, and three Impact Medium haptics and three 50 ms vibrations.
 *
 *   npm run test:ios
 *   SONOBE_IOS_SIMULATOR="iPhone 17" npm run test:ios    pick a simulator by name or UDID
 *
 * Without SONOBE_IOS_SIMULATOR it uses a booted iPhone simulator, else the first available one.
 * The build goes to apps/ios/build (git-ignored), and the full xcodebuild output to build/test.log.
 */

import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hapticCheckDocument, servePlayer } from "../../desktop/player/testing.ts";

const iosDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(iosDir, "build");
const logPath = path.join(buildDir, "test.log");
const started = Date.now();
const log = (msg) => console.log(`[test:ios +${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);

function fail(message, hint) {
  console.error(`\n${message}${hint ? `\n${hint}` : ""}`);
  process.exit(1);
}

if (process.platform !== "darwin") fail("Sonobe Viewer's tests need macOS with Xcode.", "The web player's own tests run everywhere: npx vitest run apps/desktop/player");
try {
  execFileSync("xcrun", ["--find", "xcodebuild"], { stdio: "ignore" });
} catch {
  fail("Xcode isn't installed, or its command line tools aren't selected.", "Install Xcode from the App Store, then run: sudo xcode-select -s /Applications/Xcode.app");
}

/** The simulator to test on: SONOBE_IOS_SIMULATOR (name or UDID), a booted iPhone, or the first available iPhone. */
function pickSimulator() {
  const { devices } = JSON.parse(execFileSync("xcrun", ["simctl", "list", "devices", "available", "-j"], { encoding: "utf8" }));
  const iphones = Object.entries(devices)
    .filter(([runtime]) => runtime.includes(".iOS-"))
    .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
    .flatMap(([, list]) => list)
    .filter((d) => /\.iPhone-/.test(d.deviceTypeIdentifier ?? "") || d.name.startsWith("iPhone"));
  const wanted = process.env.SONOBE_IOS_SIMULATOR?.trim();
  if (wanted) {
    const found = iphones.find((d) => d.udid === wanted) ?? iphones.find((d) => d.name === wanted);
    if (!found) fail(`No available iPhone simulator is called "${wanted}".`, `Try one of: ${[...new Set(iphones.map((d) => d.name))].join(", ")}`);
    return found;
  }
  const device = iphones.find((d) => d.state === "Booted") ?? iphones[0];
  if (!device) fail("There's no iPhone simulator.", "Add an iOS runtime in Xcode → Settings → Components.");
  return device;
}

/** `log show` wants local time, "YYYY-MM-DD HH:MM:SS". */
function localTimestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function runXcodebuild(args, env) {
  mkdirSync(buildDir, { recursive: true });
  const out = createWriteStream(logPath);
  return new Promise((resolve) => {
    const child = spawn("xcodebuild", args, { cwd: iosDir, env: { ...process.env, ...env } });
    let pending = "";
    const onData = (chunk) => {
      out.write(chunk);
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (/^Test Case .*(passed|failed|skipped)|^\s*[✔✘] (Test|Suite)|\.swift:\d+:\d+: error|\*\* (TEST|BUILD) \w+ \*\*/.test(line.trim())) console.log(`  ${line.trim()}`);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => {
      out.end();
      resolve(code ?? 1);
    });
  });
}

/** The app's haptics and vibrations since `since`, grouped by app launch (process). */
function readViewerLog(udid, since) {
  let text;
  try {
    text = execFileSync("xcrun", ["simctl", "spawn", udid, "log", "show", "--style", "ndjson", "--info", "--start", since, "--predicate", 'subsystem == "dev.sonobe.viewer"'], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    throw new Error(`Couldn't read the simulator's log: ${String(err.stderr || err.message).trim()}`);
  }
  const launches = new Map();
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry.eventMessage !== "string") continue;
    const messages = launches.get(entry.processID) ?? [];
    messages.push(entry.eventMessage);
    launches.set(entry.processID, messages);
  }
  return [...launches.values()];
}

const count = (messages, text) => messages.filter((m) => m === text).length;

const simulator = pickSimulator();
const wasBooted = simulator.state === "Booted";
log(`simulator: ${simulator.name} (${simulator.udid})${wasBooted ? "" : ", booting"}`);
// Booted up front so it stays up for reading its log afterwards (xcodebuild shuts down one it booted).
if (!wasBooted) execFileSync("xcrun", ["simctl", "bootstatus", simulator.udid, "-b"], { stdio: "ignore" });
const server = await servePlayer({ doc: hapticCheckDocument() });
log(`serving Haptic Check at ${server.url}`);

let failed = false;
try {
  const since = localTimestamp(new Date(Date.now() - 2000));
  log(`xcodebuild test (full output in ${path.relative(process.cwd(), logPath)})`);
  const code = await runXcodebuild(
    ["-project", "SonobeViewer.xcodeproj", "-scheme", "SonobeViewer", "-destination", `platform=iOS Simulator,id=${simulator.udid}`, "-derivedDataPath", buildDir, "CODE_SIGNING_ALLOWED=NO", "test"],
    { TEST_RUNNER_SONOBE_PLAYER_URL: server.url },
  );
  if (code !== 0) {
    failed = true;
    console.error(`\nxcodebuild test failed (exit ${code}). The full output is in ${logPath}.`);
  } else {
    // The unified log can lag a moment behind the app.
    let tapped;
    for (let attempt = 0; attempt < 5 && !tapped; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1000));
      tapped = readViewerLog(simulator.udid, since).find((messages) => count(messages, "haptic impactMedium") > 0);
    }
    const played = tapped ? { start: count(tapped, "haptic notificationSuccess"), taps: count(tapped, "haptic impactMedium"), vibrations: count(tapped, "vibrate [50]") } : null;
    if (played && played.start >= 1 && played.taps === 3 && played.vibrations === 3) {
      log(`the app played ${played.start} Notification Success, ${played.taps} Impact Medium and ${played.vibrations} vibrations of 50 ms`);
    } else {
      failed = true;
      console.error(`\nThe app didn't play what three taps should: expected Notification Success, then 3 Impact Medium and 3 × "vibrate [50]" in one launch; got ${JSON.stringify(played)}.`);
      console.error(`Read the log with: xcrun simctl spawn ${simulator.udid} log show --info --start "${since}" --predicate 'subsystem == "dev.sonobe.viewer"'`);
    }
  }
} catch (err) {
  failed = true;
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
} finally {
  await server.close();
  if (!wasBooted) execFileSync("xcrun", ["simctl", "shutdown", simulator.udid], { stdio: "ignore" });
}

if (failed) process.exit(1);
log("Sonobe Viewer tests passed");
