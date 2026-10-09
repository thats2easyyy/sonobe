# Contributing to Sonobe

Thanks for helping make interaction prototyping open to everyone. Bug reports, patches, recipes, and guides are all welcome, whether you write the change yourself or build it with an AI assistant.

## Setup

```bash
npm install
npm run dev        # editor in the browser (http://localhost:5199)
npm run desktop    # Electron app
npm test           # unit tests (Vitest)
npm run typecheck
npm run e2e        # Playwright end-to-end tests
npm run test:ios   # Sonobe Viewer on an iOS Simulator (macOS with Xcode)
```

Node 22.18+ is required. Node 24 is what CI uses.

## Read this first

[ARCHITECTURE.md](ARCHITECTURE.md) is the contract. The most important rules:

1. **Every document change goes through `applyOps()`.** The UI, MCP tools, CLI, and scripts all use the same op engine, so every change can be undone, validated, and attributed.
2. **Declarations drive everything.** A patch type is declared once in `packages/patches/catalog/*.json`: ports, types, defaults, docs, and behavior. The runtime, inspector, picker, docs, and MCP schemas are generated from that declaration.
3. **The engine stays headless.** `@sonobe/engine` has no DOM. Anything visual belongs in `@sonobe/renderer` or `apps/editor`.
4. **Keep it deterministic.** Given the same document and the same input events, the engine must produce the same frames. Use `services.random()` and `services.now()`, never `Math.random()` or `Date.now()`, inside patches.

## Adding or fixing a patch

1. Find the entry in `packages/patches/catalog/<category>-<n>.json` and follow [CONVENTIONS.md](packages/patches/catalog/CONVENTIONS.md).
   - The `behavior` field is the implementation spec.
   - The `docs` field is what users read.
2. Implement it in `packages/patches/src/<category>/<type>.ts` with `definePatch(type, { state, evaluate })`, then add it to that category's `index.ts`.
3. Test it in `<type>.test.ts` with the harness in `@sonobe/engine/testing`. Cover pulses, loops (per-index state), and edge cases.
4. Regenerate the reference docs with `node packages/patches/scripts/generate-docs.ts`.

## Working on Sonobe Viewer (iPhone)

`apps/ios` is a small Swift app built with Xcode, not npm. It plays the web player (`apps/desktop/player`) in a WKWebView and adds a native bridge for haptics and the player menu's Open Another Prototype, so player changes reach it without Swift changes. [apps/ios/README.md](apps/ios/README.md) has the details.

