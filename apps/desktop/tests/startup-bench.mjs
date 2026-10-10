#!/usr/bin/env node
/**
 * Times the desktop app's launch, by hand (macOS). It spawns the app directly, muted and with its own data
 * folder and SONOBE_HOME, several times over, and prints when each thing happened, in milliseconds from the
 * spawn, as median [min-max]:
 *
 *   main process starts, main bundle evaluated, app ready, window created, navigation committed,
 *   first React commit, window shown, first contentful paint, editor usable (the shell, the layer list and the
 *   viewer's first frame are in the page), patch editor nodes
 *
 * and the intervals a change to launch moves: the main bundle's compile and evaluation, ready to the first
 * window, the window to the committed navigation, and that to the first React commit.
 *
 * With a project there are two more rows, and they are different moments. "Opened document in the page" is when
 * the toolbar has its name and the viewer has its elements: the DOM, which nobody sees until a frame is drawn.
 * "Opened document on screen" is the first moment a person can see it: the latest of that, the page's first
 * contentful paint and the window being shown. A build that starts the editor on the project has the document in
 * the page before the first paint; one that shows the demo first has it there after. Compare the on-screen rows.
 *
 *   npm run package -w @sonobe/desktop                    the app to time
 *   npm run bench:startup -w @sonobe/desktop              release/mac-<arch>/Sonobe.app
 *
 *   --app <Sonobe.app>        another packaged app
 *   --baseline <Sonobe.app>   a second app, launched in turns with the first (baseline, app, app, baseline…), with
 *                             the difference of each pair. A before and after only means something in one session.
 *   --dev                     the checkout instead of a package (electron apps/desktop; build the editor and the
 *                             shell first)
 *   --scenarios noarg,project,fresh   noarg: no argument, one profile kept across runs. project: opens a copy of
 *                             examples/02-like-toggle, and adds the opened document's two rows and every
 *                             document name the toolbar showed. fresh: a new profile every run, which is a first
 *                             launch (the welcome dialog, and no compile cache yet). Default: all three.
 *   --project <folder>        the prototype the project scenario opens a copy of, instead of the example: a
 *                             larger one takes longer to read, and the first frame waits for it. Never one that
 *                             uses the Camera or Microphone patch: a launch is muted, not blind.
 *   --runs 7                  timed launches per scenario and app, after one that isn't counted
 *   --cli                     also the bundled CLI: `sonobe --version`, and `sonobe mcp` against the running app
 *                             (time to its first answer, and its resident memory then)
 *   --base-port 39600         MCP ports from here up (100 of them, in turn); otherwise the app picks a free one
 *   --json <file>             every run and the summaries, as JSON
 *   --keep                    keep the temp folder (the copies, the profiles, each run's raw result)
 *
 * No tracked file is edited to instrument the app. A packaged app is copied into a temp folder, its app.asar
 * repacked so that package.json's "main" is a two-line stub that loads startup-bench/hook.cjs and then the app's
 * own entry, and the copy re-signed ad hoc. So the copy is not the signed build: it has no hardened runtime.
 * hook.cjs records the main process's side and registers startup-bench/page.cjs in the editor page for the DOM's.
 * The first launch of each scenario isn't counted: it fills the profile and the compile cache, and the very
 * first launch of a copy also pays macOS's checks of a binary it hasn't seen.
 *
 * A run fails when an IPC handler was registered after the turn that created the first window (a page could
 * ask before it exists), when the page logged "No handler registered", or when a window the app opened for the
 * project (a build that starts the editor on it) showed any other document first.
 *
 * Afterwards everything it started is killed, the copies are unregistered from LaunchServices, and the temp
 * folder is removed.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
const here = path.join(root, "tests", "startup-bench");
const { values } = parseArgs({
  options: {
    app: { type: "string" },
    baseline: { type: "string" },
    dev: { type: "boolean", default: false },
    scenarios: { type: "string", default: "noarg,project,fresh" },
    project: { type: "string" },
    runs: { type: "string", default: "7" },
    cli: { type: "boolean", default: false },
    "base-port": { type: "string" },
    json: { type: "string" },
    keep: { type: "boolean", default: false },
  },
});

/** Stops with a message for people and what to do about it. */
function fail(message, hint) {
  console.error(`[bench] ${message}`);
  if (hint) console.error(`[bench] ${hint}`);
  process.exit(1);
}

