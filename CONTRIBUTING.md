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
   - A prototype rests while nothing changes (ARCHITECTURE.md §5.2). A patch that waits on something no input event announces (a timer, a request, a service it polls) calls `ctx.requestNextFrame()` on every frame while it waits, or it freezes at rest. Assert it in the test (`requestedNextFrame`), and when the patch keeps state across a wait, check a whole document over a rest with `runRested` from `@sonobe/engine/testing`.
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

## Measuring editor speed

`npm run bench -w @sonobe/editor` builds the editor into a temp folder, serves it, and drives it in headless Chromium (`apps/editor/scripts/bench`). It times boot and first opens, then twelve interactions on `examples/02-like-toggle` and on a generated 302-patch, 302-layer document, and prints main-thread time per second, the animation frames the app asked for and the frames the prototype stepped per second, frame times and long tasks. It asserts nothing and isn't part of `npm test` or CI.

1. Compare two builds in one run, never against numbers from another day or another machine. Serve the build to compare against (`npx vite preview --outDir <its dist> --port 5260` from `apps/editor`) and pass `--baseline http://localhost:5260`: the builds take turns, and the table shows both with the difference. Run a build against itself once to see how much the numbers move on their own.
2. Narrow a run while you work: `--only stress --filter scrub,dragLayer --reps 3`. `--throttle 4` stands in for a slower machine, `--profile <folder>` writes a CPU profile per interaction for DevTools, and `--trace` prints the timeline's busiest events (Layerize, Layout, Paint).
3. Frame times rarely move on a fast machine, so read main-thread ms per second first. Put the before and after numbers in the commit message, and leave out a change that doesn't show.

The interactions are synthetic: 60 awaited mouse steps per drag, with the prototype playing. The example is still, so its idle rows should read about 0 rAF/s and 0 steps/s, with main-thread time near the `paused.idle` row; the stress document never stops moving, so its rows show what a frame costs. `run.ts` lists the options.

What one frame costs without a browser is in two test files, which print it per case and hold it to a budget (about three times the case's cost on a quiet laptop, so read the printed figure for anything smaller): `packages/engine/src/runtime/benchmark.test.ts` (the engine's step) and `packages/renderer/src/perf.test.ts` (the draw, with its style writes counted). Run them with `npx vitest run <file> --reporter=default` before and after a change to the scene build, layout or the renderer, and add a case when yours needs one.

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
- A panel or dialog whose code loads on demand is a `loadable` (`apps/editor/src/ui/loadable.tsx`), not `React.lazy` under Suspense, which holds content back 300 ms after its fallback shows. `e2e/boot.spec.ts` checks that with the page's clock stopped. A loadable contains what it loads: with a `fallback` it says a problem in place, and without one it closes through `onFailed`.
- A new part of the editor is contained (ARCHITECTURE §9, Error containment), so a bug in it never blanks the window. A panel in an `AppShell` slot already is, and so is a `loadable`. Wrap anything else: a region inside a panel in `ErrorBoundary` (`apps/editor/src/ui/ErrorBoundary.tsx`) with a `name` that reads as a sentence starts (“The Knobs tab”) and no other boundary uses, and a dialog in `DialogBoundary`, whose `onFailed` closes it or settles what was waiting. Boundaries never log; the root's handlers do.
- To see a part of the editor fail, call `window.__sonobe.failRender("The Inspector")` in a dev build (or any build opened with `?sonobeTest`): the boundary with that name catches an error on its next render. `failRender("Sonobe")` is the whole editor, which shows the recovery screen; `failRender(name, false)` lets go. `e2e/resilience.spec.ts` drives it.
- Format with Prettier (`npm run format`).

## Clean-room policy

Sonobe reimplements interaction-prototyping concepts from public documentation and observable behavior.

- Don't contribute code, assets, icons, device imagery, or text copied from Origami Studio, Meta, Apple, or any other proprietary product.
- Describe behavior in your own words.
- Mention other products only to describe compatibility (for example, the `origami` mapping fields in the catalog).
- SF Symbols are Apple's. The sfsymbol helper (`apps/desktop/native/sfsymbol`) draws them on the person's Mac when they import, from their copy of macOS. Never commit symbol artwork, exported symbol SVGs or PNGs, or Apple's symbol lists, not even as test fixtures: tests draw what they need at run time.

## Pull requests

- Keep PRs focused. Update docs and tests alongside the code.
- `npm run typecheck && npm test` must pass. CI (`.github/workflows/ci.yml`) runs them and `npm run e2e` on every pull request.
- For UI changes, attach a screenshot or short recording.
- Be kind. People of every experience level contribute here, and helping beginners is part of the mission.
