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
| `scripts/` | `build.mjs`, `sfsymbol.ts`, `icons.mjs`, `package.mjs`, `verify-package.mjs` |

## Scripts

Run these from the repository root with `-w @sonobe/desktop`, or from this folder.

| Command | Does |
| --- | --- |
| `npm run build` | Bundles main, preload, player, scene renderer and the `sonobe` CLI into `dist/`, and on macOS compiles `dist/bin/sfsymbol` (needs Xcode's command line tools; cached after the first build) |
| `npm run start` | Builds and launches against `apps/editor/dist` (or `SONOBE_DEV_URL`) |
| `npm test` | Unit and integration tests (`electron/**/*.test.ts`) |
| `npm run smoke` | Muted end-to-end Electron run: host API, MCP loop, phone preview, pop-out viewer |
| `npm run smoke:import` | Muted design import run against a local dev server: `import_design` by URL and HTML, the Import dialog bridge, and pasting a capture (build the editor and shell first) |
| `npm run smoke:drafts` | Muted run that kills the app with SIGTERM and SIGKILL, crashes its renderer, and recovers the unsaved work each time; then `save_document({ path })` and Don't Save (build the editor and shell first) |
| `npm run icons` | Rasterizes `assets/brand/sonobe-mark.svg` into `build/icon.icns`, `icon.ico`, `icons/` |
| `npm run package` | Unsigned local build: editor, bundles, icons, then electron-builder into `release/` |
| `npm run package:verify` | Launches the packaged app muted and checks `/health`, the editor, and the CLI (`--dmg` checks the app inside the DMG) |

## Host API additions

- `notifyDocumentChanged(revision)`: the editor reports each new revision. Players stop polling and follow pushes, and MCP clients get `resources/updated` for `sonobe://documents/<docId>/outline` and `…/diagnostics`.
- `notifyPrototypeRestarted()`: the editor's prototype restarted. Players showing that window's document (phones, the pop-out viewer) restart too, after any revision they don't have yet.
- `secrets.status/get/set/delete`: small secrets such as the in-app assistant's API key, encrypted with the OS keychain in `userData/secrets.json` (0600). On Linux without a keyring, `set` refuses. `SONOBE_TEST=1` swaps in a reversible test cipher so automated runs never touch the keychain.
- `openExternal(url)`: http(s) and mailto only.
- `popOutViewer({ alwaysOnTop })`, `closeViewerWindow()`, `getViewerWindowStatus()`, `onViewerWindowStatus(cb)`: the live prototype in its own sandboxed window, served from a loopback-only player server. It has no host API.
- Phone preview: `getPreviewStatus`, `startPreview`, `stopPreview`, `onPreviewStatus`.
- `drafts.write/remove/list/read/reveal`: drafts of unsaved work, one project folder each in `userData/Drafts`. A window claims the drafts it writes or reads; `list` returns the ones nobody claims. Failures come back as `{ ok: false, code, message }` because the context bridge drops Error properties.
- `readProjectIfExists(dir)`: `readProject`, but null for a folder that doesn't exist yet (a Save As target).

## Packaging

`npm run package -w @sonobe/desktop` builds for this machine's platform and architecture with the locally installed Electron. On an Apple silicon Mac that's `release/Sonobe-<version>-mac-arm64.dmg` plus `release/mac-arm64/Sonobe.app`. `--arch x64` downloads that Electron, `--dir` skips the installer, and `--skip-editor-build` reuses `apps/editor/dist`.

Local builds are ad-hoc signed (`mac.identity: "-"`) with hardened runtime off. That's enough to run on your own Mac but not to distribute. For distribution, set a Developer ID identity, turn on `hardenedRuntime`, and notarize.

The app ships the CLI in `Resources/cli`. `Resources/cli/sonobe` runs `sonobe.mjs` with the app's own runtime in Node mode, so no separate Node install is needed. For example, `/Applications/Sonobe.app/Contents/Resources/cli/sonobe mcp` is the stdio relay Claude Desktop can launch.

On macOS the app also ships `Resources/bin/sfsymbol`, outside app.asar so it can run. Design imports use it to draw `<svg data-sf-symbol>` placeholders as real SF Symbols (macOS 13 or later), and the bundled CLI points headless servers at it through `SONOBE_SFSYMBOL`. Try it by hand: `sfsymbol heart.fill --size 17 --weight semibold --color '#FF3B30'` prints the SVG, and `sfsymbol --list` prints every name.
