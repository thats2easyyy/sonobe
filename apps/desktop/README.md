# @sonobe/desktop

The Electron shell around the editor: windows, native menus, project files, the MCP endpoint Claude connects to, the phone preview and pop-out viewer, and packaging.

| Path | What's there |
| --- | --- |
| `electron/main.ts` | Lifecycle, windows, IPC, the MCP endpoint, phone preview, pop-out viewer, simulation frames |
| `electron/boot.ts`, `electron/compile-cache.ts` | The app's entry: it turns on Node's compile cache in the data folder, then loads the main bundle |
| `electron/preload.ts`, `electron/host-api.d.ts` | `window.sonobeHost`, the API the editor uses |
| `electron/app-host.ts` | The `SonobeHost` MCP tools run against, bridged to the editor's RPC handlers |
| `electron/rpc.ts` | Main's calls into the editor page. Calls a reloading or crashed page hadn't answered fail at once (`page_gone`, MCP `editor_reloaded`), and new calls wait for the next page's handlers |
| `electron/lan-preview.ts` | The phone preview server: the player page and its CSP, and the WebSocket that streams revisions and restarts |
| `electron/commands.ts`, `electron/menu.ts` | Menu commands and accelerators (checked against the editor's shortcuts) |
| `electron/secrets.ts` | Keychain-backed secrets (Electron `safeStorage`) |
| `electron/design-capture.ts`, `electron/symbols.ts` | Design import's hidden capture window, and the SF Symbols it draws on macOS |
| `electron/drafts.ts` | Drafts of unsaved work in `userData/Drafts`, their IPC, and quitting on SIGTERM, SIGINT or SIGHUP |
| `native/sfsymbol/` | `sfsymbol`, a small Swift program that draws SF Symbols as SVG for design imports |
| `player/` | The web player for phones and the pop-out viewer: the editor viewer's platform services, the phone's device info, the three-finger menu and the Sonobe Viewer bridge |
| `scene/` | A hidden page that draws simulation frames for `get_screenshot({ simId })` |
| `scripts/` | `build.mjs`, `cli-launchers.ts`, `sfsymbol.ts`, `notices.ts`, `icons.mjs`, `package.mjs`, `signing.ts`, `verify-package.mjs` |

## Scripts

Run these from the repository root with `-w @sonobe/desktop`, or from this folder.

| Command | Does |
| --- | --- |
| `npm run build` | Bundles main and its entry (`boot.cjs`, package.json's `main`, which turns on Node's compile cache and loads `main.cjs`), preload, the updater (`updater.cjs`, loaded on the first update check), player, scene renderer and the `sonobe` CLI with its relay (`cli/sonobe.mjs`, `cli/relay.mjs` and the launchers) into `dist/`, and on macOS compiles `dist/bin/sfsymbol` (needs Xcode's command line tools; cached after the first build; `--arch arm64`, `x64` or `universal` picks its architecture) |
| `npm run start` | Builds and launches against `apps/editor/dist` (or `SONOBE_DEV_URL`) |
| `npm test` | Unit and integration tests (`electron/**/*.test.ts`) |
| `npm run smoke` | Muted end-to-end Electron run: host API, MCP loop, phone preview, pop-out viewer |
| `npm run smoke:import` | Muted design import run against a local dev server: `import_design` by URL and HTML, the Import dialog bridge, and pasting a capture (build the editor and shell first) |
| `npm run smoke:drafts` | Muted run that kills the app with SIGTERM and SIGKILL, crashes its renderer, and recovers the unsaved work each time (once by opening the draft's folder, as Finder would); then `save_document({ path })` and Don't Save; then Restart to Update with a stand-in updater: Cancel, Keep Draft, and the launch that reopens the work; then Quit with an unsaved change: Cancel, and Don't Save, which ends the app (build the editor and shell first) |
| `npm run rehearse:update -- --identity "<name>"` | An update between two real builds of this version and the next, signed with that keychain certificate, from a local feed: the check, the download, Restart to Update with unsaved work and a connected Claude session, install on quit, notify, and a download macOS refuses. By hand, before a release (CONTRIBUTING.md, "Rehearse an update") |
| `npm run bench:startup` | Times the packaged app's launch, by hand: several isolated, muted launches per scenario (no argument, with a project, a first launch) of a copy whose entry loads a recording hook first, and the timeline as median [min-max] from the spawn. `--baseline <Sonobe.app>` launches an earlier build in turns with it and prints the difference of each pair; `--cli` adds `sonobe --version` and the `sonobe mcp` relay; `--dev` times the checkout (CONTRIBUTING.md, "Measuring startup") |
| `npm run icons` | Rasterizes `assets/brand/sonobe-mark.svg` into `build/icon.icns`, `icon.ico`, `icons/` |
| `npm run package` | A local build: editor, bundles, icons, then electron-builder into `release/`, ad-hoc signed on macOS. `--identity` and `--release` build signed ones (see Packaging) |
| `npm run package:verify` | Checks the packaged app: its files, signature and entitlements, then a muted launch that checks `/health`, the editor, and the CLI (`--dmg` checks the app inside the DMG; see Checking a package) |

## Host API additions

- `notifyDocumentChanged(revision)`: the editor reports each new revision. Players stop polling and follow pushes, and MCP clients get `resources/updated` for `sonobe://documents/<docId>/outline` and `…/diagnostics`.
- `muted`: true when the app runs with `SONOBE_MUTE`, so the editor speaks silently too (system speech plays past the window's audio mute).
- `notifyPrototypeRestarted()`: the editor's prototype restarted, or it opened another document in the window. Players showing that window's document (phones, the pop-out viewer) restart too, after any revision they don't have yet.
- `secrets.status/set/delete`: small secrets such as the in-app assistant's API key, encrypted with the OS keychain in `userData/secrets.json` (0600). The renderer can't read a secret back; only the main process does. On Linux without a keyring, `set` refuses. `SONOBE_TEST=1` swaps in a reversible test cipher so automated runs never touch the keychain.
- `openExternal(url)`: http(s) and mailto only.
- `popOutViewer({ alwaysOnTop })`, `closeViewerWindow()`, `getViewerWindowStatus()`, `onViewerWindowStatus(cb)`: the live prototype in its own sandboxed window, served from a loopback-only player server. It has no host API. While it's open, the editor mutes its own viewer, so the window plays the sound.
- Phone preview: `getPreviewStatus`, `startPreview`, `stopPreview`, `onPreviewStatus`.
- `drafts.write/remove/list/read/release/reveal`: drafts of unsaved work, one project folder each in `userData/Drafts`. A window claims the drafts it writes or reads, and `release` gives back one it read but couldn't use; `list` returns the ones nobody claims. Failures come back as `{ ok: false, code, message }` because the context bridge drops Error properties.
- `readProjectIfExists(dir)`: `readProject`, but null for a folder that doesn't exist yet (a Save As target).
- `updates.status/check/restart/setAutoCheck/moveToApplications/onStatus`: whether a newer version exists and what this copy can do about it (`UpdateStatus`: the mode, the state, the version, progress, an error with a hint). `status`, `check` and `setAutoCheck` wait until updates have started, a second after the first window is shown. `restart()` answers at once (false while nothing is ready): it closes every window through its unsaved-changes prompt before the updater quits the app, and resolves false when the person cancelled. While a window subscribes with `onStatus`, its notices answer Check for Updates…; otherwise the host shows a native dialog. In a checkout `status()` is `mode: "off"`.
- `reopening`: true in the window that opens again what was open before a restart for an update.

## Packaging

`npm run package -w @sonobe/desktop` builds for this machine's platform and architecture with the locally installed Electron. On an Apple silicon Mac that's `release/Sonobe-<version>-mac-arm64.dmg` plus `release/mac-arm64/Sonobe.app`. `--arch x64` downloads that Electron, `--arch arm64,x64` builds both in one run, `--dir` skips the installer, `--skip-editor-build` reuses `apps/editor/dist`, and `--out <dir>` builds somewhere other than `release/` (never with `--release`).

`scripts/package.mjs` decides how the app is signed (`scripts/signing.ts`), and `electron-builder.yml` sets none of it:

| Build | Command | Signing |
| --- | --- | --- |
| Local (the default) | `npm run package` | Ad-hoc. It runs on the Mac that built it, needs no credentials, and ignores any in the shell |
| Rehearsal | `node scripts/package.mjs --identity "<name>"` | A certificate from your keychain, by enough of its name to match it alone. Not notarized, and every file is named `-rehearsal`: for trying an update between two signed builds, never for other people |
| Release | `node scripts/package.mjs --release` | A Developer ID Application certificate, notarized. It stops before building when there's no such certificate (in the keychain, or in `CSC_LINK` with `CSC_KEY_PASSWORD`) or no complete notarization credentials (`APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`; or `APPLE_KEYCHAIN_PROFILE`; or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`). It never falls back to another certificate, and it also refuses `--dir`, `--skip-editor-build`, a failed editor build and a missing SF Symbols helper |

Every build is signed with the hardened runtime and the entitlements in `build/entitlements.mac.plist` (JIT, camera, microphone) and `build/entitlements.mac.inherit.plist` (the helpers and everything else inside the app). A local build adds `disable-library-validation`, which an ad-hoc signature needs under the hardened runtime. It is ad-hoc whatever your keychain holds: electron-builder would take a certificate with a hyphen in its name (`gdb-cert`) for the ad-hoc identity `-`, so `package.mjs` signs a local build itself. After electron-builder signs, the script reads the signature back and stops if it isn't the one that build asked for, before any DMG or zip is made.

A release or rehearsal builds, for each architecture, a DMG and the zip an update downloads, with the zips' blockmaps and one `latest-mac.yml` that lists them all. A release builds arm64 and x64 by default; a rehearsal builds this Mac's architecture unless you pass `--arch arm64,x64`. Both architectures come from one run, because a second run would overwrite the feed. It also writes `Sonobe-<version>-sourcemaps.tar.gz`: the editor's and the app's source maps, which no build carries inside the app. Nothing is published from here; `electron-builder.yml`'s `publish` block only names where releases live. `.github/workflows/release.yml` runs the release build on a version tag, verifies it, and drafts the GitHub release ([CONTRIBUTING.md](../../CONTRIBUTING.md#releasing)).

The packaged `package.json` (inside app.asar) records what the build can do with an update, as `sonobe: { signing, updates }`: `"updates": "install"` for a build signed with a certificate, and `"notify"` for an ad-hoc one, which macOS won't let an update replace. Its name is `sonobe`, so a downloaded update waits in `sonobe-updater` under the user's caches.

A rehearsal takes two more flags, for the two versions an update is tried between. `--version 0.1.1` is the version the build claims to be instead of the tree's. `--launch-env SONOBE_NAME=value` (once per variable) sets it in the app's Info.plist, because macOS opens an updated app without the environment of the one it replaced; a build made with it refuses to start without those variables, so it never runs on your own Sonobe data.

### Checking a package

`npm run package:verify -w @sonobe/desktop` checks the app in `release/` for this machine's architecture. It never touches your settings, your keychain or a running Sonobe: the launch is muted, has its own user data and `SONOBE_HOME`, and runs with `SONOBE_TEST=1` and `SONOBE_UPDATES=off` (it asks no update feed), and afterwards the build is unregistered from LaunchServices so it doesn't become the app that opens `.sonobe` files.

It reads the bundle first, then runs it:

- **Files.** No source maps in `Resources/editor` or app.asar, no `default_app.asar`, nothing native beside the CLI, and the license files with the notices, where every package has a license.
- **Info.plist.** The camera and microphone wording is Sonobe's, and only Chromium's English locale ships.
- **Signature.** `codesign --verify --deep --strict`, the hardened runtime flag, and exactly the entitlements of `build/` on the app, its four helpers and `sfsymbol` (an ad-hoc build also has `disable-library-validation`; no other build may).
- **Update capability.** The packaged `package.json`'s `sonobe` field matches the real signature.
- **A Developer ID build** must be notarized: Gatekeeper accepts it as "Notarized Developer ID" and the ticket is stapled. Without `--release` a build that isn't is reported as a rehearsal; with `--release` it fails, and so does any build without a Developer ID signature or without Apple's secure timestamp.
- **Running it.** `sfsymbol` draws a symbol, the bundled CLI answers with the app's own runtime, and again from a copy outside the checkout (under `release/` it could load a package from the repository's `node_modules` that the bundle left out), and the app launches, shows the editor, answers `/health` and quits cleanly.
- **The relay.** `Resources/cli/relay.mjs` is under 64 KB. `sonobe mcp` says how to start the app and exits 1 when none is running, and against the launched app it answers `initialize` and exits 0 when stdin closes. The CLI's own compile cache lands in `compile-cache/cli-<version>` under the launch's `SONOBE_HOME`.
- **Compile cache.** The entry is `dist/boot.cjs`, the launch leaves `main.cjs`'s compiled code in `compile-cache/app-<version>` under the data folder, and `codesign --verify` still passes afterwards: nothing is written inside the app. A second launch with nowhere to keep a cache starts all the same.

| Flag | Does |
| --- | --- |
| `--dmg` | Mounts the DMG read-only and checks the app inside |
| `--app <path>` | Checks any `Sonobe.app` |
| `--arch x64` | Checks the other architecture's app or DMG in `release/` (`arm64`, `x64` or `universal`) |
| `--release` | Fails unless the build is Developer ID signed and notarized |
| `--static` | Reads the bundle and runs nothing from it, for an Intel build on a Mac without Rosetta |
| `--lang de` | Launches as if the system language were German and prints the locales the app ends up with |
| `--mcp-port <n>` | A fixed MCP port for the launch; otherwise the app picks a free one |
| `--screenshot <path>` | Where the window's screenshot goes. Without it nothing is kept, so `screenshots/packaged.png` changes only when you pass its path |

### What's inside

The app ships the CLI in `Resources/cli`. `Resources/cli/sonobe` runs it with the app's own runtime in Node mode, so no separate Node install is needed. For example, `/Applications/Sonobe.app/Contents/Resources/cli/sonobe mcp` is the stdio relay Claude Desktop can launch. For exactly `sonobe mcp` the launcher runs `relay.mjs`, the relay alone in 17 KB, because every Claude session keeps one running; everything else runs `sonobe.mjs`, the whole CLI, with Node's compile cache in `~/.sonobe/compile-cache/cli-<version>` (`SONOBE_HOME` moves it, and a `NODE_COMPILE_CACHE` of your own is left alone). The app removes the caches of other versions when it launches. The build always bundles it from `packages/cli/src`, without the native headless screenshot renderer: `get_screenshot` on a `--headless` server started from the app's CLI says to open the project in the app.

On macOS the app also ships `Resources/bin/sfsymbol`, outside app.asar so it can run. Design imports use it to draw `<svg data-sf-symbol>` placeholders as real SF Symbols (macOS 13 or later), and the bundled CLI points headless servers at it through `SONOBE_SFSYMBOL`. It is built for the architecture being packaged, and as one file with both slices when a run builds more than one. Try it by hand: `sfsymbol heart.fill --size 17 --weight semibold --color '#FF3B30'` prints the SVG, and `sfsymbol --list` prints every name.

`Resources/licenses` holds Sonobe's license (`LICENSE.txt`), `THIRD-PARTY-NOTICES.txt` with the license of every npm package bundled into the app, the editor and the CLI, and on macOS Electron's `LICENSE.electron.txt` and `LICENSES.chromium.html`. `build.mjs --licenses` writes the first two, `package.mjs` adds Electron's from the Electron it packages (a fresh install has none in `node_modules` until Electron first runs), and `scripts/notices.ts` takes the package list from esbuild's metafiles and the editor build's source maps. Some packages carry others inside their own published files (the MCP SDK carries ajv); the source maps they ship name those, and each is listed with the license text of the copy installed in the checkout. The build warns when one isn't installed, and package verification fails on a notice without a license.

On macOS the app ships Chromium's English locale only, asks for the camera and the microphone in Sonobe's own words (`mac.extendInfo`), and needs macOS 13 or later, which is Electron's own floor.