const SCENARIOS = { noarg: "no argument", project: "opening a project", fresh: "first launch (a new profile every run)" };
const scenarios = values.scenarios.split(",").filter(Boolean);
const unknown = scenarios.filter((name) => !(name in SCENARIOS));
if (unknown.length) fail(`--scenarios doesn't know ${unknown.join(", ")}.`, `Choose from ${Object.keys(SCENARIOS).join(", ")}.`);
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1) fail(`--runs must be a whole number of launches (got ${values.runs}).`);
const basePort = values["base-port"] === undefined ? null : Number(values["base-port"]);
if (basePort !== null && !(Number.isInteger(basePort) && basePort > 0 && basePort < 65436)) fail(`--base-port must be a port with 100 free above it (got ${values["base-port"]}).`);
if (process.platform !== "darwin") fail("The startup benchmark runs on macOS only: it copies and re-signs a Sonobe.app.");
/** The prototype the project scenario opens a copy of, and the name its toolbar shows. */
const projectSource = path.resolve(values.project ?? path.join(repo, "examples", "02-like-toggle"));
let projectName;
try {
  projectName = JSON.parse(readFileSync(path.join(projectSource, "project.json"), "utf8")).name;
} catch {
  projectName = undefined;
}
if (scenarios.includes("project") && (typeof projectName !== "string" || !projectName)) fail(`${projectSource} isn't a Sonobe prototype: it has no project.json with a name.`, "Pass --project <a prototype's folder>, or leave it out for examples/02-like-toggle.");

const defaultApp = path.join(root, "release", `mac-${process.arch}`, "Sonobe.app");
const appPath = path.resolve(values.app ?? defaultApp);
if (!values.dev && !existsSync(appPath)) fail(`There's no packaged app at ${appPath}.`, "Build one with: npm run package -w @sonobe/desktop (or pass --app <Sonobe.app>, or --dev for the checkout).");
if (values.baseline && !existsSync(values.baseline)) fail(`There's no baseline app at ${values.baseline}.`, "Pass the Sonobe.app of an earlier build, copied out of release/ before you rebuilt.");
const electronExe = path.join(repo, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
if (values.dev && !(existsSync(path.join(root, "dist", "main.cjs")) && existsSync(path.join(repo, "apps", "editor", "dist", "index.html")) && existsSync(electronExe)))
  fail("--dev launches the checkout, and it isn't built.", "Run: npm run build (the editor, then the shell).");

const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const temp = mkdtempSync(path.join(os.tmpdir(), "sonobe-bench-"));
const wall = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message) => console.log(`[bench] ${message}`);
const load = () => os.loadavg().map((n) => n.toFixed(1)).join(" ");

