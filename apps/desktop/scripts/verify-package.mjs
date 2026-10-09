#!/usr/bin/env node
/**
 * Checks a packaged Sonobe app (muted, with its own user data and SONOBE_HOME, and SONOBE_TEST=1 so secrets
 * use the test cipher: it never touches the person's settings, their keychain or a running Sonobe):
 *
 * - the files inside app.asar and Resources: no source maps, no default_app.asar, no node_modules, the licenses
 * - on macOS, Info.plist's camera and microphone wording, the signature with its hardened runtime flag and
 *   entitlements, and that package.json's `sonobe` field says what that signature can do with an update
 * - a Developer ID build is also held to Gatekeeper and its stapled notarization ticket, and with --release to
 *   Apple's secure timestamp
 * - the app launches, shows the editor build from Resources/editor, and exposes window.sonobeHost
 * - the Assistant doesn't offer the experimental Claude subscription (no packaged build does)
 * - the MCP endpoint answers /health with the token from mcp.json, and quitting removes mcp.json
 * - the bundled CLI runs with the app's own runtime (Resources/cli/sonobe --version), and runs from a copy outside
 *   the checkout, where it has nothing but its own bundle to load
 * - on macOS, the SF Symbols helper (Resources/bin/sfsymbol) has the app's architectures and draws a symbol
 *
 *   node scripts/verify-package.mjs                release/mac-<arch>/Sonobe.app, for this machine's architecture
 *   node scripts/verify-package.mjs --dmg          mount that architecture's newest DMG read-only and check the app inside
 *   node scripts/verify-package.mjs --app <path>   any Sonobe.app (or the unpacked app folder on Windows/Linux)
 *
 *   --arch x64            the other architecture's app or DMG in release/ (arm64, x64 or universal)
 *   --release             fail unless the build is Developer ID signed, notarized and accepted by Gatekeeper
 *   --static              check the bundle without running anything from it (an x64 app on a Mac without Rosetta)
 *   --lang de             launch as if the system language were German, and print the locales the app ends up with
 *   --mcp-port 39601      a fixed MCP port for the launch; otherwise the app picks a free one
 *   --screenshot <path>   where the window's screenshot goes; otherwise into the temp folder, kept only on failure
 *
 * Afterwards the app is unregistered from LaunchServices, so a build in release/ never becomes the app that
 * opens .sonobe files.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { _electron as electron } from "playwright";
import { DISABLE_LIBRARY_VALIDATION, buildInfoFor, entitlementKeys, readAssessment, readSignature } from "./signing.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const { values } = parseArgs({
  options: {
    dmg: { type: "boolean", default: false },
    app: { type: "string" },
    arch: { type: "string" },
    release: { type: "boolean", default: false },
    static: { type: "boolean", default: false },
    lang: { type: "string" },
    "mcp-port": { type: "string" },
    screenshot: { type: "string" },
  },
});
const started = Date.now();
const log = (message) => console.log(`[verify +${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`);
function assert(condition, message, detail) {
  if (!condition) throw new Error(`Assertion failed: ${message}${detail === undefined ? "" : `\n  got: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}
async function poll(fn, { timeout = 20_000, interval = 150, message = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Timed out waiting for ${message} (last: ${JSON.stringify(last)})`);
}
function health(port, token) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/health", headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${token}` } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const temp = mkdtempSync(path.join(tmpdir(), "sonobe-verify-"));
const release = path.join(root, "release");
const mac = process.platform === "darwin";
const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
/** What a tool printed (codesign and spctl report on stderr) and how it exited. */
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return { status: result.status, text: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
let mountPoint = null;
let appPath = null;
let app = null;
let failed = false;

try {
  const arch = values.arch ?? process.arch;
  appPath = values.app ? path.resolve(values.app) : null;
  if (!appPath && values.dmg) {
    const dmgs = readdirSync(release).filter((f) => f.endsWith(".dmg")).map((f) => path.join(release, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    // A release holds one DMG per architecture: take this machine's, or the one --arch names.
    const dmg = dmgs.find((f) => path.basename(f).includes(`-${arch}`)) ?? (values.arch ? undefined : dmgs[0]);
    assert(dmg, `a${values.arch ? `n ${arch}` : ""} DMG in release/`, dmgs.map((f) => path.basename(f)));
    mountPoint = path.join(temp, "mount");
    mkdirSync(mountPoint);
    execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mountPoint, dmg], { stdio: "pipe" });
    appPath = path.join(mountPoint, "Sonobe.app");
    log(`mounted ${path.relative(root, dmg)} (${(statSync(dmg).size / 1024 / 1024).toFixed(1)} MB)`);
  }
  if (!appPath) {
    // electron-builder's folders: mac-arm64, mac (x64) and mac-universal.
    const folders = values.arch ? [arch === "x64" ? "mac" : `mac-${arch}`] : [`mac-${process.arch}`, "mac", "mac-universal"];
    const candidates = mac ? folders.map((d) => path.join(release, d, "Sonobe.app")) : [path.join(release, `${process.platform === "win32" ? "win" : "linux"}-unpacked`)];
    appPath = candidates.find((p) => existsSync(p)) ?? null;
  }
  assert(appPath && existsSync(appPath), "a packaged app (run npm run package -w @sonobe/desktop first)", appPath);

  const resources = mac ? path.join(appPath, "Contents", "Resources") : path.join(appPath, "resources");
  const executable = mac ? path.join(appPath, "Contents", "MacOS", "Sonobe") : path.join(appPath, process.platform === "win32" ? "Sonobe.exe" : "sonobe");
  assert(existsSync(executable), "app executable", executable);
  log(`checking ${appPath}`);

  // Bundle contents.
  for (const file of ["app.asar", "editor/index.html", "cli/sonobe.mjs", "cli/sonobe", "cli/guides/start-here.md", "cli/examples/README.md", "cli/examples/16-placemark-deck/design/capture.json", "licenses/LICENSE.txt", "licenses/THIRD-PARTY-NOTICES.txt"]) assert(existsSync(path.join(resources, file)), `Resources/${file}`);
  // Electron's and Chromium's licenses sit beside the executable on Windows and Linux; a Mac app carries them here.
  if (mac) for (const file of ["icon.icns", "licenses/LICENSE.electron.txt", "licenses/LICENSES.chromium.html"]) assert(existsSync(path.join(resources, file)), `Resources/${file}`);
  const { listPackage, extractFile } = await import("@electron/asar");
  const asarFiles = listPackage(path.join(resources, "app.asar")).map((f) => f.replaceAll("\\", "/"));
  for (const file of ["/package.json", "/dist/main.cjs", "/dist/preload.cjs", "/dist/player/index.html", "/dist/player/player.js", "/dist/scene/index.html", "/dist/scene/scene.js", "/dist/guides/start-here.md", "/dist/examples/README.md", "/dist/examples/16-placemark-deck/design/capture.json"]) assert(asarFiles.includes(file), `app.asar${file}`, asarFiles.slice(0, 20));
  assert(!asarFiles.some((f) => f.startsWith("/node_modules/") || f.endsWith(".map")), "no node_modules or source maps in app.asar", asarFiles.filter((f) => f.startsWith("/node_modules/")).slice(0, 5));
  const under = (dir) => readdirSync(path.join(resources, dir), { recursive: true }).map((f) => String(f).replaceAll("\\", "/"));
  const editorMaps = under("editor").filter((f) => f.endsWith(".map"));
  assert(editorMaps.length === 0, "no source maps under Resources/editor (a release keeps them in Sonobe-<version>-sourcemaps.tar.gz)", editorMaps.slice(0, 5));
  assert(!existsSync(path.join(resources, "default_app.asar")), "no default_app.asar in Resources (Electron's placeholder app)");
  // The CLI is one bundled file. A native module beside it would have to be built and signed per architecture.
  const cliExtras = under("cli").filter((f) => f.split("/").includes("node_modules") || f.endsWith(".node"));
  assert(cliExtras.length === 0, "no node_modules or native modules under Resources/cli", cliExtras.slice(0, 5));
  const notices = readFileSync(path.join(resources, "licenses", "THIRD-PARTY-NOTICES.txt"), "utf8");
  // ajv is in none of Sonobe's package.json files: the MCP SDK carries it inside its own published files.
  for (const name of ["react", "elkjs", "zod", "ws", "ajv"]) assert(new RegExp(`^${name} \\d.*\\nLicense: \\S`, "m").test(notices), `licenses/THIRD-PARTY-NOTICES.txt lists ${name} with its license`);
  const unlicensed = [...notices.matchAll(/^(\S+).*\nLicense: UNKNOWN$/gm)].map((match) => match[1]);
  assert(unlicensed.length === 0, "every package in licenses/THIRD-PARTY-NOTICES.txt has a license (scripts/build.mjs warns about one it couldn't read)", unlicensed);
  log(`app.asar holds ${asarFiles.length} entries; editor (no source maps), CLI, guides and licenses are in Resources`);

  // What this build can do with an update, as the app reads it (scripts/signing.ts).
  const recorded = JSON.parse(extractFile(path.join(resources, "app.asar"), "package.json").toString("utf8")).sonobe;
  let signature = null;
  let notarized = false;
  let runnable = true;
  if (mac) {
    // Info.plist.
    const plist = JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", path.join(appPath, "Contents", "Info.plist")], { encoding: "utf8" }));
    assert(/Camera patch/.test(plist.NSCameraUsageDescription ?? "") && !/^This app needs/.test(plist.NSCameraUsageDescription), "NSCameraUsageDescription is Sonobe's wording, not Electron's", plist.NSCameraUsageDescription);
    assert(/Microphone patch/.test(plist.NSMicrophoneUsageDescription ?? "") && !/^This app needs/.test(plist.NSMicrophoneUsageDescription), "NSMicrophoneUsageDescription is Sonobe's wording, not Electron's", plist.NSMicrophoneUsageDescription);
    assert(plist.CFBundleShortVersionString === pkg.version, "CFBundleShortVersionString", plist.CFBundleShortVersionString);
    assert(Object.keys(plist.ElectronAsarIntegrity ?? {}).join() === "Resources/app.asar", "ElectronAsarIntegrity lists app.asar alone", plist.ElectronAsarIntegrity);
    const locales = readdirSync(path.join(appPath, "Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Resources")).filter((f) => f.endsWith(".lproj"));
    assert(locales.join() === "en.lproj", "the Electron framework carries English only", locales.slice(0, 8));
    log(`Info.plist: ${plist.CFBundleIdentifier} ${plist.CFBundleShortVersionString}, macOS ${plist.LSMinimumSystemVersion} or later, Sonobe's camera and microphone wording`);

    // The signature: codesign's own check, then what it was signed with and what it may do.
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "pipe" });
    signature = readSignature(run("codesign", ["-dv", "--verbose=4", appPath]).text);
    const signed = signature.kind === "adhoc" ? "ad-hoc" : `"${signature.authority}"`;
    // The entitlements are the committed files' (build/), plus library validation off for an ad-hoc signature only.
    const expected = (file) => [...entitlementKeys(readFileSync(path.join(root, "build", file), "utf8")), ...(signature.kind === "adhoc" ? [DISABLE_LIBRARY_VALIDATION] : [])].sort();
    const helper = path.join(resources, "bin", "sfsymbol");
    assert(existsSync(helper), "Resources/bin/sfsymbol (the SF Symbols helper; build.mjs needs Xcode's command line tools)", helper);
    assert(!asarFiles.some((f) => f.startsWith("/dist/bin/")), "no SF Symbols helper inside app.asar");
    const frameworks = path.join(appPath, "Contents", "Frameworks");
    const inside = [...readdirSync(frameworks).filter((f) => f.endsWith(".app")).map((f) => path.join(frameworks, f)), helper];
    assert(inside.length === 5, "the four Electron helper apps", inside.map((f) => path.basename(f)));
    for (const [code, file] of [[appPath, "entitlements.mac.plist"], ...inside.map((f) => [f, "entitlements.mac.inherit.plist"])]) {
      const name = path.relative(path.dirname(appPath), code);
      assert(readSignature(run("codesign", ["-dv", "--verbose=4", code]).text).hardened, `${name} is signed with the hardened runtime`);
      const keys = entitlementKeys(execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", code], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).sort();
      for (const key of ["com.apple.security.cs.allow-jit", "com.apple.security.device.camera", "com.apple.security.device.audio-input"]) assert(keys.includes(key), `${name} has the ${key} entitlement`, keys);
      assert(keys.join() === expected(file).join(), `${name} has the entitlements of build/${file}${signature.kind === "adhoc" ? " plus library validation off" : ""}, and no others`, keys);
    }
    log(`codesign --verify passes: signed ${signed}${signature.teamId ? ` (team ${signature.teamId})` : ""}, hardened runtime, ${expected("entitlements.mac.plist").length} entitlements on the app, its helpers and sfsymbol`);

    // A Developer ID build is what other people get: Gatekeeper must accept it, with its ticket stapled.
    if (signature.kind === "developer-id") {
      assert(signature.teamId, "a Developer ID signature names its team (TeamIdentifier)");
      // Notarization requires it, and without it the signature stops being valid when the certificate expires.
      if (values.release) assert(signature.timestamped, "a release's signature carries Apple's secure timestamp (codesign -dv prints Timestamp=)");
      const assessed = run("spctl", ["--assess", "--type", "execute", "-vv", appPath]);
      const gatekeeper = readAssessment(assessed.text);
      const stapled = run("xcrun", ["stapler", "validate", appPath]).status === 0;
      // codesign's own notarization check, for a Mac whose Gatekeeper is switched off (spctl accepts anything there).
      const meetsRequirement = run("codesign", ["--verify", "-R=notarized", "--check-notarization", appPath]).status === 0;
      notarized = stapled && meetsRequirement && (gatekeeper.gatekeeperOff || (assessed.status === 0 && gatekeeper.accepted && gatekeeper.source === "Notarized Developer ID"));
      if (notarized) log(`notarized: ${gatekeeper.gatekeeperOff ? "Gatekeeper is off on this Mac, so codesign checked the notarization requirement instead" : `Gatekeeper accepts it (${gatekeeper.source})`}; the ticket is stapled`);
      else if (values.release) assert(false, "a release is notarized: Gatekeeper accepts it as Notarized Developer ID, with its ticket stapled", { spctl: assessed.text.trim(), stapled, meetsRequirement });
      else log(`NOT notarized (${stapled ? "ticket stapled" : "no stapled ticket"}; spctl: ${assessed.text.trim().split("\n").slice(1).join(", ") || "rejected"}): a rehearsal, not distributable`);
    }
    if (values.release) assert(signature.kind === "developer-id", `--release checks the build people download, and this one is signed ${signed}. Build it with: node scripts/package.mjs --release`);

    // The helper has every architecture the app has, and this Mac can run one of them.
    const archs = (file) => execFileSync("lipo", ["-archs", file], { encoding: "utf8" }).trim().split(/\s+/);
    const appArchs = archs(executable);
    assert(appArchs.every((slice) => archs(helper).includes(slice)), `Resources/bin/sfsymbol is built for the app's architecture (${appArchs.join(" + ")})`, archs(helper));
    runnable = appArchs.includes(process.arch === "x64" ? "x86_64" : "arm64") || (appArchs.includes("x86_64") && run("arch", ["-x86_64", "/usr/bin/true"]).status === 0);
    assert(runnable || values.static, `this Mac can run the app's architecture (${appArchs.join(" + ")}). ${appArchs.includes("x86_64") ? "It's an Intel build and Rosetta isn't installed: install it with softwareupdate --install-rosetta --agree-to-license" : "It's an Apple silicon build: check it on an Apple silicon Mac"}, or pass --static to check the bundle without launching it`);
    log(`architecture: ${appArchs.join(" + ")}, with a matching SF Symbols helper`);
  }
  const wanted = signature ? buildInfoFor(signature) : { signing: "none", updates: "notify" };
  assert(recorded?.signing === wanted.signing && recorded?.updates === wanted.updates, `package.json's sonobe field matches the signature (${JSON.stringify(wanted)})`, recorded ?? "no sonobe field");
  log(`update capability recorded in package.json: ${JSON.stringify(recorded)}`);

  const verdict = !signature ? "unsigned build" : signature.kind === "adhoc" ? "ad-hoc local build: runs on the Mac that built it" : notarized ? "Developer ID, notarized: distributable" : "signed but not notarized: a rehearsal, not distributable";
  if (values.static) {
    log(`PASS (${verdict}; static: nothing was run or launched)`);
  } else {
    if (mac) {
      // The SF Symbols helper for design imports runs from Resources/bin: a binary can't run from inside app.asar.
      const svg = execFileSync(path.join(resources, "bin", "sfsymbol"), ["heart.fill", "--size", "17", "--color", "#F24D47"], { encoding: "utf8" });
      assert(svg.startsWith("<svg") && svg.includes('fill="#F24D47"'), "Resources/bin/sfsymbol draws heart.fill as SVG", svg.slice(0, 200));
      log("Resources/bin/sfsymbol draws SF Symbols");
    }

    // The bundled CLI with the app's own runtime, which its launcher finds from where it sits in the app.
    const launcher = process.platform === "win32" ? "sonobe.cmd" : "sonobe";
    const cliVersion = execFileSync(path.join(resources, "cli", launcher), ["--version"], { encoding: "utf8", env: { ...process.env, SONOBE_NODE: "" } }).trim();
    assert(cliVersion.includes(pkg.version), "bundled CLI --version", cliVersion);
    // Then from a copy outside the checkout. Under release/, Node looks for packages in the repository's
    // node_modules above Resources/cli, so a package the bundle left out would load here and on no one else's Mac.
    const cliCopy = path.join(temp, "cli");
    cpSync(path.join(resources, "cli"), cliCopy, { recursive: true });
    const described = execFileSync(path.join(cliCopy, launcher), ["describe", "switch"], { encoding: "utf8", cwd: temp, env: { ...process.env, SONOBE_NODE: executable, ELECTRON_RUN_AS_NODE: "1" } });
    assert(/switch/i.test(described), "bundled CLI describe, from a copy outside the checkout", described.slice(0, 200));
    log(`bundled CLI runs with the app runtime (${cliVersion}), and from a copy with only its own bundle`);

    // Launch muted with isolated state. SONOBE_TEST=1 keeps secrets on the test cipher: the real one is the login
    // keychain, where a freshly built app raises a permission dialog on the person's screen.
    const home = path.join(temp, "home");
    const env = { ...process.env, SONOBE_MUTE: "1", SONOBE_HOME: home, SONOBE_USER_DATA: path.join(temp, "userData"), SONOBE_TEST: "1" };
    for (const key of ["ELECTRON_RUN_AS_NODE", "SONOBE_DEV_URL", "SONOBE_EDITOR_DIST", "SONOBE_MCP", "SONOBE_MCP_PORT", "SONOBE_LAN", "SONOBE_LAN_PORT"]) delete env[key];
    if (values["mcp-port"]) env.SONOBE_MCP_PORT = values["mcp-port"];
    // macOS reads -AppleLanguages as the app's preferred languages, as a non-English system would set them.
    app = await electron.launch({ executablePath: executable, args: ["--mute-audio", ...(values.lang && mac ? ["-AppleLanguages", `(${values.lang})`] : [])], env, timeout: 60_000 });
    app.process().stderr?.on("data", (d) => process.stderr.write(`[app] ${d}`));
    const win = await app.firstWindow();
    const pageErrors = [];
    win.on("pageerror", (err) => pageErrors.push(err.message));
    win.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });
    await win.waitForLoadState("domcontentloaded");

    const tokenFile = path.join(home, "mcp.json");
    await poll(() => existsSync(tokenFile), { message: "mcp.json" });
    const conn = JSON.parse(readFileSync(tokenFile, "utf8"));
    const reply = await health(conn.port, conn.token);
    const body = JSON.parse(reply.body);
    assert(reply.status === 200 && body.ok === true && body.version === pkg.version, "/health", reply);
    if (values["mcp-port"]) assert(String(conn.port) === values["mcp-port"], "the MCP endpoint is on --mcp-port", conn.port);
    log(`MCP endpoint ${conn.url} answers /health (version ${body.version})`);

    const state = await poll(
      () =>
        app.evaluate(({ BrowserWindow, app: electronApp }) => {
          const w = BrowserWindow.getAllWindows()[0];
          if (!w || !w.isVisible()) return null;
          return { url: w.webContents.getURL(), muted: w.webContents.isAudioMuted(), muteSwitch: electronApp.commandLine.hasSwitch("mute-audio"), packaged: electronApp.isPackaged, name: electronApp.getName(), locale: electronApp.getLocale(), preferred: electronApp.getPreferredSystemLanguages() };
        }),
      { message: "the window" },
    );
    assert(state.packaged && state.name === "Sonobe", "packaged app", state);
    assert(state.muted && state.muteSwitch, "audio muted", state);
    assert(state.url.startsWith("file:") && state.url.includes("/Resources/editor/index.html".replace("/Resources", mac ? "/Resources" : "/resources")), "loads the bundled editor", state.url);
    const host = await win.evaluate(() => ({ keys: Object.keys(window.sonobeHost ?? {}).sort(), version: window.sonobeHost?.version, language: navigator.language }));
    for (const key of ["getMcpStatus", "notifyDocumentChanged", "openExternal", "popOutViewer", "secrets"]) assert(host.keys.includes(key), `sonobeHost.${key}`, host.keys);
    assert(host.version === pkg.version, "sonobeHost.version", host.version);
    if (values.lang) log(`with the system language ${JSON.stringify(state.preferred)}: app.getLocale() is ${state.locale}, navigator.language is ${host.language}`);
    // The experimental Claude subscription is offered only from a checkout, never in a packaged build.
    const connection = await win.evaluate(async () => (await window.sonobeHost.assistant.status()).connection);
    assert(connection?.available === false && connection.subscriptionEnabled === false && connection.active === "api_key", "the Claude subscription isn't offered", connection);
    // The editor build mounts into #root; a blank window means the bundled editor threw at startup.
    const mounted = await poll(() => win.evaluate(() => (document.getElementById("root")?.childElementCount ?? 0) > 0), { timeout: 15_000, message: "the editor to mount" }).catch(() => false);
    await new Promise((r) => setTimeout(r, 1500));
    // Into the temp folder unless asked: screenshots/packaged.png is tracked, and changes only on purpose.
    const screenshot = values.screenshot ? path.resolve(values.screenshot) : path.join(temp, "packaged.png");
    mkdirSync(path.dirname(screenshot), { recursive: true });
    await win.screenshot({ path: screenshot });
    assert(mounted, "the bundled editor renders (#root has content)", pageErrors.length ? pageErrors.slice(0, 5).join("\n  ") : "no page errors reported");
    log(`window loads and renders the bundled editor; sonobeHost v${host.version}; the Claude subscription isn't offered${values.screenshot ? `; screenshot → ${values.screenshot}` : ""}`);

    await app.close();
    app = null;
    await poll(() => !existsSync(tokenFile), { timeout: 5000, message: "mcp.json removal" });
    log("quit cleanly (mcp.json removed)");
    log(`PASS (${verdict})`);
  }
} catch (err) {
  failed = true;
  console.error(`[verify] FAIL: ${err?.stack ?? err}`);
  try {
    await app?.close();
  } catch {
    app?.process()?.kill("SIGKILL");
  }
} finally {
  // Launching registered this build with LaunchServices as an owner of .sonobe files, under the same bundle id
  // as an installed Sonobe. Take it out again, before a DMG's mount point disappears.
  if (mac && appPath) spawnSync(lsregister, ["-u", appPath], { stdio: "ignore" });
  if (mountPoint) {
    try {
      execFileSync("hdiutil", ["detach", mountPoint], { stdio: "pipe" });
    } catch {
      execFileSync("hdiutil", ["detach", "-force", mountPoint], { stdio: "pipe" });
    }
  }
  if (!failed) rmSync(temp, { recursive: true, force: true });
  else {
    writeFileSync(path.join(temp, "FAILED"), "");
    console.error(`[verify] temp files kept at ${temp}`);
  }
  process.exitCode = failed ? 1 : 0;
}