- Build for the Simulator, no signing needed: `xcodebuild -project apps/ios/SonobeViewer.xcodeproj -scheme SonobeViewer -sdk iphonesimulator -derivedDataPath apps/ios/build CODE_SIGNING_ALLOWED=NO build`.
- Test with `npm run test:ios`. It serves a test prototype with the real player, runs the Swift unit and UI tests on a simulator, and checks the haptics the app played. It isn't part of CI, so run it when you change the app, the player, or the bridge.
- To run on your own iPhone, copy `apps/ios/Config/Local.xcconfig.example` to `Local.xcconfig` and set your team and a bundle id of your own. Git ignores `Local.xcconfig`. Never commit a team ID, a bundle id of your own, or other signing settings to the project.
- The bridge has two sides: `apps/desktop/player/platform.ts` and `apps/ios/SonobeViewer/Haptics.swift` (with `PlayerView.swift`, which acts on the menu's messages). Change them together, bump the bridge version when you add a message, and update ARCHITECTURE.md §9.2. A player test checks that the app's haptic types exist in the catalog.
- The app loads an `http://` preview as `sonobe-player://` through `PlayerProxy.swift`, which is what lets the page use the camera, microphone, location and motion. The player reaches its server through `syncUrl` in `player/platform.ts`; anything else in the player that needs the server's `http://` or `ws://` address has to allow for that scheme too.
- The player's other services are the editor viewer's own (`packages/renderer/src/platform.ts`), so a service added there reaches phones too. Check it against the player page's CSP in `apps/desktop/electron/lan-preview.ts`, and loosen the policy only as far as the service needs.

## Changing how patch editor nodes look

Tidy Up, MCP `tidy_graph` and `add_patches`, and automatic node placement size nodes without a DOM, from the model in `packages/core/src/graph/nodeSize.ts`, which follows `apps/editor/src/panels/patch-editor/patch-editor.css`. When you change the node CSS (padding, gaps, fonts, chips, inline values):

1. Update `NODE_BOX` or `NODE_FONTS` in `nodeSize.ts` to match, and the shapes in `nodeShape.ts` when a node shows something new. When a live value or a knob value can print something longer, raise its reserve in `format.ts` (`formatValueReserve`, `knobValueReserve`), which keeps nodes from resizing while the prototype runs; a live value past its reserve ends in "…".
2. On macOS, regenerate the font table with `node apps/editor/scripts/measure-node-fonts.ts`.
3. Run `npx playwright test e2e/node-sizes.spec.ts`. It compares the estimate against the drawn nodes. With `SONOBE_UPDATE_NODE_SIZES=1` it also rewrites `packages/mcp/fixtures/node-sizes`, which `packages/mcp/src/geometry.test.ts` checks the headless estimate against. Knob chips (`.sb-pe-value--knob`) are checked in `e2e/knobs.spec.ts`.
4. Rebuild the examples with `node examples/build.ts`. Their graphs are laid out from the estimated sizes, so wider nodes get the room they need, and `examples/run.test.ts` fails when two patch nodes come within 12 pt of each other.

## Adding an MCP tool

Claude sees a tool in several places, and tests check that they agree:

1. Register it in `packages/mcp/src/tools/` with `tc.tool(name, config, handler)`, and add its name to `TOOL_NAMES` in `packages/mcp/src/server.ts`, next to its group. Give it a description that says when to use it, annotations (read-only, destructive or UI only) and, for writes and simulation, an `outputSchema`.
2. Keep its input a closed `z.object`. The tool wrapper refuses fields a tool doesn't take, with the closest field it does (`packages/mcp/src/inputs.ts`), and `inputs.test.ts` calls every tool with a made-up field. Use `z.looseObject` or `z.record` only where values really pass through.
3. Add it to `integrations/claude-desktop/manifest.json` in `TOOL_NAMES` order, to the tool tables in `packages/mcp/README.md` and ARCHITECTURE.md §10, and to the tool count in README.md and guide 11. `integrations.test.ts` and `packages/cli/src/docs.test.ts` fail until they match.
4. Call it in `payload.test.ts`, which calls every tool once, and add it to the annotation checks in `discovery.test.ts`.
5. Teach it where Claude learns the workflow: the agent guides in `packages/mcp/guides`, the server instructions in `server.ts` when it changes the steps, and the Claude Code skill (`integrations/claude-code/skills/sonobe/SKILL.md`).

## Adding an MCP tool that can take long

Tools register in `packages/mcp/src/tools/` with `tc.tool(name, config, async (args, ctx, work) => …)`. When a call can take more than a second or two (loading a page, waiting on the person), use `work` (`packages/mcp/src/progress.ts`, ARCHITECTURE §10 "Long calls"):

1. Wrap each slow host call in a step: `work.step("Loading the page", (control) => host.captureDesign(request, control), { deadlineMs })`. The step sends its message as progress, repeats it while the host works (until the deadline), and rejects at once when the call is cancelled.
2. Pass the step's `control` on. A host method that can run long takes it as a trailing `control?: HostCallControl` argument, keeps its request plain data, reports stages with `control.progress`, and stops and frees what it holds when `control.signal` aborts. Keep the host's own deadline shorter than the step's, so its error, which says more, comes first.
3. Pass `signal: work.signal` (or `tc.signal(ctx)`) to `host.apply` and `history.undo`, so a cancelled call never changes the document. Call `work.throwIfCancelled()` between steps. In a long synchronous loop, `await work.checkpoint()` now and then.
4. Test it with a v1 SDK client: `client.callTool(params, undefined, { onprogress, resetTimeoutOnProgress: true, timeout: 500 })` for progress, and `{ signal }` to cancel. `packages/mcp/src/import.test.ts` has examples.

## Changing the in-app Assistant

The Assistant's main-process side (`apps/desktop/electron/assistant`) and the editor (`apps/editor/src/panels/assistant`, `panels/design`) talk over IPC:

1. A new request field or event goes in four places: `protocol.ts`, the editor's mirror in `panels/assistant/types.ts`, the preload (`assistant/preload.ts`) and main's sanitizer (`register.ts`, or `sanitizeCanvasContext` in `assistant/design.ts` for the canvas's context and `sanitizeSelectionContext` in `assistant/selection.ts` for the selection). The last two drop fields they don't know.
2. The Assistant's own tools (the code folder's `list_code_files`, `search_code` and `read_code_file`) aren't MCP tools: keep them out of `TOOL_NAMES`, the tool tables and the counts. An MCP tool the API-key path shouldn't have goes in `ASSISTANT_HIDDEN_TOOLS` (`toolBridge.ts`) with what it does instead, as `preview_design` does, since the canvas already draws the Assistant's `import_design` html as it streams. The bridge leaves out the instruction lines, input properties and description clauses that name it, and adds that note to a result that does (a guide). The subscription path's bridge hides nothing, because Claude Code draws through `preview_design`.
3. A new document tool takes `docId`, or goes in `UNPINNED_TOOLS` (`agent.ts`); `toolBridge.test.ts` fails until it does. Both engines call tools through `toolRunner.ts`, so pinning, the replace guard and confirmations change there once. On the subscription path, a tool that reaches outside the window's prototype goes in `ASKING_TOOLS` (`acp/engine.ts`), as `save_document`, `open_document` and `create_document` do: it stays out of the session's `allowedTools`, so Claude Code asks first, and Sonobe asks itself when Claude Code didn't.
4. The system prompt is the same for every message, and `design.test.ts` pins its hash. What a message knows about the editor goes in a block before the person's text (`<canvas_context>`, `<selection>`), never in the prompt. The chat's mentions have two halves that change together: the link shapes `SELECTION_GUIDE` (`assistant/selection.ts`) tells Claude to write, and `resolveMention` in the editor's `panels/assistant/mentions.ts`.
5. Test with fakes: `scriptedClient` and `fakeBridge` (`assistant/testing.ts`), `fakeAssistantHost` in the editor, and `e2e/fakeAssistant.ts` for Playwright. The subscription path's tests run `apps/desktop/tests/fake-claude-agent.mjs`, a fake ACP agent, in place of Claude's agent adapter, by pointing `SONOBE_CLAUDE_AGENT` at it. It calls the per-chat tool endpoint the way the adapter does, a word in the message picks what it does (`design`, `save`, `crash`, `sessionend`, `limit`, `hang` and the others its header lists), `FAKE_CLAUDE_MODE` picks the permission mode its sessions start in, and `FAKE_CLAUDE_LOG=<file>` records what it was sent. No test uses an API key, starts the real adapter or needs a Claude account.

The subscription path is experimental and off by default. Only the app run from a checkout offers its switch: `electron/main.ts` sets the connection's `available` to `!app.isPackaged`, so no packaged build, and so no release, can offer it, and no environment variable changes that ([ARCHITECTURE.md](ARCHITECTURE.md) §10). Keep that gate until Anthropic agrees. To try it on your own machine:

1. Install the adapter with `npm install -g @agentclientprotocol/claude-agent-acp` (it needs Node.js 22 or later). It draws on your Claude plan's usage limits.
2. Run the desktop app from a checkout: `npm run desktop` (or `npm run start -w @sonobe/desktop`). A DMG from `npm run package -w @sonobe/desktop` doesn't offer the switch.
3. Turn on **Use my Claude subscription in the Assistant** in Settings → Claude, and choose **Claude subscription** in the Assistant. If Claude isn't signed in, **Sign in…** opens Terminal for it, or run `claude-agent-acp --cli auth login` yourself.
4. To use another copy of the adapter, or the fake agent without a Claude account, start the app with `SONOBE_CLAUDE_AGENT` set to its absolute path.

## Measuring how well Claude builds with Sonobe

`evals/` holds behavioral evals: Claude Code gets a prompt and a start project, builds through Sonobe's MCP tools alone, and the runner simulates the result and checks layer properties. It records pass or fail, turns, tokens, time, tools, and each error code with whether Claude recovered. Runs use your Claude account, so they're not part of `npm test` or CI.

1. When you change tools, tool descriptions, guides or server instructions, run the affected cases before and after: `npm run build -w @sonobe/cli`, then `node evals/run.ts --case "retro-*" --model sonnet --runs 3`. Compare the two `summary.md` files.
2. Add a case when you fix something Claude kept getting wrong: a start project, a prompt, a `test.json` on layer properties, and a `solution.json`. `npx vitest run evals` checks that the start fails and the solution passes.

[evals/README.md](evals/README.md) has the case format and the options.

## Releasing

A release is built by `.github/workflows/release.yml` from a version tag: the macOS app for Apple silicon and Intel, signed with a Developer ID certificate and notarized. The workflow stops at a draft GitHub release. Publishing the draft is yours to do.

No release has been cut yet, and the workflow has never run: the first run is its first test. Until then the README is right to say there are no prebuilt downloads.

### Confirm before the first release

The first signed release freezes three things. Every installed copy carries them, and changing one later strands the people who already installed Sonobe: an update can't reach them, and macOS treats the new app as a different one (saved API keys, camera and microphone permission).

- **The bundle id**, `dev.sonobe.app` (`appId` in `apps/desktop/electron-builder.yml`). Keep it only if the domain behind it is yours.
- **The Apple Developer team** that owns the Developer ID certificate. macOS replaces an installed app only with one signed by the same team.
- **The release repository**, `thats2easyyy/sonobe` (the `publish` block in `apps/desktop/electron-builder.yml`). It is written into every app as the place to look for a newer version.

Two smaller things to decide before the first tag:

- **The update cache folder**, `sonobe-updater` (`~/Library/Caches/sonobe-updater` on a Mac). `Resources/app-update.yml` in every app that ships in a DMG or zip names it as `updaterCacheDirName`. electron-builder derives it from the packaged `package.json`'s name, which `scripts/package.mjs` sets to `sonobe` for that reason (`extraMetadata`); `@sonobe/desktop` would give `@sonobedesktop-updater`. It is where a downloaded update waits. Changing it later only leaves old downloads behind, but the first signed build carries it, so change it now if you want another name.
- **The DMG is not signed.** `dmg.sign` is `false`, and only the app inside is signed, notarized and stapled. Gatekeeper assesses the app when someone opens the DMG and launches it, and that is what package verification checks; the clean-Mac check below is its first real test. A tool that assesses the disk image itself (`spctl -a -t open --context context:primary-signature`) rejects an unsigned one, as some managed Macs and download scanners do. If that matters to you, sign, notarize and staple the DMG too; nothing does today.

### The checklist

1. **Set the version.** `node scripts/set-version.ts 0.2.0` writes it everywhere it lives and rebuilds the examples. It takes three plain numbers and nothing else: the update feed is stable-only, so there are no `-beta` versions.
2. **Run the checks**: `npm run typecheck`, `npm test` and `npm run e2e`. The e2e run rewrites the screenshots; keep `apps/editor/screenshots/app-13-about.png`, which shows the version, and restore the rest.
3. **Rehearse an update** on that commit (below). It must pass before the tag.
4. **Merge that change**, then tag the merge commit and push the tag: `git tag v0.2.0`, `git push origin v0.2.0`. The tag must be `v` plus the version, and the workflow refuses any other.
5. **Watch the Release workflow.** It checks the tag against the version, runs typecheck and the tests, builds with `package.mjs --release`, verifies both apps and the app inside each DMG with `verify-package.mjs --release` (the Intel ones under Rosetta), and drafts the release.
6. **Read the draft.** It must hold eight files: a DMG, a zip and the zip's `.blockmap` for `arm64` and for `x64`, one `latest-mac.yml` that lists both zips, and `Sonobe-<version>-sourcemaps.tar.gz`. Edit the generated notes.
7. **Try it on a clean Mac** (below).
8. **Publish the draft.** That makes the download public.

A release that's wrong is fixed by the next version, never by swapping its files. And never publish a release as the latest one without `latest-mac.yml` in it, for example one that carries only the Claude Desktop extension: the newest release's `latest-mac.yml` is the feed an installed app reads to find an update. Every installed app reads it a few seconds after launch and every few hours (`apps/desktop/electron/updates.ts`), so a latest release without it makes every check fail.

Keep `Sonobe-<version>-sourcemaps.tar.gz` on every release. The app ships without source maps, and a stack trace from that version can only be read with that archive.

### Rehearse an update

The updater in the first release is the one every person keeps. A release whose updater can't install the next one is fixed only by asking everyone to download Sonobe again, so the update is tried for real before the tag, on the commit you mean to tag. It needs a Mac with a signing certificate in its keychain; an Apple Development certificate is enough.

```bash
node apps/desktop/tests/update-rehearsal.mjs --identity "Apple Development: Your Name"
```

It takes about four minutes and prints one PASS or FAIL line per step. A step that fails ends its scenario, and the lines say which step was the last to pass.

- **What it builds.** This version and the next patch version as rehearsal builds signed with that certificate (`package.mjs --identity`, with `--version` and `--launch-env`), and one local ad-hoc build, all into a temp folder. No tracked file changes, and `apps/desktop/dist` is rebuilt as a normal build afterwards.
- **How it runs them.** The first build is unpacked into `<temp>/Applications`, which macOS counts as an Applications folder, and the second is served from `127.0.0.1:5250` (`SONOBE_UPDATE_FEED`). Every app is muted, has its own data folder and `SONOBE_HOME`, and uses the test cipher (`SONOBE_TEST=1`), so nothing asks for your keychain. macOS opens the updated app itself, without the first one's environment, so both signed builds carry those folders in Info.plist and refuse to start without them.
- **What it asserts.**
  - **A, install.** The installed build finds the new version by itself, no sooner than 5 s after its window shows, having loaded no updater before. It downloads with rising progress, and says ready only once macOS has staged the download. The feed is asked for `latest-mac.yml` and the zip, with no per-install id. Then, with a Claude session connected through the app's own `sonobe mcp` and an unsaved change: Restart to Update names the session and offers Save, Keep Draft or Cancel; Cancel keeps the app, the window and the ready update; Keep Draft quits, macOS installs the new version and opens it, the prototype is open again with the unsaved change, a tool call sent while the app was down was refused and not applied, your own `~/.sonobe` and data folder are untouched, and the same relay answers again.
  - **B, a normal quit.** A downloaded update goes in when the app quits and the app stays closed. The next launch says "Sonobe was updated" with its release notes, and the one after doesn't.
  - **C, notify.** The ad-hoc build says a version is available and why it can't install it, Download opens the release page, and only `latest-mac.yml` was asked for.
  - **D and F.** A signed build outside an Applications folder, and one this user can't replace, only notify and say why. The first offers the move, which is never made.
  - **E, a refused download.** The new version re-signed ad hoc downloads whole, macOS refuses it, and the state ends in failed with the release page as the way out, never in ready.
- **What it touches outside the temp folder.** `~/Library/Caches/sonobe-updater` (the download), `~/Library/Caches/dev.sonobe.app.ShipIt` and the launchd job `dev.sonobe.app.ShipIt` (macOS's installer), and `dev.sonobe.app` under `~/Library/Caches` and `~/Library/HTTPStorages` (what macOS keeps of the installer's request). The bundle id decides those names, so they are the ones an installed Sonobe uses. It refuses to start while a download or an install is waiting there, and removes what wasn't there before. Quit an installed Sonobe first. Every build is unregistered from LaunchServices afterwards, and nothing goes into `/Applications`.
- **What it doesn't show.** A Developer ID build with notarization and Gatekeeper (a rehearsal is never notarized), the real feed on GitHub, Move to Applications, an Intel Mac, Windows or Linux. The updated app is opened by macOS, not by the script, so its window is read through MCP and not looked at.

`--only A,C` runs some scenarios, `--keep` leaves the temp folder with its builds and logs, and `--reuse <folder>` runs again on what `--keep` left. `npm run rehearse:update -w @sonobe/desktop -- --identity "…"` is the same command.

Before the first Windows release, two things about updates there need deciding. Neither has run.

- **Silent update or installer pages.** The app asks for a silent install that opens Sonobe again (`quitAndInstall(true, true)`), on top of the assisted installer (`nsis.oneClick: false`). A one-click installer is the other choice.
- **Claude sessions.** The installer stops every process running from the install folder, which includes `sonobe mcp`, so a connected session has to be reconnected after an update. The restart's question says so on Windows.

### Secrets

The workflow reads five repository secrets (Settings → Secrets and variables → Actions). Only its build job sees them, and that job's token can only read the repository.

| Secret | What it is |
| --- | --- |
| `CSC_LINK` | The Developer ID Application certificate with its private key: the `.p12` file, base64-encoded |
| `CSC_KEY_PASSWORD` | The password the `.p12` was exported with |
| `APPLE_API_KEY_P8` | The text of an App Store Connect API key (the `.p8` file) |
| `APPLE_API_KEY_ID` | That key's ID |
| `APPLE_API_ISSUER` | The issuer ID shown above the list of keys |

To create them:

- **The certificate.** Only the team's Account Holder can create a Developer ID Application certificate, at developer.apple.com under Certificates. Install it, then export it with its private key from Keychain Access as a `.p12` with a password. `base64 -i DeveloperID.p12 | pbcopy` copies what `CSC_LINK` holds.
- **The notarization key.** In App Store Connect, under Users and Access → Integrations, create a team API key with Developer access. The `.p8` downloads once. Paste the file's text into `APPLE_API_KEY_P8`; the workflow writes it back to a file, because notarization takes a path.

Run the workflow by hand from a branch first (Actions → Release → Run workflow). That signs, notarizes and verifies with the real secrets, keeps the files on the run for two weeks, and makes no release.

### Building a release on your Mac

With the Developer ID certificate in your keychain, store the notarization key once and name the profile:

```bash
xcrun notarytool store-credentials sonobe-notary --key AuthKey_XXXXXXXXXX.p8 --key-id <key id> --issuer <issuer id>
APPLE_KEYCHAIN_PROFILE=sonobe-notary node apps/desktop/scripts/package.mjs --release
node apps/desktop/scripts/verify-package.mjs --release
```

`--release` never falls back. Without a Developer ID certificate, or without notarization credentials, it stops before it builds anything and says what's missing. A Mac that only has an "Apple Development" certificate is refused by name: Gatekeeper rejects that signature on every other Mac.

To try a signed build without a Developer ID, build a rehearsal: `node apps/desktop/scripts/package.mjs --identity "Apple Development"`. It is signed with that certificate and the real entitlements, isn't notarized, and names every file `-rehearsal`. It exists for trying an update between two signed builds. Don't give one to anyone.

### On a clean Mac

Use a Mac that has never built or run Sonobe, on the oldest macOS you mean to support (the app needs 13). The Intel build has never been launched anywhere: the Mac it was built on has no Rosetta, so it was only read (`verify-package.mjs --static`). Its first launch is the release workflow's Rosetta step, so try it on an Intel Mac if you can.

- Download the DMG with a browser, so macOS quarantines it. Open it, drag Sonobe into Applications and launch it. macOS asks once whether to open an app from the internet, and nothing else.
- Open a prototype that uses the Camera patch, then one that uses the Microphone patch. Each permission dialog carries Sonobe's wording, and after Allow the viewer shows the camera and hears the microphone. Under the hardened runtime a missing entitlement fails here, silently. Nobody has tried this yet in any build with the hardened runtime, a local `npm run package` build included, so try it in a local build before the first tag.
- Pop out the viewer.
- Import a design that has an SF Symbol in it: the real symbol arrives, not a gray placeholder.
- Run `/Applications/Sonobe.app/Contents/Resources/cli/sonobe --version`.
- Connect Claude, and have it read the open prototype.
- Save an API key in Settings, quit, and reopen: the key is still there. Package verification uses a test cipher, so this is the only check of the real keychain.

### What shares the version

`scripts/set-version.ts` writes the root and workspace `package.json` files and their entries in `package-lock.json`, `EDITOR_VERSION` in `apps/editor/src/app/about.ts`, `GENERATOR` in `packages/core/src/document.ts` (the stamp in every saved project, so the examples are rebuilt), and the Claude Code plugin and Claude Desktop extension manifests, which bundle this version's CLI. `packages/cli/src/versions.test.ts` fails when they disagree, and `node scripts/set-version.ts --check` lists them.

Some numbers stay their own: saved documents that record the version that wrote them (the eval cases' start projects, the node-size fixtures), the Chrome extension's manifest and the generator names in Chrome and Figma captures, Sonobe Viewer's version in Xcode, and the versions tests make up.

## UI rules

The editor should feel like a quiet, dense Mac instrument: hairline-separated dark panels in one tone family, one indigo that means "you are here" or "you can press this", Claude's coral only on things Claude wrote or is doing, and patch category colors only inside the graph. Hierarchy comes from a real size and weight ladder and from removing boxes, not from more grey, tiles or glow. Build with the kit in `apps/editor/src/ui` (open `#gallery` in the browser editor) and the tokens in `apps/editor/src/theme/tokens.css`: no hard-coded colors, no off-scale sizes, no one-off copies of a kit component. Check a change in both themes and at the 1024 × 680 minimum window.

- **Text.** Nothing is under 11px except patch editor node text (`--font-size-2xs`). Sentences, helper text, empty states and errors are 12px or larger; 11px is for row meta, badges, captions and eyebrows. The ladder: dialog title 15/600, item name in the Inspector 14/600, panel and drawer title 13/600, section heading 12/600, body and rows 12/400, buttons, tabs and segments 12/500, meta 11/400 secondary, eyebrow 11/600 uppercase (menu groups and dialog sections only). Use weights 400, 500 and 600. Numbers that change while you look at them use tabular figures (`sb-tabular`); monospace is for ids, code, logs and live patch values.
- **Sizes.** Rows are 26px, fields 22px, panel header icon buttons 24px and toolbar controls 28px (`--row-h`, `--control-h-*`), and one row of controls shares one height. Anything interactive under 24px gets a 24px hit area (an `::after`) and 2px of room beside its neighbor. Panel and drawer headers are 34px (`--panel-header-h`): the title on the left with no icon tile, at most three icon actions on the right, and the collapse button last; a fourth action goes in a ⋯ menu. The toolbar is 44px. The collapsed bottom strip stays a 29px status bar, the one exception; it grows to the 34px header when opened.
- **Icon-only buttons** are for universal glyphs (close, add, more, collapse, zoom, undo, search) and always carry a tooltip (`IconButton` shows its label; pass `shortcut` when there is one). Anything that opens a mode, starts a Claude feature or matters on first run gets a visible label. Glyphs are 16px in the toolbar, 14px in headers, rails and rows, and 12px in chips, at stroke 1.75. One glyph per action across the app and one per layer type, shared by Layers and the patch editor; never one glyph for two meanings on a screen. The sparkle means Claude and nothing else, and Connect Claude is the plug.
- **Color.** Indigo (`--accent`) is selection, focus, the primary action, the active tab or segment, and links; never decoration, a gradient or a glow. Coral (`--ai`) is for Claude-authored content and Claude actions. Category colors belong to node headers and small category dots, port colors to port glyphs, and the status hues (danger, warn, success, info) to state. Text on a filled control reaches 4.5:1 (3:1 for a large icon-only glyph), tertiary text stays off selected and hovered rows, and status text passes 4.5:1 on its own tint in both themes.
- **Surfaces.** Window, toolbar and panels are one tone family separated by 1px `--border-subtle` hairlines, with no shadows or cards at the shell level. Inputs and wells use `--bg-field` or `--bg-sunken`, one level deep, never a bordered box inside a bordered box. A floating surface is `--bg-elevated` with a 1px ring and `--shadow-popover`; modals use `--shadow-modal`. Radii: 4px inline buttons and chips, 6px controls and rows, 8px cards and popovers, 12px dialogs, and 999px only for dots, badges and filter chips.
- **States.** Hover is `--bg-hover`. Selected is always an accent tint (`--bg-selected`, and `--bg-selected-hover` while hovered), never grey, and a selected segment takes the accent fill. The focus ring is 2px `--focus-ring` at a 1px offset, drawn only for keyboard focus (`:focus-visible`), with a forced-colors fallback. A disabled control says why in its tooltip.
- **Empty states** use `EmptyState` with `variant="inline"`: one left-aligned block under the header with a 12/600 title, one sentence of at most 14 words and at most one next step (a button or link, or a short row of starters), and no icon tile. Only a whole-panel first run (the Viewer with nothing to show, the Assistant) may center, with one 32px icon.
- **Motion.** Hover and press change color or background only, in 120ms (`--duration-fast`, `--ease-out`). Dialogs fade in with a 6px rise. Surfaces used constantly (the command palette, the patch picker, panel collapse) don't animate or fade in 100ms or less. Nothing loops decoratively; a spinner is for a wait. With reduced motion everything is instant, except that spinners turn slowly.
- **Dialogs** use `Dialog.Header` (a 15/600 title, an optional one-line description, an optional 24px close button), a scrolling `Dialog.Body`, and a `Dialog.Footer` with the primary button last and a destructive action on the left as a ghost-danger button. Pick a width from `DIALOG_WIDTH` (420, 540, 680). Welcome and New prototype (1120px), and the command palette and patch picker (32px rows), are the documented exceptions. A dialog that commits nothing needs only its close button; Settings, About and Connect Claude keep a Done button on purpose. Initial focus goes to the first field or the safe button, never the close button or a destructive one.
- **Tooltips.** The kit `Tooltip` is the only tooltip: 500ms first, about 120ms between neighbors, immediate on keyboard focus. Don't use `title` for guidance. Text that can be cut has an ellipsis and its full text in a tooltip, while instructions and errors wrap instead of truncating.
- **One control per job.** Play and pause live in the toolbar; a second copy is for the floating viewer or the command palette. A readout such as fps appears in one place.
- **Copy.** Sentence case for helper text, tooltips, empty states and aria-labels; Title Case only where a string mirrors a menu-bar or palette command title. Say what will happen instead of restating the label, don't say "click", and keep helper text to 14 words. An error says what failed and what to do next. Put curly quotes around names, and use no em dashes.

### Words

Text people read in the UI uses one word for one thing. Prompts and text written for Claude (Connect Claude's prompts, MCP tool text), and quotes in the README and guides, are not held to it.

- **prototype** is the thing you make. Say **project folder** only where files on disk matter, and **document** only in MCP and other Claude-facing text.
- **connect** and **disconnect** are for cables, and **driven by** is for a patch controlling a layer property. Never use "wire" or "link" as verbs.
- The **canvas** is the design surface, and the **patch editor** is the graph.
- **Claude** is the brand and the connected clients; the **Assistant** is the chat inside Sonobe.

## Code style

- TypeScript, strict ESM. Relative imports use explicit `.ts`/`.tsx` extensions.
- Import types with `import type`. Don't use enums, namespaces, or parameter properties, because the code runs under Node type stripping.
- Keep doc comments short on public APIs and skip filler comments.
- Format with Prettier (`npm run format`).

## Clean-room policy

Sonobe reimplements interaction-prototyping concepts from public documentation and observable behavior.

- Don't contribute code, assets, icons, device imagery, or text copied from Origami Studio, Meta, Apple, or any other proprietary product.
- Describe behavior in your own words.
- Mention other products only to describe compatibility (for example, the `origami` mapping fields in the catalog).
- SF Symbols are Apple's. The sfsymbol helper (`apps/desktop/native/sfsymbol`) draws them on the person's Mac when they import, from their copy of macOS. Never commit symbol artwork, exported symbol SVGs or PNGs, or Apple's symbol lists, not even as test fixtures: tests draw what they need at run time.

## Pull requests

- Keep PRs focused. Update docs and tests alongside the code.
- `npm run typecheck && npm test` must pass. CI (`.github/workflows/ci.yml`) runs them and `npm run e2e` on every pull request. A second CI job builds the desktop package and runs `npm run package:verify -w @sonobe/desktop` on it, so a change that breaks packaging fails there.
- For UI changes, attach a screenshot or short recording.
- Be kind. People of every experience level contribute here, and helping beginners is part of the mission.