/** Everything whose command line names the temp folder: the apps, their helpers, the relays. */
function killLeftovers() {
  const found = spawnSync("pgrep", ["-f", temp], { encoding: "utf8" }).stdout ?? "";
  for (const pid of found.split("\n").filter(Boolean)) {
    try {
      process.kill(Number(pid), "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

const copies = [];
let cleaned = false;
function cleanUp() {
  if (cleaned) return;
  cleaned = true;
  killLeftovers();
  // A launched copy registered itself as an owner of .sonobe files, under the bundle id of an installed Sonobe.
  for (const copy of copies) spawnSync(lsregister, ["-u", copy], { stdio: "ignore" });
  if (values.keep) log(`kept ${temp}`);
  else rmSync(temp, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanUp();
    process.exit(130);
  });
}

/** A copy of a packaged app whose entry loads the hook first. `source` itself is only read. */
async function instrumentedCopy(source, name) {
  const { createPackage, extractAll } = await import("@electron/asar");
  const dir = path.join(temp, name);
  const copy = path.join(dir, "Sonobe.app");
  mkdirSync(dir);
  // ditto keeps the symlinks and permissions a framework needs.
  execFileSync("ditto", [source, copy]);
  copies.push(copy);
  const archive = path.join(copy, "Contents", "Resources", "app.asar");
  const work = path.join(dir, "asar");
  extractAll(archive, work);
  const manifest = path.join(work, "package.json");
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  // Whatever the app's entry is called. Without the variable the copy runs as the app does (the relay's app, below).
  writeFileSync(path.join(work, "bench-entry.cjs"), `if (process.env.SONOBE_BENCH_HOOK) require(process.env.SONOBE_BENCH_HOOK);\nrequire(${JSON.stringify(`./${pkg.main}`)});\n`);
  writeFileSync(manifest, JSON.stringify({ ...pkg, main: "bench-entry.cjs" }, null, 2));
  rmSync(archive);
  await createPackage(work, archive);
  rmSync(work, { recursive: true, force: true });
  // The seal no longer matches the repacked archive, and macOS refuses a bundle whose seal is broken.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", copy], { stdio: "pipe" });
  return { name, packaged: true, exe: path.join(copy, "Contents", "MacOS", "Sonobe"), args: [], cli: path.join(copy, "Contents", "Resources", "cli", "sonobe"), entry: pkg.main, version: pkg.version };
}

let launches = 0;
/** The environment of an isolated launch: nothing of the shell's Sonobe or Node settings, and its own folders. */
function isolatedEnv(profile, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("SONOBE_") || ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_COMPILE_CACHE", "NODE_DISABLE_COMPILE_CACHE"].includes(key)) delete env[key];
  const userData = path.join(profile, "userData");
  const home = path.join(profile, "home");
  mkdirSync(userData, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { ...env, SONOBE_USER_DATA: userData, SONOBE_HOME: home, SONOBE_MUTE: "1", SONOBE_UPDATES: "off", ...(basePort === null ? {} : { SONOBE_MCP_PORT: String(basePort + (launches++ % 100)) }), ...extra };
}

const filesUnder = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).length : 0);

/** One launch, until the hook quits the app. Resolves the run's times in ms from the spawn, or null when it reported nothing. */
async function launch(target, { profile, project, welcome }) {
  const out = path.join(temp, `run-${launches}-${Date.now()}.json`);
  const env = isolatedEnv(profile, {
    SONOBE_BENCH_HOOK: path.join(here, "hook.cjs"),
    SONOBE_BENCH_PAGE: path.join(here, "page.cjs"),
    SONOBE_BENCH_OUT: out,
    ...(project ? { SONOBE_BENCH_EXPECT_DOC: path.basename(project, ".sonobe") } : {}),
    ...(welcome ? { SONOBE_BENCH_EXPECT_WELCOME: "1" } : {}),
  });
  // Whether this launch found a compile cache from an earlier one.
  const cached = filesUnder(path.join(env.SONOBE_USER_DATA, "compile-cache")) > 0;
  const stderr = [];
  const t0 = wall();
  const child = spawn(target.exe, [...target.args, ...(project ? [project] : [])], { env, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 70_000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await sleep(150);
  killLeftovers();
  if (!existsSync(out)) {
    console.warn(`[bench] ${target.name}: a launch reported nothing.${stderr.length ? ` Its last output:\n${stderr.join("").slice(-600)}` : ""}`);
    return null;
  }
  const raw = JSON.parse(readFileSync(out, "utf8"));
  if (!values.keep) rmSync(out, { force: true });
  const main = (name) => (typeof raw.marks[name] === "number" ? raw.marks[name] - t0 : undefined);
  const page = (value) => (raw.page && typeof value === "number" ? raw.page.timeOrigin + value - t0 : undefined);
  const between = (from, to) => (from === undefined || to === undefined ? undefined : to - from);
  const at = {
    "main process starts": main("start"),
    "main bundle evaluated": main("mainEvaluated"),
    "app ready": main("ready"),
    "window created": main("windowCreated"),
    "navigation committed": main("navigated"),
    "first React commit": page(raw.page?.marks.shell),
    // macOS doesn't send `show` while the display sleeps: then it's when the window was told to show.
    "window shown": main("shown") ?? main("readyToShow"),
    "first contentful paint": page(raw.page?.paint["first-contentful-paint"]),
    "editor usable": page(raw.page?.marks.usable),
    "patch editor nodes": page(raw.page?.marks.patchNodes),
    ...(project ? { "opened document in the page": page(raw.page?.marks.opened) } : {}),
    ...(welcome ? { "welcome dialog": page(raw.page?.marks.welcome) } : {}),
  };
  // In the page is not on screen: a person sees the document with the first frame drawn after it, in a window that is showing.
  const seen = [at["opened document in the page"], at["first contentful paint"], at["window shown"]];
  if (project) at["opened document on screen"] = seen.every((time) => time !== undefined) ? Math.max(...seen) : undefined;
  const intervals = {
    "main bundle: compile and evaluate": between(main("mainCompileStart"), main("mainEvaluated")),
    "ready → window created": between(main("ready"), main("windowCreated")),
    "window created → navigation committed": between(main("windowCreated"), main("navigated")),
    "navigation committed → first React commit": between(main("navigated"), at["first React commit"]),
    ...(project
      ? {
          "navigation committed → opened document in the page": between(main("navigated"), at["opened document in the page"]),
          "window shown → opened document on screen": between(at["window shown"], at["opened document on screen"]),
        }
      : {}),
  };
  return { at, intervals, titles: raw.page?.titles ?? [], launching: raw.page?.launching === true, late: raw.late, errors: raw.errors, why: raw.why, settled: raw.page?.settled === true, cached, compileCache: raw.compileCache !== null };
}

function stats(numbers) {
  const sorted = numbers.filter((n) => typeof n === "number" && Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = (sorted.length - 1) / 2;
  return { n: sorted.length, median: (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2, min: sorted[0], max: sorted[sorted.length - 1] };
}
const whole = (value) => String(Math.round(value));
const signed = (value) => `${Math.round(value) > 0 ? "+" : ""}${Math.round(value)}`;
const cell = (s) => (s ? `${whole(s.median)} [${whole(s.min)}-${whole(s.max)}]` : "-");
const difference = (s) => (s ? `${signed(s.median)} [${signed(s.min)} to ${signed(s.max)}]` : "-");

/** One table: a row per name, a column per app, and with two apps the difference of each pair of runs. */
function table(title, names, byTarget, targets) {
  const out = {};
  const widths = [54, 20, 20, 24];
  const line = (cells) => console.log(cells.map((text, i) => String(text).padEnd(widths[i])).join("").trimEnd());
  console.log(`\n${title}`);
  line(["", ...targets.map((t) => t.name), ...(targets.length === 2 ? ["difference, by pair"] : [])]);
  for (const name of names) {
    const columns = targets.map((t) => stats(byTarget[t.name].map((run) => run[name])));
    if (columns.every((s) => !s)) continue;
    const [a, b] = targets.map((t) => byTarget[t.name]);
    const pairs = targets.length === 2 ? stats(a.map((run, i) => (typeof run[name] === "number" && typeof b[i]?.[name] === "number" ? b[i][name] - run[name] : undefined))) : null;
    line([name, ...columns.map(cell), ...(targets.length === 2 ? [difference(pairs)] : [])]);
    out[name] = { ...Object.fromEntries(targets.map((t, i) => [t.name, columns[i]])), ...(pairs ? { difference: pairs } : {}) };
  }
  return out;
}

const problems = [];
const report = { at: new Date().toISOString(), machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, os: spawnSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).stdout?.trim() }, runs, loadBefore: os.loadavg(), scenarios: {} };
const caffeinate = spawn("caffeinate", ["-dimsu", "-w", String(process.pid)], { stdio: "ignore" });

try {
  log(`load average ${load()} on ${os.cpus().length} cores`);
  if (os.loadavg()[0] > os.cpus().length / 2) log("The machine is busy: trust the differences by pair and the intervals more than the times from spawn.");
  const targets = [];
  if (values.baseline) targets.push(await instrumentedCopy(path.resolve(values.baseline), "baseline"));
  if (values.dev) targets.push({ name: "checkout", packaged: false, exe: electronExe, args: ["-r", path.join(here, "hook.cjs"), root], cli: null, entry: JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).main });
  else targets.push(await instrumentedCopy(appPath, "app"));
  report.targets = targets.map((t) => ({ name: t.name, entry: t.entry, ...(t.version ? { version: t.version } : {}) }));
  log(`timing ${targets.map((t) => `${t.name} (${t.entry})`).join(" against ")}, ${runs} launches each per scenario`);

  // macOS checks a binary the first time it runs, which takes a second or two and isn't the app's launch.
  for (const target of targets) if (target.packaged) await launch(target, { profile: path.join(temp, `first-${target.name}`) });

  for (const scenario of scenarios) {
    const project = scenario === "project" ? path.join(temp, `${projectName}.sonobe`) : null;
    if (project && !existsSync(project)) cpSync(projectSource, project, { recursive: true });
    const welcome = scenario === "fresh";
    const results = Object.fromEntries(targets.map((t) => [t.name, []]));
    for (let i = 0; i <= runs; i++) {
      // Each pair in the other order than the last, so going second favours neither app.
      for (const target of i % 2 ? [...targets].reverse() : targets) {
        const profile = path.join(temp, scenario === "fresh" ? `fresh-${target.name}-${i}` : `${scenario}-${target.name}`);
        const run = await launch(target, { profile, project, welcome });
        if (scenario === "fresh") rmSync(profile, { recursive: true, force: true });
        await sleep(300);
        // The first one fills the profile and the compile cache.
        if (i === 0) continue;
        // A launch that reported nothing still takes its place, so the pairs stay the same launches.
        results[target.name].push(run ?? { at: {}, intervals: {}, titles: [], late: [], errors: [], cached: false, compileCache: false });
        if (!run) {
          problems.push(`${scenario}, ${target.name}: a launch reported nothing`);
          continue;
        }
        if (run.why !== "page" || !run.settled) problems.push(`${scenario}, ${target.name}: a launch never showed everything it waited for (${run.why})`);
        if (run.late.length) problems.push(`${scenario}, ${target.name}: IPC handlers registered after the turn that created the window: ${[...new Set(run.late)].join(", ")}`);
        for (const error of run.errors) if (/No handler registered/.test(error)) problems.push(`${scenario}, ${target.name}: ${error}`);
        // The app opened the window for the project: the editor starts on it, and the demo is never on screen.
        if (project && run.launching && run.titles.join() !== path.basename(project, ".sonobe")) problems.push(`${scenario}, ${target.name}: the window was opened for the project and showed ${run.titles.join(" → ") || "nothing"}`);
        // A launch with a compile cache that found none isn't the warm launch these two scenarios are about.
        if (scenario !== "fresh" && run.compileCache && !run.cached) problems.push(`${scenario}, ${target.name}: the compile cache was empty after the first launch, so this run compiled everything again`);
      }
    }
    const times = table(`${SCENARIOS[scenario]}: ms from spawn, median [min-max], n=${runs}`, Object.keys(results[targets[0].name].find((run) => run.why)?.at ?? {}), Object.fromEntries(targets.map((t) => [t.name, results[t.name].map((run) => run.at)])), targets);
    const intervals = table("intervals, ms", Object.keys(results[targets[0].name].find((run) => run.why)?.intervals ?? {}), Object.fromEntries(targets.map((t) => [t.name, results[t.name].map((run) => run.intervals)])), targets);
    for (const target of targets) {
      const all = results[target.name];
      const notes = [];
      if (all.some((run) => run.compileCache)) notes.push(`compile cache warm in ${all.filter((run) => run.cached).length} of ${all.length}`);
      if (project) {
        const shown = [...new Set(all.map((run) => run.titles.join(" → ")))];
        notes.push(`documents shown: ${shown.join("; ") || "none"}${all.some((run) => run.titles.length > 1 || (run.titles[0] && !run.titles[0].includes(projectName))) ? " (another document was on screen first)" : ""}`);
      }
      const errors = [...new Set(all.flatMap((run) => run.errors))];
      if (errors.length) notes.push(`console errors: ${errors.slice(0, 3).join(" | ")}`);
      if (notes.length) console.log(`${target.name}: ${notes.join("; ")}`);
    }
    report.scenarios[scenario] = { times, intervals, runs: results };
  }

  if (values.cli) {
    const withCli = targets.filter((t) => t.packaged);
    if (!withCli.length) log("--cli needs a packaged app: the checkout has no launcher to time.");
    else {
      // One home per app for all of it, so a launcher's compile cache fills on the first run and stays.
      const envs = Object.fromEntries(withCli.map((t) => [t.name, isolatedEnv(path.join(temp, `cli-${t.name}`))]));
      const timeVersion = (target) => {
        const started = performance.now();
        const result = spawnSync(target.cli, ["--version"], { env: envs[target.name], encoding: "utf8", cwd: temp });
        if (result.status !== 0) problems.push(`${target.name}: sonobe --version exited ${result.status}: ${result.stderr}`);
        return performance.now() - started;
      };
      // The first run is a row of its own: it compiles everything, and fills the compile cache where the launcher has one.
      const first = Object.fromEntries(withCli.map((t) => [t.name, [{ "sonobe --version, first run": timeVersion(t) }]]));
      const version = Object.fromEntries(withCli.map((t) => [t.name, []]));
      for (let i = 0; i < runs; i++) for (const target of withCli) version[target.name].push({ "sonobe --version": timeVersion(target) });

      // The relay talks to a running app: one per target, each with its own home, started as the app starts (no hook).
      const apps = withCli.map((target) => ({ target, env: envs[target.name], child: spawn(target.exe, [], { env: envs[target.name], stdio: "ignore" }) }));
      const relay = Object.fromEntries(withCli.map((t) => [t.name, []]));
      try {
        for (const app of apps) {
          const connection = path.join(app.env.SONOBE_HOME, "mcp.json");
          const deadline = Date.now() + 30_000;
          while (!existsSync(connection) && Date.now() < deadline) await sleep(100);
          if (!existsSync(connection)) throw new Error(`${app.target.name} never wrote mcp.json, so there's nothing for sonobe mcp to connect to.`);
        }
        const initialize = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "startup-bench", version: "0" } } })}\n`;
        for (let i = 0; i <= runs; i++) {
          for (const app of i % 2 ? [...apps].reverse() : apps) {
            const started = performance.now();
            // The launcher execs the app's binary in Node mode, so this pid is the relay's.
            const child = spawn(app.target.cli, ["mcp"], { env: app.env, cwd: temp, stdio: ["pipe", "pipe", "ignore"] });
            const exited = new Promise((resolve) => child.once("exit", resolve));
            child.stdin.write(initialize);
            const answered = await Promise.race([new Promise((resolve) => child.stdout.once("data", () => resolve(performance.now() - started))), exited.then(() => null), sleep(20_000).then(() => null)]);
            const rss = Number(spawnSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8" }).stdout) / 1024;
            child.stdin.end();
            await Promise.race([exited, sleep(5000).then(() => child.kill("SIGKILL"))]);
            if (answered === null) problems.push(`${app.target.name}: sonobe mcp never answered initialize`);
            // The first one isn't counted, as with the app.
            else if (i > 0) relay[app.target.name].push({ "sonobe mcp: first answer, ms": answered, "sonobe mcp: resident memory, MB": rss });
          }
        }
      } finally {
        for (const app of apps) app.child.kill("SIGTERM");
        await sleep(1500);
        killLeftovers();
      }
      const rows = (title, byTarget) => table(title, Object.keys(byTarget[withCli[0].name][0] ?? {}), byTarget, withCli);
      report.cli = { ...rows("bundled CLI: ms, one run", first), ...rows(`bundled CLI: ms, median [min-max], n=${runs}`, version), ...rows(`sonobe mcp against the running app: median [min-max], n=${runs}`, relay) };
    }
  }

  report.loadAfter = os.loadavg();
  report.problems = problems;
  console.log(`\nload average ${load()} at the end`);
  if (values.json) {
    writeFileSync(path.resolve(values.json), JSON.stringify(report, null, 1));
    log(`wrote ${values.json}`);
  }
  if (problems.length) {
    console.error(`\n[bench] FAIL:\n${[...new Set(problems)].map((problem) => `  - ${problem}`).join("\n")}`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`[bench] ${err?.stack ?? err}`);
  process.exitCode = 1;
} finally {
  caffeinate.kill();
  cleanUp();
}
