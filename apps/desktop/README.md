# @sonobe/desktop

The Electron shell around the editor: windows, native menus, project files, the MCP endpoint Claude connects to, the phone preview and pop-out viewer, and packaging.

| Path | What's there |
| --- | --- |
| `electron/main.ts` | Lifecycle, windows, IPC, the MCP endpoint, phone preview, pop-out viewer, simulation frames |
| `electron/preload.ts`, `electron/host-api.d.ts` | `window.sonobeHost`, the API the editor uses |
| `electron/app-host.ts` | The `SonobeHost` MCP tools run against, bridged to the editor's RPC handlers |
| `electron/commands.ts`, `electron/menu.ts` | Menu commands and accelerators (checked against the editor's shortcuts) |
| `electron/secrets.ts` | Keychain-backed secrets (Electron `safeStorage`) |
| `player/` | The web player for phones and the pop-out viewer |
| `scene/` | A hidden page that draws simulation frames for `get_screenshot({ simId })` |
| `scripts/` | `build.mjs`, `icons.mjs`, `package.mjs`, `verify-package.mjs` |

## Scripts

Run these from the repository root with `-w @sonobe/desktop`, or from this folder.

| Command | Does |
| --- | --- |
| `npm run build` | Bundles main, preload, player, scene renderer and the `sonobe` CLI into `dist/` |
| `npm run start` | Builds and launches against `apps/editor/dist` (or `SONOBE_DEV_URL`) |
| `npm test` | Unit and integration tests (`electron/**/*.test.ts`) |
| `npm run smoke` | Muted end-to-end Electron run: host API, MCP loop, phone preview, pop-out viewer |
| `npm run smoke:import` | Muted design import run against a local dev server: `import_design` by URL and HTML, the Import dialog bridge, and pasting a capture (build the editor and shell first) |
| `npm run icons` | Rasterizes `assets/brand/sonobe-mark.svg` into `build/icon.icns`, `icon.ico`, `icons/` |
| `npm run package` | Unsigned local build: editor, bundles, icons, then electron-builder into `release/` |
| `npm run package:verify` | Launches the packaged app muted and checks `/health`, the editor, and the CLI (`--dmg` checks the app inside the DMG) |

## Host API additions

- `notifyDocumentChanged(revision)`: the editor reports each new revision. Players stop polling and follow pushes, and MCP clients get `resources/updated` for `sonobe://documents/<docId>/outline` and `…/diagnostics`.
- `secrets.status/get/set/delete`: small secrets such as the in-app assistant's API key, encrypted with the OS keychain in `userData/secrets.json` (0600). On Linux without a keyring, `set` refuses. `SONOBE_TEST=1` swaps in a reversible test cipher so automated runs never touch the keychain.
- `openExternal(url)`: http(s) and mailto only.
- `popOutViewer({ alwaysOnTop })`, `closeViewerWindow()`, `getViewerWindowStatus()`, `onViewerWindowStatus(cb)`: the live prototype in its own sandboxed window, served from a loopback-only player server. It has no host API.
- Phone preview: `getPreviewStatus`, `startPreview`, `stopPreview`, `onPreviewStatus`.

## Packaging

`npm run package -w @sonobe/desktop` builds for this machine's platform and architecture with the locally installed Electron. On an Apple silicon Mac that's `release/Sonobe-<version>-mac-arm64.dmg` plus `release/mac-arm64/Sonobe.app`. `--arch x64` downloads that Electron, `--dir` skips the installer, and `--skip-editor-build` reuses `apps/editor/dist`.

Local builds are ad-hoc signed (`mac.identity: "-"`) with hardened runtime off. That's enough to run on your own Mac but not to distribute. For distribution, set a Developer ID identity, turn on `hardenedRuntime`, and notarize.

The app ships the CLI in `Resources/cli`. `Resources/cli/sonobe` runs `sonobe.mjs` with the app's own runtime in Node mode, so no separate Node install is needed. For example, `/Applications/Sonobe.app/Contents/Resources/cli/sonobe mcp` is the stdio relay Claude Desktop can launch.
