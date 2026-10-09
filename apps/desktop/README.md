# @sonobe/desktop

The Electron shell around the editor: windows, native menus, project files, the MCP endpoint Claude connects to, the phone preview and pop-out viewer, and packaging.

| Path | What's there |
| --- | --- |
| `electron/main.ts` | Lifecycle, windows, IPC, the MCP endpoint, phone preview, pop-out viewer, simulation frames |
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
| `scripts/` | `build.mjs`, `sfsymbol.ts`, `icons.mjs`, `package.mjs`, `signing.ts`, `verify-package.mjs` |

## Scripts

Run these from the repository root with `-w @sonobe/desktop`, or from this folder.

| Command | Does |
| --- | --- |
| `npm run build` | Bundles main, preload, player, scene renderer and the `sonobe` CLI into `dist/`, and on macOS compiles `dist/bin/sfsymbol` (needs Xcode's command line tools; cached after the first build; `--arch arm64`, `x64` or `universal` picks its architecture) |
| `npm run start` | Builds and launches against `apps/editor/dist` (or `SONOBE_DEV_URL`) |
| `npm test` | Unit and integration tests (`electron/**/*.test.ts`) |
| `npm run smoke` | Muted end-to-end Electron run: host API, MCP loop, phone preview, pop-out viewer |
| `npm run smoke:import` | Muted design import run against a local dev server: `import_design` by URL and HTML, the Import dialog bridge, and pasting a capture (build the editor and shell first) |
| `npm run smoke:drafts` | Muted run that kills the app with SIGTERM and SIGKILL, crashes its renderer, and recovers the unsaved work each time (once by opening the draft's folder, as Finder would); then `save_document({ path })` and Don't Save (build the editor and shell first) |
| `npm run icons` | Rasterizes `assets/brand/sonobe-mark.svg` into `build/icon.icns`, `icon.ico`, `icons/` |
| `npm run package` | A local build: editor, bundles, icons, then electron-builder into `release/`, ad-hoc signed on macOS. `--identity` and `--release` build signed ones (see Packaging) |
| `npm run package:verify` | Launches the packaged app muted and checks `/health`, the editor, and the CLI (`--dmg` checks the app inside the DMG) |

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

## Packaging

`npm run package -w @sonobe/desktop` builds for this machine's platform and architecture with the locally installed Electron. On an Apple silicon Mac that's `release/Sonobe-<version>-mac-arm64.dmg` plus `release/mac-arm64/Sonobe.app`. `--arch x64` downloads that Electron, `--arch arm64,x64` builds both in one run, `--dir` skips the installer, and `--skip-editor-build` reuses `apps/editor/dist`.

`scripts/package.mjs` decides how the app is signed (`scripts/signing.ts`), and `electron-builder.yml` sets none of it:

| Build | Command | Signing |
| --- | --- | --- |
| Local (the default) | `npm run package` | Ad-hoc. It runs on the Mac that built it, needs no credentials, and ignores any in the shell |
| Rehearsal | `node scripts/package.mjs --identity "<name>"` | A certificate from your keychain, by enough of its name to match it alone. Not notarized, and every file is named `-rehearsal`: for trying an update between two signed builds, never for other people |
| Release | `node scripts/package.mjs --release` | A Developer ID Application certificate, notarized. It stops before building when there's no such certificate (in the keychain, or in `CSC_LINK` with `CSC_KEY_PASSWORD`) or no complete notarization credentials (`APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`; or `APPLE_KEYCHAIN_PROFILE`; or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`). It never falls back to another certificate, and it also refuses `--dir`, `--skip-editor-build`, a failed editor build and a missing SF Symbols helper |

Every build is signed with the hardened runtime and the entitlements in `build/entitlements.mac.plist` (JIT, camera, microphone) and `build/entitlements.mac.inherit.plist` (the helpers and everything else inside the app). A local build adds `disable-library-validation`, which an ad-hoc signature needs under the hardened runtime. After electron-builder signs, the script reads the signature back and stops if it isn't the one that build asked for, before any DMG or zip is made.

The app ships the CLI in `Resources/cli`. `Resources/cli/sonobe` runs `sonobe.mjs` with the app's own runtime in Node mode, so no separate Node install is needed. For example, `/Applications/Sonobe.app/Contents/Resources/cli/sonobe mcp` is the stdio relay Claude Desktop can launch. The build always bundles it from `packages/cli/src`, without the native headless screenshot renderer: `get_screenshot` on a `--headless` server started from the app's CLI says to open the project in the app.

On macOS the app also ships `Resources/bin/sfsymbol`, outside app.asar so it can run. Design imports use it to draw `<svg data-sf-symbol>` placeholders as real SF Symbols (macOS 13 or later), and the bundled CLI points headless servers at it through `SONOBE_SFSYMBOL`. It is built for the architecture being packaged, and as one file with both slices when a run builds more than one. Try it by hand: `sfsymbol heart.fill --size 17 --weight semibold --color '#FF3B30'` prints the SVG, and `sfsymbol --list` prints every name.
